# PickMaster — Smart Contracts (Fase 2 — Testnet Base Sepolia)

> **Estado: implementación funcional para testnet.** Proyecto Foundry con el
> protocolo on-chain (§27), 14 tests pasando (ciclo completo, disputa, VOID,
> pausa de emergencia, seguridad de firmas y fuzzing de conservación de
> colateral) y script de despliegue para Base Sepolia verificado contra una
> cadena local (anvil). **Aún NO auditado**: el gate de mainnet (§28) exige
> además invariant tests ampliados, Slither, Echidna y auditoría externa.

## ✅ Desplegado en Base Sepolia (2026-09-01)

| Contrato | Dirección |
|---|---|
| MockUSDC (tUSDC) | [`0xda1d069ffd04fdb3f730d01168336f07695ef86e`](https://sepolia.basescan.org/address/0xda1d069ffd04fdb3f730d01168336f07695ef86e) |
| MarketRegistry | [`0x082d4e5f31518cdc209c3a414d9fbab33544f63f`](https://sepolia.basescan.org/address/0x082d4e5f31518cdc209c3a414d9fbab33544f63f) |
| PositionToken | [`0xb70655a2c6b1d31564a035b616238ef4c6396a94`](https://sepolia.basescan.org/address/0xb70655a2c6b1d31564a035b616238ef4c6396a94) |
| CollateralVault | [`0x568792c87b6c95c4cd75de4ea058c0f5cc6f904e`](https://sepolia.basescan.org/address/0x568792c87b6c95c4cd75de4ea058c0f5cc6f904e) |
| ResolutionManager | [`0xae55d9eafe24b073c66dcf98fd84e0a1e945fb9d`](https://sepolia.basescan.org/address/0xae55d9eafe24b073c66dcf98fd84e0a1e945fb9d) |
| Exchange | [`0xb4bc699e2d26dd586ed7ec15abaaaed9a883bbbe`](https://sepolia.basescan.org/address/0xb4bc699e2d26dd586ed7ec15abaaaed9a883bbbe) |
| TimelockController (§41) | [`0xA56f15ec759ad1E7Ef13B907373279aA0436400E`](https://sepolia.basescan.org/address/0xA56f15ec759ad1E7Ef13B907373279aA0436400E) |

**Gobernanza activa**: el `DEFAULT_ADMIN_ROLE` de los cinco contratos del protocolo
pertenece al timelock (delay de 48 h) y el deployer renunció al suyo — verificado
on-chain. Ningún cambio de roles o de fees es posible sin encolar la operación y
esperar el delay; la pausa de emergencia sigue siendo instantánea para el guardián.
En producción el proposer/guardián es un multisig, no una EOA.

Mercado demo activo: `usd-dop-64-diciembre-2026`
(`0xe78ba17c3b29e1e167eb5188552fb72f7989457f34775bda655f51c2cdad3449`).
Detalles completos en [`deployments/base-sepolia.json`](./deployments/base-sepolia.json).
El tUSDC tiene faucet abierto: `faucet(address, amount)` hasta 10,000 tUSDC por llamada.

## Desplegar en Base Sepolia

```bash
cd contracts
forge test                                  # 14/14
export PRIVATE_KEY=0x...                    # clave con ETH de faucet de Base Sepolia
forge script script/Deploy.s.sol --rpc-url base_sepolia --broadcast
```

El script despliega `MockUSDC` (tUSDC con faucet abierto, sólo testnet), los cinco
contratos del protocolo, cablea los roles con mínimo privilegio y crea el mercado
demo `usd-dop-64-diciembre-2026`. Variables opcionales: `USDC_ADDRESS`, `TREASURY`,
`GUARDIAN`, `DISPUTE_BOND`, `FEE_BPS`. En testnet el deployer concentra los roles
operativos para simulacros (§52); en staging/producción van al backend, al
agregador de oráculos y al multisig de arbitraje tras un timelock (§41).

## Topología (§27)

```
MarketRegistry      — factory + máquina de estados del mercado + pausa global (AC-013)
      │                (rulesHash ancla las reglas publicadas, §56)
      ├── PositionToken     — ERC-1155: tokenId = keccak256(marketId, outcome)
      ├── CollateralVault   — custodia segregada de USDC por mercado (§2.5, §45)
      │                       claim() paga 1.00 USDC/share ganador; redeemVoid()
      │                       devuelve 0.50/share a ambos lados (§46)
      ├── Exchange          — settlement de órdenes EIP-712 casadas off-chain (§16):
      │                       settleMint (BUY YES × BUY NO) y settleTransfer;
      │                       fee bps transparente con tope duro de 1% (§18)
      └── ResolutionManager — oracle adapter + dispute manager (§11–13):
                              propose → ventana de disputa con bond → finalize
                              permissionless / arbitrate por comité; único
                              titular de RESOLVER_ROLE en el registry
MockUSDC            — colateral de prueba con faucet (SÓLO testnet, §52)
```

Nadie — ni el admin — puede fijar un resultado directamente: `setResolved` sólo es
invocable por el `ResolutionManager`, y el test
`test_AdminCannotSetOutcomeDirectly` lo verifica (§46).

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
- OpenZeppelin v5 en todo el protocolo: `AccessControl`, `ReentrancyGuard`,
  `Pausable`, `SafeERC20`, `ERC1155Supply`, `EIP712`/`ECDSA`.

## Gate de salida a mainnet (§28, §63)

1. `forge test` con cobertura de invariantes (colateral total = supply de posiciones
   pendientes × 1.00, ningún payout sin resolución final, pausas efectivas).
2. Fuzzing (Echidna) sobre Exchange y CollateralVault.
3. Análisis estático (Slither) sin hallazgos críticos.
4. Auditoría externa publicada.
5. Multisig + timelock configurados; simulacros en Base Sepolia (§52).
