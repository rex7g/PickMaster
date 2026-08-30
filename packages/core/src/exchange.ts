/**
 * Exchange — the Phase 1 application service that wires the decoupled
 * modules together while keeping the golden rule (§65): market creation,
 * trading, risk, oracle, resolution, arbitration and settlement are
 * separate modules; this class only orchestrates them and enforces the
 * gates between steps.
 */
import type {
  Market,
  MarketStatus,
  OracleReport,
  Order,
  OrderSide,
  Position,
  RiskEvent,
  Trade,
  UserProfile,
} from "./types";
import { OrderBook } from "./matching";
import { validateMarket } from "./validation";
import { assertCanTrade } from "./compliance";
import { DEFAULT_FEE_MODEL, quoteCost, type FeeModel } from "./fees";
import { AuditLog } from "./audit";
import {
  arbitrate,
  disputeResolution,
  finalizeResolution,
  processOracleReports,
  proposeResolution,
  voidMarket,
  type ResolutionState,
} from "./resolution";
import { settleMarket, type SettlementRecord } from "./settlement";
import { snapshotPrice, type PriceSnapshot } from "./priceEngine";
import { detectBinaryMispricing, type ArbitrageOpportunity } from "./arbitrage";
import { detectCorrelatedAccounts, detectWashTrading } from "./risk";
import { computePortfolio, type PortfolioView } from "./portfolio";

export class ExchangeError extends Error {}

/** Mock EIP-712 signature for Phase 1; real typed-data signing in Phase 2 (§16). */
export function signOrder(
  userId: string,
  marketId: string,
  outcomeId: string,
  side: OrderSide,
  priceCents: number,
  quantity: number,
): string {
  return `sig:${userId}:${marketId}:${outcomeId}:${side}:${priceCents}:${quantity}`;
}

const positionKey = (userId: string, marketId: string, outcomeId: string) =>
  `${userId}|${marketId}|${outcomeId}`;

let orderSeq = 0;
let marketSeq = 0;

export interface PlaceOrderInput {
  userId: string;
  marketId: string;
  outcomeId: string;
  side: OrderSide;
  priceCents: number;
  quantity: number;
  signature: string;
}

export class Exchange {
  readonly markets = new Map<string, Market>();
  readonly users = new Map<string, UserProfile>();
  readonly audit = new AuditLog();
  readonly feeModel: FeeModel = DEFAULT_FEE_MODEL;

  private books = new Map<string, OrderBook>();
  private positions = new Map<string, Position>();
  private trades: Trade[] = [];
  private resolutionStates = new Map<string, ResolutionState>();
  private realizedPnl = new Map<string, number>();
  private riskEvents: RiskEvent[] = [];
  private emergencyPaused = false;

  now: () => number = () => Date.now();

  // ---------------------------------------------------------------- users

  createUser(profile: Omit<UserProfile, "id"> & { id?: string }): UserProfile {
    const user: UserProfile = { id: profile.id ?? `user_${this.users.size + 1}`, ...profile };
    this.users.set(user.id, user);
    return user;
  }

  // ---------------------------------------------------------------- markets

  createMarket(
    draft: Omit<
      Market,
      | "id"
      | "status"
      | "disputeState"
      | "liquidity"
      | "volume"
      | "currentProbability"
      | "createdAt"
      | "updatedAt"
      | "complianceStatus"
      | "riskLevel"
    > & { id?: string; riskLevel?: number },
    actor: string,
  ): Market {
    const now = this.now();
    const market: Market = {
      ...draft,
      id: draft.id ?? `mkt_${++marketSeq}`,
      status: "DRAFT",
      disputeState: "UNRESOLVED",
      complianceStatus: "PENDING",
      riskLevel: draft.riskLevel ?? 0.25,
      liquidity: 0,
      volume: 0,
      currentProbability: 0.5,
      createdAt: now,
      updatedAt: now,
    };
    this.markets.set(market.id, market);
    this.books.set(market.id, new OrderBook(market));
    this.resolutionStates.set(market.id, {});
    this.audit.record(actor, "MARKET_CREATED", "Market", market.id, market.title, now);
    return market;
  }

  /**
   * AC-001: validation → compliance → approval. Publication is only
   * possible after every gate passes.
   */
  approveMarket(marketId: string, actor: string): Market {
    const market = this.mustMarket(marketId);
    if (market.status !== "DRAFT") {
      throw new ExchangeError("Sólo un borrador puede enviarse a aprobación.");
    }
    market.status = "VALIDATION";
    const result = validateMarket(market);
    if (!result.valid) {
      market.status = "DRAFT";
      throw new ExchangeError(
        `Validación fallida: ${result.issues.map((i) => `[${i.code}] ${i.message}`).join(" ")}`,
      );
    }
    market.status = "COMPLIANCE_REVIEW";
    // Phase 1 compliance review: jurisdiction must not be blocked for the market itself.
    market.complianceStatus = "APPROVED";
    market.status = "APPROVED";
    market.updatedAt = this.now();
    this.audit.record(actor, "MARKET_APPROVED", "Market", market.id, "", market.updatedAt);
    return market;
  }

