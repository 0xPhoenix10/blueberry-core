import { SignerWithAddress } from '@nomiclabs/hardhat-ethers/signers';
import { time } from '@nomicfoundation/hardhat-network-helpers';
import chai, { expect } from 'chai';
import { BigNumber } from 'ethers';
import { ethers } from 'hardhat';
import { ADDRESS, CONTRACT_NAMES } from '../../constants';
import {
  SimpleOracle,
  IBalancerPool,
  WERC20,
  BalancerPairOracle,
  CoreOracle,
  ProxyOracle,
  BlueBerryBank,
  IComptroller,
  ICEtherEx,
  IERC20Ex,
  BalancerSpellV1,
  MockCErc20,
  WStakingRewards,
  IStakingRewards,
} from '../../typechain-types';
import { solidity } from 'ethereum-waffle';
import { near } from '../assertions/near';
import { roughlyNear } from '../assertions/roughlyNear';
import Decimal from 'decimal.js';
import hre from 'hardhat';

chai.use(solidity);
chai.use(near);
chai.use(roughlyNear);

describe('Balancer Spell', () => {
  let admin: SignerWithAddress;
  let alice: SignerWithAddress;
  let bob: SignerWithAddress;
  let eve: SignerWithAddress;

  let wERC20: WERC20;
  let simpleOracle: SimpleOracle;
  let balancerOracle: BalancerPairOracle;
  let coreOracle: CoreOracle;
  let oracle: ProxyOracle;
  let blueberryBank: BlueBerryBank;
  let balancerSpellV1: BalancerSpellV1;
  before(async () => {
    [admin, alice, bob, eve] = await ethers.getSigners();
  });

  describe('Basic', async () => {
    it('wStaking Harvest Testing', async () => {
      const dfdAddr = ADDRESS.DFD;
      const dusdAddr = ADDRESS.DUSD;
      const wethAddr = ADDRESS.WETH;
      const balancerPoolAddr = ADDRESS.BAL_DFD_DUSD_5842;
      const comptrollerAddr = ADDRESS.CM_COMP;
      const cmEthAddr = ADDRESS.cmETH;

      const dfd = <IERC20Ex>(
        await ethers.getContractAt(CONTRACT_NAMES.IERC20Ex, dfdAddr)
      );
      const dusd = <IERC20Ex>(
        await ethers.getContractAt(CONTRACT_NAMES.IERC20Ex, dusdAddr)
      );
      const balancerLP = <IERC20Ex>(
        await ethers.getContractAt(CONTRACT_NAMES.IERC20Ex, balancerPoolAddr)
      );
      const balancerPool = <IBalancerPool>(
        await ethers.getContractAt(
          CONTRACT_NAMES.IBalancerPool,
          balancerPoolAddr
        )
      );

      const MockCERC20Factory = await ethers.getContractFactory(
        CONTRACT_NAMES.MockCErc20
      );
      const crdfd = <MockCErc20>await MockCERC20Factory.deploy(dfd.address);
      await crdfd.deployed();
      const crdusd = <MockCErc20>await MockCERC20Factory.deploy(dusd.address);
      await crdusd.deployed();

      const WERC20 = await ethers.getContractFactory(CONTRACT_NAMES.WERC20);
      wERC20 = <WERC20>await WERC20.deploy();

      let stakingAddr = '0xF068236eCAd5FAbb9883bbb26A6445d6C7c9A924';
      await hre.network.provider.request({
        method: 'hardhat_impersonateAccount',
        params: [stakingAddr],
      });
      await hre.network.provider.send('hardhat_setBalance', [
        stakingAddr,
        '0xFFFFFFFFFFFFFFF',
      ]);

      const staking = await ethers.getSigner(stakingAddr);

      const WStakingFactory = await ethers.getContractFactory(
        CONTRACT_NAMES.WStakingRewards
      );
      const wStaking = <WStakingRewards>(
        await WStakingFactory.deploy(
          staking.address,
          balancerLP.address,
          dfd.address
        )
      );

      const SimpleOracleFactory = await ethers.getContractFactory(
        CONTRACT_NAMES.SimpleOracle
      );
      simpleOracle = <SimpleOracle>await SimpleOracleFactory.deploy();
      await simpleOracle.deployed();
      await simpleOracle.setETHPx(
        [dfd.address, dusd.address],
        [
          BigNumber.from(2).pow(112).div(2).div(700),
          BigNumber.from(2).pow(112).mul(2).div(700),
        ]
      );

      const BalancerPairOracleFactory = await ethers.getContractFactory(
        CONTRACT_NAMES.BalancerPairOracle
      );
      balancerOracle = <BalancerPairOracle>(
        await BalancerPairOracleFactory.deploy(simpleOracle.address)
      );
      await balancerOracle.deployed();

      const CoreOracleFactory = await ethers.getContractFactory(
        CONTRACT_NAMES.CoreOracle
      );
      coreOracle = <CoreOracle>await CoreOracleFactory.deploy();
      await coreOracle.deployed();

      const ProxyOracleFactory = await ethers.getContractFactory(
        CONTRACT_NAMES.ProxyOracle
      );
      oracle = <ProxyOracle>await ProxyOracleFactory.deploy(coreOracle.address);
      await oracle.deployed();

      await oracle.setWhitelistERC1155(
        [wERC20.address, wStaking.address],
        true
      );
      await coreOracle.setRoute(
        [dfdAddr, dusdAddr, balancerPoolAddr],
        [simpleOracle.address, simpleOracle.address, balancerOracle.address]
      );
      await oracle.setTokenFactors(
        [dfdAddr, dusdAddr, balancerPoolAddr],
        [
          {
            borrowFactor: 10000,
            collateralFactor: 10000,
            liqIncentive: 10000,
          },
          {
            borrowFactor: 10000,
            collateralFactor: 10000,
            liqIncentive: 10000,
          },
          {
            borrowFactor: 10000,
            collateralFactor: 10000,
            liqIncentive: 10000,
          },
        ]
      );

      const BlueBerryFactory = await ethers.getContractFactory(
        CONTRACT_NAMES.BlueBerryBank
      );
      blueberryBank = <BlueBerryBank>await BlueBerryFactory.deploy();
      await blueberryBank.deployed();
      await blueberryBank.initialize(oracle.address, 1000);

      const controller = <IComptroller>(
        await ethers.getContractAt(CONTRACT_NAMES.IComptroller, comptrollerAddr)
      );
      const cmEth = <ICEtherEx>(
        await ethers.getContractAt(CONTRACT_NAMES.ICEtherEx, cmEthAddr)
      );
      await cmEth
        .connect(eve)
        ['mint()']({ value: ethers.utils.parseEther('90') });

      const eve_cmEth_balance = await cmEth.balanceOf(eve.address);
      await cmEth
        .connect(eve)
        .transfer(blueberryBank.address, eve_cmEth_balance);

      await hre.network.provider.request({
        method: 'hardhat_impersonateAccount',
        params: [blueberryBank.address],
      });
      await hre.network.provider.send('hardhat_setBalance', [
        blueberryBank.address,
        '0xFFFFFFFFFFFFFFF',
      ]); // Force Set Balance of Blueberry Bank Contract

      const blueberryBankSigner = await ethers.getSigner(blueberryBank.address);
      await controller
        .connect(blueberryBankSigner)
        .enterMarkets([cmEth.address]);

      await blueberryBank.addBank(dfdAddr, crdfd.address);
      await blueberryBank.addBank(dusdAddr, crdusd.address);

      const token_amount = BigNumber.from(10)
        .pow(12)
        .mul(BigNumber.from(10).pow(18));
      // DFD mint to alice & bob
      const dfdGov = await dfd.governance();
      await hre.network.provider.request({
        method: 'hardhat_impersonateAccount',
        params: [dfdGov],
      });
      await hre.network.provider.send('hardhat_setBalance', [
        dfdGov,
        '0xFFFFFFFFFFFFFFF',
      ]);
      const dfdGovSigner = await ethers.getSigner(dfdGov);
      await dfd
        .connect(dfdGovSigner)
        ['mint(address,uint256)'](alice.address, token_amount.mul(2));
      await dfd
        .connect(dfdGovSigner)
        ['mint(address,uint256)'](bob.address, token_amount);

      // DUSD mint to alice & bob
      const dusdCore = await dusd.core();
      await hre.network.provider.request({
        method: 'hardhat_impersonateAccount',
        params: [dusdCore],
      });
      await hre.network.provider.send('hardhat_setBalance', [
        dusdCore,
        '0xFFFFFFFFFFFFFFF',
      ]);
      const dusdCoreSigner = await ethers.getSigner(dusdCore);
      await dusd
        .connect(dusdCoreSigner)
        ['mint(address,uint256)'](alice.address, token_amount.mul(2));
      await dusd
        .connect(dusdCoreSigner)
        ['mint(address,uint256)'](bob.address, token_amount);
      await hre.network.provider.send('hardhat_setBalance', [
        alice.address,
        '0xFFFFFFFFFFFFFFFFFFFFFFFFFFFFFF',
      ]);

      // console.log('Alice DUSD Balance: ', await dusd.balanceOf(alice.address));
      // console.log('Alice DFD Balance: ', await dfd.balanceOf(alice.address));

      // LP Mint to alice
      let amt_desired = BigNumber.from(10).pow(100);
      dfd.connect(alice).approve(balancerPool.address, 0);
      dfd
        .connect(alice)
        .approve(balancerPool.address, token_amount.mul(58).div(100));
      let balanceLPTotalSupply = await balancerLP.totalSupply();
      let dfdBalanceInLP = await balancerLP.getBalance(dfd.address);
      amt_desired = amt_desired.lt(
        token_amount
          .mul(58)
          .div(100)
          .mul(balanceLPTotalSupply)
          .div(dfdBalanceInLP)
      )
        ? amt_desired
        : token_amount
            .mul(58)
            .div(100)
            .mul(balanceLPTotalSupply)
            .div(dfdBalanceInLP);
      dusd.connect(alice).approve(balancerPool.address, 0);
      dusd
        .connect(alice)
        .approve(balancerPool.address, token_amount.mul(42).div(100));
      let dusdBalanceInLP = await balancerLP.getBalance(dusd.address);
      amt_desired = amt_desired.lt(
        token_amount
          .mul(42)
          .div(100)
          .mul(balanceLPTotalSupply)
          .div(dusdBalanceInLP)
      )
        ? amt_desired
        : token_amount
            .mul(42)
            .div(100)
            .mul(balanceLPTotalSupply)
            .div(dusdBalanceInLP);
      await balancerLP
        .connect(alice)
        .joinPool(amt_desired.mul(9).div(10), [
          token_amount.mul(58).div(100),
          token_amount.mul(42).div(100),
        ]);

      // LP Mint to Bob
      amt_desired = BigNumber.from(10).pow(100);
      dfd.connect(bob).approve(balancerPool.address, 0);
      dfd
        .connect(bob)
        .approve(balancerPool.address, token_amount.mul(58).div(100));
      balanceLPTotalSupply = await balancerLP.totalSupply();
      dfdBalanceInLP = await balancerLP.getBalance(dfd.address);
      amt_desired = amt_desired.lt(
        token_amount
          .mul(58)
          .div(100)
          .mul(balanceLPTotalSupply)
          .div(dfdBalanceInLP)
      )
        ? amt_desired
        : token_amount
            .mul(58)
            .div(100)
            .mul(balanceLPTotalSupply)
            .div(dfdBalanceInLP);
      dusd.connect(bob).approve(balancerPool.address, 0);
      dusd
        .connect(bob)
        .approve(balancerPool.address, token_amount.mul(42).div(100));
      dusdBalanceInLP = await balancerLP.getBalance(dusd.address);
      amt_desired = amt_desired.lt(
        token_amount
          .mul(42)
          .div(100)
          .mul(balanceLPTotalSupply)
          .div(dusdBalanceInLP)
      )
        ? amt_desired
        : token_amount
            .mul(42)
            .div(100)
            .mul(balanceLPTotalSupply)
            .div(dusdBalanceInLP);
      await balancerLP
        .connect(bob)
        .joinPool(amt_desired.mul(9).div(10), [
          token_amount.mul(58).div(100),
          token_amount.mul(42).div(100),
        ]);

      await dfd
        .connect(alice)
        .approve(blueberryBank.address, BigNumber.from(2).pow(256).sub(1));

      await dfd
        .connect(alice)
        .approve(crdfd.address, BigNumber.from(2).pow(256).sub(1));

      await dusd
        .connect(alice)
        .approve(blueberryBank.address, BigNumber.from(2).pow(256).sub(1));

      await dusd
        .connect(alice)
        .approve(crdusd.address, BigNumber.from(2).pow(256).sub(1));

      await balancerLP
        .connect(alice)
        .approve(blueberryBank.address, BigNumber.from(2).pow(256).sub(1));

      await balancerLP
        .connect(bob)
        .approve(staking.address, BigNumber.from(2).pow(256).sub(1));

      const BalancerSpellV1Factory = await ethers.getContractFactory(
        CONTRACT_NAMES.BalancerSpellV1
      );
      balancerSpellV1 = <BalancerSpellV1>(
        await BalancerSpellV1Factory.deploy(
          blueberryBank.address,
          wERC20.address,
          wethAddr
        )
      );
      await balancerSpellV1.deployed();

      blueberryBank.setWhitelistSpells([balancerSpellV1.address], [true]);
      balancerSpellV1.setWhitelistLPTokens([balancerLP.address], [true]);
      // console.log(
      //   '========================================================================='
      // );
      // console.log('Case 1.');

      let prevABal = await dfd.balanceOf(alice.address);
      let prevBBal = await dusd.balanceOf(alice.address);
      let prevLPBal = await balancerLP.balanceOf(alice.address);
      let prevLPBalBank = await balancerLP.balanceOf(blueberryBank.address);
      let prevLPBalStaking = await balancerLP.balanceOf(staking.address);

      let prevARes = await balancerPool.getBalance(dfd.address);
      let prevBRes = await balancerPool.getBalance(dusd.address);

      let dfdAmt = BigNumber.from(10).pow(18).mul(5800000);
      let dusdAmt = BigNumber.from(10).pow(18).mul(4200000);
      let lpAmt = BigNumber.from(0);
      const borrowDfdAmt = 0;
      const borrowDusdAmt = 0;

      let totalDfdAmt = dfdAmt.add(borrowDfdAmt);
      let totalDusdAmt = dusdAmt.add(borrowDusdAmt);
      const dfdWeight = 0.58;
      const dusdWeight = 0.42;

      let ratio1 = new Decimal(prevARes.toString())
        .add(new Decimal(totalDfdAmt.toString()))
        .div(new Decimal(prevARes.toString()))
        .pow(dfdWeight);

      let ratio2 = new Decimal(prevBRes.toString())
        .add(new Decimal(totalDusdAmt.toString()))
        .div(new Decimal(prevBRes.toString()))
        .pow(dusdWeight);

      let ratio = ratio1.mul(ratio2).sub(1);

      let lpTotalSupply = await balancerLP.totalSupply();
      let lpDesired = lpAmt.add(
        BigNumber.from(
          new Decimal(lpTotalSupply.toString())
            .mul(ratio)
            .mul(0.995)
            .toFixed(0)
            .toString()
        )
      );
      await blueberryBank.connect(alice).execute(
        0,
        balancerSpellV1.address,
        balancerSpellV1.interface.encodeFunctionData(
          'addLiquidityWStakingRewards',
          [
            balancerLP.address,
            {
              amtAUser: dfdAmt,
              amtBUser: dusdAmt,
              amtLPUser: lpAmt,
              amtABorrow: borrowDfdAmt,
              amtBBorrow: borrowDusdAmt,
              amtLPBorrow: 0,
              amtLPDesired: lpDesired,
            },
            wStaking.address,
          ]
        )
      );

      let curABal = await dfd.balanceOf(alice.address);
      let curBBal = await dusd.balanceOf(alice.address);
      let curLPBal = await balancerLP.balanceOf(alice.address);
      let curLPBalBank = await balancerLP.balanceOf(blueberryBank.address);
      let curLPBalStaking = await balancerLP.balanceOf(staking.address);

      let curARes = await balancerPool.getBalance(dfd.address);
      let curBRes = await balancerPool.getBalance(dusd.address);

      // console.log(
      //   'Spell LP Balance: ',
      //   await balancerLP.balanceOf(balancerSpellV1.address)
      // );

      // console.log('Alice Delta A Balance: ', curABal.sub(prevABal));
      // console.log('Alice Delta B Balance: ', curBBal.sub(prevBBal));

      // console.log('Bank LP Balance: ', curLPBalBank);

      let bankInfo = await blueberryBank.getBankInfo(dfd.address);
      // console.log('Bank DFD DfdDebt: ', bankInfo.totalDebt);
      // console.log('Bank DFD DfdShare: ', bankInfo.totalShare);

      // console.log('Bank Prev LP Balance: ', prevLPBalBank);
      // console.log('Bank Cur LP Balance: ', curLPBalBank);

      // console.log('Staking Prev LP Balance: ', prevLPBalStaking);
      // console.log('Staking Cur LP Balance: ', curLPBalStaking);

      // console.log('Prev Dfd Res: ', prevARes);
      // console.log('Cur Dfd Res: ', curARes);

      // console.log('Prev Dusd Res: ', prevBRes);
      // console.log('Cur Dusd Res: ', curBRes);

      expect(curABal.sub(prevABal)).to.be.roughlyNear(dfdAmt.mul(-1));
      expect(curBBal.sub(prevBBal)).to.be.roughlyNear(dusdAmt.mul(-1));
      expect(curLPBal.sub(prevLPBal)).to.be.equal(lpAmt.mul(-1));

      expect(await dfd.balanceOf(balancerSpellV1.address)).to.be.equal(0);
      expect(await dusd.balanceOf(balancerSpellV1.address)).to.be.equal(0);
      expect(await balancerLP.balanceOf(balancerSpellV1.address)).to.be.equal(
        0
      );
      expect(bankInfo.totalDebt).to.be.equal(borrowDfdAmt);

      expect(curABal.sub(prevABal).sub(borrowDfdAmt)).to.be.roughlyNear(
        curARes.sub(prevARes).mul(-1)
      );
      expect(curBBal.sub(prevBBal).sub(borrowDusdAmt)).to.be.roughlyNear(
        curBRes.sub(prevBRes).mul(-1)
      );

      // console.log(
      //   '========================================================================='
      // );
      // console.log('Case 2. harvest first time');

      let prevDfdBalance = await dfd.balanceOf(alice.address);
      // console.log('Alice DFD Balance Before Harvest: ', prevDfdBalance);

      let prevDfd = await dfd.balanceOf(bob.address);

      const positionInfo = await blueberryBank.getPositionInfo(1);
      const stakingRewards = <IStakingRewards>(
        await ethers.getContractAt(
          CONTRACT_NAMES.IStakingRewards,
          staking.address
        )
      );
      await stakingRewards.connect(bob).stake(positionInfo.collateralSize);

      await time.increase(20000);

      await blueberryBank
        .connect(alice)
        .execute(
          1,
          balancerSpellV1.address,
          balancerSpellV1.interface.encodeFunctionData(
            'harvestWStakingRewards',
            [wStaking.address]
          )
        );
      let curDfdBalance = await dfd.balanceOf(alice.address);
      // console.log('Alice DFD Balance After Harvest: ', curDfdBalance);
      let receivedDfd = curDfdBalance.sub(prevDfdBalance);

      await stakingRewards.connect(bob).getReward();
      let receivedDfdFromStaking = await dfd.balanceOf(bob.address);
      receivedDfdFromStaking = receivedDfdFromStaking.sub(prevDfd);
      // console.log('Received Dfd From Staking: ', receivedDfdFromStaking);
      expect(receivedDfd).to.be.roughlyNear(receivedDfdFromStaking);

      // console.log(
      //   '========================================================================='
      // );
      // console.log('Case 3. harvest second time');

      prevDfdBalance = await dfd.balanceOf(alice.address);
      // console.log('Alice DFD Balance Before Harvest: ', prevDfdBalance);

      prevDfd = await dfd.balanceOf(bob.address);

      await time.increase(20000);

      await blueberryBank
        .connect(alice)
        .execute(
          1,
          balancerSpellV1.address,
          balancerSpellV1.interface.encodeFunctionData(
            'harvestWStakingRewards',
            [wStaking.address]
          )
        );

      curDfdBalance = await dfd.balanceOf(alice.address);
      // console.log('Alice DFD Balance After Harvest: ', curDfdBalance);
      receivedDfd = curDfdBalance.sub(prevDfdBalance);

      await stakingRewards.connect(bob).getReward();
      receivedDfdFromStaking = await dfd.balanceOf(bob.address);
      receivedDfdFromStaking = receivedDfdFromStaking.sub(prevDfd);
      // console.log('Received Dfd From Staking: ', receivedDfdFromStaking);
      expect(receivedDfd).to.be.roughlyNear(receivedDfdFromStaking);
    }).timeout(1000000);
  });
});
