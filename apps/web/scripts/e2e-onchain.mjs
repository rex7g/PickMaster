/**
 * E2E del pipeline on-chain (Fase 2): firma órdenes EIP-712 como dos wallets
 * de prueba (igual que lo haría el navegador) y las envía a la API local;
 * el matcher del backend debe cruzarlas y el operator liquidarlas en el
 * Exchange real de Base Sepolia.
 *
 * Uso:
 *   OPERATOR_PRIVATE_KEY=0x... npm run start  (o next dev)
 *   ALICE_PK=0x... BOB_PK=0x... node scripts/e2e-onchain.mjs [baseUrl]
 */
import { createWalletClient, createPublicClient, http, parseAbi } from "viem";
import { privateKeyToAccount } from "viem/accounts";

const BASE_URL = process.argv[2] ?? "http://localhost:3000";
const RPC = "https://sepolia.base.org";
const EXCHANGE = "0xB4bc699e2D26Dd586ed7Ec15abaaAed9A883BBBe";
const POSITIONS = "0xB70655a2c6b1d31564A035b616238Ef4c6396a94";
const MARKET_ID = "0xe78ba17c3b29e1e167eb5188552fb72f7989457f34775bda655f51c2cdad3449";

const DOMAIN = { name: "PickMaster Exchange", version: "1", chainId: 84532, verifyingContract: EXCHANGE };
const TYPES = {
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
};

async function signAndPost(pk, outcomeIndex, priceCents, quantity) {
  const account = privateKeyToAccount(pk);
  const wallet = createWalletClient({ account, transport: http(RPC) });
  const order = {
    maker: account.address,
    marketId: MARKET_ID,
    outcomeIndex,
    isBuy: true,
    priceCents,
    quantity: String(quantity),
    expiry: String(Math.floor(Date.now() / 1000) + 3600),
    salt: String(Date.now()) + String(outcomeIndex),
  };
  const signature = await wallet.signTypedData({
    domain: DOMAIN,
    types: TYPES,
    primaryType: "Order",
    message: {
      ...order,
      priceCents: BigInt(order.priceCents),
      quantity: BigInt(order.quantity),
      expiry: BigInt(order.expiry),
      salt: BigInt(order.salt),
    },
  });
  const res = await fetch(`${BASE_URL}/api/onchain/orders`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ ...order, signature }),
  });
  const data = await res.json();
  console.log(`orden ${outcomeIndex === 0 ? "YES" : "NO"} @${priceCents}¢ →`, data);
  return { data, address: account.address };
}

const alicePk = process.env.ALICE_PK;
const bobPk = process.env.BOB_PK;
if (!alicePk || !bobPk) throw new Error("Define ALICE_PK y BOB_PK");

// bob puja NO a 40¢ (descansa), alice compra YES a 60¢ (cruza → MINT on-chain)
const bob = await signAndPost(bobPk, 1, 40, 5);
const alice = await signAndPost(alicePk, 0, 60, 5);

if (alice.data.status !== "settled") {
  console.error("FALLO: la orden de alice no se liquidó on-chain");
  process.exit(1);
}

const client = createPublicClient({ transport: http(RPC) });
const abi = parseAbi([
  "function positionId(bytes32,uint8) pure returns (uint256)",
  "function balanceOf(address,uint256) view returns (uint256)",
]);
const yesId = await client.readContract({ address: POSITIONS, abi, functionName: "positionId", args: [MARKET_ID, 0] });
// El RPC público puede tardar unos segundos en propagar el nuevo estado.
let bal = 0n;
for (let i = 0; i < 5 && bal === 0n; i++) {
  if (i > 0) await new Promise((r) => setTimeout(r, 3000));
  bal = await client.readContract({
    address: POSITIONS,
    abi,
    functionName: "balanceOf",
    args: [alice.address, yesId],
  });
}
console.log(`shares YES on-chain de alice tras el settlement: ${bal}`);
console.log(`tx: https://sepolia.basescan.org/tx/${alice.data.txHash}`);
if (bal < 5n) process.exit(1);
console.log("E2E OK: orden firmada por wallet → matcher → settlement real en Base Sepolia ✅");
