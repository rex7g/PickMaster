"use client";

/**
 * Trading real en Base Sepolia (Fase 2): la wallet del usuario firma órdenes
 * EIP-712 (sin ceder claves); el backend las casa y el operator liquida
 * on-chain. Requiere una wallet inyectada (MetaMask, Coinbase Wallet, ...)
 * con algo de ETH de Base Sepolia para faucet/approve.
 */
import { useCallback, useEffect, useState } from "react";
import {
  createWalletClient,
  createPublicClient,
  custom,
  http,
  parseAbi,
  type Address,
  type Hex,
} from "viem";
import { ADDRESSES, DEMO_MARKET_ID, baseSepolia } from "@/lib/chain";

const erc20 = parseAbi([
  "function balanceOf(address) view returns (uint256)",
  "function allowance(address,address) view returns (uint256)",
  "function approve(address,uint256) returns (bool)",
  "function faucet(address,uint256)",
]);

const DOMAIN = {
  name: "PickMaster Exchange",
  version: "1",
  chainId: baseSepolia.id,
  verifyingContract: ADDRESSES.Exchange,
} as const;

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
} as const;

interface BookState {
  operatorConfigured: boolean;
  orders: { maker: string; outcomeIndex: number; priceCents: number; quantity: string }[];
  settlements: { txHash: string; priceCents: number; quantity: string; settledAt: number }[];
}

declare global {
  interface Window {
    ethereum?: {
      request: (args: { method: string; params?: unknown[] }) => Promise<unknown>;
    };
  }
}

