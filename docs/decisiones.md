# Registro de decisiones (ADR breve)

Formato: **ID — título** · fecha · decisión · motivo · alternativas.

## ADR-001 — Repositorio propio para el proyecto

2026-11-17 · `pharma/` tiene su propio repositorio git (rama `main`), separado de cualquier repositorio contenedor. · El cliente es dueño de todo el código e historial. · Subcarpeta de un repo existente (descartada: mezcla historial ajeno).

## ADR-002 — Node 20 LTS como objetivo, compatible con 22

2026-11-17 · `engines.node >=20`, CI e imágenes Docker con Node 20. · Requisito de la pila; el entorno local del desarrollador tiene Node 22. · Fijar solo 22.

## ADR-003 — pnpm 9 instalado vía npm global

2026-11-17 · `packageManager: pnpm@9.15.9`. Corepack no puede escribir en `Program Files` sin permisos de administrador, así que pnpm se instala con `npm i -g pnpm@9.15.9`. · Evita depender de privilegios elevados. · Corepack (funciona igual si el entorno lo permite).

## ADR-004 — IDs UUID v7 generados en la aplicación

2026-11-17 · Las PK son `uuid` en PostgreSQL; el valor se genera en Node con el paquete `uuidv7` (MIT, ~2 KB, sin dependencias). · Prisma no genera v7 de forma nativa y PostgreSQL 16 no trae `uuidv7()`. Ordenables por tiempo → mejores índices. · `gen_random_uuid()` (v4, peor localidad de índice).

## ADR-005 — ESLint flat config + Prettier, sin reglas de estilo en ESLint

2026-11-17 · ESLint 9 con `typescript-eslint` para errores; Prettier para formato. · Configuración mínima y estándar, fácil para otro proveedor.

## ADR-006 — `PointsLedger` y `AdminAuditLog` inmutables a nivel de base de datos

2026-11-17 · Un trigger de PostgreSQL rechaza `UPDATE` y `DELETE` en ambas tablas (migración inicial). · La inmutabilidad no depende solo del código de la aplicación. · Solo convención en el código.

## ADR-007 — Semillas deterministas

2026-11-17 · Las semillas usan un PRNG con semilla fija y son idempotentes (`upsert` por claves naturales o borrado previo en desarrollo). · Pruebas y demos reproducibles.

## ADR-008 — Tema visual de marca en `BrandCountry`

2026-11-17 · El tema (colores, logo) vive en `Brand` como valor por defecto y puede sobrescribirse en `BrandCountry.theme`. · El modelo §7 menciona "Brand / BrandCountry … con tema visual" sin precisar dónde; esta opción cubre ambos casos.

## ADR-009 — Rol y alcance en `User`

2026-11-17 · Un usuario tiene un solo `role`. `SUPER_ADMIN` tiene `countryId` nulo (alcance global); el resto lleva `countryId` obligatorio a nivel de aplicación. `PHARMACY_MANAGER` y `CLERK` se ligan a farmacia por `PharmacyAssignment`. · Lo más simple que cumple §3 módulo 5. · Tabla de asignaciones de roles múltiples (innecesaria en el MVP).

## ADR-010 — Preguntas compartidas o por país

2026-11-17 · `Question.countryId` es opcional: nulo = pregunta compartida por los países donde la marca está activa (adaptable con `CountryTermOverride`); con valor = pregunta exclusiva de ese país. Un `CONTENT_EDITOR` de país solo crea preguntas de su país; las compartidas las gestiona `SUPER_ADMIN`. · §7 pide `countryId` en toda entidad de negocio y a la vez define "pregunta compartida" con ajustes por país; esta opción cumple ambas. · Duplicar cada pregunta por país (más contenido que mantener).

## ADR-011 — Un solo `.env` en la raíz, cargado con `dotenv-cli`

2026-11-17 · Los scripts de `apps/api` (Nest y Prisma) leen `../../.env` mediante `dotenv-cli` (MIT, solo desarrollo). En CI y producción las variables vienen del entorno. · Un único archivo de configuración local para docker-compose, API y Prisma. · Un `.env` por app (duplicación de secretos).

## ADR-012 — PostgreSQL local en el puerto 55432

2026-11-17 · docker-compose publica PostgreSQL en `127.0.0.1:55432` (configurable con `POSTGRES_PORT`). · Las máquinas de desarrollo suelen tener PostgreSQL nativo en 5432/5433; un puerto alto evita choques. Solo se publica en `127.0.0.1`.

## ADR-013 — `@pharma/shared` en CommonJS para Node y fuente ESM para Vite

2026-11-17 · El paquete compila a CommonJS (`dist/`) para la API NestJS; las apps Vite lo importan desde `src/` por alias para conservar tree-shaking. · NestJS y Prisma funcionan mejor en CommonJS; evita un paquete dual. · Paquete dual ESM+CJS con un empaquetador adicional.

## ADR-014 — `GET /api/v1/countries` adelantado a la Iteración 0

2026-11-17 · El endpoint público de países (Iteración 1 en §10) se implementó ya, sin autenticación ni datos personales. · Permite verificar de punta a punta que `pnpm dev` levanta API, base de datos y PWA.

## ADR-015 — Pruebas de NestJS con Vitest + SWC

