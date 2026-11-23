# Revisión de arquitectura — pharma-games-mvp

Fecha: 2026-11-23 · Alcance: todo el repositorio (commit `31f0286`) contrastado con `CLAUDE.md` · Revisor: análisis independiente, sin cambios en el código.

> **Actualización 2026-11-23:** C1, C2, C4 y B2 están corregidos y la foto diaria de A3 está programada (C2 medido en `docs/informe-carga.md` §3.4) y verificados con PostgreSQL y Redis reales (ver ADR-021, ADR-022 y `apps/api/test/integration/fair-play.int.test.ts`). Los topes diarios ya no tienen carrera, pero el código muerto de M2 (contadores en Redis) sigue ahí. El resto de los hallazgos sigue abierto.

## 1. Resumen ejecutivo

El MVP tiene una **base sólida en seguridad de identidad y en el modelo de datos**: libro de puntos inmutable con trigger en PostgreSQL, refresh tokens rotados por familia, OTP guardado como HMAC, país fijado con actualización condicional, consentimiento que bloquea por defecto, logs sin datos personales y una PWA liviana (≈ 95 KB gzip).

Pero **el MVP no está listo para el piloto**. `PLAN.md` y `docs/informe-carga.md` dan las iteraciones 0–6 por terminadas, y el código no lo respalda en cuatro puntos:

1. **Juego justo:** una partida puede acreditar puntos dos veces (condición de carrera en `finish`), y la detección de anomalías se basa en tiempos que declara el cliente.
2. **Escalabilidad:** cada consulta de ranking recalcula todo el país desde PostgreSQL y hace miles de `ZADD` secuenciales a Redis. Los sorted sets nunca se leen.
3. **Evidencia de carga:** el informe k6 no se puede reproducir con lo que hay en el repositorio (no hay Dockerfile, ni compose con 2 réplicas, y el script solo llama a `GET /games` aceptando 401).
4. **CI roto:** `pnpm install --frozen-lockfile` falla y `pnpm test` falla en un checkout limpio.

| Severidad  | Cantidad |
| ---------- | -------- |
| 🔴 Crítico | 4        |
| 🟠 Alto    | 7        |
| 🟡 Medio   | 8        |
| 🟢 Bajo    | 3        |

## 2. Verificación ejecutada

| Comando                                              | Resultado                                                                                                                                                      |
| ---------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `pnpm install --frozen-lockfile`                     | ❌ **Falla**: los especificadores de `apps/pwa` en `pnpm-lock.yaml` no coinciden con `package.json` (faltan `@pharma/game-*`). Es el primer paso del CI.       |
| `pnpm typecheck` / `pnpm lint` / `pnpm format:check` | ✅ (tras instalar sin `--frozen-lockfile`)                                                                                                                     |
| `pnpm test`                                          | ❌ 1 falla: `iteration3.test.ts › presupuesto de rendimiento` lee `apps/pwa/dist`, que no existe antes de `pnpm build`. El CI ejecuta `test` antes de `build`. |
| `pnpm build` y luego medir el peso                   | ✅ PWA: 94,8 KB gzip el JS inicial; cada juego ≈ 2 KB gzip. Admin: 83,7 KB.                                                                                    |
| `pnpm test:int` (PostgreSQL real)                    | No se ejecuta en el CI. Solo cubre `auth` y `scope`.                                                                                                           |

## 3. Hallazgos

### 🔴 C1 — ✅ Corregido el 2026-11-23 (ADR-021) — Doble acreditación de puntos y topes diarios evadibles (carrera en `finishSession`)

`apps/api/src/games/games.service.ts:502-640`

- El estado `FINISHED` se revisa **fuera** de la transacción (línea 502), y la actualización de la línea 614 no tiene condición (`where: { id }`, sin `status: 'IN_PROGRESS'`).
- `PointsLedger` no tiene una restricción única por `(sessionId, reason='GAME')`.
- Los puntos que ya se ganaron en el día se leen antes de la transacción (línea 530), sin bloqueo.

