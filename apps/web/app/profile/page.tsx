"use client";

/**
 * Perfil del usuario (estilo exchange): sidebar con Perfil / Cuenta /
 * Trading / Notificaciones / Relayer API keys / Session keys / Builders.
 */
import { Suspense, useCallback, useEffect, useState } from "react";
import { useSearchParams } from "next/navigation";
import { Avatar } from "@/components/UserMenu";
import { LoginModal } from "@/components/LoginModal";

interface ProfileData {
  username: string;
  email: string | null;
  address: string;
  walletLogin: boolean;
  bio: string;
  avatarHue: number;
  referralCode: string;
  referredBy: string | null;
  canApplyReferral: boolean;
  socials: { x: string | null; discord: string | null };
  settings: {
    emailNotifications: boolean;
    priceAlerts: boolean;
    resolutionAlerts: boolean;
    orderConfirmations: boolean;
    defaultSlippageBps: number;
  };
  apiKeys: { id: string; label: string; preview: string; createdAt: number }[];
}

const SECTIONS = [
  ["profile", "👤 Perfil"],
  ["account", "💳 Cuenta"],
  ["trading", "📈 Trading"],
  ["notifications", "🔔 Notificaciones"],
  ["api", "🔒 Relayer API keys"],
  ["sessions", "🗝 Session keys"],
  ["builders", "🧩 Builders"],
] as const;

type Section = (typeof SECTIONS)[number][0];

