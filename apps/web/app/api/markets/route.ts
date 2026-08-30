import { NextResponse } from "next/server";
import { allMarketSummaries } from "@/lib/views";

/** Public API (§57): GET /markets */
export async function GET() {
  return NextResponse.json({ markets: allMarketSummaries() });
}
