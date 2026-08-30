import { getExchange, formatUsd } from "@/lib/store";
import { AdminMarketActions, PlatformControls } from "@/components/AdminActions";

export const dynamic = "force-dynamic";

export default function AdminPage() {
  const exchange = getExchange();
  const markets = [...exchange.markets.values()];
  const audit = [...exchange.audit.all()].slice(-20).reverse();
  const riskEvents = [...exchange.allRiskEvents()].slice(-10).reverse();

  return (
    <div>
      <div className="flex items-center justify-between mb-6">
        <h1 className="text-2xl font-bold text-white">Panel de administración</h1>
        <PlatformControls paused={exchange.isPaused()} />
      </div>
      <p className="text-sm text-slate-500 mb-6">
        Toda acción administrativa genera un AuditEvent inmutable (cadena de hashes
        verificada: {exchange.audit.verifyChain() ? "✓ íntegra" : "✗ ROTA"}). El flujo de
        resolución respeta la separación oráculo → disputa → arbitraje → settlement; un
        administrador nunca cambia YES → NO directamente tras el cierre.
      </p>

      <div className="rounded-xl border border-slate-800 overflow-x-auto mb-10">
        <table className="w-full text-sm min-w-[640px]">
          <thead className="bg-slate-900 text-slate-400 text-left text-xs">
            <tr>
              <th className="px-4 py-2">Mercado</th>
              <th className="px-4 py-2">Estado</th>
              <th className="px-4 py-2 text-right">Volumen</th>
              <th className="px-4 py-2">Acciones</th>
            </tr>
          </thead>
          <tbody>
            {markets.map((m) => (
              <tr key={m.id} className="border-t border-slate-800/60 align-top">
                <td className="px-4 py-2 text-slate-200 max-w-[280px]">{m.title}</td>
                <td className="px-4 py-2">
                  <span className="text-xs rounded-full border border-slate-700 px-2 py-0.5 text-slate-300">
                    {m.status}
                  </span>
                  {m.winningOutcomeId !== undefined && m.status !== "OPEN" && (
                    <div className="text-xs text-slate-500 mt-1">
                      Resultado: {m.winningOutcomeId === null
                        ? "VOID"
                        : m.outcomes.find((o) => o.id === m.winningOutcomeId)?.code}
                    </div>
                  )}
                </td>
                <td className="px-4 py-2 text-right text-slate-300">{formatUsd(m.volume)}</td>
                <td className="px-4 py-2">
                  <AdminMarketActions marketId={m.id} status={m.status} />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="grid gap-8 lg:grid-cols-2">
        <section>
          <h2 className="font-semibold text-white mb-3">Eventos de riesgo</h2>
          <div className="rounded-xl border border-slate-800 overflow-hidden text-sm">
            {riskEvents.length === 0 && (
              <div className="px-4 py-3 text-slate-600">
                Sin eventos. Ejecuta un escaneo desde los controles de plataforma.
              </div>
            )}
            {riskEvents.map((e) => (
              <div key={e.id} className="px-4 py-2 border-t border-slate-800/60 first:border-t-0">
                <span className={`text-xs font-semibold ${
                  e.severity === "CRITICAL" || e.severity === "HIGH" ? "text-rose-400" : "text-amber-400"
                }`}>
                  [{e.severity}] {e.kind}
                </span>
                <div className="text-slate-400 text-xs mt-0.5">
                  {e.detail} · {e.subjectIds.join(", ")}
                </div>
              </div>
            ))}
          </div>
        </section>

        <section>
          <h2 className="font-semibold text-white mb-3">Auditoría (últimos 20)</h2>
          <div className="rounded-xl border border-slate-800 overflow-hidden text-xs">
            {audit.map((e) => (
              <div key={e.seq} className="px-4 py-1.5 border-t border-slate-800/60 first:border-t-0 flex justify-between gap-2">
                <span className="text-slate-300">
                  #{e.seq} <span className="text-emerald-400">{e.action}</span> {e.entityId}
                  {e.detail ? ` — ${e.detail.slice(0, 60)}` : ""}
                </span>
                <span className="text-slate-600 font-mono shrink-0">{e.hash}</span>
              </div>
            ))}
          </div>
        </section>
      </div>
    </div>
  );
}
