// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {AccessControl} from "@openzeppelin/contracts/access/AccessControl.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import {MarketRegistry, MarketState} from "./MarketRegistry.sol";
import {PositionToken} from "./PositionToken.sol";

/// @title CollateralVault — segregated USDC custody per market (§2.5, §45).
/// @notice Deterministic, idempotent settlement: a winning share redeems for
///         exactly 1.00 USDC; a losing share pays 0; a VOID market redeems
///         every share at 0.50 USDC (both sides together return the full
///         locked collateral). Claiming burns the shares, so double-claims
///         are impossible. Collateral is tracked per market and payouts can
///         never draw from another market's funds.
contract CollateralVault is AccessControl, ReentrancyGuard {
    using SafeERC20 for IERC20;

    bytes32 public constant EXCHANGE_ROLE = keccak256("EXCHANGE_ROLE");

    uint256 public constant UNIT = 1e6; // 1.00 USDC (6 decimals)

    IERC20 public immutable collateral;
    MarketRegistry public immutable registry;
    PositionToken public immutable positions;

    /// USDC locked per market (invariant: >= any future payout of that market).
    mapping(bytes32 => uint256) public lockedCollateral;

    event CollateralLocked(bytes32 indexed marketId, uint256 amount);
    event PayoutClaimed(bytes32 indexed marketId, address indexed to, uint256 shares, uint256 amount);
    event VoidRedeemed(bytes32 indexed marketId, address indexed to, uint256 shares, uint256 amount);

    error NothingToClaim();
    error MarketNotFinal();

    constructor(address admin, IERC20 collateral_, MarketRegistry registry_, PositionToken positions_) {
        _grantRole(DEFAULT_ADMIN_ROLE, admin);
        collateral = collateral_;
        registry = registry_;
        positions = positions_;
    }

    /// @notice Called by the Exchange after transferring `amount` USDC in;
    ///         records it against the market so payouts stay segregated.
    function recordLock(bytes32 marketId, uint256 amount) external onlyRole(EXCHANGE_ROLE) {
        lockedCollateral[marketId] += amount;
        emit CollateralLocked(marketId, amount);
    }

    /// @notice Claim payout after final resolution (AC-006). Burns the caller's
    ///         winning shares and pays 1.00 USDC each. Idempotent: a second
    ///         call finds zero shares and reverts with NothingToClaim.
    function claim(bytes32 marketId) external nonReentrant returns (uint256 paid) {
        MarketRegistry.MarketData memory data = registry.market(marketId);
        if (data.state != MarketState.Resolved) revert MarketNotFinal();

        uint256 shares = positions.balanceOf(msg.sender, positions.positionId(marketId, data.winningOutcome));
        if (shares == 0) revert NothingToClaim();

        positions.burnFrom(marketId, data.winningOutcome, msg.sender, shares);
        paid = shares * UNIT;
        lockedCollateral[marketId] -= paid; // reverts on underflow: cannot exceed the market's own funds
        collateral.safeTransfer(msg.sender, paid);
        emit PayoutClaimed(marketId, msg.sender, shares, paid);
    }

    /// @notice VOID redemption (§46): both outcomes redeem at 0.50 USDC per
    ///         share. YES supply always equals NO supply (pairs are minted
    ///         together), so total redemption exactly returns the locked
    ///         collateral. NOTE: on-chain the vault cannot know each trader's
    ///         cost basis; the 50/50 split is the deterministic on-chain rule,
    ///         equivalent in aggregate to the off-chain cost refund.
    function redeemVoid(bytes32 marketId) external nonReentrant returns (uint256 paid) {
        MarketRegistry.MarketData memory data = registry.market(marketId);
        if (data.state != MarketState.Void) revert MarketNotFinal();

        uint256 yesShares = positions.balanceOf(msg.sender, positions.positionId(marketId, 0));
        uint256 noShares = positions.balanceOf(msg.sender, positions.positionId(marketId, 1));
        if (yesShares + noShares == 0) revert NothingToClaim();

        if (yesShares > 0) positions.burnFrom(marketId, 0, msg.sender, yesShares);
        if (noShares > 0) positions.burnFrom(marketId, 1, msg.sender, noShares);
        paid = (yesShares + noShares) * (UNIT / 2);
        lockedCollateral[marketId] -= paid;
        collateral.safeTransfer(msg.sender, paid);
        emit VoidRedeemed(marketId, msg.sender, yesShares + noShares, paid);
    }
}
