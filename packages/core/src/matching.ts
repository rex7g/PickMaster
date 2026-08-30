/**
 * MatchingEngine — CLOB for binary markets (§16).
 *
 * Off-chain matching + (future) on-chain settlement. The engine is pure:
 * it maintains resting orders and produces Trades; balance/risk/compliance/
 * signature checks happen BEFORE an order reaches the book (AC-004), and
 * applying trades to positions/collateral happens after (TradingService).
 *
 * Two ways an order can fill:
 *  - TRANSFER: BUY YES x SELL YES (existing shares change hands).
 *  - MINT: BUY YES @ p_y x BUY NO @ p_n with p_y + p_n >= 100 — a full set
 *    is minted against 100¢ of locked collateral (how prediction-market
 *    CLOBs create supply). In a MINT trade, `buyerId` receives `outcomeId`
 *    shares at `priceCents`; `sellerId` (the complementary buyer) receives
 *    complementary shares at (100 - priceCents).
 */
import type { Market, Order, Trade } from "./types";

export interface MatchResult {
  order: Order;
  trades: Trade[];
}

let tradeSeq = 0;
const nextTradeId = () => `trade_${++tradeSeq}`;

export class OrderBook {
  private orders: Order[] = [];

  constructor(private readonly market: Market) {}

  /** Complement of an outcome in a binary market. */
  private complementOf(outcomeId: string): string {
    const other = this.market.outcomes.find((o) => o.id !== outcomeId);
    if (!other) throw new Error("binary market must have two outcomes");
    return other.id;
  }

  restingOrders(): readonly Order[] {
    return this.orders;
  }

  cancel(orderId: string, userId: string): Order | undefined {
    const order = this.orders.find((o) => o.id === orderId && o.userId === userId);
    if (!order) return undefined;
    order.status = "CANCELLED";
    this.orders = this.orders.filter((o) => o.id !== orderId);
    return order;
  }

  /**
   * Price-time priority matching. Returns executed trades; any remainder
   * of a limit order rests on the book.
   */
  submit(order: Order, now: number): MatchResult {
    if (order.priceCents <= 0 || order.priceCents >= 100) {
      throw new Error("price must be an integer in (0, 100) cents");
    }
    if (!Number.isInteger(order.quantity) || order.quantity <= 0) {
      throw new Error("quantity must be a positive integer");
    }
    const trades: Trade[] = [];
    const complement = this.complementOf(order.outcomeId);

    while (order.filledQuantity < order.quantity) {
      const best = this.bestCounterparty(order, complement);
      if (!best) break;

      const { resting, execPriceCents, kind } = best;
      const qty = Math.min(
        order.quantity - order.filledQuantity,
        resting.quantity - resting.filledQuantity,
      );

      const isBuyTaker = order.side === "BUY";
      trades.push({
        id: nextTradeId(),
        marketId: this.market.id,
        outcomeId: isBuyTaker ? order.outcomeId : resting.outcomeId,
        buyOrderId: isBuyTaker ? order.id : resting.id,
        sellOrderId: isBuyTaker ? resting.id : order.id,
        buyerId: isBuyTaker ? order.userId : resting.userId,
        sellerId: isBuyTaker ? resting.userId : order.userId,
        priceCents: execPriceCents,
        quantity: qty,
        kind,
        executedAt: now,
      });

      order.filledQuantity += qty;
      resting.filledQuantity += qty;
      if (resting.filledQuantity >= resting.quantity) {
        resting.status = "FILLED";
        this.orders = this.orders.filter((o) => o.id !== resting.id);
      } else {
        resting.status = "PARTIALLY_FILLED";
      }
    }

    if (order.filledQuantity >= order.quantity) {
      order.status = "FILLED";
    } else {
      order.status = order.filledQuantity > 0 ? "PARTIALLY_FILLED" : "OPEN";
      this.orders.push(order);
    }
    return { order, trades };
  }

  /**
   * Best fill available for a taker order:
   *  - BUY: cheapest of (SELL same outcome at <= limit) vs
   *         (BUY complement at p_c where 100 - p_c <= limit → MINT).
   *  - SELL: highest BUY of the same outcome at >= limit (TRANSFER).
   */
  private bestCounterparty(
    taker: Order,
    complement: string,
  ): { resting: Order; execPriceCents: number; kind: Trade["kind"] } | undefined {
    let best:
      | { resting: Order; execPriceCents: number; kind: Trade["kind"] }
      | undefined;

    for (const resting of this.orders) {
      if (resting.userId === taker.userId) continue; // no self-trade (wash-trade guard)

      let candidate:
        | { resting: Order; execPriceCents: number; kind: Trade["kind"] }
        | undefined;

      if (taker.side === "BUY") {
        if (resting.outcomeId === taker.outcomeId && resting.side === "SELL") {
          if (resting.priceCents <= taker.priceCents) {
            candidate = { resting, execPriceCents: resting.priceCents, kind: "TRANSFER" };
          }
        } else if (resting.outcomeId === complement && resting.side === "BUY") {
          const implied = 100 - resting.priceCents;
          if (implied <= taker.priceCents) {
            candidate = { resting, execPriceCents: implied, kind: "MINT" };
          }
        }
      } else {
        if (resting.outcomeId === taker.outcomeId && resting.side === "BUY") {
          if (resting.priceCents >= taker.priceCents) {
            candidate = { resting, execPriceCents: resting.priceCents, kind: "TRANSFER" };
          }
        }
      }

      if (!candidate) continue;
      if (!best) {
        best = candidate;
        continue;
      }
      const better =
        taker.side === "BUY"
          ? candidate.execPriceCents < best.execPriceCents
          : candidate.execPriceCents > best.execPriceCents;
      const tie =
        candidate.execPriceCents === best.execPriceCents &&
        candidate.resting.createdAt < best.resting.createdAt;
      if (better || tie) best = candidate;
    }
    return best;
  }

  /** Aggregated depth for an outcome, in YES-equivalent terms for the UI (§55). */
  depth(outcomeId: string): {
    bids: { priceCents: number; quantity: number }[];
    asks: { priceCents: number; quantity: number }[];
  } {
    const complement = this.complementOf(outcomeId);
    const bids = new Map<number, number>();
    const asks = new Map<number, number>();
    for (const o of this.orders) {
      const remaining = o.quantity - o.filledQuantity;
      if (remaining <= 0) continue;
      if (o.outcomeId === outcomeId && o.side === "BUY") {
        bids.set(o.priceCents, (bids.get(o.priceCents) ?? 0) + remaining);
      } else if (o.outcomeId === outcomeId && o.side === "SELL") {
        asks.set(o.priceCents, (asks.get(o.priceCents) ?? 0) + remaining);
      } else if (o.outcomeId === complement && o.side === "BUY") {
        // A bid on the complement is an implied ask on this outcome.
        const implied = 100 - o.priceCents;
        asks.set(implied, (asks.get(implied) ?? 0) + remaining);
      } else if (o.outcomeId === complement && o.side === "SELL") {
        const implied = 100 - o.priceCents;
        bids.set(implied, (bids.get(implied) ?? 0) + remaining);
      }
    }
    const toLevels = (m: Map<number, number>, desc: boolean) =>
      [...m.entries()]
        .map(([priceCents, quantity]) => ({ priceCents, quantity }))
        .sort((a, b) => (desc ? b.priceCents - a.priceCents : a.priceCents - b.priceCents));
    return { bids: toLevels(bids, true), asks: toLevels(asks, false) };
  }
}
