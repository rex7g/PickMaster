// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";

/// @title MockUSDC — test collateral for Base Sepolia ONLY (§52).
/// @notice Open faucet, 6 decimals like real USDC. Never deploy to mainnet;
///         production uses canonical USDC (§5).
contract MockUSDC is ERC20 {
    uint256 public constant FAUCET_LIMIT = 10_000e6; // 10,000 USDC per call

    constructor() ERC20("PickMaster Test USDC", "tUSDC") {}

    function decimals() public pure override returns (uint8) {
        return 6;
    }

    function faucet(address to, uint256 amount) external {
        require(amount <= FAUCET_LIMIT, "faucet: amount too large");
        _mint(to, amount);
    }
}
