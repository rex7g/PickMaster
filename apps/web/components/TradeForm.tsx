"use client";

/**
 * Simulated trading panel (Phase 1). Shows the full cost breakdown BEFORE
 * confirming (AC-005): estimated network fee + PickMaster fee = total cost.
 * The demo user's mock EIP-712 signature is produced server-side by the
 * /api/trade endpoint (a real wallet signs in Phase 2).
 */
import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";

interface Props {
  marketId: string;
  marketStatus: string;
  yesOutcomeId: string;
  noOutcomeId: string;
  yesPriceCents: number;
  noPriceCents: number;
  balanceCents: number;
}

// Mirrors DEFAULT_FEE_MODEL in @pickmaster/core for the pre-trade quote.
const FEES = { tradingBps: 20, protocolBps: 10, networkCents: 1 };

export function TradeForm(props: Props) {
  const router = useRouter();
  const [outcome, setOutcome] = useState<"YES" | "NO">("YES");
  const [side, setSide] = useState<"BUY" | "SELL">("BUY");
  const [price, setPrice] = useState(Math.round(props.yesPriceCents));
  const [quantity, setQuantity] = useState(10);
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null);
  const [busy, setBusy] = useState(false);

  const quote = useMemo(() => {
    const notional = price * quantity;
    const trading = Math.ceil((notional * FEES.tradingBps) / 10_000);
    const protocol = Math.ceil((notional * FEES.protocolBps) / 10_000);
    const total = notional + trading + protocol + FEES.networkCents;
    return { notional, trading, protocol, network: FEES.networkCents, total };
  }, [price, quantity]);

  const selectOutcome = (o: "YES" | "NO") => {
    setOutcome(o);
    setPrice(Math.round(o === "YES" ? props.yesPriceCents : props.noPriceCents));
  };

  const submit = async () => {
    setBusy(true);
    setMessage(null);
    try {
      const res = await fetch("/api/trade", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          marketId: props.marketId,
          outcomeId: outcome === "YES" ? props.yesOutcomeId : props.noOutcomeId,
          side,
          priceCents: price,
          quantity,
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        setMessage({ ok: false, text: data.error ?? "Error desconocido" });
      } else {
        setMessage({
          ok: true,
          text:
            data.trades > 0
              ? `Orden ejecutada: ${data.filled} shares (${data.trades} trade${data.trades > 1 ? "s" : ""}).`
              : "Orden colocada en el libro (sin cruce inmediato).",
        });
        router.refresh();
      }
    } catch {
      setMessage({ ok: false, text: "Error de red." });
    } finally {
      setBusy(false);
    }
  };

  const usd = (c: number) => `$${(c / 100).toFixed(2)}`;
  const disabled = props.marketStatus !== "OPEN" || busy;

  return (
    <div className="rounded-xl border border-slate-800 bg-slate-900/60 p-5 sticky top-20">
      <h2 className="font-semibold text-white mb-1">Operar (simulado)</h2>
      <p className="text-xs text-slate-500 mb-4">
        Balance demo: <span className="text-slate-300">{usd(props.balanceCents)}</span> USDC simulado
      </p>

      <div className="grid grid-cols-2 gap-2 mb-3">
        <button
          onClick={() => selectOutcome("YES")}
          className={`rounded-lg py-2 text-sm font-semibold border ${
            outcome === "YES"
              ? "bg-emerald-500/20 border-emerald-500 text-emerald-300"
              : "border-slate-700 text-slate-400 hover:border-slate-500"
          }`}
        >
          SÍ {Math.round(props.yesPriceCents)}¢
        </button>
        <button
          onClick={() => selectOutcome("NO")}
          className={`rounded-lg py-2 text-sm font-semibold border ${
            outcome === "NO"
              ? "bg-rose-500/20 border-rose-500 text-rose-300"
              : "border-slate-700 text-slate-400 hover:border-slate-500"
          }`}
        >
          NO {Math.round(props.noPriceCents)}¢
        </button>
      </div>

      <div className="grid grid-cols-2 gap-2 mb-4">
        {(["BUY", "SELL"] as const).map((s) => (
          <button
            key={s}
            onClick={() => setSide(s)}
            className={`rounded-lg py-1.5 text-xs font-semibold border ${
              side === s
                ? "bg-slate-700 border-slate-500 text-white"
                : "border-slate-700 text-slate-400 hover:border-slate-500"
            }`}
          >
            {s === "BUY" ? "Comprar" : "Vender"}
          </button>
        ))}
      </div>

      <label className="block text-xs text-slate-500 mb-1">Precio límite (¢/share)</label>
      <input
        type="number"
        min={1}
        max={99}
        value={price}
        onChange={(e) => setPrice(Math.max(1, Math.min(99, Number(e.target.value))))}
        className="w-full rounded-lg bg-slate-800 border border-slate-700 px-3 py-2 text-sm mb-3"
      />
      <label className="block text-xs text-slate-500 mb-1">Cantidad (shares)</label>
      <input
        type="number"
        min={1}
        value={quantity}
        onChange={(e) => setQuantity(Math.max(1, Math.round(Number(e.target.value))))}
        className="w-full rounded-lg bg-slate-800 border border-slate-700 px-3 py-2 text-sm mb-4"
      />

      <div className="rounded-lg bg-slate-800/60 p-3 text-xs space-y-1 mb-4">
        <div className="flex justify-between text-slate-400">
          <span>Notional ({quantity} × {price}¢)</span><span>{usd(quote.notional)}</span>
        </div>
        <div className="flex justify-between text-slate-400">
          <span>Trading fee (0.20%)</span><span>{usd(quote.trading)}</span>
        </div>
        <div className="flex justify-between text-slate-400">
          <span>Protocol fee (0.10%)</span><span>{usd(quote.protocol)}</span>
        </div>
        <div className="flex justify-between text-slate-400">
          <span>Network fee estimado (L2)</span><span>{usd(quote.network)}</span>
        </div>
        <div className="flex justify-between font-semibold text-white border-t border-slate-700 pt-1 mt-1">
          <span>Coste total</span><span>{usd(quote.total)}</span>
        </div>
        {side === "BUY" && (
          <div className="flex justify-between text-emerald-400">
            <span>Payout si aciertas</span><span>{usd(quantity * 100)}</span>
          </div>
        )}
      </div>

      <button
        onClick={submit}
        disabled={disabled}
        className="w-full rounded-lg bg-emerald-500 py-2.5 font-semibold text-slate-950 hover:bg-emerald-400 disabled:opacity-40 disabled:cursor-not-allowed"
      >
        {props.marketStatus !== "OPEN"
          ? `Mercado ${props.marketStatus}`
          : busy
            ? "Enviando…"
            : "Confirmar operación"}
      </button>

      {message && (
        <p className={`mt-3 text-xs ${message.ok ? "text-emerald-400" : "text-rose-400"}`}>
          {message.text}
        </p>
      )}
    </div>
  );
}
