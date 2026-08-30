import { NextResponse } from "next/server";
import { getExchange } from "@/lib/store";
import { marketSummary } from "@/lib/views";

/** Public API (§57): GET /markets/{id} — accepts id or slug. */
export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const exchange = getExchange();
  const market =
    exchange.markets.get(id) ??
    [...exchange.markets.values()].find((m) => m.slug === id);
  if (!market) return NextResponse.json({ error: "Not found" }, { status: 404 });
  return NextResponse.json({
    ...marketSummary(market),
    description: market.description,
    outcomes: market.outcomes,
    resolutionRule: market.resolutionRule,
    resolutionSources: market.resolutionSources,
    disputePeriodMs: market.disputePeriodMs,
    oracleId: market.oracleId,
    collateralToken: market.collateralToken,
    winningOutcomeId: market.winningOutcomeId ?? null,
  });
}
