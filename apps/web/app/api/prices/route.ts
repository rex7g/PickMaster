import { NextResponse } from "next/server";
import { allMarketSummaries } from "@/lib/views";

/** Public API (§57): GET /prices */
export async function GET() {
  return NextResponse.json({
    prices: allMarketSummaries().map((m) => ({
      marketId: m.id,
      slug: m.slug,
      yesPriceCents: m.yesPriceCents,
      noPriceCents: m.noPriceCents,
      impliedProbability: m.probability,
    })),
  });
}
