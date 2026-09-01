"use client";

import { useState } from "react";

/**
 * Modal de acceso estilo exchange: Google (simulado en Fase 2), email, o
 * wallet inyectada. En Fase 3 el botón de Google pasa a OAuth real y el
 * email a magic-link (§20 onboarding: Email → cuenta → smart wallet).
 */
export function LoginModal({
  onClose,
  onLoggedIn,
}: {
  onClose: () => void;
  onLoggedIn: () => void;
}) {
  const [email, setEmail] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const doLogin = async (payload: Record<string, unknown>) => {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/auth/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const data = await res.json();
      if (!res.ok) setError(data.error ?? "Error de acceso.");
      else {
        onLoggedIn();
        onClose();
      }
    } catch {
      setError("Error de red.");
    } finally {
      setBusy(false);
    }
  };

  const walletLogin = async () => {
    const eth = (window as unknown as { ethereum?: { request: (a: { method: string }) => Promise<unknown> } }).ethereum;
    if (!eth) {
      setError("No hay wallet inyectada (instala MetaMask o Coinbase Wallet).");
      return;
    }
    try {
      const accounts = (await eth.request({ method: "eth_requestAccounts" })) as string[];
      if (accounts[0]) await doLogin({ method: "wallet", address: accounts[0] });
    } catch {
      setError("Conexión de wallet cancelada.");
    }
  };

  const wallets: { label: string; icon: string; onClick: () => void }[] = [
    { label: "MetaMask", icon: "🦊", onClick: walletLogin },
    { label: "Coinbase Wallet", icon: "🔵", onClick: walletLogin },
    { label: "Rabby", icon: "🐰", onClick: walletLogin },
    { label: "Otras", icon: "⋯", onClick: walletLogin },
  ];

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-sm p-4"
      onClick={onClose}
    >
      <div
        className="w-full max-w-sm rounded-2xl border border-slate-800 bg-slate-950 p-6 shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <h2 className="text-center text-lg font-bold text-white mb-5">
          Bienvenido a Pick<span className="text-emerald-400">Master</span>
        </h2>

        <button
          onClick={() => doLogin({ method: "google" })}
          disabled={busy}
          className="w-full rounded-xl bg-blue-600 py-2.5 font-semibold text-white hover:bg-blue-500 disabled:opacity-40 flex items-center justify-center gap-2"
        >
          <span className="font-bold">G</span> Continuar con Google
          <span className="text-blue-200 text-xs">(demo)</span>
        </button>

        <div className="flex items-center gap-3 my-4">
          <div className="h-px flex-1 bg-slate-800" />
          <span className="text-xs text-slate-500">O</span>
          <div className="h-px flex-1 bg-slate-800" />
        </div>

        <form
          onSubmit={(e) => {
            e.preventDefault();
            doLogin({ method: "email", email });
          }}
          className="flex gap-2 mb-4"
        >
          <input
            type="email"
            required
            placeholder="Dirección de email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            className="flex-1 rounded-xl bg-slate-900 border border-slate-700 px-3 py-2.5 text-sm placeholder:text-slate-600"
          />
          <button
            type="submit"
            disabled={busy || !email}
            className="rounded-xl bg-slate-800 px-4 text-sm font-semibold text-slate-300 hover:bg-slate-700 disabled:opacity-40"
          >
            Continuar
          </button>
        </form>

        <div className="grid grid-cols-4 gap-2">
          {wallets.map((w) => (
            <button
              key={w.label}
              title={w.label}
              onClick={w.onClick}
              disabled={busy}
              className="aspect-square rounded-xl bg-slate-900 border border-slate-800 text-2xl hover:border-slate-600 disabled:opacity-40"
            >
              {w.icon}
            </button>
          ))}
        </div>

        {error && <p className="mt-3 text-xs text-rose-400">{error}</p>}

        <p className="mt-4 text-center text-xs text-slate-600">
          Términos · Privacidad — prototipo sin dinero real
        </p>
      </div>
    </div>
  );
}
