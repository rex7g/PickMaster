/**
 * Acceptance criteria tests (Master Prompt §47, AC-001..AC-013).
 * AC-014/AC-015 (mobile/web parity) are UI-level and covered by apps/web
 * plus the Phase 3 mobile app.
 */
import { beforeEach, describe, expect, it } from "vitest";
import {
  ADMIN_ACTOR,
  DEMO_USER_ID,
  Exchange,
  MAKER_USER_ID,
  classifyResolutionWindow,
  createSeededExchange,
  detectBinaryMispricing,
  detectCorrelatedAccounts,
  evidenceHash,
  marketEligibility,
  quoteCost,
  signOrder,
  type Market,
  type OracleReport,
  type ResolutionSource,
} from "../src/index";

const HOUR = 60 * 60_000;
const DAY = 24 * HOUR;

const reliableSource = (id: string, latencyMs = HOUR): ResolutionSource => ({
  id,
  name: `Fuente ${id}`,
  kind: "GOVERNMENT",
  reliabilityScore: 0.95,
  latencyMs,
});

function draftMarket(exchange: Exchange, overrides: Partial<Market> = {}): Market {
  const now = exchange.now();
  const windowMs = overrides.resolutionWindowMs ?? 2 * DAY;
  return exchange.createMarket(
    {
      slug: overrides.slug ?? "mercado-test",
      title:
        overrides.title ??
        "¿Modificará el Banco Central la tasa de política monetaria antes del 31 de octubre?",
      description: overrides.description ?? "Mercado de prueba.",
      type: "BINARY",
      category: "ECONOMY",
      jurisdiction: "DO",
      outcomes: overrides.outcomes ?? [
        { id: "t:yes", code: "YES", label: "Sí" },
        { id: "t:no", code: "NO", label: "No" },
      ],
      openTime: now,
      closeTime: now + 10 * DAY,
      resolutionTime: now + 10 * DAY + windowMs,
      resolutionWindowMs: windowMs,
      resolutionClass:
        overrides.resolutionClass ?? classifyResolutionWindow(windowMs),
      collateralToken: "USDC",
      resolutionSources: overrides.resolutionSources ?? [
        reliableSource("a"),
        reliableSource("b"),
      ],
      resolutionRule:
        overrides.resolutionRule ??
        "Comunicado oficial del BCRD publicado en bancentral.gov.do.",
      oracleId: "oracle_aggregator_v1",
      disputePeriodMs: overrides.disputePeriodMs ?? 24 * HOUR,
      marketCreator: ADMIN_ACTOR,
      feeModelId: "default-v1",
    },
    ADMIN_ACTOR,
  );
}

function makeUser(exchange: Exchange, id: string, overrides = {}) {
  return exchange.createUser({
    id,
    jurisdiction: "DO",
    kycVerified: true,
    ageVerified: true,
    sanctioned: false,
    riskScore: 0.1,
    balanceCents: 1_000_000,
    ...overrides,
  });
}

const sign = (
  userId: string,
  market: Market,
  outcomeId: string,
  side: "BUY" | "SELL",
  price: number,
  qty: number,
) => ({
  userId,
  marketId: market.id,
  outcomeId,
  side,
  priceCents: price,
  quantity: qty,
  signature: signOrder(userId, market.id, outcomeId, side, price, qty),
});

let exchange: Exchange;
let clock: number;

beforeEach(() => {
  exchange = new Exchange();
  clock = Date.parse("2026-08-30T12:00:00Z");
  exchange.now = () => clock;
});

describe("AC-001 — crear mercado con validación completa", () => {
  it("aprueba un mercado válido tras validar pregunta, outcomes, fechas, oracle, resolución y compliance", () => {
    const market = draftMarket(exchange);
    expect(market.status).toBe("DRAFT");
    exchange.approveMarket(market.id, ADMIN_ACTOR);
    expect(market.status).toBe("APPROVED");
    expect(market.complianceStatus).toBe("APPROVED");
  });

  it("rechaza un mercado sin fuente de resolución", () => {
    const market = draftMarket(exchange, { resolutionSources: [] });
    expect(() => exchange.approveMarket(market.id, ADMIN_ACTOR)).toThrow(/SOURCE_MISSING/);
    expect(market.status).toBe("DRAFT");
  });

  it("rechaza una pregunta ambigua", () => {
    const market = draftMarket(exchange, {
      title: "¿Será casi seguro un buen año para la economía?",
    });
    expect(() => exchange.approveMarket(market.id, ADMIN_ACTOR)).toThrow(/AMBIGUITY/);
  });
});

