/**
 * Phase 1 demo seed: Dominican Republic markets (§1, §35) with simulated
 * liquidity from a market-maker account. No real money (§63 Phase 1).
 */
import { Exchange, signOrder } from "./exchange";
import type { Market, ResolutionSource } from "./types";
import { classifyResolutionWindow } from "./validation";

export const DEMO_USER_ID = "user_demo";
export const MAKER_USER_ID = "user_maker";
export const ADMIN_ACTOR = "admin@pickmaster.do";

const HOUR = 60 * 60_000;
const DAY = 24 * HOUR;

const sources = {
  bancoCentral: {
    id: "src_bcrd",
    name: "Banco Central de la República Dominicana",
    url: "https://bancentral.gov.do",
    kind: "GOVERNMENT",
    reliabilityScore: 0.95,
    latencyMs: 2 * HOUR,
  },
  jce: {
    id: "src_jce",
    name: "Junta Central Electoral",
    url: "https://jce.gob.do",
    kind: "GOVERNMENT",
    reliabilityScore: 0.95,
    latencyMs: 12 * HOUR,
  },
  one: {
    id: "src_one",
    name: "Oficina Nacional de Estadística",
    url: "https://one.gob.do",
    kind: "GOVERNMENT",
    reliabilityScore: 0.9,
    latencyMs: 3 * DAY,
  },
  onamet: {
    id: "src_onamet",
    name: "ONAMET",
    url: "https://onamet.gob.do",
    kind: "WEATHER",
    reliabilityScore: 0.85,
    latencyMs: 6 * HOUR,
  },
  lidom: {
    id: "src_lidom",
    name: "LIDOM (Liga de Béisbol Profesional)",
    url: "https://lidom.com",
    kind: "SPORTS_ORG",
    reliabilityScore: 0.9,
    latencyMs: 1 * HOUR,
  },
  fxFeed: {
    id: "src_fx",
    name: "Feed financiero USD/DOP (agregado de bancos)",
    kind: "FINANCIAL",
    reliabilityScore: 0.92,
    latencyMs: 60_000,
  },
} satisfies Record<string, ResolutionSource>;

interface SeedSpec {
  slug: string;
  title: string;
  description: string;
  category: Market["category"];
  resolutionWindowMs: number;
  closeInMs: number;
  resolutionSources: ResolutionSource[];
  resolutionRule: string;
  /** Market-maker quotes: YES bid and NO bid in cents (their sum < 100). */
  yesBid: number;
  noBid: number;
  /** Demo trades to generate volume: qty of YES bought by the demo user. */
  demoYesBuy?: number;
}

const SEEDS: SeedSpec[] = [
  {
    slug: "elecciones-presidenciales-2028",
    title: "¿Ganará el partido oficialista las elecciones presidenciales de 2028?",
    description:
      "Se resuelve YES si el candidato del partido en el poder es declarado ganador por la JCE en la elección presidencial de 2028 (incluyendo segunda vuelta si aplica).",
    category: "POLITICS",
    resolutionWindowMs: 30 * DAY,
    closeInMs: 600 * DAY,
    resolutionSources: [sources.jce],
    resolutionRule:
      "Resultado oficial proclamado por la Junta Central Electoral. Si la elección se anula o pospone más de 90 días, el mercado se anula (VOID).",
    yesBid: 46,
    noBid: 50,
    demoYesBuy: 40,
  },
  {
    slug: "usd-dop-64-diciembre-2026",
    title: "¿Superará la tasa USD/DOP los 64.00 pesos al cierre del 31 de diciembre de 2026?",
    description:
      "Se resuelve YES si la tasa de venta de referencia del Banco Central supera 64.00 DOP por USD en su publicación correspondiente al 31/12/2026.",
    category: "FINANCE",
    resolutionWindowMs: 2 * DAY,
    closeInMs: 120 * DAY,
    resolutionSources: [sources.bancoCentral, sources.fxFeed],
    resolutionRule:
      "Tasa de referencia de venta publicada por el Banco Central (bancentral.gov.do) para la fecha objetivo; el feed financiero agregado actúa como fuente secundaria.",
    yesBid: 58,
    noBid: 38,
    demoYesBuy: 60,
  },
  {
    slug: "tasa-politica-monetaria-oct-2026",
    title: "¿Modificará el Banco Central la tasa de política monetaria antes del 31 de octubre de 2026?",
    description:
      "Se resuelve YES si el BCRD anuncia cualquier cambio (subida o bajada) de la TPM en o antes del 31/10/2026.",
    category: "ECONOMY",
    resolutionWindowMs: 1 * DAY,
    closeInMs: 55 * DAY,
    resolutionSources: [sources.bancoCentral],
    resolutionRule:
      "Comunicados oficiales de política monetaria del BCRD. Mantener la tasa sin cambios en todas las reuniones del período resuelve NO.",
    yesBid: 33,
    noBid: 63,
    demoYesBuy: 25,
  },
  {
    slug: "lluvia-santo-domingo-oct-2026",
    title: "¿Lloverá más de 50 mm acumulados en Santo Domingo entre el 1 y el 7 de octubre de 2026?",
    description:
      "Se resuelve YES si la precipitación acumulada reportada por ONAMET para la estación de referencia del Distrito Nacional supera 50 mm en el período indicado.",
    category: "WEATHER",
    resolutionWindowMs: 3 * DAY,
    closeInMs: 30 * DAY,
    resolutionSources: [sources.onamet],
    resolutionRule:
      "Boletín oficial de precipitaciones de ONAMET para la estación del Distrito Nacional; si la estación no reporta, se anula el mercado.",
    yesBid: 61,
    noBid: 35,
  },
  {
    slug: "licey-campeon-lidom-2026-27",
    title: "¿Ganarán los Tigres del Licey la final de LIDOM 2026-27?",
    description:
      "Se resuelve YES si los Tigres del Licey son campeones de la serie final de la temporada 2026-27 de LIDOM.",
    category: "SPORTS",
    resolutionWindowMs: 12 * HOUR,
    closeInMs: 150 * DAY,
    resolutionSources: [sources.lidom],
    resolutionRule:
      "Resultado oficial publicado por LIDOM al concluir la serie final. Si la temporada se cancela, el mercado se anula (VOID).",
    yesBid: 27,
    noBid: 69,
    demoYesBuy: 30,
  },
  {
    slug: "inflacion-interanual-2026",
    title: "¿Cerrará la inflación interanual de República Dominicana 2026 por debajo de 4.0%?",
    description:
      "Se resuelve YES si la variación interanual del IPC a diciembre 2026, publicada por el BCRD, es estrictamente menor a 4.0%.",
    category: "ECONOMY",
    resolutionWindowMs: 10 * DAY,
    closeInMs: 130 * DAY,
    resolutionSources: [sources.bancoCentral, sources.one],
    resolutionRule:
      "IPC interanual oficial del Banco Central; la ONE actúa como fuente secundaria de contraste.",
    yesBid: 52,
    noBid: 44,
  },
  {
    slug: "usd-dop-fix-hoy",
    title: "¿Cerrará el USD/DOP por encima de 63.50 en el fix interbancario de las 3:00 PM de hoy?",
    description:
      "Mercado ULTRA_FAST: se resuelve con el fix interbancario agregado de las 3:00 PM (hora de Santo Domingo) de la fecha de cierre.",
    category: "FINANCE",
    resolutionWindowMs: 10 * 60_000,
    closeInMs: 6 * HOUR,
    resolutionSources: [sources.fxFeed],
    resolutionRule:
      "Fix interbancario agregado publicado por el feed financiero (latencia ~1 min); clase ULTRA_FAST permitida por baja latencia de la fuente (§8).",
    yesBid: 49,
    noBid: 47,
    demoYesBuy: 15,
  },
];

