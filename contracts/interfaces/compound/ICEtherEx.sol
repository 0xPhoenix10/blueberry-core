// SPDX-License-Identifier: MIT

pragma solidity ^0.8.9;

// Export ICEther interface for mainnet-fork testing.
interface ICEtherEx {
    function mint() external payable;
}
