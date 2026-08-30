import Link from "next/link";
import { allMarketSummaries } from "@/lib/views";
import { formatCents, formatPct, formatUsd } from "@/lib/store";

export const dynamic = "force-dynamic";

const CATEGORY_LABELS: Record<string, string> = {
  POLITICS: "Política",
  ECONOMY: "Economía",
  SPORTS: "Deportes",
  WEATHER: "Clima",
  FINANCE: "Finanzas",
  LEGISLATION: "Legislación",
  OTHER: "Otros",
};

const CLASS_COLORS: Record<string, string> = {
  ULTRA_FAST: "bg-rose-500/15 text-rose-300 border-rose-500/40",
  FAST: "bg-amber-500/15 text-amber-300 border-amber-500/40",
  STANDARD: "bg-sky-500/15 text-sky-300 border-sky-500/40",
  LONG_TERM: "bg-violet-500/15 text-violet-300 border-violet-500/40",
};

export default function HomePage() {
  const markets = allMarketSummaries().filter((m) =>
    ["OPEN", "PAUSED", "CLOSED", "DISPUTE_WINDOW", "DISPUTED", "RESOLVED", "SETTLED", "VOID"].includes(m.status),
  );
  const totalVolume = markets.reduce((s, m) => s + m.volumeCents, 0);
  const totalLiquidity = markets.reduce((s, m) => s + m.liquidityCents, 0);

  return (
    <div>
      <section className="mb-8">
        <h1 className="text-3xl font-bold text-white">
          Predice los eventos que definen a República Dominicana
        </h1>
        <p className="mt-2 text-slate-400 max-w-2xl">
          Compra y vende posiciones sobre eventos verificables. El precio de cada
          posición representa la probabilidad implícita del mercado.
        </p>
        <div className="mt-4 flex gap-6 text-sm">
          <div>
            <span className="text-slate-500">Mercados activos </span>
            <span className="font-semibold text-white">{markets.filter((m) => m.status === "OPEN").length}</span>
          </div>
          <div>
            <span className="text-slate-500">Volumen total </span>
            <span className="font-semibold text-white">{formatUsd(totalVolume)}</span>
          </div>
          <div>
            <span className="text-slate-500">Liquidez (colateral bloqueado) </span>
            <span className="font-semibold text-white">{formatUsd(totalLiquidity)}</span>
          </div>
        </div>
      </section>

      <div className="grid gap-4 sm:grid-cols-2">
        {markets.map((m) => (
          <Link
            key={m.id}
            href={`/markets/${m.slug}`}
            className="block rounded-xl border border-slate-800 bg-slate-900/60 p-5 hover:border-emerald-500/50 transition-colors"
          >
            <div className="flex items-center gap-2 text-xs mb-3">
              <span className="rounded-full border border-slate-700 px-2 py-0.5 text-slate-300">
                {CATEGORY_LABELS[m.category] ?? m.category}
              </span>
              <span className={`rounded-full border px-2 py-0.5 ${CLASS_COLORS[m.resolutionClass] ?? ""}`}>
                {m.resolutionClass}
              </span>
              {m.status !== "OPEN" && (
                <span className="rounded-full border border-slate-600 px-2 py-0.5 text-slate-400">
                  {m.status}
                </span>
              )}
            </div>
            <h2 className="font-semibold text-white leading-snug">{m.title}</h2>
            <div className="mt-4 flex items-center gap-3">
              <div className="flex-1 h-2 rounded-full bg-slate-800 overflow-hidden">
                <div
                  className="h-full bg-emerald-500"
                  style={{ width: `${Math.round((m.probability ?? 0.5) * 100)}%` }}
                />
              </div>
              <span className="text-emerald-400 font-bold">{formatPct(m.probability)}</span>
            </div>
            <div className="mt-3 flex justify-between text-sm">
              <div className="flex gap-3">
                <span className="text-emerald-400 font-semibold">SÍ {formatCents(m.yesPriceCents)}</span>
                <span className="text-rose-400 font-semibold">NO {formatCents(m.noPriceCents)}</span>
              </div>
              <span className="text-slate-500">Vol. {formatUsd(m.volumeCents)}</span>
            </div>
          </Link>
        ))}
      </div>
    </div>
  );
}
