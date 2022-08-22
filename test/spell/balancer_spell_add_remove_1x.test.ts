import { SignerWithAddress } from '@nomiclabs/hardhat-ethers/signers';
import chai, { expect } from 'chai';
import { BigNumber } from 'ethers';
import { ethers } from 'hardhat';
import { ADDRESS, CONTRACT_NAMES } from '../../constants';
import {
  SimpleOracle,
  IBalancerPool,
  ERC20,
  ICErc20,
  WERC20,
  BalancerPairOracle,
  CoreOracle,
  ProxyOracle,
  BlueBerryBank,
  IComptroller,
  ICEtherEx,
  IERC20Ex,
  BalancerSpellV1,
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
    it('Add / Remove 1x Testing', async () => {
      const daiAddr = ADDRESS.DAI;
      const wethAddr = ADDRESS.WETH;
      const balancerPoolAddr = ADDRESS.BAL_WETH_DAI_8020;
      const curveDaiAddr = ADDRESS.crDAI;
      const comptrollerAddr = ADDRESS.CM_COMP;
      const cmEthAddr = ADDRESS.cmETH;
      const cmDaiAddr = ADDRESS.cmDAI;
      const daiAuthAddr = ADDRESS.daiAuth;

      const dai = <IERC20Ex>(
        await ethers.getContractAt(CONTRACT_NAMES.IERC20Ex, daiAddr)
      );
      const weth = <IERC20Ex>(
        await ethers.getContractAt(CONTRACT_NAMES.IERC20Ex, wethAddr)
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
      const curveDai = <ICErc20>(
        await ethers.getContractAt(CONTRACT_NAMES.ICErc20, curveDaiAddr)
      );

      const WERC20 = await ethers.getContractFactory(CONTRACT_NAMES.WERC20);
      wERC20 = <WERC20>await WERC20.deploy();

      const SimpleOracleFactory = await ethers.getContractFactory(
        CONTRACT_NAMES.SimpleOracle
      );
      simpleOracle = <SimpleOracle>await SimpleOracleFactory.deploy();
      await simpleOracle.deployed();
      await simpleOracle.setETHPx(
        [wethAddr, daiAddr],
        [
          '5192296858534827628530496329220096',
          '8887571220661441971398610676149',
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

      await oracle.setWhitelistERC1155([wERC20.address], true);
      await coreOracle.setRoute(
        [wethAddr, daiAddr, balancerPoolAddr],
        [simpleOracle.address, simpleOracle.address, balancerOracle.address]
      );
      await oracle.setTokenFactors(
        [wethAddr, daiAddr, balancerPoolAddr],
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

      await blueberryBank.addBank(daiAddr, cmDaiAddr);

      const token_amount = BigNumber.from(10)
        .pow(12)
        .mul(BigNumber.from(10).pow(18));
      // Dai mint to alice
      await hre.network.provider.request({
        method: 'hardhat_impersonateAccount',
        params: [daiAuthAddr],
      });
      await hre.network.provider.send('hardhat_setBalance', [
        daiAuthAddr,
        '0xFFFFFFFFFFFFFFF',
      ]);
      const auth = await ethers.getSigner(daiAuthAddr);
      await dai
        .connect(auth)
        ['mint(address,uint256)'](alice.address, token_amount.mul(2));

      // Weth mint to alice
      await hre.network.provider.send('hardhat_setBalance', [
        alice.address,
        '0xFFFFFFFFFFFFFFFFFFFFFFFFFFFFFF',
      ]);
      await weth.connect(alice)['deposit()']({
        value: token_amount.mul(2),
      });

      console.log('Alice WETH Balance: ', await weth.balanceOf(alice.address));
      console.log('Alice Dai Balance: ', await dai.balanceOf(alice.address));

      let amt_desired = BigNumber.from(10).pow(100);
      dai.connect(alice).approve(balancerPool.address, 0);
      dai
        .connect(alice)
        .approve(balancerPool.address, token_amount.mul(20).div(100));
      const balanceLPTotalSupply = await balancerLP.totalSupply();
      const daiBalanceInLP = await balancerLP.getBalance(dai.address);
      amt_desired = amt_desired.lt(
        token_amount
          .mul(20)
          .div(100)
          .mul(balanceLPTotalSupply)
          .div(daiBalanceInLP)
      )
        ? amt_desired
        : token_amount
            .mul(20)
            .div(100)
            .mul(balanceLPTotalSupply)
            .div(daiBalanceInLP);
      weth.connect(alice).approve(balancerPool.address, 0);
      weth
        .connect(alice)
        .approve(balancerPool.address, token_amount.mul(80).div(100));
      const wethBalanceInLP = await balancerLP.getBalance(weth.address);
      amt_desired = amt_desired.lt(
        token_amount
          .mul(80)
          .div(100)
          .mul(balanceLPTotalSupply)
          .div(wethBalanceInLP)
      )
        ? amt_desired
        : token_amount
            .mul(80)
            .div(100)
            .mul(balanceLPTotalSupply)
            .div(wethBalanceInLP);
      await balancerLP
        .connect(alice)
        .joinPool(amt_desired.mul(9).div(10), [
          token_amount.mul(20).div(100),
          token_amount.mul(80).div(100),
        ]);

      await dai
        .connect(alice)
        .approve(blueberryBank.address, BigNumber.from(2).pow(256).sub(1));

      await dai
        .connect(alice)
        .approve(curveDai.address, BigNumber.from(2).pow(256).sub(1));

      await weth
        .connect(alice)
        .approve(blueberryBank.address, BigNumber.from(2).pow(256).sub(1));

      await balancerLP
        .connect(alice)
        .approve(blueberryBank.address, BigNumber.from(2).pow(256).sub(1));

      const BalancerSpellV1Factory = await ethers.getContractFactory(
        CONTRACT_NAMES.BalancerSpellV1
      );
      balancerSpellV1 = <BalancerSpellV1>(
        await BalancerSpellV1Factory.deploy(
          blueberryBank.address,
          wERC20.address,
          weth.address
        )
      );
      await balancerSpellV1.deployed();

      blueberryBank.setWhitelistSpells([balancerSpellV1.address], [true]);
      balancerSpellV1.setWhitelistLPTokens([balancerLP.address], [true]);
      console.log(
        '========================================================================='
      );
      console.log('Case 1.');

      let prevABal = await dai.balanceOf(alice.address);
      let prevBBal = await weth.balanceOf(alice.address);
      let prevLPBal = await balancerLP.balanceOf(alice.address);
      let prevLPBalBank = await balancerLP.balanceOf(blueberryBank.address);
      let prevLPBalWERC20 = await balancerLP.balanceOf(wERC20.address);

      let prevARes = await balancerPool.getBalance(dai.address);
      let prevBRes = await balancerPool.getBalance(weth.address);

      const daiAmt = BigNumber.from(10).pow(18).mul(400);
      const wethAmt = BigNumber.from(10).pow(18).mul(1600);
      const lpAmt = BigNumber.from(10).pow(18).mul(4);
      const borrowDaiAmt = BigNumber.from(0);
      const borrowWethAmt = BigNumber.from(0);

      const totalDaiAmt = daiAmt.add(borrowDaiAmt);
      const totalWethAmt = wethAmt.add(borrowWethAmt);
      const daiWeight = 0.2;
      const wethWeight = 0.8;

      const ratio1 = new Decimal(prevARes.toString())
        .add(new Decimal(totalDaiAmt.toString()))
        .div(new Decimal(prevARes.toString()))
        .pow(daiWeight);

      const ratio2 = new Decimal(prevBRes.toString())
        .add(new Decimal(totalWethAmt.toString()))
        .div(new Decimal(prevBRes.toString()))
        .pow(wethWeight);

      const ratio = ratio1.mul(ratio2).sub(1);

      const lpTotalSupply = await balancerLP.totalSupply();
      const lpDesired = lpAmt.add(
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
        balancerSpellV1.interface.encodeFunctionData('addLiquidityWERC20', [
          balancerLP.address,
          {
            amtAUser: daiAmt,
            amtBUser: wethAmt,
            amtLPUser: lpAmt,
            amtABorrow: borrowDaiAmt,
            amtBBorrow: borrowWethAmt,
            amtLPBorrow: 0,
            amtLPDesired: lpDesired,
          },
        ])
      );

      let curABal = await dai.balanceOf(alice.address);
      let curBBal = await weth.balanceOf(alice.address);
      let curLPBal = await balancerLP.balanceOf(alice.address);
      let curLPBalBank = await balancerLP.balanceOf(blueberryBank.address);
      let curLPBalWERC20 = await balancerLP.balanceOf(wERC20.address);

      let curARes = await balancerPool.getBalance(dai.address);
      let curBRes = await balancerPool.getBalance(weth.address);

      console.log(
        'Spell LP Balance: ',
        await balancerLP.balanceOf(balancerSpellV1.address)
      );

      console.log('Alice Delta A Balance: ', curABal.sub(prevABal));

      console.log('Alice Delta B Balance: ', curBBal.sub(prevBBal));

      console.log('Bank LP Balance: ', curLPBalBank);

      let bankInfo = await blueberryBank.getBankInfo(dai.address);
      console.log('Bank Dai DaiDebt: ', bankInfo.totalDebt);
      console.log('Bank Dai DaiShare: ', bankInfo.totalShare);

      console.log('Bank Prev LP Balance: ', prevLPBalBank);
      console.log('Bank Cur LP Balance: ', curLPBalBank);

      console.log('wERC20 Prev LP Balance: ', prevLPBalWERC20);
      console.log('wERC20 Cur LP Balance: ', curLPBalWERC20);

      console.log('Prev Dai Res: ', prevARes);
      console.log('Cur Dai Res: ', curARes);

      console.log('Prev WETH Res: ', prevBRes);
      console.log('Cur WETH Res: ', curBRes);

      expect(curABal.sub(prevABal)).to.be.roughlyNear(daiAmt.mul(-1));
      expect(curBBal.sub(prevBBal)).to.be.roughlyNear(wethAmt.mul(-1));
      expect(curLPBal.sub(prevLPBal)).to.be.equal(lpAmt.mul(-1));

      expect(await dai.balanceOf(balancerSpellV1.address)).to.be.equal(0);
      expect(await weth.balanceOf(balancerSpellV1.address)).to.be.equal(0);
      expect(await balancerLP.balanceOf(balancerSpellV1.address)).to.be.equal(
        0
      );
      expect(bankInfo.totalDebt).to.be.equal(borrowDaiAmt);

      expect(curABal.sub(prevABal).sub(borrowDaiAmt)).to.be.roughlyNear(
        curARes.sub(prevARes).mul(-1)
      );
      expect(curBBal.sub(prevBBal).sub(borrowWethAmt)).to.be.roughlyNear(
        curBRes.sub(prevBRes).mul(-1)
      );

      console.log(
        '========================================================================='
      );
      console.log('Case 2.');

      prevABal = await dai.balanceOf(alice.address);
      prevBBal = await weth.balanceOf(alice.address);
      prevLPBal = await balancerLP.balanceOf(alice.address);
      prevLPBalBank = await balancerLP.balanceOf(blueberryBank.address);
      prevLPBalWERC20 = await balancerLP.balanceOf(wERC20.address);
      let prevETHBal = await hre.waffle.provider.getBalance(alice.address);

      prevARes = await balancerPool.getBalance(dai.address);
      prevBRes = await balancerPool.getBalance(weth.address);

      let lpTakeAmt = BigNumber.from(2).pow(256).sub(1);
      let lpWant = BigNumber.from(10).pow(15);
      let daiRepay = BigNumber.from(2).pow(256).sub(1);
      let wethRepay = 0;

      let realDaiRepay = await blueberryBank.borrowBalanceStored(
        1,
        dai.address
      );

      const positionInfo = await blueberryBank.getPositionInfo(1);

      await blueberryBank.connect(alice).execute(
        1,
        balancerSpellV1.address,
        balancerSpellV1.interface.encodeFunctionData('removeLiquidityWERC20', [
          balancerLP.address,
          {
            amtLPTake: lpTakeAmt,
            amtLPWithdraw: lpWant,
            amtARepay: daiRepay,
            amtBRepay: wethRepay,
            amtLPRepay: 0,
            amtAMin: 0,
            amtBMin: 0,
          },
        ])
      );

      curABal = await dai.balanceOf(alice.address);
      curBBal = await weth.balanceOf(alice.address);
      curLPBal = await balancerLP.balanceOf(alice.address);
      curLPBalBank = await balancerLP.balanceOf(blueberryBank.address);
      curLPBalWERC20 = await balancerLP.balanceOf(wERC20.address);
      let curETHBal = await hre.waffle.provider.getBalance(alice.address);

      curARes = await balancerPool.getBalance(dai.address);
      curBRes = await balancerPool.getBalance(weth.address);

      console.log(
        'Spell LP Balance: ',
        await balancerLP.balanceOf(balancerSpellV1.address)
      );
      console.log(
        'Spell Dai Balance: ',
        await dai.balanceOf(balancerSpellV1.address)
      );
      console.log(
        'Spell Weth Balance',
        await weth.balanceOf(balancerSpellV1.address)
      );
      console.log('Alice Delta A Balance', curABal.sub(prevABal));
      console.log('Alice Delta B Balance', curBBal.sub(prevBBal));
      console.log('Alice Delta ETH Balance', curETHBal.sub(prevETHBal));
      console.log('Alice Delta LP Balance', curLPBal.sub(prevLPBal));
      console.log('Bank Delta LP Balance', curLPBalBank.sub(prevLPBalBank));
      console.log('Bank Total LP Balance', curLPBalBank);

      bankInfo = await blueberryBank.getBankInfo(dai.address);

      console.log('Bank Dai DaiDebt: ', bankInfo.totalDebt);
      console.log('Bank Dai DaiShare: ', bankInfo.totalShare);

      console.log('LP Want: ', lpWant);

      console.log('Bank Delta LP Amount: ', curLPBalBank.sub(prevLPBalBank));
      console.log('LP Take Amount: ', lpTakeAmt);

      console.log('Prev WERC20 LP Balance: ', prevLPBalWERC20);
      console.log('Cur WERC20 LP Balance: ', curLPBalWERC20);

      console.log('Real Dai Repay: ', realDaiRepay);

      expect(curBBal.sub(prevBBal)).to.be.roughlyNear(BigNumber.from(0));
      expect(curLPBal.sub(prevLPBal)).to.be.roughlyNear(lpWant);

      expect(curLPBalWERC20.sub(prevLPBalWERC20)).to.be.roughlyNear(
        positionInfo.collateralSize
      );

      expect(await dai.balanceOf(balancerSpellV1.address)).to.be.equal(0);
      expect(await weth.balanceOf(balancerSpellV1.address)).to.be.equal(0);
      expect(await balancerLP.balanceOf(balancerSpellV1.address)).to.be.equal(
        0
      );

      expect(curABal.sub(prevABal).add(realDaiRepay)).to.be.roughlyNear(
        curARes.sub(prevARes).mul(-1)
      );
      expect(curBBal.sub(prevBBal)).to.be.roughlyNear(BigNumber.from(0));
      expect(curETHBal.sub(prevETHBal).add(wethRepay)).to.be.roughlyNear(
        curBRes.sub(prevBRes).mul(-1)
      );
    });
  });
});
