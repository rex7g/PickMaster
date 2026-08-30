import { NextResponse } from "next/server";
import { allMarketSummaries } from "@/lib/views";

/** Public API (§57): GET /categories */
export async function GET() {
  const counts = new Map<string, number>();
  for (const m of allMarketSummaries()) {
    counts.set(m.category, (counts.get(m.category) ?? 0) + 1);
  }
  return NextResponse.json({
    categories: [...counts.entries()].map(([category, markets]) => ({ category, markets })),
  });
}
