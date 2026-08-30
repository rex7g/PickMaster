/**
 * Portfolio view (§38): Total, Available, Invested, Unrealized/Realized P&L,
 * Exposure, Winning/Losing positions, Pending Settlement.
 */
import type { Market, Position } from "./types";

export interface PortfolioView {
  totalCents: number;
  availableBalanceCents: number;
  investedCents: number;
  unrealizedPnlCents: number;
  realizedPnlCents: number;
  exposureCents: number;
  winningPositions: number;
  losingPositions: number;
  pendingSettlement: number;
}

export function computePortfolio(
  balanceCents: number,
  realizedPnlCents: number,
  positions: Position[],
  markets: Map<string, Market>,
  /** Current mark price in cents for (marketId, outcomeId). */
  markPrice: (marketId: string, outcomeId: string) => number | null,
): PortfolioView {
  let investedCents = 0;
  let unrealizedPnlCents = 0;
  let exposureCents = 0;
  let winningPositions = 0;
  let losingPositions = 0;
  let pendingSettlement = 0;

  for (const p of positions) {
    if (p.settled || p.quantity <= 0) continue;
    const market = markets.get(p.marketId);
    investedCents += p.costCents;
    const mark = markPrice(p.marketId, p.outcomeId);
    const value = mark !== null ? mark * p.quantity : p.costCents;
    exposureCents += value;
    unrealizedPnlCents += value - p.costCents;
    if (value > p.costCents) winningPositions++;
    else if (value < p.costCents) losingPositions++;
    if (
      market &&
      (market.status === "RESOLVED" ||
        market.status === "DISPUTE_WINDOW" ||
        market.status === "DISPUTED" ||
        market.status === "RESOLUTION_PENDING")
    ) {
      pendingSettlement++;
    }
  }

  return {
    totalCents: balanceCents + exposureCents,
    availableBalanceCents: balanceCents,
    investedCents,
    unrealizedPnlCents,
    realizedPnlCents,
    exposureCents,
    winningPositions,
    losingPositions,
    pendingSettlement,
  };
}