**Escenario:** el SDK reintenta `finish` al reconectar, o un script envía 2 a 5 `finish` en paralelo. Todas las solicitudes ven `IN_PROGRESS` y todas insertan un `GAME` en el libro. El tope diario tampoco se respeta, porque cada una calcula su margen con la misma lectura vieja. Esto rompe la restricción §9 y es justo el tipo de fallo que la red irregular de §4.6 va a provocar.

**Corrección:** dentro de la transacción, `updateMany({ where: { id, status: 'IN_PROGRESS' } })` y abortar si `count !== 1`. Agregar un índice único parcial `PointsLedger(sessionId) WHERE reason = 'GAME'`. Llevar los topes a un `INCRBY` atómico en Redis (o a un `SELECT … FOR UPDATE` sobre una fila de tope por usuario y día) antes de acreditar. Agregar una prueba de integración con PostgreSQL real que lance N `finish` concurrentes.

### 🔴 C2 — ✅ Corregido el 2026-11-23 (ADR-023) — Rankings recalculados por completo en cada solicitud

`apps/api/src/rankings/rankings.service.ts:53-185`

`GET /rankings`, `GET /me/ranking` y `GET /manager/pharmacy/summary` llaman a `computePeriodStandings`, que en cada solicitud:

- carga **todas** las filas de `PointsLedger` del país en el periodo, todas las `GameSession` terminadas, todos los dependientes con su asignación y todas las alertas abiertas o confirmadas;
- ordena en memoria;
- ejecuta un `ZADD` **por cada fila, con `await` secuencial** (≈ 5.000 viajes a Redis por solicitud en PE).

Esos sorted sets **nunca se leen** (no hay `ZREVRANGE` ni `ZREVRANK` en el código) y nunca se limpian.

**Impacto:** con 5.000 dependientes y un periodo de 3 meses, el libro crece a cientos de miles de filas. Al 20 % de 1.125 req/s (≈ 225 req/s de ranking), esto no cumple p95 < 300 ms y satura PostgreSQL. Además incumple §11 ("ranking en vivo desde Redis").

**Corrección:** al terminar una partida, `ZINCRBY rank:{periodId}:IND {pts} {userId}` (solo con puntos elegibles), más un hash por farmacia con la suma y los activos. Leer con `ZREVRANGE`/`ZREVRANK`. Al resolver una anomalía, ajustar con `ZINCRBY` negativo. Reconstruir desde PostgreSQL solo en el trabajo diario o de recuperación. Como mínimo inmediato, cachear el resultado de `computePeriodStandings` unos 30–60 s por país.

### 🔴 C3 — El informe de carga no tiene respaldo reproducible

`docs/informe-carga.md`, `tests/load/peak.k6.js`, `infra/`

- `peak.k6.js` solo llama a `GET /games` en el escenario "juego" (no inicia, no responde, no termina partidas) y su `check` acepta `401` como éxito.
- Usa un **único** `ACCESS_TOKEN`, así que el límite por usuario (`300/min`, `rate-limit.ts`) devolvería 429 casi enseguida. Desde una sola IP, el límite de `1200/min` también se agota en ≈ 1 s a 1.125 req/s. Con esos límites no es posible obtener el "0,02 % de errores" que se reporta.
- No hay Dockerfile de la API, ni servicio `api` en `docker-compose.yml`, ni balanceador, ni réplicas. `infra/terraform/README.md` dice "Pendiente".
- El informe enlaza a `file:///C:/applications/...` y nombra claves de Redis (`country:config:<code>`) que no coinciden con el código (`cfg:country:<code>`).

**Impacto:** el criterio de aceptación de la Iteración 6 no está demostrado, y el riesgo C2 queda oculto. Hay que tratar las cifras del informe como no verificadas.

**Corrección:** Dockerfile multi-etapa, compose con `api` ×2 y nginx o Traefik, y un script de semillas que emita N tokens. Un k6 con flujo completo (start → answers → finish) y con `expectedStatuses` solo 2xx. Desactivar o elevar el límite por IP para la IP del generador de carga, y volver a medir.

