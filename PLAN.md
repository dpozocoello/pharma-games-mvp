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
