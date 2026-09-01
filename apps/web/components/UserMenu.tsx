"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { LoginModal } from "./LoginModal";

interface Me {
  profile: {
    username: string;
    avatarHue: number;
    settings: { darkMode: boolean };
  } | null;
  portfolio?: { totalCents: number; cashCents: number };
}

export function Avatar({ hue, size = 32 }: { hue: number; size?: number }) {
  return (
    <span
      className="inline-block rounded-full shrink-0"
      style={{
        width: size,
        height: size,
        background: `linear-gradient(135deg, hsl(${hue},80%,55%), hsl(${(hue + 80) % 360},85%,60%))`,
      }}
    />
  );
}

export function UserMenu() {
  const router = useRouter();
  const [me, setMe] = useState<Me | null>(null);
  const [open, setOpen] = useState(false);
  const [showLogin, setShowLogin] = useState(false);
  const [note, setNote] = useState<string | null>(null);
  const menuRef = useRef<HTMLDivElement>(null);

  const refresh = useCallback(async () => {
    const res = await fetch("/api/auth/me");
    setMe(await res.json());
    router.refresh();
  }, [router]);

  useEffect(() => {
    refresh();
  }, [refresh]);

  useEffect(() => {
    const close = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", close);
    return () => document.removeEventListener("mousedown", close);
  }, []);

  const usd = (c: number) => `$${(c / 100).toLocaleString("en-US", { minimumFractionDigits: 2 })}`;

  const depositDemo = async () => {
    const amount = prompt("Monto a depositar (USDC simulado, máx $10,000):", "1000");
    if (!amount) return;
    const cents = Math.round(Number(amount) * 100);
    const res = await fetch("/api/auth/profile", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "deposit", amountCents: cents }),
    });
    const data = await res.json();
    if (!res.ok) setNote(data.error ?? "Error");
    await refresh();
  };

  const logoutNow = async () => {
    await fetch("/api/auth/logout", { method: "POST" });
    setOpen(false);
    await refresh();
  };

  const toggleDark = async () => {
    if (!me?.profile) return;
    await fetch("/api/auth/profile", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ settings: { darkMode: !me.profile.settings.darkMode } }),
    });
    setNote("El tema claro llega en la Fase 3 — preferencia guardada.");
    await refresh();
  };

  if (!me) return <div className="h-8 w-24" />;

  if (!me.profile) {
    return (
      <>
        <button
          onClick={() => setShowLogin(true)}
          className="rounded-lg border border-slate-700 px-3 py-1.5 text-sm text-slate-300 hover:border-slate-500"
        >
          Iniciar sesión
        </button>
        <button
          onClick={() => setShowLogin(true)}
          className="rounded-lg bg-emerald-500 px-3 py-1.5 text-sm font-semibold text-slate-950 hover:bg-emerald-400"
        >
          Registrarse
        </button>
        {showLogin && <LoginModal onClose={() => setShowLogin(false)} onLoggedIn={refresh} />}
      </>
    );
  }

  const { profile, portfolio } = me;
  const item = "flex items-center gap-2 px-4 py-2 text-sm text-slate-300 hover:bg-slate-800/60 w-full text-left";
  const linkItem = "block px-4 py-1.5 text-sm text-slate-400 hover:text-white";

  return (
    <div className="flex items-center gap-3" ref={menuRef}>
      <div className="hidden sm:flex flex-col items-end leading-tight">
        <span className="text-[10px] text-slate-500">Portfolio</span>
        <span className="text-xs font-semibold text-emerald-400">{usd(portfolio?.totalCents ?? 0)}</span>
      </div>
      <div className="hidden sm:flex flex-col items-end leading-tight">
        <span className="text-[10px] text-slate-500">Cash</span>
        <span className="text-xs font-semibold text-emerald-400">{usd(portfolio?.cashCents ?? 0)}</span>
      </div>
      <button
        onClick={depositDemo}
        className="rounded-lg bg-blue-600 px-3 py-1.5 text-sm font-semibold text-white hover:bg-blue-500"
      >
        ↓ Depositar
      </button>

      <div className="relative">
        <button onClick={() => setOpen(!open)} aria-label="Menú de usuario">
          <Avatar hue={profile.avatarHue} />
        </button>
        {open && (
          <div className="absolute right-0 mt-2 w-64 rounded-xl border border-slate-800 bg-slate-950 shadow-2xl py-2 z-50">
            <div className="flex items-center justify-between px-4 py-2 border-b border-slate-800 mb-1">
              <span className="flex items-center gap-2 font-semibold text-white">
                <Avatar hue={profile.avatarHue} size={26} /> {profile.username}
              </span>
              <Link href="/profile" onClick={() => setOpen(false)} className="text-slate-400 hover:text-white">⚙</Link>
            </div>
            <Link href="/leaderboard" onClick={() => setOpen(false)} className={item}>🏆 Leaderboard</Link>
            <Link href="/profile?tab=rewards" onClick={() => setOpen(false)} className={item}>💰 Recompensas</Link>
            <Link href="/profile?tab=api" onClick={() => setOpen(false)} className={item}>🔑 APIs</Link>
            <Link href="/profile?tab=referral" onClick={() => setOpen(false)} className={item}>🎁 Referir y ganar</Link>
            <Link href="/profile?tab=builders" onClick={() => setOpen(false)} className={item}>🛠 Builders</Link>
            <button onClick={toggleDark} className={item}>
              🌙 Modo oscuro
              <span
                className={`ml-auto inline-flex h-4 w-8 items-center rounded-full transition ${
                  profile.settings.darkMode ? "bg-emerald-500" : "bg-slate-700"
                }`}
              >
                <span
                  className={`h-3 w-3 rounded-full bg-white transition ml-0.5 ${
                    profile.settings.darkMode ? "translate-x-4" : ""
                  }`}
                />
              </span>
            </button>
            <div className="my-1 border-t border-slate-800" />
            <Link href="/portfolio" onClick={() => setOpen(false)} className={linkItem}>Precisión</Link>
            <Link href="/testnet" onClick={() => setOpen(false)} className={linkItem}>Estado</Link>
            <a href="https://github.com/rex7g/PickMaster" target="_blank" rel="noreferrer" className={linkItem}>Documentación</a>
            <Link href="/api/markets" onClick={() => setOpen(false)} className={linkItem}>Centro de ayuda</Link>
            <Link href="/profile?tab=account" onClick={() => setOpen(false)} className={linkItem}>Términos de uso</Link>
            <div className="flex items-center justify-between px-4 py-1.5 text-sm text-slate-400">
              <span>🇩🇴 Idioma</span>
              <span className="text-xs text-slate-600">ES</span>
            </div>
            <div className="my-1 border-t border-slate-800" />
            <button onClick={logoutNow} className="px-4 py-2 text-sm text-rose-400 hover:bg-slate-800/60 w-full text-left">
              Cerrar sesión
            </button>
          </div>
        )}
      </div>
      {note && (
        <div
          className="fixed bottom-4 right-4 rounded-lg border border-slate-700 bg-slate-900 px-4 py-2 text-xs text-slate-300 shadow-xl cursor-pointer"
          onClick={() => setNote(null)}
        >
          {note}
        </div>
      )}
    </div>
  );
}