export function OnchainTrade() {
  const [account, setAccount] = useState<Address | null>(null);
  const [balance, setBalance] = useState<bigint | null>(null);
  const [allowance, setAllowance] = useState<bigint | null>(null);
  const [bookState, setBook] = useState<BookState | null>(null);
  const [outcome, setOutcome] = useState<0 | 1>(0);
  const [price, setPrice] = useState(60);
  const [qty, setQty] = useState(10);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [busy, setBusy] = useState(false);

  const readClient = createPublicClient({ chain: baseSepolia, transport: http() });

  const refresh = useCallback(async (addr: Address | null) => {
    const res = await fetch(`/api/onchain/orders?marketId=${DEMO_MARKET_ID}`);
    setBook(await res.json());
    if (addr) {
      const [bal, allo] = await Promise.all([
        readClient.readContract({ address: ADDRESSES.MockUSDC, abi: erc20, functionName: "balanceOf", args: [addr] }),
        readClient.readContract({
          address: ADDRESSES.MockUSDC,
          abi: erc20,
          functionName: "allowance",
          args: [addr, ADDRESSES.Exchange],
        }),
      ]);
      setBalance(bal);
      setAllowance(allo);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    refresh(account);
  }, [account, refresh]);

  const walletClient = () => {
    if (!window.ethereum) throw new Error("No hay wallet inyectada (instala MetaMask o Coinbase Wallet).");
    return createWalletClient({ chain: baseSepolia, transport: custom(window.ethereum) });
  };

  const connect = async () => {
    try {
      setBusy(true);
      const wallet = walletClient();
      const [addr] = await wallet.requestAddresses();
      try {
        await wallet.switchChain({ id: baseSepolia.id });
      } catch {
        await wallet.addChain({ chain: baseSepolia });
      }
      setAccount(addr ?? null);
      setMsg(null);
    } catch (e) {
      setMsg({ ok: false, text: e instanceof Error ? e.message : "Error al conectar." });
    } finally {
      setBusy(false);
    }
  };

  const write = async (
    fn: "faucet" | "approve",
    args: readonly unknown[],
    label: string,
  ) => {
    if (!account) return;
    try {
      setBusy(true);
      const hash = await walletClient().writeContract({
        address: ADDRESSES.MockUSDC,
        abi: erc20,
        functionName: fn,
        args: args as never,
        account,
      });
      await readClient.waitForTransactionReceipt({ hash });
      setMsg({ ok: true, text: `${label} confirmado (${hash.slice(0, 14)}…).` });
      await refresh(account);
    } catch (e) {
      setMsg({ ok: false, text: e instanceof Error ? e.message.slice(0, 200) : "Error." });
    } finally {
      setBusy(false);
    }
  };

  const placeOrder = async () => {
    if (!account) return;
    try {
      setBusy(true);
      const order = {
        maker: account,
        marketId: DEMO_MARKET_ID as Hex,
        outcomeIndex: outcome,
        isBuy: true,
        priceCents: price,
        quantity: String(qty),
        expiry: String(Math.floor(Date.now() / 1000) + 86400),
        salt: String(Date.now()) + String(Math.floor(Math.random() * 1e9)),
      };
      const signature = await walletClient().signTypedData({
        account,
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
      const res = await fetch("/api/onchain/orders", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...order, signature }),
      });
      const data = await res.json();
      if (!res.ok) setMsg({ ok: false, text: data.error ?? "Orden rechazada." });
      else if (data.status === "settled")
        setMsg({ ok: true, text: `¡Liquidada on-chain! tx ${data.txHash.slice(0, 14)}…` });
      else setMsg({ ok: true, text: data.error ?? "Orden firmada y colocada en el libro." });
      await refresh(account);
    } catch (e) {
      setMsg({ ok: false, text: e instanceof Error ? e.message.slice(0, 200) : "Error." });
    } finally {
      setBusy(false);
    }
  };

  const usd = (v: bigint | null) => (v === null ? "—" : `$${(Number(v) / 1e6).toFixed(2)}`);

  return (
    <div className="rounded-xl border border-slate-800 bg-slate-900/60 p-5">
      <h2 className="font-semibold text-white mb-1">Operar con tu wallet (Base Sepolia)</h2>
      <p className="text-xs text-slate-500 mb-4">
        Firmas una orden EIP-712 con tu wallet; el matcher la cruza y el operator la
        liquida en el Exchange real. Necesitas ETH de testnet para faucet/approve.
      </p>

      {!account ? (
        <button
          onClick={connect}
          disabled={busy}
          className="rounded-lg bg-emerald-500 px-4 py-2 text-sm font-semibold text-slate-950 hover:bg-emerald-400 disabled:opacity-40"
        >
          Conectar wallet
        </button>
      ) : (
        <>
          <div className="text-xs text-slate-400 mb-3 font-mono">{account}</div>
          <div className="flex gap-4 text-sm mb-4">
            <span>tUSDC: <strong className="text-white">{usd(balance)}</strong></span>
            <span>Allowance: <strong className="text-white">{allowance !== null && allowance > 10n ** 30n ? "∞" : usd(allowance)}</strong></span>
          </div>
          <div className="flex flex-wrap gap-2 mb-5">
            <button
              onClick={() => write("faucet", [account, 1_000_000_000n], "Faucet de 1,000 tUSDC")}
              disabled={busy}
              className="rounded-lg border border-slate-700 px-3 py-1.5 text-xs text-slate-300 hover:border-emerald-500 disabled:opacity-40"
            >
              Faucet 1,000 tUSDC
            </button>
            <button
              onClick={() => write("approve", [ADDRESSES.Exchange, 2n ** 256n - 1n], "Approve")}
              disabled={busy}
              className="rounded-lg border border-slate-700 px-3 py-1.5 text-xs text-slate-300 hover:border-emerald-500 disabled:opacity-40"
            >
              Aprobar Exchange
            </button>
          </div>

          <div className="grid grid-cols-2 gap-2 mb-3">
            {([0, 1] as const).map((o) => (
              <button
                key={o}
                onClick={() => setOutcome(o)}
                className={`rounded-lg py-2 text-sm font-semibold border ${
                  outcome === o
                    ? o === 0
                      ? "bg-emerald-500/20 border-emerald-500 text-emerald-300"
                      : "bg-rose-500/20 border-rose-500 text-rose-300"
                    : "border-slate-700 text-slate-400"
                }`}
              >
                {o === 0 ? "Comprar SÍ" : "Comprar NO"}
              </button>
            ))}
          </div>
          <label className="block text-xs text-slate-500 mb-1">Precio límite (¢)</label>
          <input
            type="number"
            min={1}
            max={99}
            value={price}
            onChange={(e) => setPrice(Math.max(1, Math.min(99, Number(e.target.value))))}
            className="w-full rounded-lg bg-slate-800 border border-slate-700 px-3 py-2 text-sm mb-3"
          />
          <label className="block text-xs text-slate-500 mb-1">Cantidad (shares)</label>
          <input
            type="number"
            min={1}
            value={qty}
            onChange={(e) => setQty(Math.max(1, Math.round(Number(e.target.value))))}
            className="w-full rounded-lg bg-slate-800 border border-slate-700 px-3 py-2 text-sm mb-4"
          />
          <button
            onClick={placeOrder}
            disabled={busy}
            className="w-full rounded-lg bg-emerald-500 py-2.5 font-semibold text-slate-950 hover:bg-emerald-400 disabled:opacity-40"
          >
            {busy ? "Firmando…" : "Firmar orden EIP-712"}
          </button>
        </>
      )}

      {msg && (
        <p className={`mt-3 text-xs ${msg.ok ? "text-emerald-400" : "text-rose-400"}`}>{msg.text}</p>
      )}

      {bookState && (
        <div className="mt-5 text-xs">
          {!bookState.operatorConfigured && (
            <p className="text-amber-400 mb-2">
              ⚠ Operator no configurado en este servidor: las órdenes se firman y
              descansan en el libro, pero no se liquidan (define OPERATOR_PRIVATE_KEY).
            </p>
          )}
          <div className="text-slate-500 mb-1">Órdenes firmadas en el libro:</div>
          {bookState.orders.length === 0 && <div className="text-slate-600">—</div>}
          {bookState.orders.map((o, i) => (
            <div key={i} className="flex justify-between border-t border-slate-800/60 py-1">
              <span className={o.outcomeIndex === 0 ? "text-emerald-400" : "text-rose-400"}>
                {o.outcomeIndex === 0 ? "SÍ" : "NO"} × {o.quantity} @ {o.priceCents}¢
              </span>
              <span className="font-mono text-slate-500">{o.maker.slice(0, 10)}…</span>
            </div>
          ))}
          {bookState.settlements.length > 0 && (
            <>
              <div className="text-slate-500 mt-3 mb-1">Liquidaciones on-chain:</div>
              {bookState.settlements.map((s, i) => (
                <div key={i} className="flex justify-between border-t border-slate-800/60 py-1">
                  <span className="text-slate-300">{s.quantity} shares @ {s.priceCents}¢</span>
                  <a
                    href={`https://sepolia.basescan.org/tx/${s.txHash}`}
                    target="_blank"
                    rel="noreferrer"
                    className="text-emerald-400 hover:underline font-mono"
                  >
                    {s.txHash.slice(0, 12)}…
                  </a>
                </div>
              ))}
            </>
          )}
        </div>
      )}
    </div>
  );
}
