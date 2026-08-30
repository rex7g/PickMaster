/**
 * Fee Engine (§18): fees separated by concept and never hidden — the UI
 * always shows "estimated network fee + PickMaster fee = total cost" before
 * signing (AC-005).
 */
import type { FeeBreakdown } from "./types";

export interface FeeModel {
  id: string;
  /** Basis points over notional. */
  tradingFeeBps: number;
  protocolFeeBps: number;
  settlementFeeBps: number;
  /** Flat simulated L2 network fee per operation, cents (Phase 1 estimate). */
  estimatedNetworkFeeCents: number;
}

export const DEFAULT_FEE_MODEL: FeeModel = {
  id: "default-v1",
  tradingFeeBps: 20, // 0.20%
  protocolFeeBps: 10, // 0.10%
  settlementFeeBps: 0,
  estimatedNetworkFeeCents: 1, // ~1¢ on an L2 with batching (§18)
};

export function computeFees(notionalCents: number, model: FeeModel): FeeBreakdown {
  const bps = (b: number) => Math.ceil((notionalCents * b) / 10_000);
  const tradingFeeCents = bps(model.tradingFeeBps);
  const protocolFeeCents = bps(model.protocolFeeBps);
  const settlementFeeCents = bps(model.settlementFeeBps);
  return {
    tradingFeeCents,
    protocolFeeCents,
    settlementFeeCents,
    estimatedNetworkFeeCents: model.estimatedNetworkFeeCents,
    totalFeeCents:
      tradingFeeCents +
      protocolFeeCents +
      settlementFeeCents +
      model.estimatedNetworkFeeCents,
  };
}

/** Quote shown to the user BEFORE placing an order (AC-005). */
export interface CostQuote {
  notionalCents: number;
  fees: FeeBreakdown;
  totalCostCents: number;
}

export function quoteCost(
  priceCents: number,
  quantity: number,
  model: FeeModel = DEFAULT_FEE_MODEL,
): CostQuote {
  const notionalCents = priceCents * quantity;
  const fees = computeFees(notionalCents, model);
  return { notionalCents, fees, totalCostCents: notionalCents + fees.totalFeeCents };
}
