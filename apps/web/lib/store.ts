/**
 * Phase 1 in-memory backend: a single seeded Exchange instance shared by
 * pages and API routes. Kept on globalThis so dev-mode HMR doesn't reset it.
 * Phase 2 replaces this with the .NET modular monolith + PostgreSQL (PLAN.md).
 */
import { createSeededExchange, type Exchange } from "@pickmaster/core";

const globalStore = globalThis as unknown as { __pickmaster?: Exchange };

export function getExchange(): Exchange {
  if (!globalStore.__pickmaster) {
    globalStore.__pickmaster = createSeededExchange();
  }
  return globalStore.__pickmaster;
}

export function formatUsd(cents: number): string {
  return `$${(cents / 100).toLocaleString("en-US", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;
}

export function formatCents(cents: number | null): string {
  if (cents === null) return "—";
  return `${Math.round(cents)}¢`;
}

export function formatPct(p: number | null): string {
  if (p === null) return "—";
  return `${Math.round(p * 100)}%`;
}
