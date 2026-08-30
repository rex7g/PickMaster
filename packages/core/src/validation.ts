/**
 * Market Validation Engine (§10) and ResolutionClass rules (§8).
 *
 * A market may only move from DRAFT toward APPROVED when every check passes
 * (AC-001). ULTRA_FAST (5-minute) markets are rejected when no source can
 * report within the market's resolution window (AC-002).
 */
import type { Market, ResolutionClass, ResolutionSource } from "./types";

export const MIN_RESOLUTION_WINDOW_MS = 5 * 60_000; // protocol floor: 5 minutes (§8)

export const RESOLUTION_CLASS_BOUNDS: Record<
  ResolutionClass,
  { minMs: number; maxMs: number }
> = {
  ULTRA_FAST: { minMs: 5 * 60_000, maxMs: 15 * 60_000 },
  FAST: { minMs: 15 * 60_000, maxMs: 60 * 60_000 },
  STANDARD: { minMs: 60 * 60_000, maxMs: 7 * 24 * 60 * 60_000 },
  LONG_TERM: { minMs: 7 * 24 * 60 * 60_000, maxMs: Number.MAX_SAFE_INTEGER },
};

/** Minimum SourceReliabilityScore required per resolution class. */
const MIN_RELIABILITY: Record<ResolutionClass, number> = {
  ULTRA_FAST: 0.9,
  FAST: 0.8,
  STANDARD: 0.7,
  LONG_TERM: 0.6,
};

export interface ValidationIssue {
  code: string;
  message: string;
}

export interface ValidationResult {
  valid: boolean;
  issues: ValidationIssue[];
}

/** Words that make a question ambiguous without an objective metric (§10). */
const AMBIGUOUS_TERMS = [
  "probablemente",
  "casi",
  "aproximadamente",
  "mucho",
  "poco",
  "mejor",
  "peor",
  "bueno",
  "malo",
  "exitoso",
  "popular",
];

export function classifyResolutionWindow(windowMs: number): ResolutionClass {
  if (windowMs < RESOLUTION_CLASS_BOUNDS.ULTRA_FAST.maxMs) return "ULTRA_FAST";
  if (windowMs < RESOLUTION_CLASS_BOUNDS.FAST.maxMs) return "FAST";
  if (windowMs <= RESOLUTION_CLASS_BOUNDS.STANDARD.maxMs) return "STANDARD";
  return "LONG_TERM";
}

function sourceSupportsWindow(source: ResolutionSource, windowMs: number): boolean {
  return source.latencyMs <= windowMs;
}

export function validateMarket(market: Market): ValidationResult {
  const issues: ValidationIssue[] = [];

  // Question (§10 — ambiguity)
  if (!market.title || market.title.trim().length < 10 || !market.title.includes("?")) {
    issues.push({
      code: "QUESTION",
      message: "El título debe ser una pregunta objetiva y completa.",
    });
  }
  const lowered = market.title.toLowerCase();
  const ambiguous = AMBIGUOUS_TERMS.filter((t) => lowered.includes(t));
  if (ambiguous.length > 0) {
    issues.push({
      code: "AMBIGUITY",
      message: `La pregunta contiene términos ambiguos sin métrica objetiva: ${ambiguous.join(", ")}.`,
    });
  }

  // Outcomes (§10 — result must map to YES/NO/OUTCOME_x)
  if (market.outcomes.length < 2) {
    issues.push({ code: "OUTCOMES", message: "Se requieren al menos dos outcomes." });
  }
  const codes = new Set(market.outcomes.map((o) => o.code));
  if (codes.size !== market.outcomes.length) {
    issues.push({ code: "OUTCOMES_DUP", message: "Outcomes duplicados." });
  }
  if (market.type === "BINARY" && (!codes.has("YES") || !codes.has("NO"))) {
    issues.push({
      code: "BINARY_OUTCOMES",
      message: "Un mercado binario requiere outcomes YES y NO.",
    });
  }

  // Dates (§10 — deadline)
  if (!(market.openTime < market.closeTime && market.closeTime <= market.resolutionTime)) {
    issues.push({
      code: "DATES",
      message: "Se requiere openTime < closeTime <= resolutionTime.",
    });
  }

  // Resolution window floor (§8)
  if (market.resolutionWindowMs < MIN_RESOLUTION_WINDOW_MS) {
    issues.push({
      code: "WINDOW_FLOOR",
      message: "La ventana mínima de resolución del protocolo es 5 minutos.",
    });
  }
  const expectedClass = classifyResolutionWindow(market.resolutionWindowMs);
  if (market.resolutionClass !== expectedClass) {
    issues.push({
      code: "CLASS_MISMATCH",
      message: `La ventana corresponde a ${expectedClass}, no a ${market.resolutionClass}.`,
    });
  }

  // Sources (§10, AC-002): at least one source, and for the window class,
  // a source whose latency fits inside the market's resolution window.
  if (market.resolutionSources.length === 0) {
    issues.push({
      code: "SOURCE_MISSING",
      message: "Debe existir al menos una fuente primaria de resolución.",
    });
  } else {
    const compatible = market.resolutionSources.filter(
      (s) =>
        sourceSupportsWindow(s, market.resolutionWindowMs) &&
        s.reliabilityScore >= MIN_RELIABILITY[market.resolutionClass],
    );
    if (compatible.length === 0) {
      issues.push({
        code: "SOURCE_LATENCY",
        message:
          "Ninguna fuente tiene latencia y confiabilidad compatibles con la ventana de resolución del mercado.",
      });
    }
    if (market.resolutionClass === "ULTRA_FAST" && compatible.length < 1) {
      issues.push({
        code: "ULTRA_FAST_SOURCE",
        message:
          "ULTRA_FAST requiere una fuente de alta frecuencia y baja ambigüedad.",
      });
    }
  }

  // Resolution rule (§10)
  if (!market.resolutionRule || market.resolutionRule.trim().length < 20) {
    issues.push({
      code: "RESOLUTION_RULE",
      message: "La regla de resolución debe estar definida explícitamente.",
    });
  }

  // Oracle
  if (!market.oracleId) {
    issues.push({ code: "ORACLE", message: "El mercado debe tener un oráculo asignado." });
  }
  if (market.disputePeriodMs <= 0) {
    issues.push({
      code: "DISPUTE_PERIOD",
      message: "El mercado debe definir una ventana de disputa.",
    });
  }

  return { valid: issues.length === 0, issues };
}