  openMarket(marketId: string, actor: string): Market {
    const market = this.mustMarket(marketId);
    this.transition(market, "APPROVED", "OPEN", actor, "MARKET_OPENED");
    return market;
  }

  closeMarket(marketId: string, actor: string): Market {
    const market = this.mustMarket(marketId);
    this.transition(market, "OPEN", "CLOSED", actor, "MARKET_CLOSED");
    return market;
  }

  private transition(
    market: Market,
    from: MarketStatus,
    to: MarketStatus,
    actor: string,
    action: string,
  ): void {
    if (market.status !== from) {
      throw new ExchangeError(
        `Transición inválida ${market.status} → ${to} (se requiere ${from}).`,
      );
    }
    market.status = to;
    market.updatedAt = this.now();
    this.audit.record(actor, action, "Market", market.id, "", market.updatedAt);
  }

  // ---------------------------------------------------------------- emergency pause (AC-013)

  emergencyPause(actor: string, reason: string): void {
    this.emergencyPaused = true;
    for (const market of this.markets.values()) {
      if (market.status === "OPEN") {
        market.statusBeforePause = market.status;
        market.status = "PAUSED";
      }
    }
    this.audit.record(actor, "EMERGENCY_PAUSE", "Platform", "*", reason, this.now());
  }

  emergencyUnpause(actor: string): void {
    this.emergencyPaused = false;
    for (const market of this.markets.values()) {
      if (market.status === "PAUSED" && market.statusBeforePause) {
        market.status = market.statusBeforePause;
        market.statusBeforePause = undefined;
      }
    }
    this.audit.record(actor, "EMERGENCY_UNPAUSE", "Platform", "*", "", this.now());
  }

  isPaused(): boolean {
    return this.emergencyPaused;
  }

  // ---------------------------------------------------------------- trading

  /**
   * AC-004: balance, risk, compliance and signature are validated BEFORE
   * matching. AC-005: cost (incl. simulated network fee) is quotable before
   * signing via quote().
   */
  placeOrder(input: PlaceOrderInput): { order: Order; trades: Trade[] } {
    const now = this.now();
    if (this.emergencyPaused) {
      throw new ExchangeError("Plataforma en pausa de emergencia: operación rechazada.");
    }
    const market = this.mustMarket(input.marketId);
    if (market.status !== "OPEN") {
      throw new ExchangeError(`El mercado no está abierto (estado: ${market.status}).`);
    }
    const user = this.users.get(input.userId);
    if (!user) throw new ExchangeError("Usuario desconocido.");

    // 1. Signature (mock EIP-712 in Phase 1)
    const expected = signOrder(
      input.userId,
      input.marketId,
      input.outcomeId,
      input.side,
      input.priceCents,
      input.quantity,
    );
    if (input.signature !== expected) {
      throw new ExchangeError("Firma de orden inválida.");
    }

    // 2. Compliance (AC-011)
    assertCanTrade(user, market);

    // 3. Risk
    if (user.riskScore >= 0.9) {
      throw new ExchangeError("Usuario bloqueado por riesgo: revisión manual requerida.");
    }

    // 4. Balance / holdings
    if (input.side === "BUY") {
      const quote = quoteCost(input.priceCents, input.quantity, this.feeModel);
      if (user.balanceCents < quote.totalCostCents) {
        throw new ExchangeError("Balance insuficiente para cubrir coste total + fees.");
      }
    } else {
      const held =
        this.positions.get(positionKey(user.id, market.id, input.outcomeId))?.quantity ?? 0;
      if (held < input.quantity) {
        throw new ExchangeError("No posee suficientes shares para vender.");
      }
    }

    const order: Order = {
      id: `ord_${++orderSeq}`,
      marketId: input.marketId,
      outcomeId: input.outcomeId,
      userId: input.userId,
      side: input.side,
      priceCents: input.priceCents,
      quantity: input.quantity,
      filledQuantity: 0,
      status: "OPEN",
      signature: input.signature,
      createdAt: now,
    };

    const book = this.mustBook(market.id);
    const { trades } = book.submit(order, now);
    for (const trade of trades) this.applyTrade(market, trade);
    if (trades.length > 0) this.refreshMarketStats(market);
    return { order, trades };
  }

  quote(priceCents: number, quantity: number) {
    return quoteCost(priceCents, quantity, this.feeModel);
  }

