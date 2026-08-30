/**
 * Oracle Aggregator (§11): multiple sources report; agreement between
 * reliable sources enables automatic resolution (AC-007); conflicting
 * sources force DISPUTED and never auto-settle (AC-008).
 */
import type { Market, OracleReport } from "./types";

export type AggregationOutcome =
  | { kind: "AGREEMENT"; outcomeCode: string; reports: OracleReport[] }
  | { kind: "CONFLICT"; reports: OracleReport[] }
  | { kind: "INSUFFICIENT"; reports: OracleReport[] };

/** Minimum combined reliability before automatic resolution is possible. */
export const AUTO_RESOLUTION_MIN_SOURCES = 2;
export const AUTO_RESOLUTION_MIN_RELIABILITY = 0.8;

export function aggregateReports(
  market: Market,
  reports: OracleReport[],
): AggregationOutcome {
  const relevant = reports.filter((r) => r.marketId === market.id);
  if (relevant.length === 0) return { kind: "INSUFFICIENT", reports: relevant };

  const bySource = new Map(market.resolutionSources.map((s) => [s.id, s]));
  const reliable = relevant.filter(
    (r) => (bySource.get(r.sourceId)?.reliabilityScore ?? 0) >= AUTO_RESOLUTION_MIN_RELIABILITY,
  );

  const distinctOutcomes = new Set(relevant.map((r) => r.outcomeCode));
  if (distinctOutcomes.size > 1) {
    // AC-008: two trusted sources disagree → the market must be DISPUTED.
    return { kind: "CONFLICT", reports: relevant };
  }
  if (reliable.length >= AUTO_RESOLUTION_MIN_SOURCES) {
    // AC-007: two reliable sources agree → eligible for automatic resolution.
    const first = reliable[0]!;
    return { kind: "AGREEMENT", outcomeCode: first.outcomeCode, reports: reliable };
  }
  return { kind: "INSUFFICIENT", reports: relevant };
}

/** Deterministic mock evidence hash for the Phase 1 simulator (§63 Phase 1). */
export function evidenceHash(payload: string): string {
  let h = 2166136261;
  for (let i = 0; i < payload.length; i++) {
    h ^= payload.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return `0x${(h >>> 0).toString(16).padStart(8, "0")}`;
}