describe("AC-002 — mercados de 5 minutos requieren fuente compatible", () => {
  it("rechaza un mercado ULTRA_FAST cuando la fuente tiene latencia mayor a la ventana", () => {
    const market = draftMarket(exchange, {
      resolutionWindowMs: 5 * 60_000,
      resolutionSources: [reliableSource("lenta", 2 * HOUR)],
    });
    expect(market.resolutionClass).toBe("ULTRA_FAST");
    expect(() => exchange.approveMarket(market.id, ADMIN_ACTOR)).toThrow(/SOURCE_LATENCY/);
  });

  it("acepta un mercado ULTRA_FAST con fuente de baja latencia y alta confiabilidad", () => {
    const market = draftMarket(exchange, {
      resolutionWindowMs: 5 * 60_000,
      resolutionSources: [reliableSource("rapida", 30_000)],
    });
    exchange.approveMarket(market.id, ADMIN_ACTOR);
    expect(market.status).toBe("APPROVED");
  });
});

describe("AC-003 — el precio actualiza la probabilidad implícita", () => {
  it("actualiza currentProbability cuando se ejecutan trades", () => {
    const market = draftMarket(exchange);
    exchange.approveMarket(market.id, ADMIN_ACTOR);
    exchange.openMarket(market.id, ADMIN_ACTOR);
    makeUser(exchange, "alice");
    makeUser(exchange, "bob");
    // bob puja NO a 40¢; alice compra YES a 60¢ → MINT a 60¢ → probabilidad 60%
    exchange.placeOrder(sign("bob", market, "t:no", "BUY", 40, 10));
    exchange.placeOrder(sign("alice", market, "t:yes", "BUY", 60, 10));
    expect(market.currentProbability).toBeCloseTo(0.6, 2);
  });
});

describe("AC-004 — validación previa al matching", () => {
  let market: Market;
  beforeEach(() => {
    market = draftMarket(exchange);
    exchange.approveMarket(market.id, ADMIN_ACTOR);
    exchange.openMarket(market.id, ADMIN_ACTOR);
  });

  it("rechaza firmas inválidas", () => {
    makeUser(exchange, "alice");
    expect(() =>
      exchange.placeOrder({ ...sign("alice", market, "t:yes", "BUY", 50, 10), signature: "sig:falsa" }),
    ).toThrow(/Firma/);
  });

  it("rechaza balance insuficiente", () => {
    makeUser(exchange, "pobre", { balanceCents: 10 });
    expect(() => exchange.placeOrder(sign("pobre", market, "t:yes", "BUY", 50, 100))).toThrow(
      /Balance insuficiente/,
    );
  });

  it("rechaza ventas sin posición", () => {
    makeUser(exchange, "alice");
    expect(() => exchange.placeOrder(sign("alice", market, "t:yes", "SELL", 50, 5))).toThrow(
      /No posee/,
    );
  });
});

describe("AC-005 — coste estimado visible antes de firmar", () => {
  it("desglosa network fee + fees de PickMaster = coste total", () => {
    const quote = quoteCost(50, 100); // 100 shares a 50¢ = 5000¢
    expect(quote.notionalCents).toBe(5000);
    expect(quote.fees.estimatedNetworkFeeCents).toBeGreaterThan(0);
    expect(quote.totalCostCents).toBe(quote.notionalCents + quote.fees.totalFeeCents);
    expect(quote.fees.totalFeeCents).toBe(
      quote.fees.tradingFeeCents +
        quote.fees.protocolFeeCents +
        quote.fees.settlementFeeCents +
        quote.fees.estimatedNetworkFeeCents,
    );
  });
});

function openTradedMarket(): Market {
  const market = draftMarket(exchange);
  exchange.approveMarket(market.id, ADMIN_ACTOR);
  exchange.openMarket(market.id, ADMIN_ACTOR);
  makeUser(exchange, "alice");
  makeUser(exchange, "bob");
  exchange.placeOrder(sign("bob", market, "t:no", "BUY", 40, 10));
  exchange.placeOrder(sign("alice", market, "t:yes", "BUY", 60, 10)); // MINT 10 @ 60/40
  return market;
}

const report = (
  market: Market,
  sourceId: string,
  outcomeCode: string,
): OracleReport => ({
  sourceId,
  marketId: market.id,
  outcomeCode,
  reportedAt: clock,
  evidenceHash: evidenceHash(`${sourceId}:${outcomeCode}`),
});

