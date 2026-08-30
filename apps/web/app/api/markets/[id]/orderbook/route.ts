import { NextResponse } from "next/server";
import { getExchange } from "@/lib/store";

/** Public API (§57): GET /markets/{id}/orderbook (YES-equivalent depth). */
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
  const yes = market.outcomes.find((o) => o.code === "YES") ?? market.outcomes[0]!;
  return NextResponse.json(exchange.orderBook(market.id, yes.id));
}
