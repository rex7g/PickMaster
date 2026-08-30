import { NextResponse } from "next/server";
import { getExchange } from "@/lib/store";

/** Public API (§57): GET /markets/{id}/resolution */
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
  const state = exchange.resolutionState(market.id);
  return NextResponse.json({
    status: market.status,
    disputeState: market.disputeState,
    winningOutcomeId: market.winningOutcomeId ?? null,
    proposal: state.proposal ?? null,
    dispute: state.dispute ?? null,
  });
}
