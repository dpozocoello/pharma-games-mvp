# PLAN — Iteración 0: Base

Estado: **terminada** · Fecha: 2026-11-17 · Siguiente: Iteración 1 (entrada, ingreso, países y roles)

## Tareas

| #   | Tarea                                                                                             | Estado |
| --- | ------------------------------------------------------------------------------------------------- | ------ |
| 1   | Repositorio git propio, pnpm 9                                                                    | ✅     |
| 2   | Monorepo pnpm workspaces + Turborepo, TypeScript estricto, ESLint (flat config), Prettier         | ✅     |
| 3   | `packages/shared`: esquemas Zod, constantes, i18n base, utilidades de zona horaria                | ✅     |
| 4   | `apps/api`: NestJS + pino + `/health` `/ready` + Prisma (esquema §7), migración inicial, semillas | ✅     |
| 5   | `apps/pwa`, `apps/admin`: Vite + React 18 (selección de país en la PWA)                           | ✅     |
| 6   | `packages/game-sdk`, `game-trivia`, `game-true-false`: tipos del contrato y moldes vacíos         | ✅     |
| 7   | `infra/docker-compose.yml` (PostgreSQL 16, Redis 7), `.env.example`                               | ✅     |
| 8   | CI GitHub Actions: formato, lint, tipos, pruebas, build, auditoría, migración + semillas (×2)     | ✅     |
| 9   | README y `docs/` (arquitectura, decisiones, operación; contrato y CSV como esqueleto)             | ✅     |
| 10  | Verificación local: install, lint, typecheck, test, build, migración, semillas, `pnpm dev`        | ✅     |

## Verificado localmente

- `pnpm lint`, `pnpm typecheck`, `pnpm build`, `pnpm format:check`: OK.
- `pnpm test`: 34 pruebas (shared 16, api 15, pwa 3).
- Migración inicial aplicada en PostgreSQL 16 (Docker); semillas ejecutadas dos veces con el mismo resultado
  (3 países, 9 marcas, 14 marca-país, 540 preguntas, 28 juegos, 9 farmacias, 64 usuarios).
- Trigger de inmutabilidad: `UPDATE`, `DELETE` y `TRUNCATE` sobre `PointsLedger` rechazados.
- `pnpm dev`: `/health` y `/ready` OK; la PWA (5173) lista los 3 países vía proxy; admin (5174) responde.
- JS inicial de la PWA: ~72 KB gzip (presupuesto 300 KB).

## Pendiente / no verificado

- CI no se ha ejecutado en GitHub (el repositorio aún no tiene remoto).
- Pruebas E2E con Playwright y presupuesto de peso en CI: desde Iteraciones 1 y 3.
- OpenAPI (`/api/docs`): se agrega en la Iteración 1 junto con los primeros endpoints autenticados.
- Dependencias: quedan 2 avisos moderados de `pnpm audit`; NestJS 12 (ESM) y Prisma 7 pendientes de evaluar (ADR-016).
- ESLint 9 figura como obsoleto frente a ESLint 10; migrar cuando `typescript-eslint` lo soporte de forma estable.
- Prisma avisa que `package.json#prisma` se elimina en Prisma 7; migrar a `prisma.config.ts` al actualizar.

## Riesgos

- El JS inicial de la PWA crecerá con el router, la autenticación y los juegos: vigilar desde la Iteración 3.
- Proveedores de WhatsApp/SMS sin definir: se aíslan tras `MessagingProvider` (Iteración 1).

## Preguntas abiertas (no bloquean)

- Proveedor de nube final (AWS o GCP) y región → Terraform de referencia en la Iteración 6.
- Proveedor SMS de respaldo concreto → Iteración 1.
- Texto legal de consentimiento por país: la semilla trae un texto de ejemplo marcado "pendiente de revisión legal".
