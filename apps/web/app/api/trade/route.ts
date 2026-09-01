import { NextResponse } from "next/server";
import { signOrder } from "@pickmaster/core";
import { getExchange } from "@/lib/store";
import { recordPrice } from "@/lib/history";
import { getSessionUserId } from "@/lib/auth";

/**
 * Simulated trading endpoint for the demo user. In Phase 2 the client's
 * wallet signs an EIP-712 order and the backend only verifies + matches;
 * here the server produces the mock signature on the user's behalf.
 */
export async function POST(request: Request) {
  const exchange = getExchange();
  try {
    // Con sesión activa opera la cuenta del usuario; sin sesión, la demo.
    const sessionUser = await getSessionUserId();
    const userId = sessionUser ?? "user_demo";
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
    const signature = signOrder(userId, marketId, outcomeId, side, priceCents, quantity);
    const { order, trades } = exchange.placeOrder({
      userId,
      marketId,
      outcomeId,
      side,
      priceCents,
      quantity,
      signature,
    });
    if (trades.length > 0) recordPrice(exchange, marketId);
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
