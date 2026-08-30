import { getExchange, formatUsd } from "@/lib/store";
import { DEMO_USER_ID } from "@pickmaster/core";

export const dynamic = "force-dynamic";

export default function PortfolioPage() {
  const exchange = getExchange();
  const view = exchange.portfolio(DEMO_USER_ID);
  const positions = exchange
    .userPositions(DEMO_USER_ID)
    .filter((p) => p.quantity > 0 || p.settled);

  const pnlColor = (v: number) =>
    v > 0 ? "text-emerald-400" : v < 0 ? "text-rose-400" : "text-slate-300";

  const stats: [string, string, string][] = [
    ["Total portfolio", formatUsd(view.totalCents), "text-white"],
    ["Balance disponible", formatUsd(view.availableBalanceCents), "text-white"],
    ["Invertido", formatUsd(view.investedCents), "text-white"],
    ["P&L no realizado", formatUsd(view.unrealizedPnlCents), pnlColor(view.unrealizedPnlCents)],
    ["P&L realizado", formatUsd(view.realizedPnlCents), pnlColor(view.realizedPnlCents)],
    ["Exposición", formatUsd(view.exposureCents), "text-white"],
    ["Posiciones ganadoras", String(view.winningPositions), "text-emerald-400"],
    ["Posiciones perdedoras", String(view.losingPositions), "text-rose-400"],
  ];

  return (
    <div>
      <h1 className="text-2xl font-bold text-white mb-6">Portfolio (usuario demo)</h1>
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-8">
        {stats.map(([label, value, color]) => (
          <div key={label} className="rounded-xl border border-slate-800 bg-slate-900/60 p-4">
            <div className="text-xs text-slate-500">{label}</div>
            <div className={`text-lg font-bold ${color}`}>{value}</div>
          </div>
        ))}
      </div>

      <h2 className="font-semibold text-white mb-3">Posiciones</h2>
      <div className="rounded-xl border border-slate-800 overflow-hidden">
        <table className="w-full text-sm">
          <thead className="bg-slate-900 text-slate-400 text-left text-xs">
            <tr>
              <th className="px-4 py-2">Mercado</th>
              <th className="px-4 py-2">Outcome</th>
              <th className="px-4 py-2 text-right">Shares</th>
              <th className="px-4 py-2 text-right">Coste</th>
              <th className="px-4 py-2 text-right">Estado</th>
            </tr>
          </thead>
          <tbody>
            {positions.length === 0 && (
              <tr><td colSpan={5} className="px-4 py-4 text-slate-600">Sin posiciones.</td></tr>
            )}
            {positions.map((p) => {
              const market = exchange.markets.get(p.marketId);
              const outcome = market?.outcomes.find((o) => o.id === p.outcomeId);
              return (
                <tr key={`${p.marketId}${p.outcomeId}`} className="border-t border-slate-800/60">
                  <td className="px-4 py-2 text-slate-200">{market?.title ?? p.marketId}</td>
                  <td className={`px-4 py-2 font-semibold ${outcome?.code === "YES" ? "text-emerald-400" : "text-rose-400"}`}>
                    {outcome?.code === "YES" ? "SÍ" : "NO"}
                  </td>
                  <td className="px-4 py-2 text-right">{p.quantity}</td>
                  <td className="px-4 py-2 text-right">{formatUsd(p.costCents)}</td>
                  <td className="px-4 py-2 text-right text-xs text-slate-400">
                    {p.settled ? `Liquidada · payout ${formatUsd(p.payoutCents ?? 0)}` : market?.status}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}
