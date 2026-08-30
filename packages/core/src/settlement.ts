/**
 * Settlement (§45): deterministic, auditable, idempotent.
 * Winning positions pay 100¢/share; losing positions pay 0 (AC-006).
 * VOID markets (§46) refund every position at cost.
 */
import type { Market, Position } from "./types";

export class SettlementError extends Error {}

export interface SettlementRecord {
  userId: string;
  marketId: string;
  outcomeId: string;
  quantity: number;
  payoutCents: number;
}

export const PAYOUT_PER_SHARE_CENTS = 100;

/**
 * Settle every unsettled position of a RESOLVED or VOID market.
 * Idempotent: already-settled positions are skipped, so re-running after a
 * partial failure never double-pays.
 */
export function settleMarket(market: Market, positions: Position[]): SettlementRecord[] {
  if (
    market.status !== "RESOLVED" &&
    market.status !== "VOID" &&
    market.status !== "SETTLED"
  ) {
    throw new SettlementError(
      `Sólo mercados RESOLVED, VOID o SETTLED pueden liquidarse (estado: ${market.status}).`,
    );
  }
  const wasVoid = market.status === "VOID" || (market.status === "SETTLED" && market.winningOutcomeId === null);
  const records: SettlementRecord[] = [];
  for (const position of positions) {
    if (position.marketId !== market.id || position.settled || position.quantity <= 0) {
      continue;
    }
    let payoutCents: number;
    if (wasVoid) {
      payoutCents = position.costCents; // full refund at cost (§46)
    } else if (position.outcomeId === market.winningOutcomeId) {
      payoutCents = position.quantity * PAYOUT_PER_SHARE_CENTS;
    } else {
      payoutCents = 0;
    }
    position.settled = true;
    position.payoutCents = payoutCents;
    records.push({
      userId: position.userId,
      marketId: market.id,
      outcomeId: position.outcomeId,
      quantity: position.quantity,
      payoutCents,
    });
  }
  market.status = "SETTLED";
  return records;
}
