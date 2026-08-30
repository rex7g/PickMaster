import { NextResponse } from "next/server";
import { DEMO_USER_ID, signOrder } from "@pickmaster/core";
import { getExchange } from "@/lib/store";

/**
 * Simulated trading endpoint for the demo user. In Phase 2 the client's
 * wallet signs an EIP-712 order and the backend only verifies + matches;
 * here the server produces the mock signature on the user's behalf.
 */
export async function POST(request: Request) {
  const exchange = getExchange();
  try {
    const body = await request.json();
    const { marketId, outcomeId, side, priceCents, quantity } = body ?? {};
    if (
      typeof marketId !== "string" ||
      typeof outcomeId !== "string" ||
      (side !== "BUY" && side !== "SELL") ||
      !Number.isInteger(priceCents) ||
      !Number.isInteger(quantity)
    ) {
      return NextResponse.json({ error: "Payload inválido." }, { status: 400 });
    }
    const signature = signOrder(DEMO_USER_ID, marketId, outcomeId, side, priceCents, quantity);
    const { order, trades } = exchange.placeOrder({
      userId: DEMO_USER_ID,
      marketId,
      outcomeId,
      side,
      priceCents,
      quantity,
      signature,
    });
    return NextResponse.json({
      orderId: order.id,
      status: order.status,
      filled: order.filledQuantity,
      trades: trades.length,
    });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Error interno." },
      { status: 422 },
    );
  }
}
