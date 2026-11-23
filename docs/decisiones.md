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

## ADR-023 — Ranking en vivo materializado en Redis, reconstruido desde PostgreSQL

2026-11-23 · Las lecturas de la PWA (`GET /rankings`, `GET /me/ranking`, `GET /manager/pharmacy/summary`) ya no recalculan el país: leen una **generación** materializada en Redis (`rk:{periodId}:{gen}:{scope}:pos` sorted set `entityId → posición`, `…:row` hash con la fila, `…:pts` puntos por usuario, puntero `rk:{periodId}:cur`). Fin de partida, anomalía resuelta, traslado, cambio de estado de un usuario y cierre de periodo marcan el país como sucio (`rk:dirty:{countryId}`). La lectura siguiente, si pasó `RANKING_LIVE_MIN_REBUILD_MS` (10 s por defecto) o la generación supera `RANKING_LIVE_MAX_AGE_MS` (5 min), toma un lock (`SET NX PX`) y **una sola** instancia reconstruye en segundo plano desde PostgreSQL mientras todas sirven la generación anterior; al terminar cambia el puntero, y la generación vieja vence a los 120 s. Si Redis falla, se calcula desde PostgreSQL. `GET /rankings` devuelve el top (`limit` 1–200, 50 por defecto), `totalRows` y `me` (mi fila, mi farmacia o mi país). La foto diaria, el cierre y `winners.csv` siguen calculando directo desde PostgreSQL.
· Antes cada lectura escaneaba todo el periodo del país y hacía un `ZADD` por fila que nunca se leía: con 5.064 usuarios y 200.000 partidas, una instancia servía 3,5 req/s con p95 de 15,6 s y 71 % de errores por pool agotado; ahora sirve ~750 req/s con p95 de ~100 ms y 0 % de errores, con cambios cada segundo (`docs/informe-carga.md` §3.4). Las posiciones se precalculan porque el desempate (nombre, puntos totales de farmacia) no es expresable con el puntaje de un sorted set.
· **Costo aceptado:** el ranking en vivo puede ir hasta ~10 s más el tiempo de cálculo por detrás de la última partida; la cifra oficial es la foto diaria. · Alternativas: incrementos `ZINCRBY` en cada partida (inmediato, pero el promedio de farmacia, los traslados y las anomalías obligan a ajustes en muchos lugares y a reconciliar desvíos); caché del JSON completo (cada lectura transfiere y parsea toda la clasificación).

## ADR-024 — Foto oficial diaria del ranking con `upsertJobScheduler` de BullMQ por país

2026-11-23 · Cada país activo tiene un programador BullMQ `daily-snapshot:{code}` con `pattern = RANKING_SNAPSHOT_CRON` (23:55 por defecto) y `tz` = zona del país, en la cola `rankings`. Todas las instancias lo sincronizan al arrancar (`upsertJobScheduler` es idempotente) y el panel lo resincroniza al modificar un país (activarlo, desactivarlo o cambiarle la zona horaria). El worker (`JOBS_WORKER_ENABLED`, activo por defecto y separable en otro proceso) toma la foto con `takeDailySnapshot` desde PostgreSQL. **El día de la foto es el de la hora programada** (`job.opts.prevMillis`), no el de ejecución: un reintento o una cola atrasada después de medianoche no cambia el día. Solo se fotografía un periodo `OPEN` vigente; si venció sin cerrarse se registra una advertencia y no se agrega foto. Es idempotente por día (clave única + `skipDuplicates`: se conserva la primera). 5 reintentos con espera exponencial desde 30 s.
· El periodo de ranking pedía "foto oficial diaria con un trabajo programado por país" (§11) y solo se tomaba al cerrar el periodo. A las 23:55 locales, la foto recoge el día casi completo y queda con el día correcto. · **Limitación aceptada:** BullMQ no recupera ejecuciones perdidas; si no hay ningún worker a las 23:55, ese día queda sin foto (una foto tardía no reflejaría el estado de ese día). Alternativas: cron del sistema operativo o de la nube (fuera del repositorio y de las pruebas) y un `setInterval` propio (se duplica en cada instancia).

