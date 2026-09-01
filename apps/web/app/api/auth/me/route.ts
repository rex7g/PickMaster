import { NextResponse } from "next/server";
import { getSessionProfile, publicProfile } from "@/lib/auth";
import { getExchange } from "@/lib/store";

export async function GET() {
  const profile = await getSessionProfile();
  if (!profile) return NextResponse.json({ profile: null });
  const exchange = getExchange();
  const portfolio = exchange.portfolio(profile.id);
  return NextResponse.json({
    profile: publicProfile(profile),
    portfolio: {
      totalCents: portfolio.totalCents,
      cashCents: portfolio.availableBalanceCents,
      unrealizedPnlCents: portfolio.unrealizedPnlCents,
      realizedPnlCents: portfolio.realizedPnlCents,
    },
  });
}