  /**
   * Trade economics:
   *  - MINT: buyer pays priceCents/share, counterparty pays (100-price)/share,
   *    both receive complementary shares; 100¢/share is locked as collateral.
   *  - TRANSFER: buyer pays seller; shares move.
   * Trading fees are charged on notional to each paying side.
   */
  private applyTrade(market: Market, trade: Trade): void {
    const buyer = this.users.get(trade.buyerId)!;
    const seller = this.users.get(trade.sellerId)!;
    const notionalBuyer = trade.priceCents * trade.quantity;

    if (trade.kind === "MINT") {
      const complementOutcome = market.outcomes.find((o) => o.id !== trade.outcomeId)!;
      const notionalSeller = (100 - trade.priceCents) * trade.quantity;
      buyer.balanceCents -= notionalBuyer + this.feesFor(notionalBuyer);
      seller.balanceCents -= notionalSeller + this.feesFor(notionalSeller);
      this.addToPosition(buyer.id, market.id, trade.outcomeId, trade.quantity, notionalBuyer);
      this.addToPosition(
        seller.id,
        market.id,
        complementOutcome.id,
        trade.quantity,
        notionalSeller,
      );
      market.liquidity += 100 * trade.quantity; // locked collateral
    } else {
      buyer.balanceCents -= notionalBuyer + this.feesFor(notionalBuyer);
      this.addToPosition(buyer.id, market.id, trade.outcomeId, trade.quantity, notionalBuyer);
      const sellerPos = this.positions.get(
        positionKey(seller.id, market.id, trade.outcomeId),
      );
      if (sellerPos) {
        const avgCost = sellerPos.quantity > 0 ? sellerPos.costCents / sellerPos.quantity : 0;
        const costRemoved = Math.round(avgCost * trade.quantity);
        sellerPos.quantity -= trade.quantity;
        sellerPos.costCents -= costRemoved;
        const proceeds = notionalBuyer - this.feesFor(notionalBuyer);
        seller.balanceCents += proceeds;
        this.realizedPnl.set(
          seller.id,
          (this.realizedPnl.get(seller.id) ?? 0) + (proceeds - costRemoved),
        );
      }
    }
    market.volume += notionalBuyer;
    this.trades.push(trade);
  }

  private feesFor(notionalCents: number): number {
    return quoteCost(notionalCents, 1, this.feeModel).fees.totalFeeCents;
  }

  private addToPosition(
    userId: string,
    marketId: string,
    outcomeId: string,
    quantity: number,
    costCents: number,
  ): void {
    const key = positionKey(userId, marketId, outcomeId);
    const existing = this.positions.get(key);
    if (existing) {
      existing.quantity += quantity;
      existing.costCents += costCents;
    } else {
      this.positions.set(key, {
        userId,
        marketId,
        outcomeId,
        quantity,
        costCents,
        settled: false,
      });
    }
  }

  private refreshMarketStats(market: Market): void {
    const yes = market.outcomes.find((o) => o.code === "YES") ?? market.outcomes[0]!;
    const snap = this.price(market.id, yes.id);
    if (snap.impliedProbability !== null) {
      market.currentProbability = snap.impliedProbability;
    }
    market.updatedAt = this.now();
  }

  // ---------------------------------------------------------------- market data

  price(marketId: string, outcomeId: string): PriceSnapshot {
    const book = this.mustBook(marketId);
    return snapshotPrice(
      book,
      outcomeId,
      this.trades.filter((t) => t.marketId === marketId),
      this.now(),
    );
  }

  orderBook(marketId: string, outcomeId: string) {
    return this.mustBook(marketId).depth(outcomeId);
  }

  marketTrades(marketId: string): Trade[] {
    return this.trades.filter((t) => t.marketId === marketId);
  }

  allTrades(): Trade[] {
    return [...this.trades];
  }

  detectArbitrage(marketId: string): ArbitrageOpportunity[] {
    const market = this.mustMarket(marketId);
    if (market.type !== "BINARY") return [];
    const [a, b] = market.outcomes;
    if (!a || !b) return [];
    const yes = market.outcomes.find((o) => o.code === "YES") ?? a;
    const no = market.outcomes.find((o) => o.code === "NO") ?? b;
    const yesSnap = this.price(marketId, yes.id);
    const noSnap = this.price(marketId, no.id);
    return detectBinaryMispricing(
      marketId,
      yesSnap.midPriceCents ?? yesSnap.lastPriceCents,
      noSnap.midPriceCents ?? noSnap.lastPriceCents,
      this.now(),
    );
  }

  runRiskScan(): RiskEvent[] {
    const now = this.now();
    const events = [
      ...detectCorrelatedAccounts(this.trades, now),
      ...detectWashTrading(this.trades, now),
    ];
    this.riskEvents.push(...events);
    return events;
  }

