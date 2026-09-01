/**
 * Fase 2 — pipeline de trading on-chain (§16):
 *   wallet del usuario firma la orden EIP-712 en el navegador
 *     → este módulo (backend) verifica la firma y la coloca en el libro
 *     → el matcher cruza órdenes complementarias
 *     → el relayer OPERATOR liquida el match on-chain (settleMint/Transfer).
 *
 * El libro vive en memoria (prototipo); en Fase 3 pasa a Redis/PostgreSQL.
 * El backend NUNCA custodia claves de usuarios: sólo la clave del operator
 * (rol de relayer sin acceso a fondos de usuarios) vía OPERATOR_PRIVATE_KEY.
 */
import {
  createWalletClient,
  http,
  verifyTypedData,
  type Address,
  type Hex,
} from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { ADDRESSES, baseSepolia, publicClient } from "./chain";

export interface SignedOrder {
  maker: Address;
  marketId: Hex;
  outcomeIndex: number; // 0 YES, 1 NO
  isBuy: boolean;
  priceCents: number;
  quantity: string; // uint128 as decimal string
  expiry: string; // unix seconds as string
  salt: string; // uint256 as decimal string
  signature: Hex;
}

export interface OnchainSettlement {
  kind: "MINT" | "TRANSFER";
  txHash: Hex;
  marketId: Hex;
  priceCents: number;
  quantity: string;
  makers: [Address, Address];
  settledAt: number;
}

export const EIP712_DOMAIN = {
  name: "PickMaster Exchange",
  version: "1",
  chainId: baseSepolia.id,
  verifyingContract: ADDRESSES.Exchange,
} as const;

export const ORDER_TYPES = {
  Order: [
    { name: "maker", type: "address" },
    { name: "marketId", type: "bytes32" },
    { name: "outcomeIndex", type: "uint8" },
    { name: "isBuy", type: "bool" },
    { name: "priceCents", type: "uint64" },
    { name: "quantity", type: "uint128" },
    { name: "expiry", type: "uint64" },
    { name: "salt", type: "uint256" },
  ],
} as const;

const settleAbi = [
  {
    type: "function",
    name: "settleMint",
    stateMutability: "nonpayable",
    inputs: [
      { name: "buyYes", type: "tuple", components: orderComponents() },
      { name: "yesSig", type: "bytes" },
      { name: "buyNo", type: "tuple", components: orderComponents() },
      { name: "noSig", type: "bytes" },
      { name: "quantity", type: "uint128" },
      { name: "yesPriceCents", type: "uint64" },
    ],
    outputs: [],
  },
  {
    type: "function",
    name: "settleTransfer",
    stateMutability: "nonpayable",
    inputs: [
      { name: "buy", type: "tuple", components: orderComponents() },
      { name: "buySig", type: "bytes" },
      { name: "sell", type: "tuple", components: orderComponents() },
      { name: "sellSig", type: "bytes" },
      { name: "quantity", type: "uint128" },
      { name: "priceCents", type: "uint64" },
    ],
    outputs: [],
  },
] as const;

function orderComponents() {
  return [
    { name: "maker", type: "address" },
    { name: "marketId", type: "bytes32" },
    { name: "outcomeIndex", type: "uint8" },
    { name: "isBuy", type: "bool" },
    { name: "priceCents", type: "uint64" },
    { name: "quantity", type: "uint128" },
    { name: "expiry", type: "uint64" },
    { name: "salt", type: "uint256" },
  ] as const;
}

interface OnchainBook {
  orders: SignedOrder[];
  settlements: OnchainSettlement[];
}

const globalBook = globalThis as unknown as { __pickmasterOnchain?: OnchainBook };

function book(): OnchainBook {
  if (!globalBook.__pickmasterOnchain) {
    globalBook.__pickmasterOnchain = { orders: [], settlements: [] };
  }
  return globalBook.__pickmasterOnchain;
}

export function operatorConfigured(): boolean {
  return Boolean(process.env.OPERATOR_PRIVATE_KEY);
}

function toTuple(o: SignedOrder) {
  return {
    maker: o.maker,
    marketId: o.marketId,
    outcomeIndex: o.outcomeIndex,
    isBuy: o.isBuy,
    priceCents: BigInt(o.priceCents),
    quantity: BigInt(o.quantity),
    expiry: BigInt(o.expiry),
    salt: BigInt(o.salt),
  };
}

