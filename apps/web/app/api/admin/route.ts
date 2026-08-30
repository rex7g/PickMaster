import { NextResponse } from "next/server";
import { ADMIN_ACTOR, evidenceHash, type OracleReport } from "@pickmaster/core";
import { getExchange } from "@/lib/store";

/**
 * Phase 1 admin endpoint (no auth — the prototype is single-tenant demo).
 * Every action routes through the Exchange, which records AuditEvents and
 * enforces the resolution state machine; there is no direct YES→NO switch.
 */
export async function POST(request: Request) {
  const exchange = getExchange();
  try {
    const { action, marketId, outcome } = await request.json();
    const now = Date.now();

    const reports = (codes: string[]): OracleReport[] => {
      const market = exchange.markets.get(marketId);
      if (!market) throw new Error("Mercado desconocido.");
      const sources = market.resolutionSources;
      return codes.map((code, i) => ({
        sourceId: sources[i % sources.length]!.id,
        marketId,
        outcomeCode: code,
        reportedAt: now,
        evidenceHash: evidenceHash(`${marketId}:${code}:${i}`),
      }));
    };

    const outcomeIdFor = (code: string) => {
      const market = exchange.markets.get(marketId);
      const o = market?.outcomes.find((x) => x.code === code);
      if (!o) throw new Error("Outcome desconocido.");
      return o.id;
    };

    switch (action) {
      case "close":
        exchange.closeMarket(marketId, ADMIN_ACTOR);
        break;
      case "oracle-agree":
        exchange.submitOracleReports(marketId, reports([outcome, outcome]));
        break;
      case "oracle-conflict":
        exchange.submitOracleReports(marketId, reports(["YES", "NO"]));
        break;
      case "dispute":
        exchange.dispute(marketId, ADMIN_ACTOR, "Disputa manual desde el panel admin.");
        break;
      case "finalize": {
        // Demo-only fast-forward of the dispute window so the flow can be
        // exercised interactively; real deployments wait out the window.
        const state = exchange.resolutionState(marketId);
        if (state.proposal) state.proposal.disputeWindowEndsAt = now - 1;
        exchange.finalize(marketId, ADMIN_ACTOR);
        break;
      }
      case "arbitrate":
        exchange.arbitrateMarket(marketId, outcomeIdFor(outcome), "comite@pickmaster.do");
        break;
      case "void":
        exchange.voidMarketById(marketId, ADMIN_ACTOR, "Anulado desde el panel admin.");
        break;
      case "settle":
        exchange.settle(marketId, ADMIN_ACTOR);
        break;
      case "pause":
        exchange.emergencyPause(ADMIN_ACTOR, "Pausa activada desde el panel admin.");
        break;
      case "unpause":
        exchange.emergencyUnpause(ADMIN_ACTOR);
        break;
      case "risk-scan":
        exchange.runRiskScan();
        break;
      default:
        return NextResponse.json({ error: "Acción desconocida." }, { status: 400 });
    }
    return NextResponse.json({ ok: true });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Error interno." },
      { status: 422 },
    );
  }
}