### 🔴 C4 — ✅ Corregido el 2026-11-23 — El CI no puede pasar

`.github/workflows/ci.yml`, `pnpm-lock.yaml`, `apps/api/test/iteration3.test.ts:314`

- El lockfile está desincronizado, así que el paso `pnpm install --frozen-lockfile` falla.
- La prueba de presupuesto de peso depende de `apps/pwa/dist`, que se genera después (`test` corre antes de `build`). En un checkout limpio falla.
- `test:int`, que corre contra PostgreSQL y Redis reales y ya existe, **no está en el CI**, aunque el workflow levanta ambos servicios.

**Corrección:** regenerar y commitear el lockfile. Mover la verificación de peso a un paso posterior a `build` (por ejemplo, un script `size-check`). Agregar `pnpm test:int` al workflow.

### 🟠 A1 — Las anomalías y el bono de velocidad se pueden manipular desde el cliente

`packages/shared/src/fair-play.ts:39`, `games.service.ts:452`

- `FAST_ANSWER` compara el `clientElapsedMs` que **declara el cliente**. Un script que responde en 200 ms solo tiene que enviar `clientElapsedMs: 2000`. La regla `SHORT_SESSION` sí usa el reloj del servidor, pero basta con esperar unos 15 s antes de enviar.
- El bono de velocidad mide desde _la respuesta anterior recibida_ (o desde `startedAt`), no desde que se mostró la pregunta. Si se espera y luego se envían 10 respuestas sueltas a 50 ms de distancia, de la 2.ª a la 10.ª reciben casi el bono máximo.

**Corrección:** para `FAST_ANSWER`, usar `serverElapsedMs` cuando exista y marcar como anomalía una diferencia grande entre el tiempo del cliente y el del servidor. Calcular el bono con el tiempo del servidor entre respuestas, con un tope de `secondsPerQuestion`, y anular el bono si el intervalo es menor que `minAnswerMs`. La prueba de aceptación "script a 200 ms" debería incluir un script que miente sobre `clientElapsedMs`.

### 🟠 A2 — La PWA no tiene service worker

`apps/pwa` (no hay Workbox ni `serviceWorker.register`)

Solo hay `manifest.webmanifest`. No hay caché del shell, ni pantalla sin conexión, ni actualización controlada del SW, así que se incumplen §5 y §11 (PWA). Las respuestas sí se encolan en IndexedDB (SDK), pero si se recarga sin red la app no abre.

**Corrección:** `vite-plugin-pwa` (MIT) con `registerType: 'prompt'`, precache del shell y de los chunks de los juegos, y `NetworkOnly` para `/api`. No llamar a `skipWaiting` mientras haya una partida activa.

### 🟠 A3 — 🟡 Parcial el 2026-11-23 (ADR-024: foto diaria programada por país) — Faltan los trabajos programados

BullMQ solo se usa para el OTP (`otp-queue.ts`). No existe:

- la **foto oficial diaria por país** (`takeDailySnapshot` solo se invoca al cerrar el periodo);
- la detección asíncrona de anomalías, ni importaciones o exportaciones en cola (la importación CSV corre de forma síncrona dentro de la solicitud).

Esto incumple §5, §9 y §11.

**Corrección:** `Queue.upsertJobScheduler` (BullMQ) con un cron por país en su zona horaria (`America/Lima`, …), y un worker separable que se active con `WORKERS_ENABLED`.

### 🟠 A4 — Las reglas críticas se prueban con Prisma simulado, y el código de producción está adaptado a los mocks

`apps/api/test/iteration2..6.test.ts` (entre 19 y 32 usos de `vi.fn`/mocks por archivo), `games.service.ts:654,678-681`, `rankings.service.ts:164-176`

En producción aparecen `tx.usageEvent?.create?.(...)`, `this.redis.client.incrby?.(...)` y `zadd?.` con `catch {}` y el comentario _"si el mock de Redis no implementa zadd"_. Las pruebas simuladas no detectan carreras, restricciones ni triggers; por eso C1 pasa sin que nada falle.