2026-11-17 · `unplugin-swc` + `@swc/core` en las pruebas de la API. · esbuild (el transformador por defecto de Vitest) no emite la metadata de decoradores que necesita la inyección de dependencias de NestJS. · Jest (segundo ejecutor de pruebas en el repositorio).

## ADR-016 — NestJS 11, Zod 4 y Prisma 6 con override de `deepmerge-ts`

2026-11-17 · NestJS 11.2 (CommonJS, Express 5, multer 2.5), Zod 4.6 y Prisma 6.19 con `pnpm.overrides` de `deepmerge-ts ^8`. · `pnpm audit` marcaba vulnerabilidades altas en NestJS 10 (multer, body-parser), Zod 3 y `deepmerge-ts 7` (vía Prisma 6).

## ADR-017 — Código OTP almacenado como HMAC-SHA256 en Redis con script Lua atómico

2026-11-18 · El código de 6 dígitos nunca se guarda en claro en Redis: se almacena `HMAC-SHA256(AUTH_TOKEN_SECRET, app:userId:code)` junto al contador de intentos en un hash con TTL de 300 s, verificado con un script Lua atómico. · Si alguien vuelca la memoria de Redis no puede leer códigos activos, y la verificación/bloqueo al 5.º intento fallido no tiene condiciones de carrera.

## ADR-018 — Cola BullMQ para envío de OTP con respaldo automático WhatsApp → SMS

2026-11-18 · `OtpQueue` encola el envío en BullMQ (`removeOnComplete: true`) y `OtpDeliveryService` intenta primero `WhatsAppCloudProvider`; si lanza error o timeout, invoca `HttpSmsProvider` en el mismo intento antes de reintentar el job. En desarrollo (`MESSAGING_PROVIDER=console`), `ConsoleProvider` guarda el último código por 5 min en `dev:outbox:<phone>` consultable solo fuera de producción.

## ADR-019 — Refresh tokens opacos por familia con margen de carrera de 10 s

2026-11-18 · El refresh token (90 días) es un valor aleatorio opaco de 32 bytes en cookie `HttpOnly` (`pharma_rt_pwa` y `pharma_rt_admin` separados para que ambas apps convivan en `localhost`); en `RefreshToken` solo se persiste su SHA-256 y un `familyId`. Si se presenta un token ya rotado hace menos de 10 s devuelve `401 REFRESH_RACE` sin revocar la familia (tolera pestañas concurrentes); si han pasado más de 10 s revoca toda la familia por posible robo de token.

## ADR-020 — Consentimiento obligatorio solo para roles jugadores (`CLERK` y `PHARMACY_MANAGER`)

2026-11-18 · `ConsentGuard` bloquea por defecto las rutas para `CLERK` y `PHARMACY_MANAGER` hasta que acepten la `ConsentVersion` vigente de su país (`CountryConfig.consentVersionId`). Cuando un administrador publica una nueva versión de consentimiento, `consentVersionId` cambia y la app vuelve a exigir la aceptación antes de permitir jugar.

## ADR-021 — Cierre de partida atómico: bloqueo por usuario, reclamo condicional e índice único parcial

2026-11-23 · `finishSession` corre en una transacción que (1) toma `pg_advisory_xact_lock` sobre el usuario, (2) reclama la partida con `updateMany({ status: 'IN_PROGRESS' → 'FINISHED' })` y solo si gana calcula y acredita, (3) lee respuestas y puntos del día dentro de la transacción. Las solicitudes que pierden devuelven el resultado guardado (idempotencia). `submitAnswers` toma `FOR SHARE` sobre la fila de la partida, así ninguna respuesta entra después del cálculo. Como última barrera, la migración `20261123000000_ledger_game_unique` crea el índice único parcial `PointsLedger(sessionId) WHERE reason = 'GAME'`, en SQL porque Prisma no expresa índices parciales. · La revisión de arquitectura (C1) demostró con PostgreSQL real que 6 `finish` simultáneos acreditaban 6 veces y que dos partidas a la vez superaban el tope por marca (200 de 120). Un bloqueo por usuario y no global: los cierres de usuarios distintos no compiten. · Topes atómicos solo en Redis (rápido, pero Redis no es la fuente de verdad del libro) y `SERIALIZABLE` con reintentos (más complejo de operar).
**Si la migración falla por duplicados** en una base existente: no se borra nada del libro inmutable; se anula cada movimiento `GAME` sobrante con un `REVERSAL` auditado y se aplica el índice sobre los movimientos que quedan, o se ajusta el predicado del índice con una ventana de fecha. Hay que decidirlo con el cliente antes de desplegar.

## ADR-022 — Override de `effect` a `^3.22.1`

2026-11-23 · `pnpm.overrides.effect = ^3.22.1`. `prisma@6.19.3` (la última 6.x) fija `effect 3.21.0`, afectada por GHSA-7589-6fvf-x4pw (ReDoS, severidad alta), y `pnpm audit --audit-level high` en CI fallaba. Es una actualización menor dentro de 3.x (MIT); `prisma generate`, `migrate deploy` y las semillas se verificaron con la versión nueva. · Quitar el override al migrar a Prisma 7. · Bajar el umbral de la auditoría (descartado: oculta el riesgo).
