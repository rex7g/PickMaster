/**
 * PickMaster domain types.
 *
 * Prices are expressed in integer cents of collateral (USDC) per share,
 * in the range (0, 100). A YES share pays 100 cents if the market resolves
 * YES and 0 otherwise, so price ≈ implied probability (§37).
 * Money amounts are integer cents to keep settlement deterministic (§45).
 */

// ---------------------------------------------------------------- lifecycle

/** Market lifecycle (§9). */
export type MarketStatus =
  | "DRAFT"
  | "VALIDATION"
  | "COMPLIANCE_REVIEW"
  | "APPROVED"
  | "OPEN"
  | "CLOSED"
  | "RESOLUTION_PENDING"
  | "DISPUTE_WINDOW"
  | "DISPUTED"
  | "RESOLVED"
  | "SETTLED"
  | "VOID"
  | "PAUSED";

/** Resolution window classes (§8). */
export type ResolutionClass = "ULTRA_FAST" | "FAST" | "STANDARD" | "LONG_TERM";

/** Dispute / arbitration states (§13). */
export type DisputeState =
  | "UNRESOLVED"
  | "PROPOSED"
  | "CHALLENGE_PERIOD"
  | "DISPUTED"
  | "ARBITRATION"
  | "RESOLVED"
  | "EMERGENCY_RESOLUTION";

export type MarketType =
  | "BINARY"
  | "MULTIPLE_CHOICE"
  | "SCALAR"
  | "NUMERIC"
  | "CONDITIONAL";

export type ComplianceStatus = "PENDING" | "APPROVED" | "REJECTED";

export type MarketCategory =
  | "POLITICS"
  | "ECONOMY"
  | "SPORTS"
  | "WEATHER"
  | "FINANCE"
  | "LEGISLATION"
  | "OTHER";

// ---------------------------------------------------------------- market

export interface Outcome {
  id: string;
  /** e.g. "YES", "NO", "OUTCOME_A" */
  code: string;
  label: string;
}

/** A resolution data source with its reliability score (§11). */
export interface ResolutionSource {
  id: string;
  name: string;
  /** e.g. "https://jce.gob.do", "bancentral.gov.do" */
  url?: string;
  kind: "OFFICIAL_API" | "GOVERNMENT" | "SPORTS_ORG" | "FINANCIAL" | "WEATHER" | "NEWS";
  /** 0..1 — SourceReliabilityScore (§11). */
  reliabilityScore: number;
  /** Worst-case latency between real-world outcome and source publication, in ms. */
  latencyMs: number;
}

/** Market entity (§6). */
export interface Market {
  id: string;
  slug: string;
  title: string;
  description: string;

  type: MarketType;
  category: MarketCategory;
  /** ISO 3166-1 alpha-2 of the jurisdiction the market pertains to. */
  jurisdiction: string;

  outcomes: Outcome[];

  status: MarketStatus;
  /** Status held before an emergency pause, restored on unpause. */
  statusBeforePause?: MarketStatus;

  openTime: number;
  closeTime: number;
  resolutionTime: number;
  /** Resolution window length in ms; must respect the ResolutionClass floor (§8). */
  resolutionWindowMs: number;
  resolutionClass: ResolutionClass;

  collateralToken: string;

  /** Aggregates maintained by the trading engine, in cents. */
  liquidity: number;
  volume: number;

  /** Implied probability of the first outcome (YES for binary), 0..1. */
  currentProbability: number;

  resolutionSources: ResolutionSource[];
  resolutionRule: string;

  oracleId: string;
  disputePeriodMs: number;

  marketCreator: string;
  feeModelId: string;

  /** 0..1 composite market risk (§29). */
  riskLevel: number;
  complianceStatus: ComplianceStatus;

  /** Set when the market resolves: winning outcome id, or null when VOID. */
  winningOutcomeId?: string | null;
  disputeState: DisputeState;

  createdAt: number;
  updatedAt: number;
}

// ---------------------------------------------------------------- trading

