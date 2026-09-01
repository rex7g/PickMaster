import { describe, expect, it } from "vitest";
import {
  CHAIN_CANDIDATES,
  CHAIN_WEIGHTS,
  chainScore,
  rankChains,
  selectOperatingChain,
} from "../src/chainSelection";

describe("Chain Selection Engine (§4)", () => {
  it("los pesos suman exactamente 1", () => {
    const total = Object.values(CHAIN_WEIGHTS).reduce((a, b) => a + b, 0);
    expect(total).toBeCloseTo(1, 10);
  });

  it("calcula el score ponderado correctamente", () => {
    const perfect = chainScore({
      cost: 10,
      liquidity: 10,
      security: 10,
      finality: 10,
      oracleEcosystem: 10,
      stablecoinEcosystem: 10,
      developerEcosystem: 10,
      walletSupport: 10,
      interoperability: 10,
    });
    expect(perfect).toBe(10);
    expect(() => chainScore({ ...CHAIN_CANDIDATES[0]!.criteria, cost: 11 })).toThrow();
  });

  it("rankea las candidatas y selecciona Base como capa de operaciones", () => {
    const ranked = rankChains(CHAIN_CANDIDATES);
    expect(ranked).toHaveLength(3);
    expect(ranked[0]!.score).toBeGreaterThanOrEqual(ranked[1]!.score);
    expect(selectOperatingChain().id).toBe("base");
  });
});
