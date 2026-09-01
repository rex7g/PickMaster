# PickMaster

> **Predict the events that shape the Dominican Republic.**

Plataforma de mercados predictivos sobre eventos reales y verificables — elecciones,
tasa USD/DOP, inflación, clima, deportes — donde el precio de cada posición representa
la probabilidad implícita del mercado. Arquitectura de *Prediction Market Protocol*
(no una casa de apuestas): fondos segregados, resolución verificable multi-fuente,
liquidación determinística y auditoría inmutable.

**Estado: Fase 1 — Prototype.** Trading simulado, sin dinero real ni blockchain en
producción. Ver [`PLAN.md`](./PLAN.md) para la estimación de fases (0–4) y
[`docs/ARCHITECTURE.md`](./docs/ARCHITECTURE.md) para la arquitectura.

## Estructura

```
PLAN.md              Plan de ejecución y estimación de fases 0–4
docs/                Arquitectura, threat model, mapa de entregables
packages/core        Dominio completo en TypeScript (motores + tests AC-001..AC-013)
apps/web             Web app Next.js: mercados, trading simulado, portfolio, admin, API pública
contracts/           Arquitectura de smart contracts (Solidity, referencia para Fase 2)
```

## Ejecutar

**Importante:** es un monorepo con npm workspaces — `npm install` va siempre en la
**raíz** del repositorio, no dentro de `apps/web`.

```bash
npm install     # SIEMPRE desde la raíz (instala core + web)
npm test        # tests de aceptación (criterios §47 del Master Prompt)
npm run dev     # web en http://localhost:3000
```

> Si tras un `git pull` aparece `Module not found: Can't resolve 'viem'` (o
> cualquier otra dependencia), es que `node_modules` quedó desactualizado
> respecto al `package.json`: vuelve a ejecutar `npm install` en la raíz. El
> script `predev`/`prebuild` detecta este caso y lo indica explícitamente.

La web arranca con mercados dominicanos sembrados, un market maker simulado y un
usuario demo con $1,000 USDC simulados. Flujo completo demostrable desde la UI:

1. **Mercados** — probabilidades, order book (CLOB con matching complementario
   YES/NO), volumen y liquidez.
2. **Operar** — desglose de costes (network fee estimado + fees PickMaster) antes de
   confirmar; validación de firma, balance, riesgo y compliance antes del matching.
3. **Portfolio** — P&L realizado y no realizado, exposición, posiciones.
4. **Admin** — cerrar mercados, simular oráculos (acuerdo/conflicto), ventana de
   disputa, arbitraje, VOID, liquidación, pausa de emergencia, escaneo de riesgo y
   auditoría con cadena de hashes.

## API pública (Fase 1)

`GET /api/markets` · `GET /api/markets/{id|slug}` · `/orderbook` · `/trades` ·
`/resolution` · `GET /api/prices` · `GET /api/categories`

## Principios innegociables

- El resultado de un mercado sólo se fija vía oráculo → disputa → arbitraje, o VOID.
  Nunca un cambio administrativo directo tras el cierre.
- Ninguna operación con dinero real sin auditoría externa de contratos (Fase 4) y
  la habilitación regulatoria correspondiente, que se gestiona fuera de este
  repositorio.
- Los agentes IA recomiendan; nunca custodian fondos ni claves.
