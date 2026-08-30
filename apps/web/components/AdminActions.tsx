"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

function useAdminCall() {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const call = async (action: string, marketId?: string, extra?: Record<string, unknown>) => {
    setError(null);
    const res = await fetch("/api/admin", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action, marketId, ...extra }),
    });
    if (!res.ok) {
      const data = await res.json().catch(() => ({}));
      setError(data.error ?? "Error");
    }
    router.refresh();
  };
  return { call, error };
}

const btn =
  "rounded-md border border-slate-700 px-2 py-1 text-xs text-slate-300 hover:border-emerald-500 hover:text-white";

export function AdminMarketActions({ marketId, status }: { marketId: string; status: string }) {
  const { call, error } = useAdminCall();
  return (
    <div className="flex flex-wrap gap-1.5">
      {status === "OPEN" && (
        <button className={btn} onClick={() => call("close", marketId)}>Cerrar</button>
      )}
      {(status === "CLOSED" || status === "RESOLUTION_PENDING") && (
        <>
          <button className={btn} onClick={() => call("oracle-agree", marketId, { outcome: "YES" })}>
            Oráculo: 2× SÍ
          </button>
          <button className={btn} onClick={() => call("oracle-agree", marketId, { outcome: "NO" })}>
            Oráculo: 2× NO
          </button>
          <button className={btn} onClick={() => call("oracle-conflict", marketId)}>
            Oráculo: conflicto
          </button>
        </>
      )}
      {status === "DISPUTE_WINDOW" && (
        <>
          <button className={btn} onClick={() => call("dispute", marketId)}>Disputar</button>
          <button className={btn} onClick={() => call("finalize", marketId)}>
            Finalizar (avanza ventana)
          </button>
        </>
      )}
      {status === "DISPUTED" && (
        <>
          <button className={btn} onClick={() => call("arbitrate", marketId, { outcome: "YES" })}>
            Arbitrar: SÍ
          </button>
          <button className={btn} onClick={() => call("arbitrate", marketId, { outcome: "NO" })}>
            Arbitrar: NO
          </button>
          <button className={btn} onClick={() => call("void", marketId)}>Anular (VOID)</button>
        </>
      )}
      {(status === "RESOLVED" || status === "VOID") && (
        <button className={btn} onClick={() => call("settle", marketId)}>Liquidar</button>
      )}
      {error && <span className="text-rose-400 text-xs w-full">{error}</span>}
    </div>
  );
}

export function PlatformControls({ paused }: { paused: boolean }) {
  const { call, error } = useAdminCall();
  return (
    <div className="flex gap-2 items-center">
      {error && <span className="text-rose-400 text-xs">{error}</span>}
      <button className={btn} onClick={() => call("risk-scan")}>Escaneo de riesgo</button>
      {paused ? (
        <button
          className="rounded-md border border-emerald-500 px-3 py-1 text-xs text-emerald-300"
          onClick={() => call("unpause")}
        >
          Reanudar plataforma
        </button>
      ) : (
        <button
          className="rounded-md border border-rose-500 px-3 py-1 text-xs text-rose-300"
          onClick={() => call("pause")}
        >
          Pausa de emergencia
        </button>
      )}
    </div>
  );
}
