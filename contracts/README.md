# PickMaster — Smart Contract Architecture (Fase 2)

> **Estado: especificación de referencia.** Estos contratos definen la arquitectura
> on-chain del protocolo (§27 del Master Prompt) para la Fase 2 (Testnet). **No están
> compilados, testeados ni auditados**, y no deben desplegarse en ninguna red sin
> completar el gate de seguridad (§28): unit + fuzz + invariant tests con Foundry,
> Slither, Echidna, verificación formal de componentes críticos y auditoría externa.

## Topología (§27)

```
MarketFactory ──crea──▶ Market (estado + reglas de un mercado)
      │
      ├── CollateralVault   — custodia segregada de USDC por mercado (§2.5)
      ├── PositionToken     — ERC-1155: un tokenId por (market, outcome)
      ├── Exchange          — settlement de órdenes EIP-712 casadas off-chain (§16)
      ├── OracleAdapter     — recibe resultados del agregador de oráculos (§11)
      ├── DisputeManager    — propuesta → ventana de disputa → arbitraje (§12–13)
      ├── FeeManager        — fees separadas y visibles (§18)
      ├── Treasury          — multisig + timelock (§41)
      └── EmergencyPause    — pausa global auditada (AC-013)
```

Principios aplicados:

- **Contratos simples e inmutables para las reglas económicas** (sin proxy en
  `CollateralVault`/`Market`); UUPS sólo donde exista justificación (§27).
- **Liquidación determinística**: una posición ganadora cobra 1.00 USDC por share,
  la perdedora 0; `VOID` reembolsa el colateral aportado (§45–46).
- **Fondos segregados** por mercado en el vault; el matching es off-chain y el
  settlement on-chain valida firmas EIP-712 de ambas contrapartes (§16).
- **Nadie cambia YES→NO tras el cierre**: el resultado sólo puede fijarse por el
  flujo OracleAdapter → DisputeManager, o VOID (§46).
- **AI sin acceso a fondos**: los agentes sólo llegan hasta la propuesta; ejecución
  requiere humano/multisig/oráculo (§33).
- OpenZeppelin (`AccessControl`, `ReentrancyGuard`, `Pausable`, `SafeERC20`) se
  incorpora al materializar los contratos con Foundry en Fase 2.

## Gate de salida a mainnet (§28, §63)

1. `forge test` con cobertura de invariantes (colateral total = supply de posiciones
   pendientes × 1.00, ningún payout sin resolución final, pausas efectivas).
2. Fuzzing (Echidna) sobre Exchange y CollateralVault.
3. Análisis estático (Slither) sin hallazgos críticos.
4. Auditoría externa publicada.
5. Multisig + timelock configurados; simulacros en Base Sepolia (§52).
