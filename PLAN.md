# PLAN — Correcciones posteriores a la revisión de arquitectura

Estado: **en curso** · Fecha: 2026-11-23 · Origen: `docs/revision-arquitectura.md`

| #   | Tarea                                                                                                                                                                           | Estado |
| --- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------ |
| C4  | CI: lockfile sincronizado, `pnpm size` después del build, `pnpm test:int` en CI, `AUTH_TOKEN_SECRET` en CI, override de `effect` (ADR-022)                                      | ✅     |
| C4  | `PrismaService` usa la URL de la configuración validada (las pruebas de integración usaban la base equivocada) y limpieza de países Z\* al re-ejecutar                          | ✅     |
| C1  | `finish` atómico (bloqueo por usuario + reclamo condicional), `FOR SHARE` en respuestas, índice único parcial en `PointsLedger` (ADR-021)                                       | ✅     |
| C1  | Pruebas de concurrencia contra PostgreSQL real (`test/integration/fair-play.int.test.ts`)                                                                                       | ✅     |
| C2  | Ranking en vivo materializado en Redis con reconstrucción única desde PostgreSQL, `limit`/`me`/`totalRows` en `GET /rankings` (ADR-023); medido en `docs/informe-carga.md` §3.4 | ✅     |
| B2  | `winners.csv` neutraliza fórmulas con `sanitizeCsvCell`                                                                                                                         | ✅     |
| A3  | Foto oficial diaria por país con `upsertJobScheduler` de BullMQ a las 23:55 locales, día = hora programada (ADR-024)                                                            | ✅     |
| M4  | Traslados: puntos y actividad atribuidos a la farmacia donde se jugó (ADR-025); perfil cuenta todas las partidas del periodo; panel muestra puntos de anomalías descartadas     | ✅     |
| A5  | Redis caído: la API arranca, juega desde PostgreSQL, rate limit falla abierto (OTP cerrado con 503), apagado sin cuelgues (ADR-026)                                             | ✅     |
| A6  | PWA renueva el token ante un 401 (una sola renovación, sin desmontar la partida); E2E con Playwright ejecutable y en CI (ADR-027, ADR-028)                                      | ✅     |
| —   | Pendiente: C3, resto de A3 (importaciones, anomalías y exportaciones en cola), A1, A2, A4, A7, M1–M3, M5–M8 (ver la sección 5 del reporte)                                      | ⏳     |

**Riesgo de despliegue:** si una base existente ya tiene movimientos `GAME` duplicados, la migración `20261123000000_ledger_game_unique` falla a propósito. Ver ADR-021 antes de desplegar.

---

# PLAN — Iteración 6: Medición, carga y endurecimiento (módulo 12 parcial + no funcionales)

Estado: **terminada ✅ (Iteraciones 0 a 6 completas)** · Fecha: 2026-11-18 · Anterior: Iteración 5 (terminada ✅)

## Criterios de aceptación (CLAUDE.md §12)

- [x] Test inicial por marca (`GET /tests/pending`, `POST /tests/:id/submit`) y eventos de uso (`UsageEvent`); reporte de participación por país, farmacia y marca en CSV (`GET /admin/reports/participation.csv`).
- [x] Informe k6 en `docs/informe-carga.md` que cumple los umbrales de la sección 11 (o explica la brecha y la corrección).
- [x] Revisión de seguridad documentada, respaldo y restauración probados, `docs/operacion.md` completo.

## Tareas

| #   | Tarea                                                                                                                                                                                                                                                                                                                                               | Estado |
| --- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------ |
| 1   | `packages/shared`: esquemas Zod y tipos para Medición (`PendingKnowledgeTest`, `SubmitKnowledgeTestRequest`, `SubmitKnowledgeTestResponse`, `UsageEventInput`)                                                                                                                                                                                      | ✅     |
| 2   | `apps/api/prisma/seed.ts`: sembrar `KnowledgeTest` (`kind = 'INITIAL'`) de 5 preguntas publicadas por cada combinación marca-país (idempotente)                                                                                                                                                                                                     | ✅     |
| 3   | `MeasurementService` y `MeasurementController`: `GET /tests/pending` (sin exponer `correctAnswer`), `POST /tests/:id/submit` (cálculo en servidor + `TestResult` único por usuario y test + `UsageEvent`), `POST /events` (sin datos personales) y `GET /admin/reports/participation.csv` (por país, farmacia y marca, auditado en `AdminAuditLog`) | ✅     |
| 4   | PWA (`apps/pwa`) y Admin (`apps/admin`): flujo de Test inicial de conocimiento por marca en la PWA y botón de exportación de `participation.csv` en el panel de administración                                                                                                                                                                      | ✅     |
| 5   | Pruebas automatizadas (`apps/api/test/iteration6.test.ts`): verificar `GET /tests/pending` (sin `correctAnswer`), `POST /tests/:id/submit` (idempotente y calculado en servidor), registro de `UsageEvent` sin PII y exportación de `participation.csv` con auditoría                                                                               | ✅     |
| 6   | Scripts de carga k6 en `tests/load/peak.k6.js` (1.125 req/s: 70 % juego, 20 % ranking/perfil, 10 % navegación; `p(95)<300`, `rate<0.005`) y `tests/load/period-close.k6.js` ("cierre de periodo"), e informe en `docs/informe-carga.md`                                                                                                             | ✅     |
| 7   | Endurecimiento, revisión de seguridad OWASP ASVS L2, procedimiento probado de respaldo y restauración de PostgreSQL, derechos ARCO (Ley 1581 CO, LOPDP EC, Ley 29733 PE) y actualización completa de `docs/operacion.md` y `README.md`                                                                                                              | ✅     |
