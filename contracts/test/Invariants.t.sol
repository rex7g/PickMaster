// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {Test} from "forge-std/Test.sol";
import {StdInvariant} from "forge-std/StdInvariant.sol";
import {MockUSDC} from "../src/MockUSDC.sol";
import {MarketRegistry, MarketState} from "../src/MarketRegistry.sol";
import {PositionToken} from "../src/PositionToken.sol";
import {CollateralVault} from "../src/CollateralVault.sol";
import {ResolutionManager} from "../src/ResolutionManager.sol";
import {Exchange} from "../src/Exchange.sol";

/// Randomized action handler: mints, transfers, resolutions and claims in
/// arbitrary interleavings across several markets and actors.
contract ProtocolHandler is Test {
    MockUSDC public usdc;
    MarketRegistry public registry;
    PositionToken public positions;
    CollateralVault public vault;
    ResolutionManager public resolution;
    Exchange public exchange;

    address public operator;
    address public oracle;
    address public committee;

    uint256[] public actorPks;
    address[] public actors;
    bytes32[] public marketIds;
    uint256 public saltCounter;

    constructor(
        MockUSDC usdc_,
        MarketRegistry registry_,
        PositionToken positions_,
        CollateralVault vault_,
        ResolutionManager resolution_,
        Exchange exchange_,
        address operator_,
        address oracle_,
        address committee_,
        bytes32[] memory marketIds_
    ) {
        usdc = usdc_;
        registry = registry_;
        positions = positions_;
        vault = vault_;
        resolution = resolution_;
        exchange = exchange_;
        operator = operator_;
        oracle = oracle_;
        committee = committee_;
        marketIds = marketIds_;

        for (uint256 i = 1; i <= 4; i++) {
            uint256 pk = 0xF00D + i;
            actorPks.push(pk);
            address actor = vm.addr(pk);
            actors.push(actor);
            usdc.faucet(actor, 10_000e6);
            vm.prank(actor);
            usdc.approve(address(exchange), type(uint256).max);
        }
    }

    function _order(address maker, bytes32 marketId, uint8 outcome, uint64 price, uint128 qty)
        private
        returns (Exchange.Order memory)
    {
        return Exchange.Order({
            maker: maker,
            marketId: marketId,
            outcomeIndex: outcome,
            isBuy: true,
            priceCents: price,
            quantity: qty,
            expiry: uint64(block.timestamp + 30 days),
            salt: ++saltCounter
        });
    }

    function _sign(uint256 pk, Exchange.Order memory order) private view returns (bytes memory) {
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(pk, exchange.hashOrder(order));
        return abi.encodePacked(r, s, v);
    }

    function mint(uint256 marketSeed, uint256 buyerSeed, uint64 price, uint128 qty) external {
        bytes32 marketId = marketIds[marketSeed % marketIds.length];
        if (registry.market(marketId).state != MarketState.Open) return;
        if (block.timestamp >= registry.market(marketId).closeTime) return;
        price = uint64(bound(price, 1, 99));
        qty = uint128(bound(qty, 1, 500));
        uint256 yesIdx = buyerSeed % actors.length;
        uint256 noIdx = (buyerSeed + 1) % actors.length;

        Exchange.Order memory buyYes = _order(actors[yesIdx], marketId, 0, price, qty);
        Exchange.Order memory buyNo = _order(actors[noIdx], marketId, 1, 100 - price, qty);
        bytes memory ySig = _sign(actorPks[yesIdx], buyYes);
        bytes memory nSig = _sign(actorPks[noIdx], buyNo);
        vm.prank(operator);
        exchange.settleMint(buyYes, ySig, buyNo, nSig, qty, price);
    }

    function resolve(uint256 marketSeed, uint8 outcome, bool viaVoid) external {
        bytes32 marketId = marketIds[marketSeed % marketIds.length];
        MarketRegistry.MarketData memory data = registry.market(marketId);
        if (data.state != MarketState.Open) return;
        vm.warp(uint256(data.closeTime) + 1);
        if (viaVoid) {
            vm.prank(committee);
            resolution.voidWithoutProposal(marketId);
        } else {
            vm.prank(oracle);
            resolution.propose(marketId, outcome % 2, keccak256(abi.encode(marketId, outcome)));
            vm.warp(block.timestamp + uint256(data.disputePeriod) + 1);
            resolution.finalize(marketId);
        }
    }

    function claim(uint256 marketSeed, uint256 actorSeed) external {
        bytes32 marketId = marketIds[marketSeed % marketIds.length];
        MarketRegistry.MarketData memory data = registry.market(marketId);
        address actor = actors[actorSeed % actors.length];
        if (data.state == MarketState.Resolved) {
            uint256 bal = positions.balanceOf(actor, positions.positionId(marketId, data.winningOutcome));
            if (bal == 0) return;
            vm.prank(actor);
            vault.claim(marketId);
        } else if (data.state == MarketState.Void) {
            uint256 y = positions.balanceOf(actor, positions.positionId(marketId, 0));
            uint256 n = positions.balanceOf(actor, positions.positionId(marketId, 1));
            if (y + n == 0) return;
            vm.prank(actor);
            vault.redeemVoid(marketId);
        }
    }

    function marketsCount() external view returns (uint256) {
        return marketIds.length;
    }
}

