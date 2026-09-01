# PickMaster — Documento de Arquitectura (Fase 1)

Resumen ejecutable del Software Architecture Document. Mapea el Master Prompt al
código de este repositorio y fija la ruta hacia Fase 2+.

## 1. Vista de módulos (regla de oro §65)

```
DISCOVERY → MARKET CREATION → TRADING → RISK → ORACLE → RESOLUTION → ARBITRATION → SETTLEMENT
```

| Paso | Módulo en `packages/core` | Notas |
|------|---------------------------|-------|
| Market creation | `exchange.createMarket` + `validation.ts` | Pipeline Draft→Validation→Compliance→Approval (§9–10) |
| Trading | `matching.ts` (CLOB) + gates en `exchange.placeOrder` | Off-chain matching, settlement on-chain en Fase 2 (§16) |
| Risk | `risk.ts` | Correlación, wash trading, concentración (§29–30) |
| Oracle | `oracle.ts` | Agregador multi-fuente + `SourceReliabilityScore` (§11) |
| Resolution | `resolution.ts` | Automatic / Optimistic / Arbitration / VOID (§12, §46) |
| Arbitration | `resolution.arbitrate` + `Dispute` | Estados §13; integrable con UMA/Kleros en Fase 3 |
| Settlement | `settlement.ts` | Determinístico, idempotente (§45) |

Transversales: `compliance.ts` (§31), `fees.ts` (§18), `audit.ts` (§40),
`arbitrage.ts` (§14–15), `priceEngine.ts` (§37), `portfolio.ts` (§38).
Ningún módulo tiene autoridad sobre todos los pasos: el `Exchange` sólo orquesta y
cada motor es una función pura o clase aislada sin dependencias entre pasos.

## 2. Bounded contexts (§61) y evolución del backend

Fase 1: dominio TypeScript puro (este repo) tras API routes de Next.js.
Fase 2: monolito modular .NET 10 (§23) con los mismos contratos de dominio,
PostgreSQL (transaccional), Redis (cache/orderbook), ClickHouse (analytics),
object storage (evidencia) y Blockchain Indexer con reorg detection (§25–26).
Eventos (§24): `MarketCreated`, `OrderMatched`, `ResolutionProposed`,
`MarketResolved`, `PositionSettled`, … — en Fase 1 el AuditLog cumple el rol de
event stream; en Fase 2 se publica a Kafka/Redpanda.

## 3. Blockchain (§4–5, §27)

- **Chain Selection Engine**: scoring 20% coste + 15% liquidez + 15% seguridad +
  10% finality + 10% oráculos + 10% stablecoins + 10% dev ecosystem + 5% wallets +
  5% interoperabilidad. Candidato inicial **Base**; alternativas Arbitrum One y
  Optimism. Ethereum L1 reservado para governance/treasury/anchors.
- Colateral: **USDC**; sin token propio en el MVP (§5).
- Contratos: ver `contracts/` (interfaces de referencia). Matching off-chain con
  órdenes EIP-712; settlement batched on-chain; ERC-4337 + paymasters para UX
  gasless (§19). `ChainAdapter` por red para portabilidad multichain (§44).

## 4. Threat model (resumen §42) y mitigaciones en el diseño

| Amenaza | Mitigación |
|---------|-----------|
| Manipulación de oráculo | ≥2 fuentes confiables para auto-resolución (AC-007); conflicto → DISPUTED (AC-008) |
| Admin malicioso | Sin YES→NO tras cierre; sólo arbitraje auditado o VOID (§46); AuditEvent en cadena de hashes (AC-012) |
| Wash trading / Sybil | `risk.ts` + no self-trade en el matching engine |
| Jurisdicciones restringidas | `MarketEligibility` bloquea antes del matching (AC-011) |
| Vulnerabilidad crítica | Emergency pause global auditada (AC-013); multisig + timelock en Fase 2 |
| MEV / frontrunning | CLOB off-chain + settlement batched + firmas EIP-712 (§43) |
| Fondos | Colateral segregado por mercado; settlement determinístico e idempotente (§45) |

## 5. Frontend y API

- Web (`apps/web`): Next.js + TypeScript + Tailwind (§22, §62). Página de mercado con
  precios en ¢, probabilidad implícita, order book, reglas, fuentes, transparencia
  (§55–56) y desglose de costes previo a la firma (AC-005). Panel admin (§40).
- API pública (§57): `GET /api/markets`, `/api/markets/{id}`, `/orderbook`,
  `/trades`, `/resolution`, `/api/prices`, `/api/categories`. WebSockets, SDK
  `@pickmaster/sdk` y webhooks (§57–59) llegan en Fase 2.
- Mobile (§21): React Native/Expo en Fase 3, consumiendo la misma API.

## 6. Operación

- CI/CD (§50): lint → tests → build → security scan → staging → E2E → producción
  (GitHub Actions; los tests de `packages/core` son el primer stage hoy).
- Entornos (§51): local → development → staging → testnet → production.
- Observabilidad (§49): OpenTelemetry + Prometheus + Grafana + Loki en Fase 2;
  métricas objetivo (§48, §53): API p95 < 300 ms, order ack < 500 ms, update
  WebSocket < 200 ms.

## 7. Agentes IA (§32–33)

Doce agentes (discovery, designer, oracle, resolution, dispute, risk, arbitrage,
liquidity, compliance, fraud, news, auditor) operan en Fase 3 bajo el patrón
`AI Recommendation → Policy Engine → Humano/Multisig → Smart Contract`. Ningún
agente tiene acceso a claves ni fondos. En Fase 1 sus contratos de salida ya están
modelados: candidato de mercado → `validateMarket`, reportes → `OracleReport`,
hallazgos → `RiskEvent`.

## 8. Mapa de entregables (§66)

| Entregable | Ubicación |
|------------|-----------|
| Roadmap, fases, cost model inicial | `PLAN.md` |
| PRD + criterios de aceptación | Master Prompt + `packages/core/test/acceptance.test.ts` |
| SAD, threat model, DDD, observabilidad, CI/CD | este documento |
| Domain/Database model | `packages/core/src/types.ts` |
| Smart contract architecture | `contracts/` |
| Oracle/Resolution/Arbitration/Arbitrage specs | `packages/core/src/{oracle,resolution,arbitrage}.ts` |
| Compliance architecture | `packages/core/src/compliance.ts` (la habilitación regulatoria es dependencia externa al repo) |
| API specification | `apps/web/app/api/**` |
| Test strategy | vitest sobre AC-001..AC-013; fuzz/invariant en Fase 2 |
