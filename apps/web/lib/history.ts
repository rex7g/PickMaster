/**
 * Historial de precios por mercado (§37 / §55 Chart).
 * Fase 1-2: serie sintética determinística (random walk sembrado por slug)
 * que termina en el precio actual del mercado, más los trades reales que se
 * van añadiendo en vivo. En Fase 3 la serie sale de ClickHouse (§25).
 */
import type { Exchange } from "@pickmaster/core";

export interface PricePoint {
  /** epoch ms */
  t: number;
  /** precio YES en centavos (probabilidad implícita ×100) */
  yes: number;
}

const HOUR = 3_600_000;
const DAY = 24 * HOUR;

const globalHistory = globalThis as unknown as {
  __pickmasterHistory?: Map<string, PricePoint[]>;
};

function store(): Map<string, PricePoint[]> {
  if (!globalHistory.__pickmasterHistory) globalHistory.__pickmasterHistory = new Map();
  return globalHistory.__pickmasterHistory;
}

/** PRNG determinístico (mulberry32) sembrado por el slug del mercado. */
function rng(seed: string): () => number {
  let h = 1779033703;
  for (let i = 0; i < seed.length; i++) {
    h = Math.imul(h ^ seed.charCodeAt(i), 3432918353);
    h = (h << 13) | (h >>> 19);
  }
  let a = h >>> 0;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * Genera 30 días de puntos (cada 15 min) que convergen al precio actual.
 * Camino browniano con reversión suave hacia el precio final.
 */
function generate(slug: string, endPriceCents: number, now: number): PricePoint[] {
  const rand = rng(slug);
  const points: PricePoint[] = [];
  const steps = (30 * DAY) / (15 * 60_000);
  // Camino hacia atrás desde el precio final para garantizar la convergencia.
  let price = endPriceCents;
  const back: number[] = [price];
  for (let i = 1; i <= steps; i++) {
    const shock = (rand() - 0.5) * 2.2;
    const drift = (50 - price) * 0.004; // ligera reversión a 50 hacia el pasado
    price = Math.min(96, Math.max(4, price + shock + drift));
    back.push(price);
  }
  back.reverse();
  for (let i = 0; i < back.length; i++) {
    points.push({
      t: now - (steps - i) * 15 * 60_000,
      yes: Math.round(back[i]! * 10) / 10,
    });
  }
  return points;
}

export function ensureHistory(exchange: Exchange, marketId: string): PricePoint[] {
  const s = store();
  let series = s.get(marketId);
  if (!series) {
    const market = exchange.markets.get(marketId);
    const end = market ? Math.round(market.currentProbability * 100) : 50;
    series = generate(market?.slug ?? marketId, end || 50, Date.now());
    s.set(marketId, series);
  }
  return series;
}

/** Añade un punto tras cada trade real (llamado desde /api/trade). */
export function recordPrice(exchange: Exchange, marketId: string): void {
  const market = exchange.markets.get(marketId);
  if (!market) return;
  const series = ensureHistory(exchange, marketId);
  series.push({ t: Date.now(), yes: Math.round(market.currentProbability * 1000) / 10 });
}

export type Range = "1H" | "6H" | "1D" | "1W" | "1M" | "ALL";

const RANGE_MS: Record<Range, number> = {
  "1H": HOUR,
  "6H": 6 * HOUR,
  "1D": DAY,
  "1W": 7 * DAY,
  "1M": 30 * DAY,
  ALL: Number.MAX_SAFE_INTEGER,
};

export function getHistory(
  exchange: Exchange,
  marketId: string,
  range: Range,
): PricePoint[] {
  const series = ensureHistory(exchange, marketId);
  const cutoff = Date.now() - RANGE_MS[range];
  const filtered = series.filter((p) => p.t >= cutoff);
  // Para rangos cortos, densifica interpolando entre los puntos de 15 min.
  return filtered.length >= 2 ? filtered : series.slice(-8);
}