export async function verifyOrderSignature(order: SignedOrder): Promise<boolean> {
  return verifyTypedData({
    address: order.maker,
    domain: EIP712_DOMAIN,
    types: ORDER_TYPES,
    primaryType: "Order",
    message: {
      maker: order.maker,
      marketId: order.marketId,
      outcomeIndex: order.outcomeIndex,
      isBuy: order.isBuy,
      priceCents: BigInt(order.priceCents),
      quantity: BigInt(order.quantity),
      expiry: BigInt(order.expiry),
      salt: BigInt(order.salt),
    },
    signature: order.signature,
  });
}

export function listOrders(marketId: string): SignedOrder[] {
  return book().orders.filter((o) => o.marketId === marketId);
}

export function listSettlements(marketId: string): OnchainSettlement[] {
  return book().settlements.filter((s) => s.marketId === marketId);
}

/**
 * Valida la firma, coloca la orden y ejecuta el matching. Sólo órdenes BUY
 * en el prototipo on-chain: BUY YES × BUY NO cruza vía settleMint cuando
 * p_yes + p_no >= 100 (precio de ejecución = precio implícito del maker).
 */
export async function submitOrder(
  order: SignedOrder,
): Promise<{ status: string; txHash?: Hex; error?: string }> {
  const valid = await verifyOrderSignature(order).catch(() => false);
  if (!valid) return { status: "rejected", error: "Firma EIP-712 inválida." };
  if (order.priceCents < 1 || order.priceCents > 99) {
    return { status: "rejected", error: "Precio fuera de rango (1–99¢)." };
  }
  if (!order.isBuy) {
    return { status: "rejected", error: "El prototipo on-chain sólo acepta órdenes BUY (MINT)." };
  }

  const b = book();
  const complementIndex = order.outcomeIndex === 0 ? 1 : 0;
  const matchIdx = b.orders.findIndex(
    (resting) =>
      resting.marketId === order.marketId &&
      resting.outcomeIndex === complementIndex &&
      resting.isBuy &&
      resting.maker.toLowerCase() !== order.maker.toLowerCase() &&
      resting.priceCents + order.priceCents >= 100,
  );

  if (matchIdx === -1) {
    b.orders.push(order);
    return { status: "resting" };
  }

  if (!operatorConfigured()) {
    b.orders.push(order);
    return {
      status: "resting",
      error: "Match encontrado pero OPERATOR_PRIVATE_KEY no está configurado; la orden queda en el libro.",
    };
  }

  const resting = b.orders[matchIdx]!;
  const buyYes = order.outcomeIndex === 0 ? order : resting;
  const buyNo = order.outcomeIndex === 0 ? resting : order;
  // Precio de ejecución: el implícito del maker (price improvement al taker).
  const yesPriceCents =
    order.outcomeIndex === 0 ? 100 - resting.priceCents : buyYes.priceCents;
  const quantity =
    BigInt(order.quantity) < BigInt(resting.quantity)
      ? BigInt(order.quantity)
      : BigInt(resting.quantity);

  const account = privateKeyToAccount(process.env.OPERATOR_PRIVATE_KEY as Hex);
  const wallet = createWalletClient({ account, chain: baseSepolia, transport: http() });

  try {
    const txHash = await wallet.writeContract({
      address: ADDRESSES.Exchange,
      abi: settleAbi,
      functionName: "settleMint",
      args: [
        toTuple(buyYes),
        buyYes.signature,
        toTuple(buyNo),
        buyNo.signature,
        quantity,
        BigInt(yesPriceCents),
      ],
    });
    await publicClient().waitForTransactionReceipt({ hash: txHash });

    // Bookkeeping: retira la resting si quedó llena; el remainder del taker
    // no se re-encola en el prototipo (una orden = un intento de cruce).
    if (BigInt(resting.quantity) <= quantity) b.orders.splice(matchIdx, 1);
    else resting.quantity = (BigInt(resting.quantity) - quantity).toString();

    const settlement: OnchainSettlement = {
      kind: "MINT",
      txHash,
      marketId: order.marketId,
      priceCents: yesPriceCents,
      quantity: quantity.toString(),
      makers: [buyYes.maker, buyNo.maker],
      settledAt: Date.now(),
    };
    b.settlements.push(settlement);
    return { status: "settled", txHash };
  } catch (err) {
    return {
      status: "failed",
      error: err instanceof Error ? err.message.slice(0, 300) : "settlement failed",
    };
  }
}
