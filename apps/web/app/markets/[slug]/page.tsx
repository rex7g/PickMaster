import { notFound } from "next/navigation";
import { getExchange, formatCents, formatPct, formatUsd } from "@/lib/store";
import { TradeForm } from "@/components/TradeForm";

export const dynamic = "force-dynamic";

export default async function MarketPage({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;
  const exchange = getExchange();
  const market = [...exchange.markets.values()].find((m) => m.slug === slug);
  if (!market) notFound();

  const yes = market.outcomes.find((o) => o.code === "YES") ?? market.outcomes[0]!;
  const no = market.outcomes.find((o) => o.code === "NO") ?? market.outcomes[1]!;
  const yesSnap = exchange.price(market.id, yes.id);
  const noSnap = exchange.price(market.id, no.id);
  const yesMid = yesSnap.midPriceCents ?? yesSnap.lastPriceCents;
  const noMid = noSnap.midPriceCents ?? noSnap.lastPriceCents;
  const book = exchange.orderBook(market.id, yes.id);
  const trades = exchange.marketTrades(market.id).slice(-12).reverse();
  const arbitrage = exchange.detectArbitrage(market.id);
  const resolution = exchange.resolutionState(market.id);
  const demoBalance = exchange.users.get("user_demo")?.balanceCents ?? 0;

  return (
    <div className="grid gap-8 lg:grid-cols-[1fr_340px]">
      <div>
        <div className="text-xs text-slate-500 mb-2">
          {market.category} · {market.resolutionClass} · Estado: {market.status} · Jurisdicción: {market.jurisdiction}
        </div>
        <h1 className="text-2xl font-bold text-white leading-snug">{market.title}</h1>
        <p className="mt-2 text-slate-400 text-sm">{market.description}</p>

        {arbitrage.length > 0 && (
          <div className="mt-4 rounded-lg border border-amber-500/40 bg-amber-500/10 p-3 text-sm text-amber-300">
            <strong>Arbitrage Engine:</strong>{" "}
            {arbitrage.map((a) => `${a.kind}: ${a.detail}`).join(" · ")}
          </div>
        )}

        <div className="mt-6 grid grid-cols-2 gap-4">
          <div className="rounded-xl border border-emerald-500/40 bg-emerald-500/10 p-4">
            <div className="text-emerald-300 text-sm">SÍ</div>
            <div className="text-3xl font-bold text-emerald-400">{formatCents(yesMid)}</div>
            <div className="text-xs text-slate-400 mt-1">
              Bid {formatCents(yesSnap.bestBidCents)} · Ask {formatCents(yesSnap.bestAskCents)}
            </div>
          </div>
          <div className="rounded-xl border border-rose-500/40 bg-rose-500/10 p-4">
            <div className="text-rose-300 text-sm">NO</div>
            <div className="text-3xl font-bold text-rose-400">{formatCents(noMid)}</div>
            <div className="text-xs text-slate-400 mt-1">
              Bid {formatCents(noSnap.bestBidCents)} · Ask {formatCents(noSnap.bestAskCents)}
            </div>
          </div>
        </div>

        <div className="mt-4 grid grid-cols-4 gap-3 text-center text-sm">
          {[
            ["Probabilidad", formatPct(yesMid !== null ? yesMid / 100 : null)],
            ["Volumen", formatUsd(market.volume)],
            ["Liquidez", formatUsd(market.liquidity)],
            ["Spread", formatCents(yesSnap.spreadCents)],
          ].map(([label, value]) => (
            <div key={label} className="rounded-lg border border-slate-800 bg-slate-900/60 p-3">
              <div className="text-slate-500 text-xs">{label}</div>
              <div className="font-semibold text-white">{value}</div>
            </div>
          ))}
        </div>

        <section className="mt-8">
          <h2 className="font-semibold text-white mb-2">Order book (SÍ)</h2>
          <div className="grid grid-cols-2 gap-4 text-sm">
            <div className="rounded-lg border border-slate-800 overflow-hidden">
              <div className="bg-slate-900 px-3 py-1.5 text-xs text-emerald-400">Bids</div>
              {book.bids.length === 0 && <div className="px-3 py-2 text-slate-600">—</div>}
              {book.bids.map((l) => (
                <div key={`b${l.priceCents}`} className="flex justify-between px-3 py-1 border-t border-slate-800/60">
                  <span className="text-emerald-400">{l.priceCents}¢</span>
                  <span className="text-slate-400">{l.quantity}</span>
                </div>
              ))}
            </div>
            <div className="rounded-lg border border-slate-800 overflow-hidden">
              <div className="bg-slate-900 px-3 py-1.5 text-xs text-rose-400">Asks</div>
              {book.asks.length === 0 && <div className="px-3 py-2 text-slate-600">—</div>}
              {book.asks.map((l) => (
                <div key={`a${l.priceCents}`} className="flex justify-between px-3 py-1 border-t border-slate-800/60">
                  <span className="text-rose-400">{l.priceCents}¢</span>
                  <span className="text-slate-400">{l.quantity}</span>
                </div>
              ))}
            </div>
          </div>
        </section>

        <section className="mt-8">
          <h2 className="font-semibold text-white mb-2">Últimos trades</h2>
          <div className="rounded-lg border border-slate-800 overflow-hidden text-sm">
            {trades.length === 0 && <div className="px-3 py-2 text-slate-600">Sin trades aún.</div>}
            {trades.map((t) => (
              <div key={t.id} className="flex justify-between px-3 py-1.5 border-t border-slate-800/60 first:border-t-0">
                <span className={t.outcomeId === yes.id ? "text-emerald-400" : "text-rose-400"}>
                  {t.outcomeId === yes.id ? "SÍ" : "NO"} × {t.quantity}
                </span>
                <span className="text-slate-300">{t.priceCents}¢</span>
                <span className="text-slate-500 text-xs">{t.kind}</span>
              </div>
            ))}
          </div>
        </section>

        <section className="mt-8 rounded-xl border border-slate-800 bg-slate-900/40 p-5 text-sm">
          <h2 className="font-semibold text-white mb-3">Reglas y transparencia</h2>
          <dl className="space-y-2 text-slate-300">
            <div><dt className="text-slate-500 inline">Regla de resolución: </dt><dd className="inline">{market.resolutionRule}</dd></div>
            <div>
              <dt className="text-slate-500 inline">Fuentes: </dt>
              <dd className="inline">
                {market.resolutionSources.map((s) => `${s.name} (confiabilidad ${Math.round(s.reliabilityScore * 100)}%)`).join(", ")}
              </dd>
            </div>
            <div><dt className="text-slate-500 inline">Oráculo: </dt><dd className="inline">{market.oracleId}</dd></div>
            <div><dt className="text-slate-500 inline">Cierre: </dt><dd className="inline">{new Date(market.closeTime).toLocaleString("es-DO")}</dd></div>
            <div><dt className="text-slate-500 inline">Resolución: </dt><dd className="inline">{new Date(market.resolutionTime).toLocaleString("es-DO")}</dd></div>
            <div><dt className="text-slate-500 inline">Ventana de disputa: </dt><dd className="inline">{Math.round(market.disputePeriodMs / 3_600_000)} horas</dd></div>
            <div><dt className="text-slate-500 inline">Creado por: </dt><dd className="inline">{market.marketCreator} · {new Date(market.createdAt).toLocaleDateString("es-DO")}</dd></div>
            <div><dt className="text-slate-500 inline">Colateral: </dt><dd className="inline">{market.collateralToken} (simulado en Fase 1)</dd></div>
            {resolution.proposal && (
              <div>
                <dt className="text-slate-500 inline">Propuesta de resolución: </dt>
                <dd className="inline">
                  {resolution.proposal.method} por {resolution.proposal.proposedBy}; ventana de disputa hasta{" "}
                  {new Date(resolution.proposal.disputeWindowEndsAt).toLocaleString("es-DO")}
                </dd>
              </div>
            )}
            {resolution.dispute && (
              <div>
                <dt className="text-slate-500 inline">Disputa: </dt>
                <dd className="inline">{resolution.dispute.reason} ({resolution.dispute.disputedBy})</dd>
              </div>
            )}
          </dl>
          <p className="mt-3 text-xs text-slate-500">
            El precio representa la probabilidad implícita del mercado, no una garantía
            de que el evento ocurra.
          </p>
        </section>
      </div>

      <aside>
        <TradeForm
          marketId={market.id}
          marketStatus={market.status}
          yesOutcomeId={yes.id}
          noOutcomeId={no.id}
          yesPriceCents={yesMid ?? 50}
          noPriceCents={noMid ?? 50}
          balanceCents={demoBalance}
        />
      </aside>
    </div>
  );
}
