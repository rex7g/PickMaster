# PickMaster — Plan de Ejecución y Estimación de Fases

> **PickMaster — Predict the events that shape the Dominican Republic.**
>
> Plataforma de mercados predictivos sobre eventos verificables, iniciando en República
> Dominicana y preparada para evolucionar a Caribe → Latinoamérica → Global.

Este documento estima las fases del proyecto (según la Estrategia de Lanzamiento del
Master Prompt, §63) y define qué se construye en cada una. La **Fase 1 (Prototype)** está
implementada en este repositorio.

---

## Resumen de fases

| Fase | Nombre | Duración estimada | Equipo estimado | Dinero real | Estado |
|------|--------|-------------------|-----------------|-------------|--------|
| 0 | Legal & Research | 6–10 semanas (en paralelo con Fase 1) | 1 PM + asesoría legal RD/crypto + 1 compliance officer | No | Pendiente (checklist abajo) |
| 1 | Prototype | 6–8 semanas | 2–3 full-stack + 1 diseñador | No (todo simulado) | ✅ **Implementada en este repo** |
| 2 | Testnet | 10–14 semanas | +2 ingenieros Solidity, +1 backend, +1 QA | No (Base Sepolia + test USDC) | Pendiente |
| 3 | Closed Beta | 8–12 semanas | Equipo Fase 2 + soporte + ops | Limitado, usuarios invitados | Pendiente |
| 4 | Production | 6–8 semanas de hardening + gate de auditoría | Equipo completo + auditoría externa | Sí, tras aprobación legal/auditoría | Pendiente |

**Camino crítico:** Fase 0 (legal) bloquea cualquier operación con dinero real; Fase 1 y
Fase 0 corren en paralelo. La auditoría externa de contratos (Fase 4) debe contratarse al
final de Fase 2 por sus plazos (típicamente 4–8 semanas de espera).

---

## Fase 0 — Legal & Research (6–10 semanas)

Regulatory & Compliance Gate obligatorio antes de habilitar dinero real (§2, §31, §63).

Entregables:
- Opinión legal y clasificación regulatoria en República Dominicana (Ley 139-11 y
  normativa de juegos de azar por Internet; requisitos de Hacienda sobre cuentas,
  procesamiento de pagos, infraestructura, inspección y conservación de información).
- Matriz de jurisdicciones (RD, EE. UU., UE, resto) → `ALLOWED / RESTRICTED / BLOCKED /
  REQUIRES_REVIEW` por tipo de mercado.
- Selección de proveedores KYC/AML y sanctions screening.
- Modelo de pagos (on-ramp/off-ramp USDC) y su tratamiento regulatorio.
- Licenciamiento de datos (JCE, Banco Central, ONE, ONAMET, ligas deportivas) — sin
  scraping de fuentes que lo prohíban (§35).

## Fase 1 — Prototype (6–8 semanas) — ✅ este repositorio

Sin dinero real ni blockchain en producción. Objetivo: validar producto y dominio.

Construido aquí:
- **`packages/core`** — dominio completo en TypeScript, testeado contra los criterios de
  aceptación AC-001…AC-013 (§47): modelo de mercado (§6), ciclo de vida (§9), Market
  Validation Engine (§10) con `ResolutionClass` y regla de latencia de fuente (§8),
  matching engine CLOB con matching complementario YES/NO (§16), Price Engine con
  probabilidad implícita (§37), Internal Arbitrage Engine (§15), arquitectura de
  oráculos con agregador multi-fuente y `SourceReliabilityScore` (§11), Resolution
  Engine con resolución automática/optimista/disputada (§12–13), Settlement
  determinístico e idempotente (§45), estado `VOID` (§46), Compliance Engine con
  `MarketEligibility` (§31), Risk/Fraud Engine (§29–30), Fee Engine con desglose
  transparente (§18), AuditEvent con hash encadenado (§40), Emergency Pause (AC-013)
  y Portfolio/P&L (§38).
- **`apps/web`** — web Next.js + TypeScript + Tailwind (§22, §62): listado de mercados,
  página de mercado (precio YES/NO en centavos, probabilidad, order book, reglas,
  fuentes, ventana de disputa — §55–56), trading simulado con desglose de costes,
  portfolio con P&L, panel admin (crear/resolver/pausar mercados, auditoría — §40),
  API pública `GET /api/markets…` (§57).
- **`contracts/`** — arquitectura de smart contracts (§27) en Solidity como
  especificación de referencia para Fase 2 (no desplegable aún: requiere Foundry,
  tests, fuzzing y auditoría — §28).
- **`docs/`** — arquitectura, modelo de dominio y mapa de entregables (§66).

Deviación consciente vs. §62: el backend del prototipo es TypeScript (dominio puro +
API routes de Next.js) para iterar rápido sin dinero real. El port a .NET 10/ASP.NET
Core como monolito modular está planificado para Fase 2; el dominio está escrito como
funciones puras sin dependencia del framework precisamente para que ese port sea directo.

## Fase 2 — Testnet (10–14 semanas)

- Smart contracts reales con Foundry: `MarketFactory`, `CollateralVault`,
  `PositionToken` (ERC-1155), `Exchange` (órdenes EIP-712, matching off-chain +
  settlement on-chain), `OracleAdapter`, `DisputeManager`, `FeeManager`,
  `EmergencyPause`, multisig + timelock (§27, §41).
- Suite de seguridad: unit + fuzz + invariant tests, Slither, Echidna (§28).
- Base Sepolia + test USDC; Chain Selection Engine con scoring formal (§4) —
  candidato inicial **Base**, alternativas Arbitrum One / Optimism.
- Backend .NET 10 monolito modular (§23), PostgreSQL + Redis, event bus, Blockchain
  Indexer con reorg detection y RPC failover (§26).
- Wallets: WalletConnect/MetaMask/Coinbase + embedded smart accounts, ERC-4337 y
  paymasters para UX gasless (§19–20).
- Simulacros: resolución automática, disputada, cancelación (VOID), caída de chain (§52).

## Fase 3 — Closed Beta (8–12 semanas)

- Usuarios invitados con KYC completo; mercados curados de baja ambigüedad.
- App móvil React Native/Expo (§21) con las 16 pantallas.
- Observabilidad completa: OpenTelemetry, Prometheus, Grafana, Loki, alertas de
  oracle/RPC/gas/manipulación (§49).
- Motores de riesgo/fraude con datos reales; agentes IA en modo recomendación (nunca
  con acceso a fondos — §33).

## Fase 4 — Production

Gate de salida (todos obligatorios, §63):
- Auditoría externa de contratos publicada y hallazgos críticos resueltos.
- Aprobación legal y de compliance por jurisdicción.
- Security review de infraestructura y threat model actualizado (§42).
- Monitoring y runbooks de incidentes/disaster recovery operativos.

## Post-MVP (backlog §64)

AMM híbrido, mercados multi-outcome/scalar/condicionales, cross-chain (`ChainAdapter`),
arbitraje externo, creación de mercados por agentes IA con aprobación humana, DAO,
liquidez avanzada, SDK `@pickmaster/sdk` y webhooks públicos.

---

## Regla de oro (§65)

`DISCOVERY → MARKET CREATION → TRADING → RISK → ORACLE → RESOLUTION → ARBITRATION →
SETTLEMENT` son módulos separados; ningún componente tiene autoridad absoluta sobre
todos los pasos. El código de `packages/core` refleja esa separación módulo a módulo.
