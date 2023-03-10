// SPDX-License-Identifier: MIT

pragma solidity ^0.8.9;

interface IComptroller {
    function enterMarkets(address[] memory cTokens)
        external
        returns (uint256[] memory);
}
