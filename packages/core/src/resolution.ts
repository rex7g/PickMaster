/**
 * Resolution Engine (§12) + Dispute/Arbitration (§13), decoupled from
 * trading per the golden rule (§65). Supports:
 *  - AUTOMATIC: reliable sources agree (via oracle aggregator).
 *  - OPTIMISTIC: an actor proposes; a challenge window follows.
 *  - MANUAL_ARBITRATION: an authorized committee decides a disputed market.
 *  - EMERGENCY: multisig + timelock path (admin-only, always audited).
 * A market NEVER settles automatically while sources conflict (AC-008), and
 * an admin can never flip YES → NO after close outside arbitration (§46) —
 * only VOID or an arbitrated decision with recorded evidence.
 */
import type { Dispute, Market, OracleReport, ResolutionProposal } from "./types";
import { aggregateReports } from "./oracle";

export class ResolutionError extends Error {}

export interface ResolutionState {
  proposal?: ResolutionProposal;
  dispute?: Dispute;
}

/** Feed oracle reports for a CLOSED market; may produce a proposal or a dispute. */
export function processOracleReports(
  market: Market,
  state: ResolutionState,
  reports: OracleReport[],
  now: number,
): ResolutionState {
  if (market.status !== "CLOSED" && market.status !== "RESOLUTION_PENDING") {
    throw new ResolutionError(
      `El mercado debe estar cerrado para procesar reportes (estado: ${market.status}).`,
    );
  }
  market.status = "RESOLUTION_PENDING";
  const aggregation = aggregateReports(market, reports);

  if (aggregation.kind === "CONFLICT") {
    market.status = "DISPUTED";
    market.disputeState = "DISPUTED";
    market.updatedAt = now;
    return {
      ...state,
      dispute: {
        marketId: market.id,
        disputedBy: "oracle-aggregator",
        reason: "Fuentes confiables reportan resultados diferentes.",
        disputedAt: now,
      },
    };
  }

  if (aggregation.kind === "AGREEMENT") {
    const outcome = market.outcomes.find((o) => o.code === aggregation.outcomeCode);
    if (!outcome) {
      throw new ResolutionError(
        `Las fuentes reportan un outcome desconocido: ${aggregation.outcomeCode}`,
      );
    }
    market.status = "DISPUTE_WINDOW";
    market.disputeState = "CHALLENGE_PERIOD";
    market.updatedAt = now;
    return {
      ...state,
      proposal: {
        marketId: market.id,
        outcomeId: outcome.id,
        method: "AUTOMATIC",
        proposedBy: "oracle-aggregator",
        proposedAt: now,
        evidence: aggregation.reports,
        disputeWindowEndsAt: now + market.disputePeriodMs,
      },
    };
  }

  return state; // INSUFFICIENT: keep waiting for more reports.
}

/** Optimistic proposal by an authorized proposer (§12). */
export function proposeResolution(
  market: Market,
  state: ResolutionState,
  outcomeId: string,
  proposedBy: string,
  evidence: OracleReport[],
  now: number,
): ResolutionState {
  if (market.status !== "CLOSED" && market.status !== "RESOLUTION_PENDING") {
    throw new ResolutionError("Sólo un mercado cerrado admite propuestas de resolución.");
  }
  if (!market.outcomes.some((o) => o.id === outcomeId)) {
    throw new ResolutionError("Outcome desconocido.");
  }
  market.status = "DISPUTE_WINDOW";
  market.disputeState = "PROPOSED";
  market.updatedAt = now;
  return {
    ...state,
    proposal: {
      marketId: market.id,
      outcomeId,
      method: "OPTIMISTIC",
      proposedBy,
      proposedAt: now,
      evidence,
      disputeWindowEndsAt: now + market.disputePeriodMs,
    },
  };
}

/** Challenge an open proposal during its dispute window (§13). */
export function disputeResolution(
  market: Market,
  state: ResolutionState,
  disputedBy: string,
  reason: string,
  now: number,
  evidenceHash?: string,
): ResolutionState {
  if (market.status !== "DISPUTE_WINDOW" || !state.proposal) {
    throw new ResolutionError("No hay propuesta en ventana de disputa.");
  }
  if (now > state.proposal.disputeWindowEndsAt) {
    throw new ResolutionError("La ventana de disputa ya cerró.");
  }
  market.status = "DISPUTED";
  market.disputeState = "DISPUTED";
  market.updatedAt = now;
  return {
    ...state,
    dispute: { marketId: market.id, disputedBy, reason, disputedAt: now, evidenceHash },
  };
}

/** Finalize after an undisputed window elapses. */
export function finalizeResolution(
  market: Market,
  state: ResolutionState,
  now: number,
): void {
  if (market.status !== "DISPUTE_WINDOW" || !state.proposal) {
    throw new ResolutionError("Nada que finalizar: no hay propuesta activa.");
  }
  if (now < state.proposal.disputeWindowEndsAt) {
    throw new ResolutionError("La ventana de disputa sigue abierta.");
  }
  market.winningOutcomeId = state.proposal.outcomeId;
  market.status = "RESOLVED";
  market.disputeState = "RESOLVED";
  market.updatedAt = now;
}

/** Arbitration committee decision for a DISPUTED market (§12–13). */
export function arbitrate(
  market: Market,
  state: ResolutionState,
  outcomeId: string | null,
  decidedBy: string,
  now: number,
): void {
  if (market.status !== "DISPUTED") {
    throw new ResolutionError("Sólo un mercado en disputa admite arbitraje.");
  }
  if (outcomeId !== null && !market.outcomes.some((o) => o.id === outcomeId)) {
    throw new ResolutionError("Outcome desconocido.");
  }
  if (state.dispute) {
    state.dispute.decision = { outcomeId, decidedBy, decidedAt: now };
  }
  if (outcomeId === null) {
    voidMarket(market, now);
    return;
  }
  market.winningOutcomeId = outcomeId;
  market.status = "RESOLVED";
  market.disputeState = "RESOLVED";
  market.updatedAt = now;
}

/**
 * VOID (§46): event cancelled, source unavailable, ambiguous result,
 * manipulation detected. Every position refunds at cost — an admin can
 * never simply flip the winning outcome after close.
 */
export function voidMarket(market: Market, now: number): void {
  if (market.status === "SETTLED" || market.status === "RESOLVED") {
    throw new ResolutionError("Un mercado resuelto o liquidado no puede anularse.");
  }
  market.winningOutcomeId = null;
  market.status = "VOID";
  market.disputeState = "RESOLVED";
  market.updatedAt = now;
}