## ADR-025 — Ranking de farmacia: los puntos cuentan para la farmacia donde se jugó

2026-11-23 · Cada movimiento elegible y cada partida terminada se atribuyen a la farmacia que el dependiente tenía asignada **en ese instante** (`PharmacyAssignment.from ≤ t < to`), con `attributePharmacyPoints` en `@pharma/shared`. Un traslado no se lleva los puntos ya ganados ni hace "activa" a la farmacia nueva hasta que el dependiente juegue allí; quien se traslada a mitad de periodo puede contar como activo en las dos. Lo jugado sin farmacia asignada no cuenta para ninguna farmacia (sí en el ranking individual). El ranking individual y los puntos del dependiente no cambian con un traslado.
· `CLAUDE.md` exige que los traslados conserven puntos e historial, pero no dice a qué farmacia van; el cliente no lo definió. Es la opción conservadora: un traslado de fin de periodo no puede cambiar a los ganadores de farmacia, y el ranking refleja dónde se hizo el esfuerzo. Antes todos los puntos del periodo se iban con el dependiente a su farmacia actual. · **Reversible por configuración de código** si el cliente prefiere "los puntos siguen al dependiente": basta con atribuir todo a la asignación vigente. Confirmar con el cliente antes del piloto.

Relacionado: la vista de usuario del panel calculaba los puntos excluyendo `onHold`, una marca inmutable que no cambia al descartar la alerta; ahora usa la misma regla que el ranking (alertas `OPEN`/`CONFIRMED`).

## ADR-026 — La API sigue funcionando con Redis caído

2026-11-23 · Redis es caché, contadores y colas, no la fuente de verdad. Con Redis caído: (1) el límite general por IP y por usuario **falla abierto** (registra y deja pasar), y las rutas con política propia (`/auth/otp/*`, `/auth/refresh`) **fallan cerradas** con 503, porque sin contador no hay protección contra fuerza bruta y el OTP vive en Redis; (2) todo error de "Redis no disponible" se responde como `503 SERVICE_UNAVAILABLE` con `Retry-After: 30`, no 500; (3) la programación de la foto diaria corre en segundo plano y se completa sola cuando Redis vuelve; (4) encolar un OTP tiene un tope de 3 s; (5) cerrar colas y workers de BullMQ tiene un tope de 3 s, así el apagado ordenado no se cuelga; (6) los errores de conexión se registran como mucho una vez cada 30 s. Configuración de país, consentimiento, rankings y topes ya caían a PostgreSQL. `/ready` sigue respondiendo 503 para que el balanceador lo vea.
· La revisión (A5) encontró que cualquier caída de Redis convertía cada solicitud en 500, y al probarlo apareció algo peor: **la API no arrancaba** (la programación de la foto diaria esperaba a BullMQ sin límite) y el apagado se colgaba. Prueba: `test/integration/redis-down.int.test.ts` arranca la API sin Redis y juega una partida completa. · Alternativa descartada: fallar cerrado en todo (más simple, pero un Redis caído deja a todos los países sin jugar).

## ADR-027 — Renovación automática del token de acceso en la PWA

2026-11-23 · El token de acceso (15 min) vive en un almacén del módulo `apps/pwa/src/api.ts`, no en el estado de React. `authFetch` lo agrega a cada solicitud y, ante un 401, renueva **una vez** con la cookie de 90 días (`/auth/refresh`, una sola renovación aunque venzan varias solicitudes a la vez) y reintenta. `REFRESH_RACE` (otra pestaña rotó el refresh a la vez) se reintenta hasta 3 veces en lugar de cerrar la sesión. Si la sesión de 90 días terminó, el token queda en `null`, la app vuelve al ingreso y avisa "Tu sesión terminó". El juego ya no depende del token en React: renovarlo **no desmonta una partida en curso**. Las consultas de TanStack Query se identifican por usuario, no por token.
· Antes la PWA solo renovaba al abrirse: a los 15 minutos de uso toda llamada fallaba hasta recargar (A6 de la revisión). · Alternativa: renovar por temporizador antes del minuto 15 (falla igual si el celular suspende la pestaña; el reintento ante 401 cubre ambos casos).