export type OrderSide = "BUY" | "SELL";

export interface Order {
  id: string;
  marketId: string;
  outcomeId: string;
  userId: string;
  side: OrderSide;
  /** Limit price in cents per share, integer in (0, 100). */
  priceCents: number;
  /** Number of shares. */
  quantity: number;
  filledQuantity: number;
  status: "OPEN" | "FILLED" | "PARTIALLY_FILLED" | "CANCELLED";
  /** EIP-712-style signature placeholder; real signatures arrive in Phase 2 (§16). */
  signature?: string;
  createdAt: number;
}

export interface Trade {
  id: string;
  marketId: string;
  outcomeId: string;
  buyOrderId: string;
  sellOrderId: string;
  buyerId: string;
  sellerId: string;
  priceCents: number;
  quantity: number;
  /**
   * MINT: a YES buyer matched a NO buyer — collateral locked, both sides minted.
   * TRANSFER: existing shares changed hands.
   */
  kind: "MINT" | "TRANSFER";
  executedAt: number;
}

export interface Position {
  userId: string;
  marketId: string;
  outcomeId: string;
  quantity: number;
  /** Total cents paid for the currently held quantity. */
  costCents: number;
  settled: boolean;
  /** Payout received at settlement, cents. */
  payoutCents?: number;
}

// ---------------------------------------------------------------- oracle / resolution

export interface OracleReport {
  sourceId: string;
  marketId: string;
  /** Outcome code reported by the source, e.g. "YES". */
  outcomeCode: string;
  reportedAt: number;
  /** Hash of the raw evidence payload. */
  evidenceHash: string;
}

export interface ResolutionProposal {
  marketId: string;
  outcomeId: string | null;
  method:
    | "AUTOMATIC"
    | "OPTIMISTIC"
    | "MULTI_ORACLE"
    | "MANUAL_ARBITRATION"
    | "EMERGENCY";
  proposedBy: string;
  proposedAt: number;
  evidence: OracleReport[];
  disputeWindowEndsAt: number;
}

export interface Dispute {
  marketId: string;
  disputedBy: string;
  reason: string;
  disputedAt: number;
  evidenceHash?: string;
  decision?: { outcomeId: string | null; decidedBy: string; decidedAt: number };
}

// ---------------------------------------------------------------- compliance / risk

export type EligibilityResult = "ALLOWED" | "RESTRICTED" | "BLOCKED" | "REQUIRES_REVIEW";

export interface UserProfile {
  id: string;
  /** ISO 3166-1 alpha-2. */
  jurisdiction: string;
  kycVerified: boolean;
  ageVerified: boolean;
  sanctioned: boolean;
  /** 0..1 (§29). */
  riskScore: number;
  balanceCents: number;
}

export interface RiskEvent {
  id: string;
  kind:
    | "WASH_TRADING"
    | "CORRELATED_ACCOUNTS"
    | "CONCENTRATION"
    | "RAPID_TRADING"
    | "SUSPICIOUS_WALLET"
    | "ORACLE_RISK"
    | "PRICE_ANOMALY";
  severity: "LOW" | "MEDIUM" | "HIGH" | "CRITICAL";
  subjectIds: string[];
  marketId?: string;
  detail: string;
  createdAt: number;
}

// ---------------------------------------------------------------- audit

export interface AuditEvent {
  /** Monotonic sequence number. */
  seq: number;
  actor: string;
  action: string;
  entity: string;
  entityId: string;
  detail: string;
  timestamp: number;
  /** Hash of previous event's hash + this event's payload — tamper-evident chain (§40). */
  prevHash: string;
  hash: string;
}

// ---------------------------------------------------------------- fees

/** Transparent fee breakdown — never hide gas (§18). */
export interface FeeBreakdown {
  tradingFeeCents: number;
  protocolFeeCents: number;
  settlementFeeCents: number;
  /** Estimated network (gas) fee; simulated in Phase 1. */
  estimatedNetworkFeeCents: number;
  totalFeeCents: number;
}
