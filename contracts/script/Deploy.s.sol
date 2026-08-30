// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {Script, console} from "forge-std/Script.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {MockUSDC} from "../src/MockUSDC.sol";
import {MarketRegistry} from "../src/MarketRegistry.sol";
import {PositionToken} from "../src/PositionToken.sol";
import {CollateralVault} from "../src/CollateralVault.sol";
import {ResolutionManager} from "../src/ResolutionManager.sol";
import {Exchange} from "../src/Exchange.sol";

/// @title Deploy — Base Sepolia testnet deployment (§52, Fase 2).
/// @notice Usage:
///   export PRIVATE_KEY=0x...           # funded Base Sepolia key
///   forge script script/Deploy.s.sol --rpc-url base_sepolia --broadcast
///
/// Environment overrides:
///   USDC_ADDRESS   — reuse an existing collateral token (default: deploy MockUSDC)
///   TREASURY       — fee/bond treasury (default: deployer)
///   GUARDIAN       — emergency-pause guardian (default: deployer; use the
///                    multisig in staging and beyond, §41)
///   DISPUTE_BOND   — USDC units (default 100e6)
///   FEE_BPS        — trading fee in bps (default 20 = 0.20%)
///
/// On testnet the deployer holds every operational role (creator, proposer,
/// arbitrator, operator) for simulation convenience (§52). NEVER replicate
/// that on mainnet: roles go to the backend service keys, the oracle
/// aggregator and the arbitration multisig behind a timelock.
contract Deploy is Script {
    function run() external {
        uint256 pk = vm.envUint("PRIVATE_KEY");
        address deployer = vm.addr(pk);
        address treasury = vm.envOr("TREASURY", deployer);
        address guardian = vm.envOr("GUARDIAN", deployer);
        uint256 disputeBond = vm.envOr("DISPUTE_BOND", uint256(100e6));
        uint16 feeBps = uint16(vm.envOr("FEE_BPS", uint256(20)));

        vm.startBroadcast(pk);

        address usdcAddr = vm.envOr("USDC_ADDRESS", address(0));
        if (usdcAddr == address(0)) {
            MockUSDC mock = new MockUSDC();
            mock.faucet(deployer, 10_000e6);
            usdcAddr = address(mock);
        }
        IERC20 usdc = IERC20(usdcAddr);

        MarketRegistry registry = new MarketRegistry(deployer, guardian);
        PositionToken positions = new PositionToken(deployer);
        CollateralVault vault = new CollateralVault(deployer, usdc, registry, positions);
        ResolutionManager resolution = new ResolutionManager(deployer, registry, usdc, disputeBond, treasury);
        Exchange exchange = new Exchange(deployer, usdc, registry, positions, vault, treasury, feeBps);

        // Wire roles (least privilege: each contract only what it needs).
        registry.grantRole(registry.RESOLVER_ROLE(), address(resolution));
        registry.grantRole(registry.MARKET_CREATOR_ROLE(), deployer);
        positions.grantRole(positions.EXCHANGE_ROLE(), address(exchange));
        positions.grantRole(positions.VAULT_ROLE(), address(vault));
        vault.grantRole(vault.EXCHANGE_ROLE(), address(exchange));
        resolution.grantRole(resolution.PROPOSER_ROLE(), deployer);
        resolution.grantRole(resolution.ARBITRATOR_ROLE(), deployer);
        exchange.grantRole(exchange.OPERATOR_ROLE(), deployer);

        // Demo market: USD/DOP > 64.00 on 2026-12-31 (matches the Phase 1 seed).
        bytes32 marketId = keccak256("usd-dop-64-diciembre-2026");
        registry.createMarket(
            marketId,
            uint64(block.timestamp + 120 days),
            uint64(24 hours),
            keccak256("Tasa de venta de referencia del BCRD al 31/12/2026 > 64.00 DOP/USD")
        );

        vm.stopBroadcast();

        console.log("== PickMaster Base Sepolia ==");
        console.log("USDC (collateral):", usdcAddr);
        console.log("MarketRegistry:   ", address(registry));
        console.log("PositionToken:    ", address(positions));
        console.log("CollateralVault:  ", address(vault));
        console.log("ResolutionManager:", address(resolution));
        console.log("Exchange:         ", address(exchange));
        console.log("Demo marketId:");
        console.logBytes32(marketId);
    }
}