function ProfileInner() {
  const params = useSearchParams();
  const initialTab = (params.get("tab") as Section) ?? "profile";
  const [section, setSection] = useState<Section>(
    SECTIONS.some(([s]) => s === initialTab) ? initialTab : "profile",
  );
  const [profile, setProfile] = useState<ProfileData | null | undefined>(undefined);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [editingName, setEditingName] = useState(false);
  const [nameDraft, setNameDraft] = useState("");
  const [bioDraft, setBioDraft] = useState("");
  const [referralDraft, setReferralDraft] = useState("");
  const [newKey, setNewKey] = useState<string | null>(null);

  const load = useCallback(async () => {
    const res = await fetch("/api/auth/me");
    const data = await res.json();
    setProfile(data.profile);
    if (data.profile) setBioDraft(data.profile.bio);
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const patch = async (body: Record<string, unknown>, okText = "Guardado.") => {
    setMsg(null);
    const res = await fetch("/api/auth/profile", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    const data = await res.json();
    if (!res.ok) setMsg({ ok: false, text: data.error ?? "Error" });
    else {
      setMsg({ ok: true, text: okText });
      if (data.apiKey) setNewKey(data.apiKey.key);
      await load();
    }
  };

  if (profile === undefined) return <div className="text-slate-500">Cargando…</div>;
  if (profile === null) {
    return (
      <div className="text-center py-16">
        <p className="text-slate-400 mb-4">Inicia sesión para ver tu perfil.</p>
        <LoginModal onClose={() => {}} onLoggedIn={load} />
      </div>
    );
  }

  const row = "rounded-xl border border-slate-800 bg-slate-900/60 px-5 py-4 flex items-center justify-between gap-4";
  const label = "font-semibold text-white";
  const toggle = (key: keyof ProfileData["settings"], text: string) => (
    <div className={row} key={key}>
      <span className={label}>{text}</span>
      <button
        onClick={() => patch({ settings: { [key]: !profile.settings[key] } })}
        className={`inline-flex h-5 w-10 items-center rounded-full transition ${
          profile.settings[key] ? "bg-emerald-500" : "bg-slate-700"
        }`}
      >
        <span
          className={`h-4 w-4 rounded-full bg-white transition ml-0.5 ${
            profile.settings[key] ? "translate-x-5" : ""
          }`}
        />
      </button>
    </div>
  );

  return (
    <div className="grid gap-8 md:grid-cols-[220px_1fr]">
      <aside className="space-y-1">
        {SECTIONS.map(([id, name]) => (
          <button
            key={id}
            onClick={() => setSection(id)}
            className={`w-full rounded-xl px-4 py-2.5 text-left text-sm ${
              section === id
                ? "bg-slate-800 text-white font-semibold"
                : "text-slate-400 hover:text-white"
            }`}
          >
            {name}
          </button>
        ))}
      </aside>

      <div>
        {msg && (
          <p className={`mb-4 text-sm ${msg.ok ? "text-emerald-400" : "text-rose-400"}`}>{msg.text}</p>
        )}

        {section === "profile" && (
          <div className="space-y-3">
            <h1 className="text-xl font-bold text-white mb-4">Perfil</h1>
            <div className={row}>
              <span className={label}>Foto de perfil</span>
              <Avatar hue={profile.avatarHue} size={40} />
            </div>
            <div className={row}>
              <span className={label}>Username</span>
              {editingName ? (
                <span className="flex gap-2">
                  <input
                    value={nameDraft}
                    onChange={(e) => setNameDraft(e.target.value)}
                    className="rounded-lg bg-slate-800 border border-slate-700 px-2 py-1 text-sm w-40"
                  />
                  <button
                    onClick={async () => {
                      await patch({ username: nameDraft });
                      setEditingName(false);
                    }}
                    className="text-emerald-400 text-sm"
                  >
                    Guardar
                  </button>
                </span>
              ) : (
                <span className="text-slate-300 flex items-center gap-2">
                  {profile.username}
                  <button
                    onClick={() => {
                      setNameDraft(profile.username);
                      setEditingName(true);
                    }}
                    className="text-slate-500 hover:text-white"
                  >
                    ✎
                  </button>
                </span>
              )}
            </div>
            <div className={row}>
              <span className={label}>Email</span>
              <span className="text-slate-300">{profile.email ?? "— (login con wallet)"}</span>
            </div>
            <div className={row}>
              <div>
                <div className={label}>Dirección</div>
                <div className="text-xs text-slate-500 mt-0.5">
                  No envíes fondos a esta dirección. Sólo para uso del API.
                </div>
              </div>
              <span className="font-mono text-xs text-slate-300 flex items-center gap-2">
                {profile.address}
                <button
                  onClick={() => navigator.clipboard.writeText(profile.address)}
                  className="text-slate-500 hover:text-white"
                  title="Copiar"
                >
                  ⧉
                </button>
              </span>
            </div>

            <div>
              <div className="text-white font-semibold mt-6 mb-2">Bio</div>
              <div className="relative">
                <textarea
                  value={bioDraft}
                  onChange={(e) => setBioDraft(e.target.value.slice(0, 200))}
                  placeholder="Cuéntales a otros sobre ti"
                  rows={3}
                  className="w-full rounded-xl bg-slate-900/60 border border-slate-800 px-4 py-3 text-sm placeholder:text-slate-600"
                />
                <span className="absolute bottom-2 right-3 text-xs text-slate-600">
                  {bioDraft.length}/200
                </span>
              </div>
              {bioDraft !== profile.bio && (
                <button
                  onClick={() => patch({ bio: bioDraft })}
                  className="mt-2 rounded-lg bg-emerald-500 px-4 py-1.5 text-sm font-semibold text-slate-950"
                >
                  Guardar bio
                </button>
              )}
            </div>

            <div>
              <div className="text-white font-semibold mt-6 mb-2">Código de referido</div>
              <div className="flex gap-2">
                <input
                  value={referralDraft}
                  onChange={(e) => setReferralDraft(e.target.value)}
                  placeholder="Ingresa el código de quien te refirió"
                  disabled={!profile.canApplyReferral}
                  className="flex-1 rounded-xl bg-slate-900/60 border border-slate-800 px-4 py-2.5 text-sm placeholder:text-slate-600 disabled:opacity-50"
                />
                <button
                  onClick={() => patch({ referralApply: referralDraft }, "Código aplicado.")}
                  disabled={!profile.canApplyReferral || !referralDraft}
                  className="rounded-xl bg-blue-600 px-5 text-sm font-semibold text-white hover:bg-blue-500 disabled:opacity-40"
                >
                  Aplicar
                </button>
              </div>
              <p className="mt-1.5 text-xs text-emerald-600">
                {profile.referredBy
                  ? "Ya tienes un código de referido aplicado."
                  : "Sólo puedes aplicar un código dentro de las 24 horas de crear tu cuenta."}
              </p>
              <p className="mt-1 text-xs text-slate-500">
                Tu código para compartir: <span className="font-mono text-slate-300">{profile.referralCode}</span>
              </p>
            </div>

            <div className="text-white font-semibold mt-6 mb-2">Conexiones sociales</div>
            <div className={row}>
              <span className="flex items-center gap-3">
                <span className="flex h-8 w-8 items-center justify-center rounded-full bg-black text-white font-bold">𝕏</span>
                <span>
                  <span className={label}>X</span>
                  <div className="text-xs text-slate-500">Vincula tu cuenta de X para mostrarla en tu perfil.</div>
                </span>
              </span>
              {profile.socials.x ? (
                <span className="text-emerald-400 text-sm">{profile.socials.x} ✓</span>
              ) : (
                <button onClick={() => patch({ connectX: true }, "X vinculado (demo).")} className="text-blue-400 text-sm font-semibold">
                  Conectar X ↗
                </button>
              )}
            </div>
            <div className={row}>
              <span className="flex items-center gap-3">
                <span className="flex h-8 w-8 items-center justify-center rounded-full bg-indigo-600 text-white">🎮</span>
                <span>
                  <span className={label}>Discord</span>
                  <div className="text-xs text-slate-500">Vincula tu Discord para mostrarlo en tu perfil.</div>
                </span>
              </span>
              {profile.socials.discord ? (
                <span className="text-emerald-400 text-sm">{profile.socials.discord} ✓</span>
              ) : (
                <button onClick={() => patch({ connectDiscord: true }, "Discord vinculado (demo).")} className="text-blue-400 text-sm font-semibold">
                  Conectar Discord ↗
                </button>
              )}
            </div>
          </div>
        )}

        {section === "account" && (
          <div className="space-y-3">
            <h1 className="text-xl font-bold text-white mb-4">Cuenta</h1>
            <div className={row}>
              <span className={label}>Método de acceso</span>
              <span className="text-slate-300">{profile.walletLogin ? "Wallet" : "Email/Google (demo)"}</span>
            </div>
            <div className={row}>
              <span className={label}>Jurisdicción</span>
              <span className="text-slate-300">🇩🇴 República Dominicana</span>
            </div>
            <div className={row}>
              <span className={label}>KYC</span>
              <span className="text-emerald-400">Pre-aprobado (demo; KYC real en Fase 3)</span>
            </div>
            <div className={row}>
              <span className={label}>Exportar mis datos</span>
              <a href="/api/auth/me" target="_blank" className="text-blue-400 text-sm font-semibold">Descargar JSON ↗</a>
            </div>
          </div>
        )}

        {section === "trading" && (
          <div className="space-y-3">
            <h1 className="text-xl font-bold text-white mb-4">Trading</h1>
            {toggle("orderConfirmations", "Confirmar cada orden antes de enviar")}
            <div className={row}>
              <span className={label}>Slippage máximo por defecto</span>
              <select
                value={profile.settings.defaultSlippageBps}
                onChange={(e) => patch({ settings: { defaultSlippageBps: Number(e.target.value) } })}
                className="rounded-lg bg-slate-800 border border-slate-700 px-2 py-1 text-sm"
              >
                <option value={50}>0.5%</option>
                <option value={100}>1%</option>
                <option value={200}>2%</option>
                <option value={500}>5%</option>
              </select>
            </div>
          </div>
        )}

        {section === "notifications" && (
          <div className="space-y-3">
            <h1 className="text-xl font-bold text-white mb-4">Notificaciones</h1>
            {toggle("emailNotifications", "Notificaciones por email")}
            {toggle("priceAlerts", "Alertas de cambio de precio")}
            {toggle("resolutionAlerts", "Resolución de mercados con posición")}
          </div>
        )}

        {section === "api" && (
          <div className="space-y-3">
            <h1 className="text-xl font-bold text-white mb-2">Relayer API keys</h1>
            <p className="text-sm text-slate-500 mb-4">
              Claves para operar vía API pública (§57–58). La clave completa sólo se muestra una vez.
            </p>
            {newKey && (
              <div className="rounded-xl border border-emerald-500/40 bg-emerald-500/10 p-4 text-sm">
                <div className="text-emerald-300 mb-1">Guarda esta clave ahora — no volverá a mostrarse:</div>
                <code className="font-mono text-xs text-white break-all">{newKey}</code>
              </div>
            )}
            {profile.apiKeys.map((k) => (
              <div key={k.id} className={row}>
                <span>
                  <span className={label}>{k.label}</span>
                  <div className="font-mono text-xs text-slate-500">{k.preview}</div>
                </span>
                <button
                  onClick={() => patch({ action: "revoke-api-key", keyId: k.id }, "Clave revocada.")}
                  className="text-rose-400 text-sm"
                >
                  Revocar
                </button>
              </div>
            ))}
            <button
              onClick={() => patch({ action: "create-api-key", label: `key-${profile.apiKeys.length + 1}` }, "Clave creada.")}
              className="rounded-xl bg-emerald-500 px-4 py-2 text-sm font-semibold text-slate-950"
            >
              + Generar nueva API key
            </button>
          </div>
        )}

        {section === "sessions" && (
          <div>
            <h1 className="text-xl font-bold text-white mb-4">Session keys</h1>
            <p className="text-sm text-slate-500 max-w-lg">
              Las session keys (claves de sesión delegadas para operar sin firmar cada orden,
              vía ERC-4337 smart accounts — §19) llegan con las smart wallets de la Fase 3.
            </p>
          </div>
        )}

        {section === "builders" && (
          <div>
            <h1 className="text-xl font-bold text-white mb-4">Builders</h1>
            <p className="text-sm text-slate-500 max-w-lg mb-4">
              Integra PickMaster en tu producto: API pública de mercados, precios y
              order book, y SDK <code className="text-slate-300">@pickmaster/sdk</code> (§58) en camino.
            </p>
            <div className="space-y-2 text-sm">
              <a href="/api/markets" target="_blank" className="block text-blue-400">GET /api/markets ↗</a>
              <a href="/api/prices" target="_blank" className="block text-blue-400">GET /api/prices ↗</a>
              <a href="https://github.com/rex7g/PickMaster" target="_blank" rel="noreferrer" className="block text-blue-400">Repositorio y documentación ↗</a>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

export default function ProfilePage() {
  return (
    <Suspense fallback={<div className="text-slate-500">Cargando…</div>}>
      <ProfileInner />
    </Suspense>
  );
}
