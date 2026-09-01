/**
 * Blockchain Indexer (§26, versión Fase 2): lee los eventos reales del
 * protocolo en Base Sepolia y los acumula en caché.
 *
 * El RPC público limita `eth_getLogs` a ~10k bloques por llamada, así que el
 * escaneo va por tramos y guarda un cursor: el primer arranque recorre desde
 * el bloque de despliegue hasta la cabeza y cada refresco sólo pide el tramo
 * nuevo. La versión de producción (Fase 3) es un servicio dedicado con
 * reorg detection, confirmaciones y RPC failover escribiendo a
 * PostgreSQL/ClickHouse.
 */
import { parseAbiItem, type Hex } from "viem";
import { ADDRESSES, publicClient } from "./chain";

export interface IndexedMint {
  txHash: Hex;
  blockNumber: string;
  marketId: Hex;
  yesBuyer: string;
  noBuyer: string;
  yesPriceCents: number;
  quantity: string;
}

export interface IndexedStateChange {
  txHash: Hex;
  blockNumber: string;
  marketId: Hex;
  state: number;
  winningOutcome: number;
}

const mintEvent = parseAbiItem(
  "event MintSettled(bytes32 indexed marketId, address yesBuyer, address noBuyer, uint64 yesPriceCents, uint128 quantity)",
);
const stateEvent = parseAbiItem(
  "event MarketStateChanged(bytes32 indexed marketId, uint8 state, uint8 winningOutcome)",
);

/** Bloque del despliegue del protocolo (2026-09-01). */
const DEPLOY_BLOCK = 46178700n;
/** Límite del RPC público por llamada. */
const CHUNK = 9_000n;
/** Tramos por refresco: acota la latencia del render inicial. */
const MAX_CHUNKS_PER_PASS = 10;
const TTL_MS = 30_000;

export interface IndexerState {
  /** Último bloque ya escaneado. */
  cursor: bigint;
  head: bigint;
  mints: IndexedMint[];
  stateChanges: IndexedStateChange[];
  lastRun: number;
  /** false mientras el cursor no ha alcanzado la cabeza. */
  synced: boolean;
}

const globalIdx = globalThis as unknown as { __pickmasterIndexer?: IndexerState };

function state(): IndexerState {
  if (!globalIdx.__pickmasterIndexer) {
    globalIdx.__pickmasterIndexer = {
      cursor: DEPLOY_BLOCK,
      head: DEPLOY_BLOCK,
      mints: [],
      stateChanges: [],
      lastRun: 0,
      synced: false,
    };
  }
  return globalIdx.__pickmasterIndexer;
}

export async function indexProtocolEvents(): Promise<IndexerState> {
  const s = state();
  if (s.synced && Date.now() - s.lastRun < TTL_MS) return s;

  const client = publicClient();
  s.head = await client.getBlockNumber();

  let chunks = 0;
  while (s.cursor < s.head && chunks < MAX_CHUNKS_PER_PASS) {
    const from = s.cursor + 1n;
    const to = from + CHUNK > s.head ? s.head : from + CHUNK;
    const [mintLogs, stateLogs] = await Promise.all([
      client.getLogs({ address: ADDRESSES.Exchange, event: mintEvent, fromBlock: from, toBlock: to }),
      client.getLogs({ address: ADDRESSES.MarketRegistry, event: stateEvent, fromBlock: from, toBlock: to }),
    ]);

    for (const l of mintLogs) {
      s.mints.push({
        txHash: l.transactionHash,
        blockNumber: String(l.blockNumber),
        marketId: l.args.marketId as Hex,
        yesBuyer: l.args.yesBuyer as string,
        noBuyer: l.args.noBuyer as string,
        yesPriceCents: Number(l.args.yesPriceCents),
        quantity: String(l.args.quantity),
      });
    }
    for (const l of stateLogs) {
      s.stateChanges.push({
        txHash: l.transactionHash,
        blockNumber: String(l.blockNumber),
        marketId: l.args.marketId as Hex,
        state: Number(l.args.state),
        winningOutcome: Number(l.args.winningOutcome),
      });
    }

    s.cursor = to;
    chunks++;
  }

  s.synced = s.cursor >= s.head;
  s.lastRun = Date.now();
  return s;
}
