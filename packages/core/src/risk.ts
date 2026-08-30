/**
 * Risk Engine (§29) + Fraud Engine (§30).
 * Phase 1 implements the detectors needed by the acceptance criteria:
 * correlated-account detection (AC-010), wash-trade and concentration
 * heuristics, plus composite scores. ML-based scoring lands in Phase 3.
 */
import type { RiskEvent, Trade } from "./types";

let riskSeq = 0;
const nextRiskId = () => `risk_${++riskSeq}`;

/**
 * AC-010: two accounts whose trades are highly correlated (repeatedly on
 * opposite sides of each other) must generate a Risk Event.
 */
export function detectCorrelatedAccounts(
  trades: Trade[],
  now: number,
  minSharedTrades = 3,
  minShareOfActivity = 0.6,
): RiskEvent[] {
  const pairCounts = new Map<string, number>();
  const activity = new Map<string, number>();
  for (const t of trades) {
    if (t.buyerId === t.sellerId) continue;
    const key = [t.buyerId, t.sellerId].sort().join("|");
    pairCounts.set(key, (pairCounts.get(key) ?? 0) + 1);
    activity.set(t.buyerId, (activity.get(t.buyerId) ?? 0) + 1);
    activity.set(t.sellerId, (activity.get(t.sellerId) ?? 0) + 1);
  }
  const events: RiskEvent[] = [];
  for (const [key, count] of pairCounts) {
    const [a, b] = key.split("|") as [string, string];
    const share = count / Math.min(activity.get(a) ?? 1, activity.get(b) ?? 1);
    if (count >= minSharedTrades && share >= minShareOfActivity) {
      events.push({
        id: nextRiskId(),
        kind: "CORRELATED_ACCOUNTS",
        severity: share > 0.85 ? "HIGH" : "MEDIUM",
        subjectIds: [a, b],
        detail: `${count} trades entre ambas cuentas (${Math.round(share * 100)}% de su actividad).`,
        createdAt: now,
      });
    }
  }
  return events;
}

/** Wash trading: same account (or pair) rapidly buying and selling to itself. */
export function detectWashTrading(
  trades: Trade[],
  now: number,
  windowMs = 10 * 60_000,
): RiskEvent[] {
  const events: RiskEvent[] = [];
  const byPair = new Map<string, Trade[]>();
  for (const t of trades) {
    const key = [t.buyerId, t.sellerId].sort().join("|") + "|" + t.marketId;
    const list = byPair.get(key) ?? [];
    list.push(t);
    byPair.set(key, list);
  }
  for (const [key, list] of byPair) {
    const sorted = [...list].sort((x, y) => x.executedAt - y.executedAt);
    for (let i = 1; i < sorted.length; i++) {
      const prev = sorted[i - 1]!;
      const cur = sorted[i]!;
      const reversed = prev.buyerId === cur.sellerId && prev.sellerId === cur.buyerId;
      if (reversed && cur.executedAt - prev.executedAt <= windowMs) {
        const [a, b] = key.split("|") as [string, string, string];
        events.push({
          id: nextRiskId(),
          kind: "WASH_TRADING",
          severity: "HIGH",
          subjectIds: [a, b],
          marketId: cur.marketId,
          detail: "Compra y venta invertida entre las mismas cuentas en <10 min.",
          createdAt: now,
        });
        break;
      }
    }
  }
  return events;
}

/** Concentration: one account holding most of a market's open interest. */
export function detectConcentration(
  holdingsByUser: Map<string, number>,
  marketId: string,
  now: number,
  threshold = 0.5,
): RiskEvent[] {
  const total = [...holdingsByUser.values()].reduce((a, b) => a + b, 0);
  if (total <= 0) return [];
  const events: RiskEvent[] = [];
  for (const [userId, qty] of holdingsByUser) {
    const share = qty / total;
    if (share >= threshold) {
      events.push({
        id: nextRiskId(),
        kind: "CONCENTRATION",
        severity: share > 0.8 ? "CRITICAL" : "HIGH",
        subjectIds: [userId],
        marketId,
        detail: `Una cuenta concentra ${Math.round(share * 100)}% del open interest.`,
        createdAt: now,
      });
    }
  }
  return events;
}

/** Composite user fraud score from risk events (0..1). */
export function fraudScore(userId: string, events: RiskEvent[]): number {
  const weights = { LOW: 0.1, MEDIUM: 0.25, HIGH: 0.5, CRITICAL: 1 } as const;
  const score = events
    .filter((e) => e.subjectIds.includes(userId))
    .reduce((sum, e) => sum + weights[e.severity], 0);
  return Math.min(1, score);
}