export function createSeededExchange(now = Date.now()): Exchange {
  const exchange = new Exchange();
  exchange.now = () => Date.now();

  exchange.createUser({
    id: DEMO_USER_ID,
    jurisdiction: "DO",
    kycVerified: true,
    ageVerified: true,
    sanctioned: false,
    riskScore: 0.05,
    balanceCents: 100_000, // $1,000.00 simulados
  });
  exchange.createUser({
    id: MAKER_USER_ID,
    jurisdiction: "DO",
    kycVerified: true,
    ageVerified: true,
    sanctioned: false,
    riskScore: 0.02,
    balanceCents: 100_000_000, // market maker simulado
  });

  for (const spec of SEEDS) {
    const market = exchange.createMarket(
      {
        slug: spec.slug,
        title: spec.title,
        description: spec.description,
        type: "BINARY",
        category: spec.category,
        jurisdiction: "DO",
        outcomes: [
          { id: `${spec.slug}:yes`, code: "YES", label: "Sí" },
          { id: `${spec.slug}:no`, code: "NO", label: "No" },
        ],
        openTime: now,
        closeTime: now + spec.closeInMs,
        resolutionTime: now + spec.closeInMs + spec.resolutionWindowMs,
        resolutionWindowMs: spec.resolutionWindowMs,
        resolutionClass: classifyResolutionWindow(spec.resolutionWindowMs),
        collateralToken: "USDC",
        resolutionSources: spec.resolutionSources,
        resolutionRule: spec.resolutionRule,
        oracleId: "oracle_aggregator_v1",
        disputePeriodMs: 24 * HOUR,
        marketCreator: ADMIN_ACTOR,
        feeModelId: "default-v1",
      },
      ADMIN_ACTOR,
    );
    exchange.approveMarket(market.id, ADMIN_ACTOR);
    exchange.openMarket(market.id, ADMIN_ACTOR);

    const [yesOutcome, noOutcome] = market.outcomes;
    const place = (
      userId: string,
      outcomeId: string,
      side: "BUY" | "SELL",
      priceCents: number,
      quantity: number,
    ) =>
      exchange.placeOrder({
        userId,
        marketId: market.id,
        outcomeId,
        side,
        priceCents,
        quantity,
        signature: signOrder(userId, market.id, outcomeId, side, priceCents, quantity),
      });

    // Market-maker quotes both sides (yesBid + noBid < 100 → no self-cross).
    place(MAKER_USER_ID, yesOutcome!.id, "BUY", spec.yesBid, 500);
    place(MAKER_USER_ID, noOutcome!.id, "BUY", spec.noBid, 500);

    // Demo user lifts the implied YES ask → MINT trades create volume.
    if (spec.demoYesBuy) {
      place(DEMO_USER_ID, yesOutcome!.id, "BUY", 100 - spec.noBid, spec.demoYesBuy);
      // Maker re-quotes the NO side consumed by the mint.
      place(MAKER_USER_ID, noOutcome!.id, "BUY", spec.noBid, spec.demoYesBuy);
    }
  }

  return exchange;
}
