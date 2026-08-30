// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {AccessControl} from "@openzeppelin/contracts/access/AccessControl.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import {MarketRegistry, MarketState} from "./MarketRegistry.sol";

/// @title ResolutionManager — oracle adapter + dispute manager (§11–13).
/// @notice Optimistic flow: the oracle aggregator (PROPOSER_ROLE, run by the
///         backend after >= 2 reliable sources agree, AC-007) proposes an
///         outcome with an evidence hash; anyone may dispute within the
///         market's dispute window by posting a USDC bond; an undisputed
///         proposal finalizes permissionlessly after the window; a disputed
///         market is decided only by the arbitration committee
///         (ARBITRATOR_ROLE — a multisig, later UMA/Kleros §13). Conflicting
///         sources never settle automatically (AC-008): the backend simply
///         does not propose, or the conflict surfaces as a dispute.
contract ResolutionManager is AccessControl, ReentrancyGuard {
    using SafeERC20 for IERC20;

    bytes32 public constant PROPOSER_ROLE = keccak256("PROPOSER_ROLE");
    bytes32 public constant ARBITRATOR_ROLE = keccak256("ARBITRATOR_ROLE");

    struct Proposal {
        uint8 outcome;
        uint64 proposedAt;
        bytes32 evidenceHash;
        address disputer; // zero until disputed
        bytes32 disputeEvidenceHash;
    }

    IERC20 public immutable bondToken; // USDC
    MarketRegistry public immutable registry;
    address public immutable treasury;
    uint256 public immutable disputeBond; // e.g. 100e6 = 100 USDC

    mapping(bytes32 => Proposal) public proposals;

    event ResolutionProposed(bytes32 indexed marketId, uint8 outcome, bytes32 evidenceHash, address proposer);
    event ResolutionDisputed(bytes32 indexed marketId, address indexed disputer, bytes32 evidenceHash);
    event ResolutionFinalized(bytes32 indexed marketId, uint8 outcome);
    event Arbitrated(bytes32 indexed marketId, uint8 outcome, bool voided, address indexed arbitrator);

    error NoActiveProposal();
    error DisputeWindowClosed();
    error DisputeWindowOpen();
    error AlreadyDisputed();

    constructor(
        address admin,
        MarketRegistry registry_,
        IERC20 bondToken_,
        uint256 disputeBond_,
        address treasury_
    ) {
        _grantRole(DEFAULT_ADMIN_ROLE, admin);
        registry = registry_;
        bondToken = bondToken_;
        disputeBond = disputeBond_;
        treasury = treasury_;
    }

    /// @notice Oracle aggregator proposes after market close (§12 Optimistic /
    ///         Automatic). evidenceHash anchors the off-chain evidence bundle.
    function propose(bytes32 marketId, uint8 outcome, bytes32 evidenceHash) external onlyRole(PROPOSER_ROLE) {
        require(outcome < 2, "invalid outcome");
        registry.setProposed(marketId); // reverts unless Open + past closeTime
        proposals[marketId] = Proposal({
            outcome: outcome,
            proposedAt: uint64(block.timestamp),
            evidenceHash: evidenceHash,
            disputer: address(0),
            disputeEvidenceHash: bytes32(0)
        });
        emit ResolutionProposed(marketId, outcome, evidenceHash, msg.sender);
    }

    /// @notice Anyone may dispute within the window by posting the bond (§13).
    function dispute(bytes32 marketId, bytes32 evidenceHash) external nonReentrant {
        Proposal storage p = proposals[marketId];
        if (p.proposedAt == 0) revert NoActiveProposal();
        if (p.disputer != address(0)) revert AlreadyDisputed();
        MarketRegistry.MarketData memory data = registry.market(marketId);
        if (block.timestamp > p.proposedAt + data.disputePeriod) revert DisputeWindowClosed();

        bondToken.safeTransferFrom(msg.sender, address(this), disputeBond);
        p.disputer = msg.sender;
        p.disputeEvidenceHash = evidenceHash;
        registry.setDisputed(marketId);
        emit ResolutionDisputed(marketId, msg.sender, evidenceHash);
    }

    /// @notice Permissionless finalization of an undisputed proposal after the
    ///         window (AC-006 pre-condition).
    function finalize(bytes32 marketId) external {
        Proposal storage p = proposals[marketId];
        if (p.proposedAt == 0) revert NoActiveProposal();
        MarketRegistry.MarketData memory data = registry.market(marketId);
        require(data.state == MarketState.ResolutionProposed, "not in proposal state");
        if (block.timestamp <= p.proposedAt + data.disputePeriod) revert DisputeWindowOpen();
        registry.setResolved(marketId, p.outcome);
        emit ResolutionFinalized(marketId, p.outcome);
    }

    /// @notice Committee decision on a disputed market. If the ruling differs
    ///         from the proposal, the disputer's bond is returned; otherwise it
    ///         goes to the treasury (griefing deterrent).
    function arbitrate(bytes32 marketId, uint8 outcome, bool isVoid) external nonReentrant onlyRole(ARBITRATOR_ROLE) {
        Proposal storage p = proposals[marketId];
        if (p.proposedAt == 0) revert NoActiveProposal();
        MarketRegistry.MarketData memory data = registry.market(marketId);
        require(data.state == MarketState.Disputed, "not disputed");

        bool disputerWasRight = isVoid || outcome != p.outcome;
        address bondRecipient = disputerWasRight ? p.disputer : treasury;
        if (isVoid) {
            registry.setVoid(marketId);
        } else {
            require(outcome < 2, "invalid outcome");
            registry.setResolved(marketId, outcome);
        }
        bondToken.safeTransfer(bondRecipient, disputeBond);
        emit Arbitrated(marketId, outcome, isVoid, msg.sender);
    }

    /// @notice Emergency VOID before any proposal exists (event cancelled,
    ///         source permanently unavailable — §46). Committee only, audited
    ///         on-chain via the registry event.
    function voidWithoutProposal(bytes32 marketId) external onlyRole(ARBITRATOR_ROLE) {
        Proposal storage p = proposals[marketId];
        require(p.proposedAt == 0, "use arbitrate");
        registry.setVoid(marketId);
        emit Arbitrated(marketId, 0, true, msg.sender);
    }
}
