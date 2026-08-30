/**
 * InternalArbitrageEngine (§15): detects mathematical inconsistencies inside
 * PickMaster — for a binary market, YES + NO must price to ≈ 100¢ (AC-009).
 *
 * External arbitrage (§14) is detection-only by design: the engine reports
 * opportunities but NEVER auto-executes against external venues without
 * legality, liquidity, gas, slippage, bridge-cost and counterparty checks.
 */
export interface ArbitrageOpportunity {
  marketId: string;
  kind:
    | "MISPRICING"
    | "NEGATIVE_RISK"
    | "STALE_PRICE"
    | "LIQUIDITY_IMBALANCE"
    | "EXTERNAL_SPREAD";
  /** Deviation in cents (or spread for EXTERNAL_SPREAD). */
  magnitudeCents: number;
  detail: string;
  detectedAt: number;
}

/** Tolerance: spreads make small deviations normal; flag beyond 2¢. */
export const MISPRICING_TOLERANCE_CENTS = 2;

export function detectBinaryMispricing(
  marketId: string,
  yesMidCents: number | null,
  noMidCents: number | null,
  now: number,
): ArbitrageOpportunity[] {
  if (yesMidCents === null || noMidCents === null) return [];
  const sum = yesMidCents + noMidCents;
  const deviation = Math.abs(sum - 100);
  if (deviation <= MISPRICING_TOLERANCE_CENTS) return [];
  const opportunities: ArbitrageOpportunity[] = [
    {
      marketId,
      kind: "MISPRICING",
      magnitudeCents: deviation,
      detail: `YES (${yesMidCents}¢) + NO (${noMidCents}¢) = ${sum}¢ ≠ 100¢`,
      detectedAt: now,
    },
  ];
  if (sum < 100 - MISPRICING_TOLERANCE_CENTS) {
    // Buying the full set below 100¢ guarantees a profit at settlement.
    opportunities.push({
      marketId,
      kind: "NEGATIVE_RISK",
      magnitudeCents: 100 - sum,
      detail: `Comprar YES + NO cuesta ${sum}¢ y paga 100¢ garantizados.`,
      detectedAt: now,
    });
  }
  return opportunities;
}

export function detectStalePrice(
  marketId: string,
  lastTradeAt: number | null,
  now: number,
  maxAgeMs: number,
): ArbitrageOpportunity[] {
  if (lastTradeAt === null || now - lastTradeAt <= maxAgeMs) return [];
  return [
    {
      marketId,
      kind: "STALE_PRICE",
      magnitudeCents: 0,
      detail: `Sin trades desde hace ${Math.round((now - lastTradeAt) / 60000)} min.`,
      detectedAt: now,
    },
  ];
}

export function detectExternalSpread(
  marketId: string,
  internalYesCents: number,
  externalYesCents: number,
  now: number,
): ArbitrageOpportunity[] {
  const spread = Math.abs(internalYesCents - externalYesCents);
  if (spread <= MISPRICING_TOLERANCE_CENTS) return [];
  return [
    {
      marketId,
      kind: "EXTERNAL_SPREAD",
      magnitudeCents: spread,
      detail: `PickMaster YES = ${internalYesCents}¢ vs mercado externo ${externalYesCents}¢ (detección solamente; sin ejecución automática).`,
      detectedAt: now,
    },
  ];
}
