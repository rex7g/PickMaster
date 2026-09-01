import { NextResponse } from "next/server";
import {
  listOrders,
  listSettlements,
  operatorConfigured,
  submitOrder,
  type SignedOrder,
} from "@/lib/onchain";
import { DEMO_MARKET_ID } from "@/lib/chain";

/** Libro on-chain: órdenes EIP-712 firmadas por wallets reales (Fase 2). */
export async function GET(request: Request) {
  const url = new URL(request.url);
  const marketId = url.searchParams.get("marketId") ?? DEMO_MARKET_ID;
  return NextResponse.json({
    operatorConfigured: operatorConfigured(),
    orders: listOrders(marketId).map((o) => ({
      maker: o.maker,
      outcomeIndex: o.outcomeIndex,
      priceCents: o.priceCents,
      quantity: o.quantity,
    })),
    settlements: listSettlements(marketId),
  });
}

export async function POST(request: Request) {
  let body: SignedOrder;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "JSON inválido." }, { status: 400 });
  }
  const required = [
    "maker",
    "marketId",
    "outcomeIndex",
    "isBuy",
    "priceCents",
    "quantity",
    "expiry",
    "salt",
    "signature",
  ] as const;
  for (const field of required) {
    if (body[field] === undefined || body[field] === null) {
      return NextResponse.json({ error: `Falta el campo ${field}.` }, { status: 400 });
    }
  }
  const result = await submitOrder(body);
  const status = result.status === "rejected" || result.status === "failed" ? 422 : 200;
  return NextResponse.json(result, { status });
}
