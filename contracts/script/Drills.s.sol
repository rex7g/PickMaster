// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {Script, console} from "forge-std/Script.sol";
import {MockUSDC} from "../src/MockUSDC.sol";
import {MarketRegistry, MarketState} from "../src/MarketRegistry.sol";
import {PositionToken} from "../src/PositionToken.sol";
import {CollateralVault} from "../src/CollateralVault.sol";
import {ResolutionManager} from "../src/ResolutionManager.sol";
import {Exchange} from "../src/Exchange.sol";

/// §52 testnet drills against the LIVE Base Sepolia deployment: real trades
/// with EIP-712 signatures, disputed resolution, VOID cancellation and
/// emergency pause. Split in three stages because real time must pass
/// between them (no vm.warp on a live chain):
///   1. DrillSetup    — fund drill wallets, create short-lived drill markets,
///                      settle real MINT trades on each.
///   2. DrillResolve  — after closeTime (~3 min): propose on A and B, dispute
///                      A with a bond and arbitrate it, VOID C and redeem,
///                      pause/unpause drill.
///   3. DrillFinalize — after B's dispute window (5 min): finalize + claim.
abstract contract DrillBase is Script {
    MockUSDC constant usdc = MockUSDC(0xDA1d069fFD04fDb3F730d01168336f07695ef86E);
    MarketRegistry constant registry = MarketRegistry(0x082d4E5f31518CDc209C3a414d9fbAb33544f63f);
    PositionToken constant positions = PositionToken(0xB70655a2c6b1d31564A035b616238Ef4c6396a94);
    CollateralVault constant vault = CollateralVault(0x568792C87B6c95c4Cd75De4ea058c0f5cc6F904E);
    ResolutionManager constant resolution = ResolutionManager(0xaE55D9eAFe24b073C66Dcf98FD84e0a1E945Fb9d);
    Exchange constant exchange = Exchange(0xB4bc699e2D26Dd586ed7Ec15abaaAed9A883BBBe);

    function drillId(string memory tag) internal view returns (bytes32) {
        return keccak256(abi.encodePacked("drill-", tag, "-", vm.envString("DRILL_RUN")));
    }

    function makeOrder(address maker, bytes32 marketId, uint8 outcome, bool isBuy, uint64 price, uint128 qty)
        internal
        view
        returns (Exchange.Order memory)
    {
        return Exchange.Order({
            maker: maker,
            marketId: marketId,
            outcomeIndex: outcome,
            isBuy: isBuy,
            priceCents: price,
            quantity: qty,
            expiry: uint64(block.timestamp + 1 days),
            salt: uint256(keccak256(abi.encodePacked(maker, marketId, outcome, isBuy)))
        });
    }

    function signed(uint256 pk, Exchange.Order memory order) internal view returns (bytes memory) {
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(pk, exchange.hashOrder(order));
        return abi.encodePacked(r, s, v);
    }
}

contract DrillSetup is DrillBase {
    function run() external {
        uint256 deployerPk = vm.envUint("PRIVATE_KEY");
        uint256 alicePk = vm.envUint("ALICE_PK");
        uint256 bobPk = vm.envUint("BOB_PK");
        address alice = vm.addr(alicePk);
        address bob = vm.addr(bobPk);

        bytes32[3] memory ids = [drillId("A"), drillId("B"), drillId("C")];

        vm.startBroadcast(deployerPk);
        usdc.faucet(alice, 1_000e6);
        usdc.faucet(bob, 1_000e6);
        payable(alice).transfer(0.000006 ether);
        payable(bob).transfer(0.000006 ether);
        for (uint256 i = 0; i < 3; i++) {
            registry.createMarket(
                ids[i],
                uint64(block.timestamp + 180), // trading closes in ~3 min
                5 minutes, // minimum dispute window
                keccak256(abi.encodePacked("drill rules ", i))
            );
        }
        vm.stopBroadcast();

        vm.startBroadcast(alicePk);
        usdc.approve(address(exchange), type(uint256).max);
        vm.stopBroadcast();
        vm.startBroadcast(bobPk);
        usdc.approve(address(exchange), type(uint256).max);
        usdc.approve(address(resolution), type(uint256).max);
        vm.stopBroadcast();

        // Real MINT trades: alice BUY YES 60c x bob BUY NO 40c, 50 shares each market.
        vm.startBroadcast(deployerPk); // deployer holds OPERATOR_ROLE on testnet
        for (uint256 i = 0; i < 3; i++) {
            Exchange.Order memory buyYes = makeOrder(alice, ids[i], 0, true, 60, 50);
            Exchange.Order memory buyNo = makeOrder(bob, ids[i], 1, true, 40, 50);
            exchange.settleMint(buyYes, signed(alicePk, buyYes), buyNo, signed(bobPk, buyNo), 50, 60);
        }
        vm.stopBroadcast();

        for (uint256 i = 0; i < 3; i++) {
            console.log("drill market locked (USDC units):", vault.lockedCollateral(ids[i]));
            console.logBytes32(ids[i]);
        }
    }
}

