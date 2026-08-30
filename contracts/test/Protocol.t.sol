// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {Test} from "forge-std/Test.sol";
import {MockUSDC} from "../src/MockUSDC.sol";
import {MarketRegistry, MarketState} from "../src/MarketRegistry.sol";
import {PositionToken} from "../src/PositionToken.sol";
import {CollateralVault} from "../src/CollateralVault.sol";
import {ResolutionManager} from "../src/ResolutionManager.sol";
import {Exchange} from "../src/Exchange.sol";

/// Testnet-gate suite (§52): full lifecycle, disputed resolution, VOID,
/// emergency pause, signature safety and collateral conservation (fuzz).
contract ProtocolTest is Test {
    MockUSDC usdc;
    MarketRegistry registry;
    PositionToken positions;
    CollateralVault vault;
    ResolutionManager resolution;
    Exchange exchange;

    address admin = makeAddr("admin");
    address guardian = makeAddr("guardian");
    address treasury = makeAddr("treasury");
    address oracle = makeAddr("oracle"); // backend oracle-aggregator
    address committee = makeAddr("committee"); // arbitration multisig
    address operator = makeAddr("operator"); // backend matcher relayer

    uint256 alicePk = 0xA11CE;
    uint256 bobPk = 0xB0B;
    uint256 carolPk = 0xCA401;
    address alice = vm.addr(0xA11CE);
    address bob = vm.addr(0xB0B);
    address carol = vm.addr(0xCA401);

    bytes32 constant MARKET_ID = keccak256("usd-dop-64-diciembre-2026");
    uint64 closeTime;
    uint64 constant DISPUTE_PERIOD = 1 hours;
    uint256 constant BOND = 100e6;

    function setUp() public {
        usdc = new MockUSDC();
        registry = new MarketRegistry(admin, guardian);
        positions = new PositionToken(admin);
        vault = new CollateralVault(admin, usdc, registry, positions);
        resolution = new ResolutionManager(admin, registry, usdc, BOND, treasury);
        exchange = new Exchange(admin, usdc, registry, positions, vault, treasury, 20);

        vm.startPrank(admin);
        registry.grantRole(registry.MARKET_CREATOR_ROLE(), admin);
        registry.grantRole(registry.RESOLVER_ROLE(), address(resolution));
        positions.grantRole(positions.EXCHANGE_ROLE(), address(exchange));
        positions.grantRole(positions.VAULT_ROLE(), address(vault));
        vault.grantRole(vault.EXCHANGE_ROLE(), address(exchange));
        resolution.grantRole(resolution.PROPOSER_ROLE(), oracle);
        resolution.grantRole(resolution.ARBITRATOR_ROLE(), committee);
        exchange.grantRole(exchange.OPERATOR_ROLE(), operator);
        vm.stopPrank();

        closeTime = uint64(block.timestamp + 1 days);
        vm.prank(admin);
        registry.createMarket(MARKET_ID, closeTime, DISPUTE_PERIOD, keccak256("reglas BCRD 31/12/2026"));

        for (uint256 i = 0; i < 3; i++) {
            address user = [alice, bob, carol][i];
            usdc.faucet(user, 10_000e6);
            vm.prank(user);
            usdc.approve(address(exchange), type(uint256).max);
        }
        usdc.faucet(bob, 10_000e6); // extra for dispute bonds
        vm.prank(bob);
        usdc.approve(address(resolution), type(uint256).max);
    }

    // ------------------------------------------------------------- helpers

    function makeOrder(address maker, uint8 outcome, bool isBuy, uint64 price, uint128 qty)
        internal
        view
        returns (Exchange.Order memory)
    {
        return Exchange.Order({
            maker: maker,
            marketId: MARKET_ID,
            outcomeIndex: outcome,
            isBuy: isBuy,
            priceCents: price,
            quantity: qty,
            expiry: uint64(block.timestamp + 1 days),
            salt: uint256(keccak256(abi.encode(maker, outcome, isBuy, price, qty)))
        });
    }

    /// NOTE: makes an external self-call, so always compute signatures BEFORE
    /// vm.prank / vm.expectRevert.
    function sign(uint256 pk, Exchange.Order memory order) internal returns (bytes memory) {
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(pk, this.hashOrderExternal(order));
        return abi.encodePacked(r, s, v);
    }

    function hashOrderExternal(Exchange.Order calldata order) external view returns (bytes32) {
        return exchange.hashOrder(order);
    }

    function settleMintAsOperator(
        Exchange.Order memory buyYes,
        uint256 yesPk,
        Exchange.Order memory buyNo,
        uint256 noPk,
        uint128 qty,
        uint64 price
    ) internal {
        bytes memory ySig = sign(yesPk, buyYes);
        bytes memory nSig = sign(noPk, buyNo);
        vm.prank(operator);
        exchange.settleMint(buyYes, ySig, buyNo, nSig, qty, price);
    }

    // Mint 100 full sets: alice BUY YES a 60, bob BUY NO a 40.
    function mint100() internal {
        settleMintAsOperator(makeOrder(alice, 0, true, 60, 100), alicePk, makeOrder(bob, 1, true, 40, 100), bobPk, 100, 60);
    }

    // ------------------------------------------------------------- lifecycle

    function test_MintLocksFullCollateralAndChargesVisibleFees() public {
        uint256 aliceBefore = usdc.balanceOf(alice);
        mint100();

        // 100 sets × 1.00 USDC locked, split 60/40.
        assertEq(vault.lockedCollateral(MARKET_ID), 100e6);
        assertEq(usdc.balanceOf(address(vault)), 100e6);
        assertEq(positions.balanceOf(alice, positions.positionId(MARKET_ID, 0)), 100);
        assertEq(positions.balanceOf(bob, positions.positionId(MARKET_ID, 1)), 100);
        // alice paid 60 USDC + 0.20% fee = 60e6 + 120000
        assertEq(aliceBefore - usdc.balanceOf(alice), 60e6 + 120_000);
        assertEq(usdc.balanceOf(treasury), 120_000 + 80_000); // both sides' fees
    }

    function test_FullLifecycle_ResolveAndClaim() public {
        mint100();
        vm.warp(closeTime + 1);
        vm.prank(oracle);
        resolution.propose(MARKET_ID, 0, keccak256("2 fuentes: YES"));

        // AC-006: nobody can claim before the dispute window ends.
        vm.expectRevert(CollateralVault.MarketNotFinal.selector);
        vm.prank(alice);
        vault.claim(MARKET_ID);

        vm.warp(closeTime + DISPUTE_PERIOD + 2);
        resolution.finalize(MARKET_ID); // permissionless

        uint256 before = usdc.balanceOf(alice);
        vm.prank(alice);
        uint256 paid = vault.claim(MARKET_ID);
        assertEq(paid, 100e6); // 100 shares × 1.00 USDC
        assertEq(usdc.balanceOf(alice) - before, 100e6);
        assertEq(vault.lockedCollateral(MARKET_ID), 0);

        // Idempotent: nothing left to claim, loser gets nothing (§45).
        vm.expectRevert(CollateralVault.NothingToClaim.selector);
        vm.prank(alice);
        vault.claim(MARKET_ID);
        vm.expectRevert(CollateralVault.NothingToClaim.selector);
        vm.prank(bob);
        vault.claim(MARKET_ID);
    }

    function test_TransferSettlement_MovesSharesAndCash() public {
        mint100();
        Exchange.Order memory buy = makeOrder(carol, 0, true, 70, 100);
        Exchange.Order memory sell = makeOrder(alice, 0, false, 70, 100);
        bytes memory buySig = sign(carolPk, buy);
        bytes memory sellSig = sign(alicePk, sell);
        uint256 aliceBefore = usdc.balanceOf(alice);
        vm.prank(operator);
        exchange.settleTransfer(buy, buySig, sell, sellSig, 100, 70);

        assertEq(positions.balanceOf(carol, positions.positionId(MARKET_ID, 0)), 100);
        assertEq(positions.balanceOf(alice, positions.positionId(MARKET_ID, 0)), 0);
        // alice received 70 USDC minus her 0.20% fee
        assertEq(usdc.balanceOf(alice) - aliceBefore, 70e6 - 140_000);
    }

    // ------------------------------------------------------------- disputes (AC-008)

    function test_DisputedMarket_OnlyArbitrationResolves() public {
        mint100();
        vm.warp(closeTime + 1);
        vm.prank(oracle);
        resolution.propose(MARKET_ID, 0, keccak256("propuesta YES"));

        vm.prank(bob);
        resolution.dispute(MARKET_ID, keccak256("fuente secundaria dice NO"));
        assertEq(uint8(registry.market(MARKET_ID).state), uint8(MarketState.Disputed));

        // Finalize is blocked while disputed; time alone cannot settle it.
        vm.warp(closeTime + DISPUTE_PERIOD + 2);
        vm.expectRevert();
        resolution.finalize(MARKET_ID);

        // Committee rules NO: disputer was right → bond returned.
        uint256 bobBefore = usdc.balanceOf(bob);
        vm.prank(committee);
        resolution.arbitrate(MARKET_ID, 1, false);
        assertEq(usdc.balanceOf(bob) - bobBefore, BOND);
        assertEq(registry.market(MARKET_ID).winningOutcome, 1);

        vm.prank(bob);
        assertEq(vault.claim(MARKET_ID), 100e6);
    }

    function test_FrivolousDispute_BondGoesToTreasury() public {
        mint100();
        vm.warp(closeTime + 1);
        vm.prank(oracle);
        resolution.propose(MARKET_ID, 0, keccak256("propuesta YES"));
        vm.prank(bob);
        resolution.dispute(MARKET_ID, keccak256("sin fundamento"));

        uint256 treasuryBefore = usdc.balanceOf(treasury);
        vm.prank(committee);
        resolution.arbitrate(MARKET_ID, 0, false); // confirms proposal
        assertEq(usdc.balanceOf(treasury) - treasuryBefore, BOND);
    }

    // ------------------------------------------------------------- VOID (§46)

    function test_Void_BothSidesRedeemHalfAndCollateralConserves() public {
        mint100();
        vm.warp(closeTime + 1);
        vm.prank(oracle);
        resolution.propose(MARKET_ID, 0, keccak256("propuesta"));
        vm.prank(bob);
        resolution.dispute(MARKET_ID, keccak256("evento cancelado"));
        vm.prank(committee);
        resolution.arbitrate(MARKET_ID, 0, true); // VOID

        vm.prank(alice);
        uint256 alicePaid = vault.redeemVoid(MARKET_ID);
        vm.prank(bob);
        uint256 bobPaid = vault.redeemVoid(MARKET_ID);
        assertEq(alicePaid, 50e6);
        assertEq(bobPaid, 50e6);
        assertEq(alicePaid + bobPaid, 100e6); // exactly the locked collateral
        assertEq(vault.lockedCollateral(MARKET_ID), 0);
        assertEq(usdc.balanceOf(address(vault)), 0);
    }

    // ------------------------------------------------------------- pause (AC-013)

    function test_EmergencyPause_BlocksNewTrades() public {
        vm.prank(guardian);
        registry.pause("vulnerabilidad critica");

        Exchange.Order memory buyYes = makeOrder(alice, 0, true, 60, 10);
        Exchange.Order memory buyNo = makeOrder(bob, 1, true, 40, 10);
        bytes memory ySig = sign(alicePk, buyYes);
        bytes memory nSig = sign(bobPk, buyNo);
        vm.prank(operator);
        vm.expectRevert(MarketRegistry.MarketNotTradeable.selector);
        exchange.settleMint(buyYes, ySig, buyNo, nSig, 10, 60);

        vm.prank(guardian);
        registry.unpause();
        vm.prank(operator);
        exchange.settleMint(buyYes, ySig, buyNo, nSig, 10, 60);
        assertEq(vault.lockedCollateral(MARKET_ID), 10e6);
    }

    // ------------------------------------------------------------- order safety

    function test_BadSignatureReverts() public {
        Exchange.Order memory buyYes = makeOrder(alice, 0, true, 60, 10);
        Exchange.Order memory buyNo = makeOrder(bob, 1, true, 40, 10);
        bytes memory forged = sign(carolPk, buyYes); // carol signs alice's order
        bytes memory nSig = sign(bobPk, buyNo);
        vm.prank(operator);
        vm.expectRevert(Exchange.BadSignature.selector);
        exchange.settleMint(buyYes, forged, buyNo, nSig, 10, 60);
    }

    function test_CancelledOrderReverts() public {
        Exchange.Order memory buyYes = makeOrder(alice, 0, true, 60, 10);
        Exchange.Order memory buyNo = makeOrder(bob, 1, true, 40, 10);
        bytes memory ySig = sign(alicePk, buyYes);
        bytes memory nSig = sign(bobPk, buyNo);
        vm.prank(alice);
        exchange.cancelOrder(buyYes);
        vm.prank(operator);
        vm.expectRevert(abi.encodeWithSelector(Exchange.InvalidOrder.selector, "cancelled"));
        exchange.settleMint(buyYes, ySig, buyNo, nSig, 10, 60);
    }

    function test_OverfillReverts() public {
        mint100(); // fills alice's 100-share order completely
        Exchange.Order memory buyYes = makeOrder(alice, 0, true, 60, 100);
        Exchange.Order memory buyNo2 = makeOrder(carol, 1, true, 40, 100);
        bytes memory ySig = sign(alicePk, buyYes);
        bytes memory nSig = sign(carolPk, buyNo2);
        vm.prank(operator);
        vm.expectRevert(Exchange.Overfill.selector);
        exchange.settleMint(buyYes, ySig, buyNo2, nSig, 1, 60);
    }

    function test_PriceOutsideLimitsReverts() public {
        Exchange.Order memory buyYes = makeOrder(alice, 0, true, 60, 10);
        Exchange.Order memory buyNo = makeOrder(bob, 1, true, 40, 10);
        bytes memory ySig = sign(alicePk, buyYes);
        bytes memory nSig = sign(bobPk, buyNo);
        // Executing YES at 61 violates alice's limit of 60.
        vm.prank(operator);
        vm.expectRevert(abi.encodeWithSelector(Exchange.InvalidOrder.selector, "yes limit"));
        exchange.settleMint(buyYes, ySig, buyNo, nSig, 10, 61);
    }

    // ------------------------------------------------------------- governance safety (§46)

    function test_AdminCannotSetOutcomeDirectly() public {
        vm.warp(closeTime + 1);
        vm.prank(admin); // admin lacks RESOLVER_ROLE: only ResolutionManager has it
        vm.expectRevert();
        registry.setResolved(MARKET_ID, 0);
    }

    function test_TradingStopsAtCloseTime() public {
        Exchange.Order memory buyYes = makeOrder(alice, 0, true, 60, 10);
        Exchange.Order memory buyNo = makeOrder(bob, 1, true, 40, 10);
        bytes memory ySig = sign(alicePk, buyYes);
        bytes memory nSig = sign(bobPk, buyNo);
        vm.warp(closeTime + 1);
        vm.prank(operator);
        vm.expectRevert(MarketRegistry.MarketNotTradeable.selector);
        exchange.settleMint(buyYes, ySig, buyNo, nSig, 10, 60);
    }

    // ------------------------------------------------------------- fuzz: collateral conservation (§45)

    function testFuzz_CollateralConservation(uint64 price, uint128 qty) public {
        price = uint64(bound(price, 1, 99));
        qty = uint128(bound(qty, 1, 5_000));

        usdc.faucet(alice, 10_000e6);
        usdc.faucet(bob, 10_000e6);

        settleMintAsOperator(
            makeOrder(alice, 0, true, price, qty), alicePk, makeOrder(bob, 1, true, 100 - price, qty), bobPk, qty, price
        );

        // Invariant: locked collateral == outstanding sets × 1.00 USDC.
        assertEq(vault.lockedCollateral(MARKET_ID), uint256(qty) * 1e6);
        assertEq(usdc.balanceOf(address(vault)), uint256(qty) * 1e6);

        vm.warp(closeTime + 1);
        vm.prank(oracle);
        resolution.propose(MARKET_ID, 0, keccak256("fuzz"));
        vm.warp(closeTime + DISPUTE_PERIOD + 2);
        resolution.finalize(MARKET_ID);

        vm.prank(alice);
        assertEq(vault.claim(MARKET_ID), uint256(qty) * 1e6);
        assertEq(usdc.balanceOf(address(vault)), 0); // winner drains exactly everything
    }
}
