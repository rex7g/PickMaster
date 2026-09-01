# Seguridad — estado y triaje (Fase 2, §28)

## Cobertura actual

| Capa | Estado |
|---|---|
| Unit/integration tests | ✅ 14 tests (`test/Protocol.t.sol`) |
| Fuzz | ✅ conservación de colateral, 256 runs |
| Invariant tests | ✅ 3 invariantes × 128,000 llamadas aleatorias (`test/Invariants.t.sol`): vault solvente, locked == claims pendientes exactos, sin shares sin colateral |
| Análisis estático (Slither) | ✅ ejecutado; triaje abajo — sin hallazgos explotables abiertos |
| Echidna | ⬜ pendiente |
| Verificación formal | ⬜ pendiente (candidatos: CollateralVault, settleMint) |
| Auditoría externa | ⬜ obligatoria antes de mainnet — **no desplegar dinero real sin ella** |

## Triaje Slither (2026-09-01)

- **`arbitrary-send-erc20` (Exchange)** — el Exchange hace `transferFrom` con
  `from = order.maker ≠ msg.sender`. Es inherente al diseño de relayer con
  órdenes firmadas (§16): cada pull ocurre sólo tras verificar la firma
  EIP-712 del maker sobre esa orden exacta (mercado, lado, precio límite,
  cantidad, expiry) y sólo dentro de esos límites, con `onlyRole(OPERATOR)`.
  Mismo patrón que los exchanges CTF de mercados predictivos en producción.
  **Nota abierta para la próxima iteración:** la fee (hasta el tope duro de
  1%) no está dentro de la firma; incluir `maxFeeBps` en la struct `Order`
  firmada antes de la beta cerrada para que el usuario firme también su fee
  máxima.
- **`divide-before-multiply` (CollateralVault.redeemVoid)** — `UNIT / 2` es
  exacto (1e6/2 = 5e5, sin pérdida de precisión). Falso positivo.
- **`missing-zero-check` (treasury)** — corregido: los constructores de
  `Exchange` y `ResolutionManager` ahora rechazan `treasury = address(0)`.
  El despliegue de testnet 2026-09-01 es anterior a este check (su treasury
  es el deployer, no-cero).
- **`reentrancy-benign` / `reentrancy-events`** — llamadas externas al propio
  `MarketRegistry` (contrato del protocolo, no arbitrario) seguidas de
  eventos; las funciones con movimientos de fondos usan `ReentrancyGuard` y
  patrón checks-effects-interactions. Aceptado.
- **`timestamp`** — las comparaciones con `block.timestamp` son inherentes a
  mercados con ventanas temporales; en una L2 con sequencer el sesgo posible
  es de segundos frente a ventanas de minutos/horas/días. Aceptado; las
  clases ULTRA_FAST usan ventana mínima de 5 minutos (§8) precisamente por
  esto.

## Modelo de roles (testnet vs producción)

En testnet el deployer concentra creator/proposer/arbitrator/operator/guardian
para poder ejecutar simulacros (§52). El gate de producción exige separarlos:
backend (operator), agregador de oráculos (proposer), multisig del comité
(arbitrator) y multisig+timelock (guardian/admin) — §41.