contract DrillResolve is DrillBase {
    function run() external {
        uint256 deployerPk = vm.envUint("PRIVATE_KEY");
        uint256 alicePk = vm.envUint("ALICE_PK");
        uint256 bobPk = vm.envUint("BOB_PK");
        address bob = vm.addr(bobPk);

        bytes32 a = drillId("A");
        bytes32 b = drillId("B");
        bytes32 c = drillId("C");

        // Drill: pause blocks trading, then unpause (AC-013).
        vm.startBroadcast(deployerPk);
        registry.pause("drill: simulacro de emergencia");
        vm.stopBroadcast();
        console.log("paused:", registry.paused());
        vm.startBroadcast(deployerPk);
        registry.unpause();
        // Oracle proposes YES on A and B (deployer holds PROPOSER_ROLE on testnet).
        resolution.propose(a, 0, keccak256("drill A: fuentes reportan YES"));
        resolution.propose(b, 0, keccak256("drill B: fuentes reportan YES"));
        vm.stopBroadcast();

        // Bob disputes A with a 100 tUSDC bond.
        vm.startBroadcast(bobPk);
        resolution.dispute(a, keccak256("drill A: fuente secundaria dice NO"));
        vm.stopBroadcast();

        // Committee (deployer on testnet) rules NO on A: disputer was right.
        uint256 bobBefore = usdc.balanceOf(bob);
        vm.startBroadcast(deployerPk);
        resolution.arbitrate(a, 1, false);
        // C: event cancelled -> VOID without proposal (§46).
        resolution.voidWithoutProposal(c);
        vm.stopBroadcast();
        console.log("bond returned to disputer:", usdc.balanceOf(bob) - bobBefore);

        // Bob claims his winning NO shares on A; both redeem C at 50c.
        vm.startBroadcast(bobPk);
        uint256 paidA = vault.claim(a);
        uint256 paidCbob = vault.redeemVoid(c);
        vm.stopBroadcast();
        vm.startBroadcast(alicePk);
        uint256 paidCalice = vault.redeemVoid(c);
        vm.stopBroadcast();
        console.log("A claim (bob, NO gana):", paidA);
        console.log("C void redeem bob:", paidCbob);
        console.log("C void redeem alice:", paidCalice);
        console.log("A locked tras claim:", vault.lockedCollateral(a));
        console.log("C locked tras redeem:", vault.lockedCollateral(c));
    }
}

contract DrillFinalize is DrillBase {
    function run() external {
        uint256 alicePk = vm.envUint("ALICE_PK");
        bytes32 b = drillId("B");

        // Anyone can finalize an undisputed proposal after the window.
        vm.startBroadcast(alicePk);
        resolution.finalize(b);
        uint256 paid = vault.claim(b); // alice's 50 YES shares pay 50 USDC
        vm.stopBroadcast();
        console.log("B finalizado; claim alice:", paid);
        console.log("B locked tras claim:", vault.lockedCollateral(b));
    }
}
