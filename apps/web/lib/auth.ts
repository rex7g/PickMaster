/**
 * Identity (Fase 2, prototipo): login por email / Google (simulado) / wallet,
 * sesión por cookie httpOnly y perfiles estilo exchange (username, bio,
 * referral, sociales, API keys). Sin contraseñas ni OAuth real todavía:
 * el proveedor de identidad y el KYC llegan con la Closed Beta (Fase 3,
 * §31). El perfil vive en memoria junto al Exchange de la Fase 1.
 */
import { cookies } from "next/headers";
import { evidenceHash } from "@pickmaster/core";
import { getExchange } from "./store";

export interface ApiKey {
  id: string;
  label: string;
  /** Sólo se muestra completa al crearla. */
  key: string;
  createdAt: number;
}

export interface Profile {
  id: string;
  username: string;
  email: string | null;
  /** Dirección derivada (API only) o la wallet real si entró con wallet. */
  address: string;
  walletLogin: boolean;
  bio: string;
  /** Tono 0-360 del avatar degradado. */
  avatarHue: number;
  referralCode: string;
  referredBy: string | null;
  socials: { x: string | null; discord: string | null };
  settings: {
    darkMode: boolean;
    emailNotifications: boolean;
    priceAlerts: boolean;
    resolutionAlerts: boolean;
    orderConfirmations: boolean;
    defaultSlippageBps: number;
  };
  apiKeys: ApiKey[];
  createdAt: number;
}

const SESSION_COOKIE = "pm_session";

const globalAuth = globalThis as unknown as {
  __pickmasterProfiles?: Map<string, Profile>;
  __pickmasterSessions?: Map<string, string>; // token -> userId
};

function profiles(): Map<string, Profile> {
  if (!globalAuth.__pickmasterProfiles) globalAuth.__pickmasterProfiles = new Map();
  return globalAuth.__pickmasterProfiles;
}

function sessions(): Map<string, string> {
  if (!globalAuth.__pickmasterSessions) globalAuth.__pickmasterSessions = new Map();
  return globalAuth.__pickmasterSessions;
}

function randomToken(): string {
  return Array.from(crypto.getRandomValues(new Uint8Array(24)))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

/** Dirección determinística "for API use only" para cuentas sin wallet. */
function deriveAddress(userId: string): string {
  let hex = "";
  for (let i = 0; hex.length < 40; i++) hex += evidenceHash(`${userId}:${i}`).slice(2);
  return `0x${hex.slice(0, 40)}`;
}

function hueFrom(id: string): number {
  let h = 0;
  for (const c of id) h = (h * 31 + c.charCodeAt(0)) % 360;
  return h;
}

function makeReferralCode(username: string): string {
  return `${username.slice(0, 6).toUpperCase()}${Math.floor(1000 + Math.random() * 9000)}`;
}

function createProfile(id: string, username: string, email: string | null, address?: string): Profile {
  const profile: Profile = {
    id,
    username,
    email,
    address: address ?? deriveAddress(id),
    walletLogin: Boolean(address),
    bio: "",
    avatarHue: hueFrom(id),
    referralCode: makeReferralCode(username),
    referredBy: null,
    socials: { x: null, discord: null },
    settings: {
      darkMode: true,
      emailNotifications: true,
      priceAlerts: true,
      resolutionAlerts: true,
      orderConfirmations: true,
      defaultSlippageBps: 100,
    },
    apiKeys: [],
    createdAt: Date.now(),
  };
  profiles().set(id, profile);
  // Cuenta de trading simulada asociada (Fase 1-2: KYC pre-aprobado en demo).
  const exchange = getExchange();
  if (!exchange.users.has(id)) {
    exchange.createUser({
      id,
      jurisdiction: "DO",
      kycVerified: true,
      ageVerified: true,
      sanctioned: false,
      riskScore: 0.05,
      balanceCents: 0,
    });
  }
  return profile;
}

export interface LoginInput {
  method: "email" | "google" | "wallet";
  email?: string;
  address?: string;
}

export async function login(input: LoginInput): Promise<Profile> {
  let id: string;
  let username: string;
  let email: string | null = null;
  let address: string | undefined;

  if (input.method === "wallet") {
    if (!input.address || !/^0x[a-fA-F0-9]{40}$/.test(input.address)) {
      throw new Error("Dirección de wallet inválida.");
    }
    address = input.address;
    id = `wallet_${input.address.toLowerCase()}`;
    username = `${input.address.slice(2, 8).toLowerCase()}`;
  } else if (input.method === "email") {
    const normalized = input.email?.trim().toLowerCase() ?? "";
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(normalized)) {
      throw new Error("Email inválido.");
    }
    email = normalized;
    id = `email_${evidenceHash(normalized).slice(2)}`;
    username = normalized.split("@")[0]!.slice(0, 16);
  } else {
    // Login "Google" simulado: en producción esto es OAuth real (Fase 3).
    email = input.email?.trim().toLowerCase() || "demo.google@pickmaster.do";
    id = `google_${evidenceHash(email).slice(2)}`;
    username = email.split("@")[0]!.slice(0, 16);
  }

  const existing = profiles().get(id);
  const profile = existing ?? createProfile(id, username, email, address);

  const token = randomToken();
  sessions().set(token, id);
  const jar = await cookies();
  jar.set(SESSION_COOKIE, token, {
    httpOnly: true,
    sameSite: "lax",
    path: "/",
    maxAge: 30 * 24 * 3600,
  });
  return profile;
}