describe("AC-006 / AC-007 — resolución automática y settlement", () => {
  it("dos fuentes confiables de acuerdo → resolución automática, y tras la ventana de disputa los usuarios cobran", () => {
    const market = openTradedMarket();
    exchange.closeMarket(market.id, ADMIN_ACTOR);

    exchange.submitOracleReports(market.id, [
      report(market, "a", "YES"),
      report(market, "b", "YES"),
    ]);
    expect(market.status).toBe("DISPUTE_WINDOW"); // AC-007

    clock += 25 * HOUR; // la ventana de disputa (24h) expira
    exchange.finalize(market.id, ADMIN_ACTOR);
    expect(market.status).toBe("RESOLVED");
    expect(market.winningOutcomeId).toBe("t:yes");

    const aliceBefore = exchange.users.get("alice")!.balanceCents;
    const bobBefore = exchange.users.get("bob")!.balanceCents;
    const records = exchange.settle(market.id, ADMIN_ACTOR); // AC-006
    expect(market.status).toBe("SETTLED");
    expect(exchange.users.get("alice")!.balanceCents).toBe(aliceBefore + 10 * 100);
    expect(exchange.users.get("bob")!.balanceCents).toBe(bobBefore);
    expect(records.some((r) => r.userId === "alice" && r.payoutCents === 1000)).toBe(true);

    // Idempotencia (§45): re-liquidar no paga dos veces.
    const again = exchange.settle(market.id, ADMIN_ACTOR);
    expect(again).toHaveLength(0);
  });
});

describe("AC-008 — fuentes en conflicto → DISPUTED, nunca liquidación automática", () => {
  it("marca el mercado como DISPUTED y bloquea settle", () => {
    const market = openTradedMarket();
    exchange.closeMarket(market.id, ADMIN_ACTOR);
    exchange.submitOracleReports(market.id, [
      report(market, "a", "YES"),
      report(market, "b", "NO"),
    ]);
    expect(market.status).toBe("DISPUTED");
    expect(() => exchange.settle(market.id, ADMIN_ACTOR)).toThrow();
    // Sólo el arbitraje (o VOID) puede resolverlo (§12–13, §46).
    exchange.arbitrateMarket(market.id, "t:no", "comite@pickmaster.do");
    expect(market.status).toBe("RESOLVED");
    expect(market.winningOutcomeId).toBe("t:no");
  });

  it("permite anular (VOID) un mercado disputado y reembolsa al coste", () => {
    const market = openTradedMarket();
    exchange.closeMarket(market.id, ADMIN_ACTOR);
    exchange.submitOracleReports(market.id, [
      report(market, "a", "YES"),
      report(market, "b", "NO"),
    ]);
    exchange.voidMarketById(market.id, ADMIN_ACTOR, "Resultado ambiguo");
    const aliceBefore = exchange.users.get("alice")!.balanceCents;
    exchange.settle(market.id, ADMIN_ACTOR);
    // alice pagó 600¢ por 10 YES @ 60¢ → reembolso exacto del coste
    expect(exchange.users.get("alice")!.balanceCents).toBe(aliceBefore + 600);
  });
});

describe("AC-009 — arbitraje interno detecta YES + NO ≠ 1", () => {
  it("detecta mispricing y negative risk", () => {
    const opportunities = detectBinaryMispricing("m1", 58, 47, clock);
    expect(opportunities.some((o) => o.kind === "MISPRICING")).toBe(true);
    const cheap = detectBinaryMispricing("m1", 40, 50, clock);
    expect(cheap.some((o) => o.kind === "NEGATIVE_RISK")).toBe(true);
    expect(detectBinaryMispricing("m1", 52, 48, clock)).toHaveLength(0);
  });
});

describe("AC-010 — cuentas correlacionadas generan Risk Event", () => {
  it("detecta dos cuentas que operan repetidamente entre sí", () => {
    const market = draftMarket(exchange);
    exchange.approveMarket(market.id, ADMIN_ACTOR);
    exchange.openMarket(market.id, ADMIN_ACTOR);
    makeUser(exchange, "s1");
    makeUser(exchange, "s2");
    for (let i = 0; i < 4; i++) {
      exchange.placeOrder(sign("s1", market, "t:no", "BUY", 40, 5));
      exchange.placeOrder(sign("s2", market, "t:yes", "BUY", 60, 5));
    }
    const events = exchange.runRiskScan();
    expect(
      events.some(
        (e) =>
          e.kind === "CORRELATED_ACCOUNTS" &&
          e.subjectIds.includes("s1") &&
          e.subjectIds.includes("s2"),
      ),
    ).toBe(true);
  });
});