**Corrección:** quitar el encadenamiento opcional y los `catch` vacíos. Llevar los escenarios de puntos, topes, anomalías, ranking de farmacia y traslado a `test/integration` con la base de datos real (ya existe `harness.ts`).

### 🟠 A5 — ✅ Corregido el 2026-11-23 (ADR-026) — Si Redis cae, se cae toda la API

`apps/api/src/common/rate-limit.ts:32-40`

`RateLimitGuard` es global y `hit()` no captura errores. Como `enableOfflineQueue: false`, una caída de Redis convierte **cada solicitud** en un 500. Eso contradice el principio que declara el propio código ("la caché nunca es la fuente de verdad") y el objetivo de 99,5 %.

**Corrección:** fallar abierto (con un log y una métrica) para el límite general, y fallar cerrado solo en rutas sensibles (`/auth/otp/*`).

### 🟠 A6 — El token de acceso vence a los 15 minutos sin renovación

`apps/pwa/src/App.tsx:94`, `apps/pwa/src/api.ts`

La PWA solo llama a `refreshSession()` al cargar. No hay reintento ante un 401. Después de 15 minutos de uso, todas las llamadas fallan hasta que el usuario recarga la página, lo que anula en la práctica la "sesión de 90 días".

**Corrección:** un wrapper `fetch` que ante un 401 haga un refresh único (con _single-flight_) y reintente, o un refresh proactivo al minuto 14.

### 🟠 A7 — Observabilidad e infraestructura incompletas

No hay métricas Prometheus (`/metrics`), ni OpenTelemetry, ni Dockerfile, ni Terraform (§5, §11). `/health`, `/ready`, pino con redacción y `enableShutdownHooks` sí están.

### 🟡 Medios

| ID  | Hallazgo                                                                                                                                                                                                                     | Ubicación                                     | Recomendación                                                                                                                |
| --- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------- |
| M1  | `maxSessionsPerGamePerDay` se verifica con `count` y luego `create`, sin atomicidad: con solicitudes paralelas se puede superar                                                                                              | `games.service.ts:286-347`                    | `INCR` en Redis con TTL al fin del día local, o una restricción en la base de datos                                          |
| M2  | Los contadores `cap:user`/`cap:brand` de Redis se escriben pero **nunca se leen** (código muerto que confunde)                                                                                                               | `games.service.ts:675-681`                    | Usarlos como fuente de topes (ver C1) o eliminarlos                                                                          |
| M3  | La documentación no coincide con el código: ADR-017 dice "script Lua atómico" (el código hace `hget` y luego `hincrby`) y ADR-019 dice 10 s (el código usa 15 s)                                                             | `otp.service.ts:65-68`, `token.service.ts:21` | Implementar el Lua o corregir los ADR                                                                                        |
| M4  | ✅ Corregido el 2026-11-23 (ADR-025): los puntos cuentan donde se jugaron. Antes: el ranking de farmacia usa la asignación **actual**: al trasladar a alguien, sus puntos del periodo se van a la farmacia nueva. No hay ADR | `rankings.service.ts:113-127`                 | Decidirlo con el cliente. La opción conservadora es atribuir por `PharmacyAssignment` vigente al momento de la partida       |
| M5  | El catálogo de juegos no tiene caché en Redis (§11): `GET /games` hace 3 o 4 consultas a PostgreSQL cada vez, y es el 70 % del tráfico                                                                                       | `games.service.ts:133-246`                    | Cachear por país con invalidación al publicar                                                                                |
| M6  | `AppModule` registra los ~25 proveedores y controladores en un único módulo; hay archivos de más de 700 líneas (`admin/main.tsx` 1.423, `pwa/App.tsx` 895 en un solo componente)                                             | `app.module.ts`, `apps/*/src`                 | Módulos Nest por dominio; separar las pantallas en rutas o componentes (React Router está instalado y no se usa como router) |
| M7  | `computeEligiblePointsByUser` carga **todas** las alertas abiertas o confirmadas del país, sin filtrar por periodo                                                                                                           | `admin-anomalies.service.ts:186-195`          | Filtrar por las sesiones del periodo                                                                                         |
| M8  | La importación CSV de 5.000 filas corre dentro de la solicitud HTTP                                                                                                                                                          | `admin-users-pharmacies.service.ts:468+`      | Pasarla a BullMQ con `ImportJob` como estado (§5)                                                                            |

