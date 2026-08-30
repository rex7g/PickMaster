// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/**
 * PickMaster protocol interfaces (Fase 2 — especificación de referencia).
 * Ver contracts/README.md: NO desplegar sin tests, fuzzing y auditoría (§28).
 */

/// Estados del mercado on-chain (subconjunto del ciclo de vida §9 que vive en L2).
enum MarketState {
    Open,
    Closed,
    ResolutionProposed,
    Disputed,
    Resolved,
    Void,
    Settled
}

interface IMarketFactory {
    event MarketCreated(
        bytes32 indexed marketId,
        address market,
        address collateralToken,
        uint64 closeTime,
        uint64 disputePeriod
    );

    /// Sólo MARKET_CREATOR_ROLE (backend aprobado por compliance, nunca un agente IA).
    function createMarket(
        bytes32 marketId,
        address collateralToken,
        uint64 closeTime,
        uint64 disputePeriod,
        bytes32 rulesHash // hash de las reglas de resolución publicadas (§56)
    ) external returns (address market);
}

interface ICollateralVault {
    event CollateralLocked(bytes32 indexed marketId, address indexed from, uint256 amount);
    event PayoutClaimed(bytes32 indexed marketId, address indexed to, uint256 amount);

    /// Bloquea colateral al mintear un set completo (1.00 USDC por share, §16 MINT).
    function lockForMint(bytes32 marketId, address yesBuyer, address noBuyer, uint256 shares)
        external;

    /// Reclamo de payout tras resolución final (AC-006). Idempotente.
    function claim(bytes32 marketId) external returns (uint256 paid);

    /// Reembolso al coste si el mercado es VOID (§46).
    function refund(bytes32 marketId) external returns (uint256 paid);
}

interface IPositionToken /* is ERC1155 */ {
    /// tokenId = keccak256(marketId, outcomeIndex)
    function positionId(bytes32 marketId, uint8 outcomeIndex) external pure returns (uint256);
    function mintPair(bytes32 marketId, address yesTo, address noTo, uint256 shares) external;
    function burn(address from, uint256 tokenId, uint256 shares) external;
}

/// Settlement on-chain de órdenes casadas off-chain (§16): CLOB off-chain,
/// firmas EIP-712 de ambas contrapartes, batching para minimizar gas (§18).
interface IExchange {
    struct Order {
        address maker;
        bytes32 marketId;
        uint8 outcomeIndex;
        bool isBuy;
        uint64 priceCents; // (0, 100)
        uint128 quantity;
        uint64 expiry;
        uint256 nonce;
    }

    event OrdersMatched(
        bytes32 indexed marketId,
        bytes32 buyOrderHash,
        bytes32 sellOrderHash,
        uint64 priceCents,
        uint128 quantity,
        bool minted
    );

    /// Verifica ambas firmas EIP-712, estado del mercado y balances; ejecuta
    /// MINT o TRANSFER. Sólo OPERATOR_ROLE (matcher backend); los usuarios
    /// nunca entregan claves privadas (§16).
    function settleMatch(
        Order calldata buy,
        bytes calldata buySig,
        Order calldata sell,
        bytes calldata sellSig,
        uint128 quantity
    ) external;

    function cancelOrder(Order calldata order) external;
}

interface IOracleAdapter {
    event ResolutionProposed(bytes32 indexed marketId, uint8 outcomeIndex, bytes32 evidenceHash);

    /// El agregador (≥2 fuentes confiables de acuerdo, AC-007) propone; nunca
    /// resuelve directamente: abre la ventana de disputa en DisputeManager.
    function proposeResolution(bytes32 marketId, uint8 outcomeIndex, bytes32 evidenceHash)
        external;
}

interface IDisputeManager {
    event ResolutionDisputed(bytes32 indexed marketId, address indexed disputer, bytes32 evidenceHash);
    event MarketResolved(bytes32 indexed marketId, uint8 outcomeIndex);
    event MarketVoided(bytes32 indexed marketId);

    /// Cualquiera puede disputar dentro de la ventana depositando un bond (§13).
    function dispute(bytes32 marketId, bytes32 evidenceHash) external;

    /// Finaliza una propuesta no disputada cuya ventana expiró.
    function finalize(bytes32 marketId) external;

    /// ARBITRATOR_ROLE (comité multisig; integrable con UMA/Kleros §13) decide
    /// mercados disputados: outcome o VOID. Nunca puede revertir un Resolved.
    function arbitrate(bytes32 marketId, uint8 outcomeIndex, bool isVoid) external;
}

interface IFeeManager {
    /// Fees en basis points, separadas y consultables públicamente (§18).
    function tradingFeeBps() external view returns (uint16);
    function protocolFeeBps() external view returns (uint16);
    function collect(bytes32 marketId, uint256 notional) external returns (uint256 feeAmount);
}

interface IEmergencyPause {
    event Paused(address indexed by, string reason);
    event Unpaused(address indexed by);

    /// GUARDIAN_ROLE (multisig). Bloquea nuevas operaciones, nunca retiene
    /// payouts de mercados ya resueltos (AC-013).
    function pause(string calldata reason) external;

    /// Despausar exige timelock (§41).
    function unpause() external;
}
