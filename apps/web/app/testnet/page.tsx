import {
  ADDRESSES,
  DEMO_MARKET_ID,
  MARKET_STATES,
  erc20Abi,
  exchangeAbi,
  publicClient,
  registryAbi,
  vaultAbi,
} from "@/lib/chain";

export const dynamic = "force-dynamic";
export const revalidate = 0;

const EXPLORER = "https://sepolia.basescan.org/address/";

async function readChain() {
  const client = publicClient();
  const [market, paused, locked, usdcSupply, feeBps, block] = await Promise.all([
    client.readContract({
      address: ADDRESSES.MarketRegistry,
      abi: registryAbi,
      functionName: "market",
      args: [DEMO_MARKET_ID],
    }),
    client.readContract({
      address: ADDRESSES.MarketRegistry,
      abi: registryAbi,
      functionName: "paused",
    }),
    client.readContract({
      address: ADDRESSES.CollateralVault,
      abi: vaultAbi,
      functionName: "lockedCollateral",
      args: [DEMO_MARKET_ID],
    }),
    client.readContract({
      address: ADDRESSES.MockUSDC,
      abi: erc20Abi,
      functionName: "totalSupply",
    }),
    client.readContract({
      address: ADDRESSES.Exchange,
      abi: exchangeAbi,
      functionName: "feeBps",
    }),
    client.getBlock(),
  ]);
  return { market, paused, locked, usdcSupply, feeBps, block };
}

export default async function TestnetPage() {
  let data: Awaited<ReturnType<typeof readChain>> | null = null;
  let error: string | null = null;
  try {
    data = await readChain();
  } catch (e) {
    error = e instanceof Error ? e.message : "Error leyendo la cadena.";
  }

  return (
    <div>
      <h1 className="text-2xl font-bold text-white mb-2">Testnet — Base Sepolia (en vivo)</h1>
      <p className="text-sm text-slate-400 mb-6 max-w-2xl">
        Lectura directa de los contratos del protocolo desplegados en Base Sepolia
        (chain 84532) vía el RPC público. Código fuente verificado en el explorador.
      </p>

      {error && (
        <div className="rounded-lg border border-rose-500/40 bg-rose-500/10 p-4 text-sm text-rose-300 mb-6">
          No se pudo leer la cadena: {error}
        </div>
      )}

      {data && (
        <>
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-8">
            {(
              [
                ["Bloque actual", String(data.block.number)],
                ["Plataforma", data.paused ? "⏸ PAUSADA" : "▶ Operativa"],
                ["tUSDC emitido", `$${(Number(data.usdcSupply) / 1e6).toLocaleString("en-US")}`],
                ["Fee del Exchange", `${Number(data.feeBps) / 100}%`],
              ] as const
            ).map(([label, value]) => (
              <div key={label} className="rounded-xl border border-slate-800 bg-slate-900/60 p-4">
                <div className="text-xs text-slate-500">{label}</div>
                <div className="text-lg font-bold text-white">{value}</div>
              </div>
            ))}
          </div>

          <section className="rounded-xl border border-slate-800 bg-slate-900/40 p-5 mb-8 text-sm">
            <h2 className="font-semibold text-white mb-3">
              Mercado on-chain: ¿USD/DOP &gt; 64.00 al 31/12/2026?
            </h2>
            <dl className="grid sm:grid-cols-2 gap-2 text-slate-300">
              <div>
                <dt className="text-slate-500 inline">Estado: </dt>
                <dd className="inline font-semibold text-emerald-400">
                  {MARKET_STATES[data.market.state] ?? data.market.state}
                </dd>
              </div>
              <div>
                <dt className="text-slate-500 inline">Colateral bloqueado: </dt>
                <dd className="inline">${(Number(data.locked) / 1e6).toFixed(2)} tUSDC</dd>
              </div>
              <div>
                <dt className="text-slate-500 inline">Cierre de trading: </dt>
                <dd className="inline">
                  {new Date(Number(data.market.closeTime) * 1000).toLocaleString("es-DO")}
                </dd>
              </div>
              <div>
                <dt className="text-slate-500 inline">Ventana de disputa: </dt>
                <dd className="inline">{Number(data.market.disputePeriod) / 3600} horas</dd>
              </div>
              <div className="sm:col-span-2">
                <dt className="text-slate-500 inline">Hash de reglas (ancla on-chain): </dt>
                <dd className="inline font-mono text-xs">{data.market.rulesHash}</dd>
              </div>
              <div className="sm:col-span-2">
                <dt className="text-slate-500 inline">Market ID: </dt>
                <dd className="inline font-mono text-xs">{DEMO_MARKET_ID}</dd>
              </div>
            </dl>
          </section>
        </>
      )}

      <h2 className="font-semibold text-white mb-3">Contratos del protocolo</h2>
      <div className="rounded-xl border border-slate-800 overflow-hidden text-sm mb-8">
        {Object.entries(ADDRESSES).map(([name, address]) => (
          <div
            key={name}
            className="flex flex-wrap justify-between gap-2 px-4 py-2 border-t border-slate-800/60 first:border-t-0"
          >
            <span className="text-slate-200">{name}</span>
            <a
              href={`${EXPLORER}${address}`}
              target="_blank"
              rel="noreferrer"
              className="font-mono text-xs text-emerald-400 hover:underline"
            >
              {address}
            </a>
          </div>
        ))}
      </div>

      <p className="text-xs text-slate-500 max-w-2xl">
        Simulacros §52 ejecutados sobre este despliegue: trades MINT con firmas
        EIP-712, resolución disputada con bond devuelto al disputador, VOID con
        reembolso 50/50 y pausa de emergencia. El trading con wallet real
        (WalletConnect + firmas EIP-712 del usuario) llega en la siguiente
        iteración de la Fase 2.
      </p>
    </div>
  );
}