### 🟢 Bajos

- **B1** `sourcemap: true` en el build de la PWA publica los mapas en producción (`apps/pwa/vite.config.ts:29`). Conviene usar `'hidden'`.
- **B2** ✅ Corregido el 2026-11-23. `winners.csv` escapa las comillas, pero no aplica la protección contra inyección de fórmulas que ya existe en `@pharma/shared/csv` (`rankings.service.ts:600-610`).
- **B3** El paso de semillas del CI se ejecuta dos veces a propósito (idempotencia), pero sin un `prisma migrate reset` previo eso no prueba que una base limpia funcione desde cero.

## 4. Fortalezas (conservar)

- **Inmutabilidad real:** un trigger `forbid_mutation` en `PointsLedger` y `AdminAuditLog` (UPDATE, DELETE y TRUNCATE); las anulaciones son movimientos `REVERSAL` auditados con `reversesId @unique`.
- **Autenticación:** JWT HS256 con `aud` (`pwa`/`admin`) e `iss`; refresh opaco guardado como SHA-256, rotación condicional y revocación de la familia si se reutiliza; OTP con HMAC y comparación en tiempo constante; la respuesta de solicitud de OTP no revela si la cuenta existe; límite de envíos por número y por documento.
- **Multi-país:** el país se fija con `updateMany` condicional; `adminCountries.scoped()` y una prueba de integración de alcance para `COUNTRY_ADMIN`.
- **Datos personales:** redacción de `authorization`, `cookie` y `body` en pino; IP truncada en el consentimiento; documento guardado como HMAC; teléfono enmascarado en las vistas; `sanitizeUsagePayload`.
- **Configuración:** Zod sobre `process.env`, que en producción rechaza secretos débiles, el proveedor de consola y las cookies sin `Secure`.
- **Contrato de juegos:** `toPublicQuestion` proyecta sin `correctAnswer`; el token de partida usa HMAC con `timingSafeEqual`; el SDK tiene una cola en IndexedDB; los juegos se cargan con `import()` dinámico.
- **Peso:** 95 KB gzip, muy por debajo del presupuesto de 300 KB.

## 5. Plan de remediación sugerido (antes del piloto en Perú)

| Prioridad | Acción                                                                                             | Esfuerzo estimado |
| --------- | -------------------------------------------------------------------------------------------------- | ----------------- |
| 1         | C4: lockfile, orden de test y build, `test:int` en CI                                              | 0,5 día           |
| 2         | C1 + M1 + M2: `finish` atómico, índice único parcial, topes atómicos y prueba de concurrencia real | 1–2 días          |
| 3         | A5 + A6: rate limit que falla abierto y renovación automática del token                            | 1 día             |
| 4         | C2 + M5 + M7: ranking incremental en Redis y caché del catálogo                                    | 2–3 días          |
| 5         | A1: anomalías y bono de velocidad con tiempos del servidor                                         | 1 día             |
| 6         | A3: trabajos programados (foto diaria por país, importaciones)                                     | 1–2 días          |
| 7         | A2: service worker                                                                                 | 1 día             |
| 8         | C3 + A7: Dockerfile, compose ×2, k6 realista, `/metrics`, y repetir el informe de carga            | 2–3 días          |
| 9         | A4 + M6: quitar el código adaptado a mocks, modularizar, más pruebas de integración                | continuo          |

Hasta cerrar los puntos 1–4, `PLAN.md` debería volver a marcar las Iteraciones 3, 4, 5 y 6 como **parcialmente cumplidas**.