describe("AC-011 — jurisdicción restringida bloqueada", () => {
  it("bloquea usuarios de jurisdicciones no permitidas antes del matching", () => {
    const market = draftMarket(exchange);
    exchange.approveMarket(market.id, ADMIN_ACTOR);
    exchange.openMarket(market.id, ADMIN_ACTOR);
    const blocked = makeUser(exchange, "us_user", { jurisdiction: "US" });
    expect(marketEligibility({ user: blocked, market })).toBe("BLOCKED");
    expect(() => exchange.placeOrder(sign("us_user", market, "t:yes", "BUY", 50, 1))).toThrow(
      /BLOCKED/,
    );
    const unverified = makeUser(exchange, "sin_kyc", { kycVerified: false });
    expect(marketEligibility({ user: unverified, market })).toBe("RESTRICTED");
  });
});

describe("AC-012 — auditoría inmutable", () => {
  it("cada acción administrativa genera un AuditEvent encadenado y verificable", () => {
    const market = draftMarket(exchange);
    exchange.approveMarket(market.id, ADMIN_ACTOR);
    exchange.openMarket(market.id, ADMIN_ACTOR);
    const events = exchange.audit.all();
    expect(events.map((e) => e.action)).toEqual([
      "MARKET_CREATED",
      "MARKET_APPROVED",
      "MARKET_OPENED",
    ]);
    expect(exchange.audit.verifyChain()).toBe(true);
    // La manipulación de un evento rompe la cadena.
    (events[1] as { detail: string }).detail = "alterado";
    expect(exchange.audit.verifyChain()).toBe(false);
  });
});

describe("AC-013 — emergency pause", () => {
  it("bloquea nuevas operaciones al activarse y las restaura al despausar", () => {
    const market = draftMarket(exchange);
    exchange.approveMarket(market.id, ADMIN_ACTOR);
    exchange.openMarket(market.id, ADMIN_ACTOR);
    makeUser(exchange, "alice");

    exchange.emergencyPause(ADMIN_ACTOR, "Vulnerabilidad crítica");
    expect(market.status).toBe("PAUSED");
    expect(() => exchange.placeOrder(sign("alice", market, "t:yes", "BUY", 50, 1))).toThrow(
      /pausa de emergencia/,
    );

    exchange.emergencyUnpause(ADMIN_ACTOR);
    expect(market.status).toBe("OPEN");
    makeUser(exchange, "bob");
    exchange.placeOrder(sign("bob", market, "t:no", "BUY", 50, 1));
    expect(() => exchange.placeOrder(sign("alice", market, "t:yes", "BUY", 50, 1))).not.toThrow();
  });
});

describe("Motor de matching — economía de MINT y TRANSFER", () => {
  it("bloquea 100¢/share de colateral en un MINT y reparte payouts correctos", () => {
    const market = openTradedMarket();
    // alice pagó 60¢ × 10, bob pagó 40¢ × 10 → 1000¢ de colateral bloqueado
    expect(market.liquidity).toBe(1000);
    const alicePos = exchange.userPositions("alice")[0]!;
    expect(alicePos.quantity).toBe(10);
    expect(alicePos.costCents).toBe(600);
  });

  it("permite cerrar una posición antes de la resolución (TRANSFER) con P&L realizado", () => {
    const market = openTradedMarket();
    makeUser(exchange, "carol");
    // carol puja YES a 70¢; alice vende sus 10 YES → TRANSFER a 70¢
    exchange.placeOrder(sign("carol", market, "t:yes", "BUY", 70, 10));
    exchange.placeOrder(sign("alice", market, "t:yes", "SELL", 70, 10));
    expect(exchange.userPositions("alice").find((p) => p.outcomeId === "t:yes")!.quantity).toBe(0);
    expect(exchange.userPositions("carol").find((p) => p.outcomeId === "t:yes")!.quantity).toBe(10);
    const portfolio = exchange.portfolio("alice");
    // alice compró a 60¢ y vendió a 70¢ → P&L realizado positivo (neto de fees)
    expect(portfolio.realizedPnlCents).toBeGreaterThan(0);
  });
});

describe("Seed de demostración (Fase 1)", () => {
  it("crea mercados dominicanos abiertos con liquidez y probabilidad", () => {
    const seeded = createSeededExchange();
    const markets = [...seeded.markets.values()];
    expect(markets.length).toBeGreaterThanOrEqual(6);
    expect(markets.every((m) => m.status === "OPEN")).toBe(true);
    expect(markets.some((m) => m.resolutionClass === "ULTRA_FAST")).toBe(true);
    const withVolume = markets.filter((m) => m.volume > 0);
    expect(withVolume.length).toBeGreaterThan(0);
    expect(seeded.users.get(DEMO_USER_ID)).toBeDefined();
    expect(seeded.users.get(MAKER_USER_ID)).toBeDefined();
    expect(seeded.audit.verifyChain()).toBe(true);
  });
});
