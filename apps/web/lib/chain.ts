/**
 * Fase 2: lectura on-chain del despliegue real en Base Sepolia via viem.
 * Direcciones publicadas en contracts/deployments/base-sepolia.json.
 */
import { createPublicClient, http, defineChain } from "viem";

export const baseSepolia = defineChain({
  id: 84532,
  name: "Base Sepolia",
  nativeCurrency: { name: "Ether", symbol: "ETH", decimals: 18 },
  rpcUrls: { default: { http: ["https://sepolia.base.org"] } },
  blockExplorers: {
    default: { name: "Basescan", url: "https://sepolia.basescan.org" },
  },
});

export const ADDRESSES = {
  MockUSDC: "0xDA1d069fFD04fDb3F730d01168336f07695ef86E",
  MarketRegistry: "0x082d4E5f31518CDc209C3a414d9fbAb33544f63f",
  PositionToken: "0xB70655a2c6b1d31564A035b616238Ef4c6396a94",
  CollateralVault: "0x568792C87B6c95c4Cd75De4ea058c0f5cc6F904E",
  ResolutionManager: "0xaE55D9eAFe24b073C66Dcf98FD84e0a1E945Fb9d",
  Exchange: "0xB4bc699e2D26Dd586ed7Ec15abaaAed9A883BBBe",
} as const;

export const DEMO_MARKET_ID =
  "0xe78ba17c3b29e1e167eb5188552fb72f7989457f34775bda655f51c2cdad3449" as const;

export const MARKET_STATES = [
  "None",
  "Open",
  "ResolutionProposed",
  "Disputed",
  "Resolved",
  "Void",
] as const;

export const registryAbi = [
  {
    type: "function",
    name: "market",
    stateMutability: "view",
    inputs: [{ name: "marketId", type: "bytes32" }],
    outputs: [
      {
        type: "tuple",
        components: [
          { name: "closeTime", type: "uint64" },
          { name: "disputePeriod", type: "uint64" },
          { name: "rulesHash", type: "bytes32" },
          { name: "state", type: "uint8" },
          { name: "winningOutcome", type: "uint8" },
        ],
      },
    ],
  },
  {
    type: "function",
    name: "paused",
    stateMutability: "view",
    inputs: [],
    outputs: [{ type: "bool" }],
  },
] as const;

export const vaultAbi = [
  {
    type: "function",
    name: "lockedCollateral",
    stateMutability: "view",
    inputs: [{ name: "marketId", type: "bytes32" }],
    outputs: [{ type: "uint256" }],
  },
] as const;

export const erc20Abi = [
  {
    type: "function",
    name: "totalSupply",
    stateMutability: "view",
    inputs: [],
    outputs: [{ type: "uint256" }],
  },
  {
    type: "function",
    name: "symbol",
    stateMutability: "view",
    inputs: [],
    outputs: [{ type: "string" }],
  },
] as const;

export const exchangeAbi = [
  {
    type: "function",
    name: "feeBps",
    stateMutability: "view",
    inputs: [],
    outputs: [{ type: "uint16" }],
  },
] as const;

export function publicClient() {
  return createPublicClient({ chain: baseSepolia, transport: http() });
}