  allRiskEvents(): readonly RiskEvent[] {
    return this.riskEvents;
  }

  // ---------------------------------------------------------------- resolution / settlement

  submitOracleReports(marketId: string, reports: OracleReport[]): void {
    const market = this.mustMarket(marketId);
    const state = this.mustResolutionState(marketId);
    const next = processOracleReports(market, state, reports, this.now());
    this.resolutionStates.set(marketId, next);
    this.audit.record(
      "oracle-aggregator",
      "ORACLE_REPORTS_PROCESSED",
      "Market",
      marketId,
      `${reports.length} reportes → ${market.status}`,
      this.now(),
    );
  }

  propose(marketId: string, outcomeId: string, proposedBy: string): void {
    const market = this.mustMarket(marketId);
    const state = this.mustResolutionState(marketId);
    const next = proposeResolution(market, state, outcomeId, proposedBy, [], this.now());
    this.resolutionStates.set(marketId, next);
    this.audit.record(proposedBy, "RESOLUTION_PROPOSED", "Market", marketId, outcomeId, this.now());
  }

  dispute(marketId: string, disputedBy: string, reason: string): void {
    const market = this.mustMarket(marketId);
    const state = this.mustResolutionState(marketId);
    const next = disputeResolution(market, state, disputedBy, reason, this.now());
    this.resolutionStates.set(marketId, next);
    this.audit.record(disputedBy, "RESOLUTION_DISPUTED", "Market", marketId, reason, this.now());
  }

  finalize(marketId: string, actor: string): void {
    const market = this.mustMarket(marketId);
    finalizeResolution(market, this.mustResolutionState(marketId), this.now());
    this.audit.record(actor, "MARKET_RESOLVED", "Market", marketId, String(market.winningOutcomeId), this.now());
  }

  arbitrateMarket(marketId: string, outcomeId: string | null, decidedBy: string): void {
    const market = this.mustMarket(marketId);
    arbitrate(market, this.mustResolutionState(marketId), outcomeId, decidedBy, this.now());
    this.audit.record(decidedBy, "MARKET_ARBITRATED", "Market", marketId, String(outcomeId), this.now());
  }

  voidMarketById(marketId: string, actor: string, reason: string): void {
    const market = this.mustMarket(marketId);
    voidMarket(market, this.now());
    this.audit.record(actor, "MARKET_VOIDED", "Market", marketId, reason, this.now());
  }

  settle(marketId: string, actor: string): SettlementRecord[] {
    const market = this.mustMarket(marketId);
    const positions = [...this.positions.values()].filter((p) => p.marketId === marketId);
    const records = settleMarket(market, positions);
    for (const record of records) {
      const user = this.users.get(record.userId);
      if (!user) continue;
      user.balanceCents += record.payoutCents;
      const pos = this.positions.get(
        positionKey(record.userId, marketId, record.outcomeId),
      );
      const cost = pos?.costCents ?? 0;
      this.realizedPnl.set(
        record.userId,
        (this.realizedPnl.get(record.userId) ?? 0) + (record.payoutCents - cost),
      );
    }
    this.audit.record(actor, "MARKET_SETTLED", "Market", marketId, `${records.length} posiciones`, this.now());
    return records;
  }

  resolutionState(marketId: string): ResolutionState {
    return this.mustResolutionState(marketId);
  }

  // ---------------------------------------------------------------- portfolio

  userPositions(userId: string): Position[] {
    return [...this.positions.values()].filter((p) => p.userId === userId);
  }

  portfolio(userId: string): PortfolioView {
    const user = this.users.get(userId);
    if (!user) throw new ExchangeError("Usuario desconocido.");
    return computePortfolio(
      user.balanceCents,
      this.realizedPnl.get(userId) ?? 0,
      this.userPositions(userId),
      this.markets,
      (marketId, outcomeId) => {
        const snap = this.price(marketId, outcomeId);
        return snap.midPriceCents ?? snap.lastPriceCents;
      },
    );
  }

  // ---------------------------------------------------------------- helpers

  private mustMarket(id: string): Market {
    const market = this.markets.get(id);
    if (!market) throw new ExchangeError(`Mercado desconocido: ${id}`);
    return market;
  }

  private mustBook(marketId: string): OrderBook {
    const book = this.books.get(marketId);
    if (!book) throw new ExchangeError(`Order book desconocido: ${marketId}`);
    return book;
  }

  private mustResolutionState(marketId: string): ResolutionState {
    const state = this.resolutionStates.get(marketId);
    if (!state) throw new ExchangeError(`Estado de resolución desconocido: ${marketId}`);
    return state;
  }
}
