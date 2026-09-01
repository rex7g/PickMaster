import { NextResponse } from "next/server";
import { getExchange } from "@/lib/store";
import { getHistory, type Range } from "@/lib/history";

/** Public API (§57): GET /markets/{id}/history?range=1H|6H|1D|1W|1M|ALL */
export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const exchange = getExchange();
  const market =
    exchange.markets.get(id) ??
    [...exchange.markets.values()].find((m) => m.slug === id);
  if (!market) return NextResponse.json({ error: "Not found" }, { status: 404 });

  const url = new URL(request.url);
  const rangeParam = (url.searchParams.get("range") ?? "1W").toUpperCase();
  const range: Range = (["1H", "6H", "1D", "1W", "1M", "ALL"] as const).includes(
    rangeParam as Range,
  )
    ? (rangeParam as Range)
    : "1W";

  return NextResponse.json({
    marketId: market.id,
    range,
    volumeCents: market.volume,
    points: getHistory(exchange, market.id, range),
  });
}