export async function logout(): Promise<void> {
  const jar = await cookies();
  const token = jar.get(SESSION_COOKIE)?.value;
  if (token) sessions().delete(token);
  jar.delete(SESSION_COOKIE);
}

export async function getSessionUserId(): Promise<string | null> {
  const jar = await cookies();
  const token = jar.get(SESSION_COOKIE)?.value;
  if (!token) return null;
  return sessions().get(token) ?? null;
}

export async function getSessionProfile(): Promise<Profile | null> {
  const id = await getSessionUserId();
  return id ? (profiles().get(id) ?? null) : null;
}

export function getProfile(id: string): Profile | null {
  return profiles().get(id) ?? null;
}

export function allProfiles(): Profile[] {
  return [...profiles().values()];
}

export interface ProfileUpdate {
  username?: string;
  bio?: string;
  referralApply?: string;
  connectX?: boolean;
  connectDiscord?: boolean;
  settings?: Partial<Profile["settings"]>;
}

export function updateProfile(id: string, update: ProfileUpdate): Profile {
  const profile = profiles().get(id);
  if (!profile) throw new Error("Perfil no encontrado.");

  if (update.username !== undefined) {
    const name = update.username.trim();
    if (name.length < 3 || name.length > 20) throw new Error("El username debe tener 3–20 caracteres.");
    if (!/^[a-zA-Z0-9_]+$/.test(name)) throw new Error("Sólo letras, números y _.");
    profile.username = name;
  }
  if (update.bio !== undefined) {
    if (update.bio.length > 200) throw new Error("La bio no puede superar 200 caracteres.");
    profile.bio = update.bio;
  }
  if (update.referralApply) {
    if (profile.referredBy) throw new Error("Ya aplicaste un código de referido.");
    if (Date.now() - profile.createdAt > 24 * 3600_000) {
      throw new Error("Sólo puedes aplicar un código dentro de las 24 horas de crear tu cuenta.");
    }
    const referrer = [...profiles().values()].find(
      (p) => p.referralCode === update.referralApply!.trim().toUpperCase() && p.id !== id,
    );
    if (!referrer) throw new Error("Código de referido no válido.");
    profile.referredBy = referrer.id;
  }
  if (update.connectX) profile.socials.x = `@${profile.username}`;
  if (update.connectDiscord) profile.socials.discord = `${profile.username}#${1000 + (profile.avatarHue % 8999)}`;
  if (update.settings) profile.settings = { ...profile.settings, ...update.settings };
  return profile;
}

export function createApiKey(id: string, label: string): ApiKey {
  const profile = profiles().get(id);
  if (!profile) throw new Error("Perfil no encontrado.");
  if (profile.apiKeys.length >= 5) throw new Error("Máximo 5 API keys.");
  const key: ApiKey = {
    id: `key_${randomToken().slice(0, 8)}`,
    label: label.trim() || "default",
    key: `pk_test_${randomToken()}`,
    createdAt: Date.now(),
  };
  profile.apiKeys.push(key);
  return key;
}

export function revokeApiKey(id: string, keyId: string): void {
  const profile = profiles().get(id);
  if (!profile) throw new Error("Perfil no encontrado.");
  profile.apiKeys = profile.apiKeys.filter((k) => k.id !== keyId);
}

/** Depósito simulado de USDC demo (Fase 1-2; on-ramp real en Fase 3). */
export function deposit(id: string, amountCents: number): number {
  if (!Number.isInteger(amountCents) || amountCents <= 0 || amountCents > 1_000_000) {
    throw new Error("Monto inválido (máx $10,000 demo).");
  }
  const user = getExchange().users.get(id);
  if (!user) throw new Error("Cuenta de trading no encontrada.");
  user.balanceCents += amountCents;
  return user.balanceCents;
}

/** Vista pública del perfil (sin claves API completas). */
export function publicProfile(profile: Profile) {
  return {
    id: profile.id,
    username: profile.username,
    email: profile.email,
    address: profile.address,
    walletLogin: profile.walletLogin,
    bio: profile.bio,
    avatarHue: profile.avatarHue,
    referralCode: profile.referralCode,
    referredBy: profile.referredBy,
    canApplyReferral: !profile.referredBy && Date.now() - profile.createdAt <= 24 * 3600_000,
    socials: profile.socials,
    settings: profile.settings,
    apiKeys: profile.apiKeys.map((k) => ({
      id: k.id,
      label: k.label,
      preview: `${k.key.slice(0, 12)}…${k.key.slice(-4)}`,
      createdAt: k.createdAt,
    })),
    createdAt: profile.createdAt,
  };
}
