/**
 * Chain Selection Engine (§4): scoring formal para elegir la L2 de
 * operaciones. Los pesos son los del Master Prompt; las puntuaciones por
 * criterio (0–10) se alimentan de datos operativos y se revisan
 * periódicamente — el sistema permite cambiar de L2 sin reescribir el
 * dominio (ChainAdapter, §44).
 *
 * ChainScore = 20% Cost + 15% Liquidity + 15% Security + 10% Finality
 *            + 10% Oracle + 10% Stablecoin + 10% Developer
 *            + 5% Wallet + 5% Interoperability
 */

export interface ChainCriteria {
  /** 0–10 en cada criterio. */
  cost: number;
  liquidity: number;
  security: number;
  finality: number;
  oracleEcosystem: number;
  stablecoinEcosystem: number;
  developerEcosystem: number;
  walletSupport: number;
  interoperability: number;
}

export interface ChainCandidate {
  id: string;
  name: string;
  chainId: number;
  criteria: ChainCriteria;
  notes: string;
}

export const CHAIN_WEIGHTS: Record<keyof ChainCriteria, number> = {
  cost: 0.2,
  liquidity: 0.15,
  security: 0.15,
  finality: 0.1,
  oracleEcosystem: 0.1,
  stablecoinEcosystem: 0.1,
  developerEcosystem: 0.1,
  walletSupport: 0.05,
  interoperability: 0.05,
};

export function chainScore(criteria: ChainCriteria): number {
  let score = 0;
  for (const key of Object.keys(CHAIN_WEIGHTS) as (keyof ChainCriteria)[]) {
    const value = criteria[key];
    if (value < 0 || value > 10) throw new Error(`Criterio ${key} fuera de rango 0-10`);
    score += value * CHAIN_WEIGHTS[key];
  }
  return Math.round(score * 100) / 100;
}

export function rankChains(candidates: ChainCandidate[]): (ChainCandidate & { score: number })[] {
  return candidates
    .map((c) => ({ ...c, score: chainScore(c.criteria) }))
    .sort((a, b) => b.score - a.score);
}

/**
 * Evaluación 2026 de las candidatas (§4). Puntuaciones basadas en datos
 * públicos operativos: fees medianas, TVL, liquidez USDC nativa, soporte de
 * oráculos (Chainlink/Pyth), tooling y bridges canónicos. Ethereum L1 se
 * reserva para governance/treasury/anchors, no se puntúa como capa de
 * operaciones frecuentes.
 */
export const CHAIN_CANDIDATES: ChainCandidate[] = [
  {
    id: "base",
    name: "Base",
    chainId: 8453,
    criteria: {
      cost: 9,
      liquidity: 9,
      security: 8,
      finality: 8,
      oracleEcosystem: 8,
      stablecoinEcosystem: 10, // USDC nativo de Circle, emisor en la propia chain
      developerEcosystem: 9,
      walletSupport: 10, // Coinbase Wallet + smart wallet + todo el ecosistema EVM
      interoperability: 8,
    },
    notes:
      "USDC nativo, fees sub-céntimo con batching, onboarding retail vía Coinbase, paymasters ERC-4337 maduros. Sequencer centralizado (mitigación: forced inclusion vía L1).",
  },
  {
    id: "arbitrum-one",
    name: "Arbitrum One",
    chainId: 42161,
    criteria: {
      cost: 8,
      liquidity: 10, // mayor TVL DeFi entre L2s
      security: 9, // fraud proofs permissionless (BoLD)
      finality: 8,
      oracleEcosystem: 9,
      stablecoinEcosystem: 9,
      developerEcosystem: 9,
      walletSupport: 8,
      interoperability: 8,
    },
    notes: "Mayor TVL y liquidez DeFi; fraud proofs permissionless; fees algo mayores que Base.",
  },
  {
    id: "optimism",
    name: "OP Mainnet",
    chainId: 10,
    criteria: {
      cost: 8,
      liquidity: 7,
      security: 8,
      finality: 8,
      oracleEcosystem: 8,
      stablecoinEcosystem: 8,
      developerEcosystem: 8,
      walletSupport: 8,
      interoperability: 9, // Superchain interop nativa con Base
    },
    notes: "Misma stack (OP Stack) que Base → migración casi sin coste; menor liquidez propia.",
  },
];

/** Selección vigente: Base (mainnet 8453 / testnet Base Sepolia 84532). */
export function selectOperatingChain(): ChainCandidate & { score: number } {
  return rankChains(CHAIN_CANDIDATES)[0]!;
}
