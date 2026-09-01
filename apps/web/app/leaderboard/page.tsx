import { getExchange, formatUsd } from "@/lib/store";
import { getProfile } from "@/lib/auth";

export const dynamic = "force-dynamic";

export default function LeaderboardPage() {
  const exchange = getExchange();
  const volumeByUser = new Map<string, number>();
  for (const t of exchange.allTrades()) {
    const notional = t.priceCents * t.quantity;
    volumeByUser.set(t.buyerId, (volumeByUser.get(t.buyerId) ?? 0) + notional);
    volumeByUser.set(t.sellerId, (volumeByUser.get(t.sellerId) ?? 0) + notional);
  }

  const rows = [...exchange.users.values()]
    .map((u) => {
      const p = exchange.portfolio(u.id);
      const profile = getProfile(u.id);
      return {
        id: u.id,
        name:
          profile?.username ??
          (u.id === "user_maker" ? "market-maker" : u.id === "user_demo" ? "demo" : u.id.slice(0, 12)),
        hue: profile?.avatarHue ?? 200,
        pnl: p.realizedPnlCents + p.unrealizedPnlCents,
        volume: volumeByUser.get(u.id) ?? 0,
      };
    })
    .filter((r) => r.volume > 0 || r.pnl !== 0)
    .sort((a, b) => b.pnl - a.pnl);

  return (
    <div className="max-w-3xl mx-auto">
      <h1 className="text-2xl font-bold text-white mb-1">🏆 Leaderboard</h1>
      <p className="text-sm text-slate-500 mb-6">P&L total (realizado + no realizado) del prototipo.</p>
      <div className="rounded-xl border border-slate-800 overflow-hidden">
        <table className="w-full text-sm">
          <thead className="bg-slate-900 text-slate-400 text-left text-xs">
            <tr>
              <th className="px-4 py-2 w-10">#</th>
              <th className="px-4 py-2">Trader</th>
              <th className="px-4 py-2 text-right">Volumen</th>
              <th className="px-4 py-2 text-right">P&L</th>
            </tr>
          </thead>
          <tbody>
            {rows.length === 0 && (
              <tr><td colSpan={4} className="px-4 py-4 text-slate-600">Aún no hay actividad.</td></tr>
            )}
            {rows.map((r, i) => (
              <tr key={r.id} className="border-t border-slate-800/60">
                <td className="px-4 py-2.5 text-slate-500">{i + 1}</td>
                <td className="px-4 py-2.5">
                  <span className="flex items-center gap-2 text-slate-200">
                    <span
                      className="inline-block h-6 w-6 rounded-full"
                      style={{
                        background: `linear-gradient(135deg, hsl(${r.hue},80%,55%), hsl(${(r.hue + 80) % 360},85%,60%))`,
                      }}
                    />
                    {r.name}
                  </span>
                </td>
                <td className="px-4 py-2.5 text-right text-slate-300">{formatUsd(r.volume)}</td>
                <td className={`px-4 py-2.5 text-right font-semibold ${r.pnl >= 0 ? "text-emerald-400" : "text-rose-400"}`}>
                  {r.pnl >= 0 ? "+" : ""}{formatUsd(r.pnl)}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