## ADR-028 — `@playwright/test` como dependencia y E2E en CI

2026-11-23 · `@playwright/test` (Apache-2.0, solo desarrollo) queda en el `package.json` raíz con la versión exacta del Playwright preinstalado en el entorno de desarrollo, más `pnpm test:e2e`. `playwright.config.ts` levanta la API (build), la PWA y el panel con `vite preview` (o reutiliza servidores ya en marcha), y el CI instala Chromium y WebKit y corre Pixel 5 e iPhone 12. · Las pruebas E2E existían pero el repositorio no declaraba la dependencia, así que no se podían ejecutar. Además, el helper OTP leía a veces el código de una ejecución anterior e `isVisible({ timeout })` no esperaba la pantalla de consentimiento.

## ADR-029 — Anomalías y bono de velocidad con tiempos del servidor

2026-11-23 · Al terminar la partida, `serverObservedTimes` calcula el tiempo de cada respuesta según el **servidor**, con `SessionAnswer.receivedAt`: el intervalo desde la llegada anterior (o desde el inicio de la partida), repartido entre las respuestas que llegaron juntas en un lote. `FAST_ANSWER` usa el menor entre ese tiempo y el que declara el cliente, así que declarar más tiempo no evita la alerta (`details.detectedByServerOnly` cuenta las que solo el servidor detectó). El bono de velocidad sigue usando solo el tiempo del servidor y es 0 si la respuesta llegó más rápido que `minAnswerMs`. Un lote enviado al reconectar después de jugar sin red tiene un intervalo largo y no se marca: el SDK envía lo pendiente en un solo lote. Sin cambios de esquema.
· La revisión (A1) mostró que un script podía enviar `clientElapsedMs: 5000` para esquivar `FAST_ANSWER` y, enviando respuestas sueltas en ráfaga, cobrar casi el bono máximo en cada una. · Límite conocido: un script que espera ~1 s entre respuestas parece una persona rápida; lo cubren `PERFECT_STREAK`, `HIGH_FREQUENCY` y los topes diarios.

## ADR-030 — Service worker de la PWA con `vite-plugin-pwa` (Workbox)

2026-11-23 · `vite-plugin-pwa@1.3.0` (MIT, solo build) genera el service worker con Workbox; en el cliente solo se suma `workbox-window@7.4.1` (MIT, ~2,4 KB gzip, se carga aparte del bundle inicial). Se precargan el HTML, el JS, el CSS, los íconos y el manifiesto, **incluidos los dos moldes de juego**, así la app abre sin red. La API (`/api/*`), `/health` y `/ready` **nunca** se cachean: puntajes, preguntas y rankings son siempre del servidor. `registerType: 'prompt'`: una versión nueva queda en espera y la app la ofrece con un aviso "Hay una versión nueva — Actualizar" solo fuera de una partida, para no recargar a mitad del juego. Un aviso global indica cuando no hay conexión (durante la partida: "tus respuestas se guardan y se envían al volver la red"). Se mantiene `public/manifest.webmanifest`.
· La revisión (A2) encontró que no había service worker: sin red la app no abría (§5 y §11 piden Workbox, pantalla sin conexión amigable y actualización sin romper partidas). JS inicial después del cambio: 94,1 KB gzip (límite 300). · Alternativa: un service worker escrito a mano (habría que mantener la lista de precarga y las revisiones a mano en cada build).
