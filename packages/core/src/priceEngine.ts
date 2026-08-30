/**
 * Price Engine (§37): implied probability, mid price, best bid/ask, spread.
 * Price of a share in cents ≈ implied probability in %.
 *
 * Disclaimer shown in the UI: "El precio representa la probabilidad implícita
 * del mercado, no una garantía de que el evento ocurra."
 */
import type { Trade } from "./types";
import type { OrderBook } from "./matching";

export interface PriceSnapshot {
  outcomeId: string;
  bestBidCents: number | null;
  bestAskCents: number | null;
  midPriceCents: number | null;
  lastPriceCents: number | null;
  /** 0..1 */
  impliedProbability: number | null;
  spreadCents: number | null;
  volume24hCents: number;
  change24h: number | null;
}

export function snapshotPrice(
  book: OrderBook,
  outcomeId: string,
  trades: Trade[],
  now: number,
): PriceSnapshot {
  const { bids, asks } = book.depth(outcomeId);
  const bestBidCents = bids[0]?.priceCents ?? null;
  const bestAskCents = asks[0]?.priceCents ?? null;
  const midPriceCents =
    bestBidCents !== null && bestAskCents !== null
      ? (bestBidCents + bestAskCents) / 2
      : null;

  const outcomeTrades = trades
    .filter((t) => t.outcomeId === outcomeId)
    .sort((a, b) => a.executedAt - b.executedAt);
  const last = outcomeTrades[outcomeTrades.length - 1];
  const lastPriceCents = last ? last.priceCents : null;

  const dayAgo = now - 24 * 60 * 60_000;
  const trades24h = outcomeTrades.filter((t) => t.executedAt >= dayAgo);
  const volume24hCents = trades24h.reduce(
    (sum, t) => sum + t.priceCents * t.quantity,
    0,
  );
  const first24h = trades24h[0];
  const change24h =
    first24h && last && first24h.priceCents > 0
      ? (last.priceCents - first24h.priceCents) / first24h.priceCents
      : null;

  const reference = midPriceCents ?? lastPriceCents;
  return {
    outcomeId,
    bestBidCents,
    bestAskCents,
    midPriceCents,
    lastPriceCents,
    impliedProbability: reference !== null ? reference / 100 : null,
    spreadCents:
      bestBidCents !== null && bestAskCents !== null
        ? bestAskCents - bestBidCents
        : null,
    volume24hCents,
    change24h,
  };
}
