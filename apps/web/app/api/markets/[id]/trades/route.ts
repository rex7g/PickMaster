import { NextResponse } from "next/server";
import { getExchange } from "@/lib/store";

/** Public API (§57): GET /markets/{id}/trades */
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
  const trades = exchange.marketTrades(market.id).map((t) => ({
    id: t.id,
    outcomeId: t.outcomeId,
    priceCents: t.priceCents,
    quantity: t.quantity,
    kind: t.kind,
    executedAt: t.executedAt,
  }));
  return NextResponse.json({ trades });
}