/// Invariants (§45): the vault can always honor every future payout, and
/// collateral accounting never drifts from outstanding position supply.
contract InvariantsTest is StdInvariant, Test {
    MockUSDC usdc;
    MarketRegistry registry;
    PositionToken positions;
    CollateralVault vault;
    ResolutionManager resolution;
    Exchange exchange;
    ProtocolHandler handler;

    address admin = makeAddr("admin");
    address operator = makeAddr("operator");
    address oracle = makeAddr("oracle");
    address committee = makeAddr("committee");
    address treasury = makeAddr("treasury");

    bytes32[] ids;

    function setUp() public {
        usdc = new MockUSDC();
        registry = new MarketRegistry(admin, admin);
        positions = new PositionToken(admin);
        vault = new CollateralVault(admin, usdc, registry, positions);
        resolution = new ResolutionManager(admin, registry, usdc, 100e6, treasury);
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

        for (uint256 i = 0; i < 3; i++) {
            bytes32 id = keccak256(abi.encode("inv-market", i));
            registry.createMarket(id, uint64(block.timestamp + 30 days), 1 hours, keccak256("rules"));
            ids.push(id);
        }
        vm.stopPrank();

        handler = new ProtocolHandler(
            usdc, registry, positions, vault, resolution, exchange, operator, oracle, committee, ids
        );
        targetContract(address(handler));
    }

    /// The USDC actually held by the vault always covers the recorded locks.
    function invariant_VaultSolvent() public view {
        uint256 totalLocked;
        for (uint256 i = 0; i < ids.length; i++) {
            totalLocked += vault.lockedCollateral(ids[i]);
        }
        assertGe(usdc.balanceOf(address(vault)), totalLocked);
    }

    /// Per market: locked collateral exactly equals what outstanding shares
    /// can still draw — 1.00 USDC per full set while unresolved; after
    /// resolution, 1.00 per winning share; after VOID, 0.50 per share.
    function invariant_LockedMatchesOutstandingClaims() public view {
        for (uint256 i = 0; i < ids.length; i++) {
            bytes32 id = ids[i];
            MarketRegistry.MarketData memory data = registry.market(id);
            uint256 yes = positions.totalSupply(positions.positionId(id, 0));
            uint256 no = positions.totalSupply(positions.positionId(id, 1));
            uint256 expected;
            if (data.state == MarketState.Resolved) {
                uint256 winning = data.winningOutcome == 0 ? yes : no;
                expected = winning * 1e6;
            } else if (data.state == MarketState.Void) {
                expected = (yes + no) * 5e5;
            } else {
                assertEq(yes, no, "unresolved market must hold full sets");
                expected = yes * 1e6;
            }
            assertEq(vault.lockedCollateral(id), expected);
        }
    }

    /// Position supplies only shrink through vault burns (claims), never
    /// through the exchange; YES/NO supplies stay equal until resolution.
    function invariant_NoFreeShares() public view {
        for (uint256 i = 0; i < ids.length; i++) {
            bytes32 id = ids[i];
            MarketRegistry.MarketData memory data = registry.market(id);
            if (data.state == MarketState.Open || data.state == MarketState.ResolutionProposed) {
                assertEq(
                    positions.totalSupply(positions.positionId(id, 0)),
                    positions.totalSupply(positions.positionId(id, 1))
                );
            }
        }
    }
}
