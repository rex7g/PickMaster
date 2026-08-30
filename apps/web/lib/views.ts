/** Serializable view models passed from server to client components. */
import type { Market } from "@pickmaster/core";
import { getExchange } from "./store";

export interface MarketSummary {
  id: string;
  slug: string;
  title: string;
  category: string;
  status: string;
  resolutionClass: string;
  closeTime: number;
  yesPriceCents: number | null;
  noPriceCents: number | null;
  probability: number | null;
  volumeCents: number;
  liquidityCents: number;
  spreadCents: number | null;
}

export function marketSummary(market: Market): MarketSummary {
  const exchange = getExchange();
  const yes = market.outcomes.find((o) => o.code === "YES") ?? market.outcomes[0]!;
  const no = market.outcomes.find((o) => o.code === "NO") ?? market.outcomes[1]!;
  const yesSnap = exchange.price(market.id, yes.id);
  const noSnap = exchange.price(market.id, no.id);
  const yesMid = yesSnap.midPriceCents ?? yesSnap.lastPriceCents;
  const noMid = noSnap.midPriceCents ?? noSnap.lastPriceCents;
  return {
    id: market.id,
    slug: market.slug,
    title: market.title,
    category: market.category,
    status: market.status,
    resolutionClass: market.resolutionClass,
    closeTime: market.closeTime,
    yesPriceCents: yesMid,
    noPriceCents: noMid,
    probability: yesMid !== null ? yesMid / 100 : null,
    volumeCents: market.volume,
    liquidityCents: market.liquidity,
    spreadCents: yesSnap.spreadCents,
  };
}

export function allMarketSummaries(): MarketSummary[] {
  const exchange = getExchange();
  return [...exchange.markets.values()].map(marketSummary);
}
