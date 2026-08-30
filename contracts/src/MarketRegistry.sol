// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {AccessControl} from "@openzeppelin/contracts/access/AccessControl.sol";
import {Pausable} from "@openzeppelin/contracts/utils/Pausable.sol";

/// On-chain market lifecycle (subset of §9 that must live on L2).
enum MarketState {
    None,
    Open,
    ResolutionProposed,
    Disputed,
    Resolved,
    Void
}

/// @title MarketRegistry — market state machine and global emergency pause.
/// @notice Golden rule (§65): the registry only tracks state. Trading lives in
///         Exchange, resolution in ResolutionManager (the sole RESOLVER_ROLE),
///         custody in CollateralVault. Nobody — including the admin — can set a
///         winning outcome directly: every resolution transition passes through
///         the propose → dispute-window → finalize/arbitrate flow (§46).
contract MarketRegistry is AccessControl, Pausable {
    bytes32 public constant MARKET_CREATOR_ROLE = keccak256("MARKET_CREATOR_ROLE");
    bytes32 public constant RESOLVER_ROLE = keccak256("RESOLVER_ROLE");
    bytes32 public constant GUARDIAN_ROLE = keccak256("GUARDIAN_ROLE");

    struct MarketData {
        uint64 closeTime; // trading stops (§6 closeTime)
        uint64 disputePeriod; // seconds (§13)
        bytes32 rulesHash; // hash of published resolution rules (§56)
        MarketState state;
        uint8 winningOutcome; // 0 = YES, 1 = NO (valid only when Resolved)
    }

    mapping(bytes32 => MarketData) private _markets;

    event MarketCreated(bytes32 indexed marketId, uint64 closeTime, uint64 disputePeriod, bytes32 rulesHash);
    event MarketStateChanged(bytes32 indexed marketId, MarketState state, uint8 winningOutcome);
    event EmergencyPaused(address indexed by, string reason);
    event EmergencyUnpaused(address indexed by);

    error UnknownMarket();
    error InvalidTransition();
    error MarketNotTradeable();

    constructor(address admin, address guardian) {
        _grantRole(DEFAULT_ADMIN_ROLE, admin);
        _grantRole(GUARDIAN_ROLE, guardian);
    }

    // ------------------------------------------------------------- creation

    /// @notice Off-chain the market has already passed Draft → Validation →
    ///         Compliance → Approval (§9, AC-001); only then is it anchored here.
    function createMarket(bytes32 marketId, uint64 closeTime, uint64 disputePeriod, bytes32 rulesHash)
        external
        onlyRole(MARKET_CREATOR_ROLE)
        whenNotPaused
    {
        require(_markets[marketId].state == MarketState.None, "market exists");
        require(closeTime > block.timestamp, "closeTime in past");
        require(disputePeriod >= 5 minutes, "dispute period too short");
        _markets[marketId] = MarketData({
            closeTime: closeTime,
            disputePeriod: disputePeriod,
            rulesHash: rulesHash,
            state: MarketState.Open,
            winningOutcome: 0
        });
        emit MarketCreated(marketId, closeTime, disputePeriod, rulesHash);
    }

    // ------------------------------------------------------------- views

    function market(bytes32 marketId) public view returns (MarketData memory data) {
        data = _markets[marketId];
        if (data.state == MarketState.None) revert UnknownMarket();
    }

    /// @notice Trading gate used by Exchange (AC-013: pause blocks new trades).
    function requireTradeable(bytes32 marketId) external view {
        MarketData memory data = market(marketId);
        if (paused() || data.state != MarketState.Open || block.timestamp >= data.closeTime) {
            revert MarketNotTradeable();
        }
    }

    // ------------------------------------------------------------- resolution transitions (RESOLVER_ROLE only)

    function setProposed(bytes32 marketId) external onlyRole(RESOLVER_ROLE) {
        MarketData storage data = _markets[marketId];
        if (data.state != MarketState.Open) revert InvalidTransition();
        require(block.timestamp >= data.closeTime, "market still trading");
        data.state = MarketState.ResolutionProposed;
        emit MarketStateChanged(marketId, data.state, 0);
    }

    function setDisputed(bytes32 marketId) external onlyRole(RESOLVER_ROLE) {
        MarketData storage data = _markets[marketId];
        if (data.state != MarketState.ResolutionProposed) revert InvalidTransition();
        data.state = MarketState.Disputed;
        emit MarketStateChanged(marketId, data.state, 0);
    }

    function setResolved(bytes32 marketId, uint8 winningOutcome) external onlyRole(RESOLVER_ROLE) {
        MarketData storage data = _markets[marketId];
        if (data.state != MarketState.ResolutionProposed && data.state != MarketState.Disputed) {
            revert InvalidTransition();
        }
        require(winningOutcome < 2, "invalid outcome");
        data.state = MarketState.Resolved;
        data.winningOutcome = winningOutcome;
        emit MarketStateChanged(marketId, data.state, winningOutcome);
    }

    /// @notice VOID (§46): both sides redeem at 50¢ in the vault. Allowed from
    ///         any non-final state (event cancelled, source unavailable, ...).
    function setVoid(bytes32 marketId) external onlyRole(RESOLVER_ROLE) {
        MarketData storage data = _markets[marketId];
        if (data.state == MarketState.None || data.state == MarketState.Resolved || data.state == MarketState.Void)
        {
            revert InvalidTransition();
        }
        data.state = MarketState.Void;
        emit MarketStateChanged(marketId, data.state, 0);
    }

    // ------------------------------------------------------------- emergency pause (AC-013)

    function pause(string calldata reason) external onlyRole(GUARDIAN_ROLE) {
        _pause();
        emit EmergencyPaused(msg.sender, reason);
    }

    /// @dev In production unpause sits behind the timelock (§41); the timelock
    ///      contract holds GUARDIAN_ROLE.
    function unpause() external onlyRole(GUARDIAN_ROLE) {
        _unpause();
        emit EmergencyUnpaused(msg.sender);
    }
}
