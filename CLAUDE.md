# Prompt maestro — MVP "Plataforma de juegos de capacitación farmacéutica"

> **Cómo usarlo**
> - **Codex / Antigravity:** guarda este archivo como `AGENTS.md` en la raíz de un repositorio vacío (o pégalo como regla del espacio de trabajo).
> - **Claude Code:** guárdalo como `CLAUDE.md` en la raíz del repositorio.
> - **Cualquier agente en chat:** pégalo completo como primer mensaje.
>
> Después, avanza una iteración a la vez con los prompts de arranque de la sección 14.

---

## 1. Rol

Actúa como un equipo senior formado por un **arquitecto de soluciones y datos**, un **desarrollador full-stack TypeScript**, un **ingeniero de QA** y un **ingeniero DevOps/SRE**. Construyes software de producción: seguro, probado, documentado y fácil de mantener por otro proveedor. Prefieres la solución más simple que cumpla los requisitos. No inventes requisitos: si algo no está definido aquí, toma la opción más conservadora, regístrala en `docs/decisiones.md` y continúa.

## 2. Contexto del negocio

Un laboratorio farmacéutico con marcas de venta libre (OTC) quiere reforzar la **recordación de sus marcas** entre los **dependientes de farmacia** que las recomiendan en el punto de venta, en **Colombia, Ecuador y Perú**. La solución es una **web móvil instalable (PWA)** con **juegos cortos** (2–3 minutos, 8–10 preguntas), **puntos**, **rankings por periodo** con premios y un **test de conocimiento inicial y final por marca** que demuestra el aumento de conocimiento.

El éxito del producto se mide así: los dependientes vuelven a jugar y el cliente puede demostrar que mejoró el conocimiento de sus marcas.

### Dimensionamiento

| Dato | Valor |
|---|---|
| Países | Colombia (CO), Ecuador (EC), Perú (PE). Todos en UTC−5 |
| Marcas | 9 únicas, 14 combinaciones marca-país (CO 5, EC 5, PE 4) |
| Usuarios año 1 | 15.000 (5.000 por país), **precargados**; sin autorregistro |
| Pico | 3.750 usuarios simultáneos ≈ 750 solicitudes/s. **Diseñar y probar al 150 % = 1.125 solicitudes/s** |
| Dispositivos | Android de gama baja (2 GB de RAM) e iPhone con Safari. Red móvil irregular |
| Idioma | Español con términos locales por país; preparado para más idiomas |

## 3. Objetivo de este trabajo: el MVP

Construir el **MVP 1, "Piloto funcional"**, listo para un lanzamiento piloto en **Perú**, con la arquitectura preparada para sumar Ecuador y Colombia **por configuración y sin desarrollo**.

### Dentro del alcance del MVP

| # | Módulo | Qué debe hacer en el MVP |
|---|---|---|
| 1 | Entrada única y selección de país | Un enlace y un QR para los tres países. El usuario elige su país en la primera pantalla; al iniciar sesión el país queda **fijado a su cuenta** y no puede puntuar en otro |
| 2 | Ingreso y cuentas | Ingreso con celular o documento + **código OTP por WhatsApp con respaldo SMS**. Sesión larga (90 días). Usuarios precargados |
| 3 | Administración de países | Alta y configuración por país: idioma y términos locales, marcas activas, reglas de puntos, periodo de ranking (1, 2 o 3 meses), texto de consentimiento. **Agregar un país = configuración** |
| 4 | Usuarios y farmacias | Carga masiva por CSV con validaciones y reporte de errores por fila. Cada dependiente pertenece a una farmacia. Altas, bajas y traslados con historial |
| 5 | Roles y permisos | `SUPER_ADMIN`, `COUNTRY_ADMIN`, `CONTENT_EDITOR`, `PHARMACY_MANAGER`, `CLERK` (dependiente), con alcance por país y farmacia |
| 6 | Marcas y contenido | Catálogo de marcas por país. Banco de preguntas por marca con carga CSV. Flujo `DRAFT → IN_REVIEW → PUBLISHED` |
| 7 | Motor de juegos | Sortea preguntas publicadas del banco, entrega la partida al juego, recibe respuestas y **calcula el puntaje en el servidor**. Define el **contrato de integración** (SDK) |
| 8 | Puntos y juego justo | Libro de puntos inmutable, tope diario por usuario y por marca, reintentos limitados, detección de anomalías revisable por el administrador |
| 9 | Rankings | Individual, por farmacia (**promedio de puntos por dependiente activo, no suma**) y por país. Vista en vivo + foto oficial diaria. Cierre de periodo con ganadores exportables en CSV |
| 10 | Panel del gerente de farmacia | Solo lectura: % de su equipo que participó, quién no ha entrado, posición de su farmacia |
| 11 | Perfil del dependiente | Puntaje, posición en rankings, partidas jugadas y marcas pendientes |
| 12 (parcial) | Medición | **Test inicial por marca** y registro de eventos de uso. Reporte de participación básico en CSV |
| B | Juegos | **2 mecánicas** con molde reutilizable: **trivia de opción múltiple** y **verdadero/falso**, tematizables por marca |

### Fuera del alcance del MVP

Test final y reportes avanzados (siguiente iteración), mecánicas "completar la frase" y "emparejar", apps nativas o publicación en tiendas, integración con ventas, premios y su logística, redacción de contenido real, cursos o videos, productos con receta, SSO con sistemas del cliente.

## 4. Restricciones no negociables

1. **El cliente nunca calcula el puntaje.** Las preguntas viajan al celular **sin la respuesta correcta**; el servidor valida, puntúa y registra.
2. **Propiedad del cliente y cero dependencia del proveedor:** solo software de código abierto o servicios reemplazables; nada de licencias que aten. Todo el código, el diseño y los datos son del cliente.
3. **Multi-país desde el día 1:** todo registro de negocio lleva `countryId`; ninguna consulta cruza países salvo para `SUPER_ADMIN`.
4. **Servicios sin estado:** cualquier instancia de la API atiende cualquier solicitud; el estado vive en PostgreSQL y Redis. Escalado horizontal, mínimo 2 instancias.
5. **Datos personales:** cumplimiento de la Ley 1581 (Colombia), la LOPDP (Ecuador) y la Ley 29733 (Perú). Consentimiento versionado por país antes de jugar, finalidad declarada, datos mínimos, sin datos personales en logs.
6. **Rendimiento en gama baja:** JavaScript inicial de la PWA **≤ 300 KB gzip**; cada juego **≤ 1,5 MB** con recursos; la partida sigue funcionando si se corta la red entre preguntas.
7. **Contenido ficticio:** usa marcas y preguntas **inventadas** (los nombres reales están bajo acuerdo de confidencialidad). Nada de afirmaciones médicas reales.

## 5. Pila tecnológica

| Capa | Tecnología |
|---|---|
| Monorepo | pnpm workspaces + Turborepo, TypeScript estricto en todo |
| PWA dependiente y gerente | React 18 + Vite + TypeScript, React Router, TanStack Query, Workbox (service worker), CSS Modules o Tailwind con purga. Sin librerías de UI pesadas |
| Panel de administración | React + Vite (app separada, no se descarga en la PWA del dependiente) |
| API | Node.js 20 LTS + NestJS, validación con Zod (esquemas compartidos), OpenAPI generado |
| Base de datos | PostgreSQL 16 con Prisma (migraciones versionadas) |
| Caché, rankings, topes | Redis 7 (sorted sets, contadores con TTL) |
| Trabajos asíncronos | BullMQ sobre Redis: OTP, cierre diario de rankings, detección de anomalías, importaciones CSV, exportaciones |
| Juegos | Paquetes TypeScript sin framework pesado (DOM + CSS, Canvas solo si hace falta), cargados como módulos dinámicos |
| Pruebas | Vitest (unidad), Supertest (API), Playwright (E2E móvil: Pixel 5 y iPhone 12), k6 (carga) |
| Contenedores e infraestructura | Docker, docker-compose para desarrollo, Terraform de referencia para AWS o GCP (región configurable) |
| Observabilidad | Logs JSON estructurados (pino), métricas Prometheus, trazas OpenTelemetry, endpoint `/health` y `/ready` |

## 6. Estructura del repositorio

```
/
├─ apps/
│  ├─ pwa/              # Dependiente y gerente de farmacia
│  ├─ admin/            # Super admin, admin de país, editor de contenido
│  └─ api/              # NestJS
├─ packages/
│  ├─ shared/           # Esquemas Zod, tipos, constantes, i18n
│  ├─ game-sdk/         # Contrato de integración de juegos
│  ├─ game-trivia/      # Molde: opción múltiple
│  └─ game-true-false/  # Molde: verdadero/falso
├─ infra/
│  ├─ docker-compose.yml
│  └─ terraform/        # Referencia, sin aplicar
├─ tests/
│  ├─ e2e/
│  └─ load/             # Scripts k6
├─ docs/
│  ├─ arquitectura.md
│  ├─ decisiones.md     # Registro de decisiones (ADR breve)
│  ├─ contrato-juegos.md
│  ├─ formato-csv.md
│  └─ operacion.md
└─ AGENTS.md / CLAUDE.md
```

## 7. Modelo de datos (mínimo)

Usa UUID v7 como identificador, `createdAt`/`updatedAt` en todas las tablas y `countryId` en toda entidad de negocio.

| Entidad | Campos clave y reglas |
|---|---|
| `Country` | `code` (CO, EC, PE), `name`, `locale`, `timezone`, `active` |
| `CountryConfig` | `countryId`, `terms` (diccionario de términos locales, JSON), `pointsRules` (JSON validado con Zod), `rankingPeriodMonths` (1, 2 o 3), `consentVersionId` |
| `ConsentVersion` / `UserConsent` | Texto versionado por país; aceptación con fecha, versión e IP truncada |
| `Chain` / `Pharmacy` | Cadena opcional; farmacia con `countryId`, `externalCode` opcional, `name`, `city`, `active` |
| `User` | `countryId` (fijado al primer ingreso), `phoneE164`, `documentHash` (HMAC, nunca en claro en logs), `displayName`, `role`, `status` (ACTIVE, INACTIVE) |
| `PharmacyAssignment` | Historial `userId`, `pharmacyId`, `from`, `to` (los traslados no borran puntos) |
| `Brand` / `BrandCountry` | Marca única y su disponibilidad por país, con tema visual (colores, logo) |
| `Question` | `brandId`, `type` (MULTIPLE_CHOICE, TRUE_FALSE), `prompt`, `options` (JSON), `correctAnswer` (**nunca se expone al cliente**), `locale`, `status` (DRAFT, IN_REVIEW, PUBLISHED, ARCHIVED), `version` |
| `CountryTermOverride` | Ajustes de texto por país para una pregunta compartida |
| `Game` | `brandId`, `mechanic`, `version`, `status` |
| `GameSession` (partida) | `userId`, `gameId`, `countryId`, `questionIds`, `seed`, `startedAt`, `expiresAt`, `finishedAt`, `score`, `status`, `flags` |
| `SessionAnswer` | `sessionId`, `questionId`, `answer`, `clientElapsedMs`, `correct`, `points` |
| `PointsLedger` | **Inmutable.** `userId`, `countryId`, `brandId`, `sessionId?`, `delta`, `reason` (GAME, BONUS, REVERSAL), `createdBy`. Una anulación es un movimiento inverso auditado |
| `AnomalyAlert` | `sessionId`, `rule`, `details`, `status` (OPEN, CONFIRMED, DISMISSED), `reviewedBy` |
| `RankingPeriod` | `countryId`, `startsAt`, `endsAt`, `status` (OPEN, CLOSING, CLOSED) |
| `RankingSnapshot` | Foto diaria: `periodId`, `scope` (INDIVIDUAL, PHARMACY, COUNTRY), `entityId`, `points`, `position`, `activeClerks` |
| `Winner` | `periodId`, `scope`, `entityId`, `position`, `exportedAt` |
| `KnowledgeTest` / `TestResult` | Test por marca y tipo (INITIAL, FINAL); resultado con puntaje y fecha |
| `UsageEvent` | `type`, `userId`, `countryId`, `brandId?`, `payload` (sin datos personales), `occurredAt` |
| `AdminAuditLog` | Toda acción de administración: actor, acción, entidad, antes/después. Sin borrado |
| `ImportJob` | Importaciones CSV: archivo, estado, filas válidas, errores por fila |

Reglas:
- **Dependiente activo** en un periodo = jugó al menos 1 partida terminada en ese periodo (configurable).
- **Ranking de farmacia** = suma de puntos del periodo de sus dependientes ÷ dependientes activos. Con 0 activos no aparece.
- Índices para: ranking por país y periodo, partidas por usuario y día, preguntas publicadas por marca y país.

## 8. Contrato de integración de juegos (`packages/game-sdk`)

Un juego es un **módulo ES** que exporta:

```ts
export interface GameModule {
  manifest: { id: string; mechanic: 'MULTIPLE_CHOICE' | 'TRUE_FALSE'; version: string; maxBundleKb: number };
  mount(container: HTMLElement, ctx: GameContext): GameHandle;
}

export interface GameContext {
  session: { id: string; token: string; expiresAt: string };
  questions: PublicQuestion[];          // SIN respuesta correcta
  theme: { primary: string; secondary: string; logoUrl: string; brandName: string };
  locale: string;                       // es-CO | es-EC | es-PE
  terms: Record<string, string>;        // términos locales
  limits: { secondsPerQuestion: number; totalSeconds: number };
  submitAnswer(a: { questionId: string; answer: string; clientElapsedMs: number }): void; // se encola offline
  finish(): Promise<GameResult>;        // el SDK envía lo pendiente y recibe el puntaje del servidor
  track(event: string, data?: Record<string, unknown>): void;
}

export interface GameHandle { unmount(): void; }
export interface GameResult { score: number; correct: number; total: number; dailyCapReached: boolean; rankPosition?: number }
```

- El SDK guarda las respuestas en `IndexedDB` si no hay red y las envía al reconectar, antes de que expire la sesión.
- Sonido y animación: ligeros y desactivables; respeta `prefers-reduced-motion`.
- Cada molde se tematiza solo con `theme`; un juego nuevo de la misma mecánica = configuración + arte, sin código.
- Documenta el contrato en `docs/contrato-juegos.md` con un ejemplo mínimo de juego.

## 9. Reglas de puntos y juego justo (configurables por país)

Valores por defecto, en `CountryConfig.pointsRules`:

```json
{
  "pointsPerCorrect": 10,
  "speedBonusMax": 5,
  "questionsPerSession": 10,
  "secondsPerQuestion": 20,
  "maxSessionsPerGamePerDay": 3,
  "dailyCapPerUser": 300,
  "dailyCapPerBrand": 120,
  "minAnswerMs": 800,
  "anomaly": { "minSessionMsPerQuestion": 1500, "perfectStreakSessions": 5, "maxSessionsPerHour": 10 }
}
```

- Puntaje = correctas × `pointsPerCorrect` + bono de velocidad calculado con **tiempos del servidor** cuando estén disponibles; el tiempo del cliente solo se usa para detectar anomalías.
- La sesión lleva un **token firmado** (HMAC) con `sessionId`, `userId`, `questionIds` y `expiresAt`. Rechaza sesiones vencidas, terminadas o de otro usuario (respuesta idempotente al reenviar).
- Topes con contadores de Redis por día local del país (`America/Bogota`, `America/Guayaquil`, `America/Lima`). Al alcanzar el tope se puede jugar, pero no suma puntos, y la interfaz lo dice.
- Anomalías (respuestas más rápidas que `minAnswerMs`, sesiones demasiado cortas, rachas perfectas improbables, exceso de sesiones por hora) crean `AnomalyAlert`; los puntos quedan en revisión y **no** cuentan para ganadores hasta que un admin resuelva.

## 10. API (mínimo)

Prefijo `/api/v1`, JSON, errores con formato RFC 7807, OpenAPI en `/api/docs` (solo fuera de producción).

| Área | Endpoints |
|---|---|
| Auth | `POST /auth/otp/request` · `POST /auth/otp/verify` · `POST /auth/refresh` · `POST /auth/logout` · `GET /me` · `POST /me/consent` |
| Países y config | `GET /countries` (público) · `GET/PUT /admin/countries/:code/config` |
| Usuarios y farmacias | `POST /admin/imports/users` (CSV) · `GET /admin/imports/:id` · `GET/POST/PATCH /admin/pharmacies` · `POST /admin/users/:id/transfer` · `PATCH /admin/users/:id/status` |
| Contenido | `GET/POST /admin/brands` · `POST /admin/imports/questions` (CSV) · `PATCH /admin/questions/:id/status` |
| Juego | `GET /games` (por país y marca, con marcas pendientes) · `POST /games/:id/sessions` · `POST /sessions/:id/answers` (lote) · `POST /sessions/:id/finish` |
| Rankings | `GET /rankings?scope=individual\|pharmacy\|country&period=current` · `GET /me/ranking` · `POST /admin/periods/:id/close` · `GET /admin/periods/:id/winners.csv` |
| Gerente | `GET /manager/pharmacy/summary` |
| Medición | `GET /tests/pending` · `POST /tests/:id/submit` · `GET /admin/reports/participation.csv` |
| Anomalías | `GET /admin/anomalies` · `PATCH /admin/anomalies/:id` |

OTP:
- Código de 6 dígitos, vence en 5 minutos, máximo 5 intentos, límite de 3 envíos por número cada 15 minutos.
- Interfaz `MessagingProvider` con `WhatsAppCloudProvider`, `SmsProvider` (respaldo automático si WhatsApp falla) y `ConsoleProvider` para desarrollo.
- Sesión: token de acceso de 15 minutos + refresh de 90 días en cookie `HttpOnly`, `Secure`, `SameSite=Lax`, con rotación.

## 11. Requisitos no funcionales y seguridad

- **Carga:** p95 < 300 ms y errores < 0,5 % a **1.125 solicitudes/s** sostenidas 15 minutos en el escenario k6 "pico" (70 % juego, 20 % ranking/perfil, 10 % navegación), más un escenario "cierre de periodo".
- **Ranking en vivo** desde Redis (`ZADD`/`ZREVRANK`); la foto oficial diaria se guarda en PostgreSQL con un trabajo programado por país.
- **Caché:** catálogo de juegos y configuración de país en Redis con invalidación al publicar.
- **Disponibilidad:** objetivo 99,5 % en horario laboral; `/health` y `/ready`; apagado ordenado.
- **Seguridad:** OWASP ASVS nivel 2 como guía. Helmet, CORS estricto, límite de solicitudes por IP y por usuario, validación de toda entrada, consultas parametrizadas, secretos solo por variables de entorno (`.env.example` sin valores reales), dependencias auditadas en CI.
- **Datos personales:** `documentHash` con HMAC, teléfono enmascarado en interfaces de administración, exportaciones solo para roles autorizados y registradas en auditoría, proceso documentado para derechos de acceso, rectificación y eliminación.
- **Accesibilidad:** contraste AA, objetivos táctiles ≥ 44 px, funciona con fuente grande del sistema.
- **PWA:** manifiesto instalable, funciona en Safari iOS, pantalla sin conexión amigable, actualización del service worker sin romper partidas en curso.

## 12. Plan de iteraciones y criterios de aceptación

Trabaja **una iteración a la vez**. Al terminar cada una: pruebas en verde, `docs/` actualizado y un resumen de lo hecho, lo pendiente y las decisiones tomadas.

**Iteración 0 — Base**
- Monorepo, lint, formato, TypeScript estricto, CI (lint, tipos, pruebas, build), docker-compose con PostgreSQL y Redis, migración inicial, semillas.
- Semillas: 3 países; 9 marcas ficticias (Marca A–I) con la distribución real: 2 en los tres países, 1 en EC y PE, 3 solo en CO, 2 solo en EC, 1 solo en PE; 60 preguntas ficticias por marca; 3 farmacias y 20 dependientes por país; un usuario por rol.
- ✅ `pnpm dev` levanta todo; `pnpm test` pasa; README con instrucciones.

**Iteración 1 — Entrada, ingreso, países y roles (módulos 1, 2, 3, 5)**
- ✅ Un mismo enlace lleva a elegir país; tras el OTP el país queda fijado y no se puede cambiar.
- ✅ OTP con límites y respaldo SMS; sesión de 90 días; consentimiento obligatorio por país.
- ✅ Un `COUNTRY_ADMIN` de PE no ve datos de CO ni de EC (prueba automatizada).
- ✅ Cambiar el periodo de ranking o una regla de puntos se hace desde el panel, sin desplegar.

**Iteración 2 — Usuarios, farmacias y contenido (módulos 4 y 6)**
- ✅ CSV de 5.000 usuarios se importa en < 60 s con reporte de errores por fila; formato documentado en `docs/formato-csv.md`.
- ✅ Traslado entre farmacias conserva puntos e historial.
- ✅ Solo las preguntas `PUBLISHED` entran a una partida; el flujo de aprobación queda auditado.

**Iteración 3 — Motor y juegos (módulo 7 + Parte B)**
- ✅ `game-sdk`, `game-trivia` y `game-true-false` funcionando con el tema de una marca ficticia.
- ✅ La respuesta correcta nunca aparece en la red del cliente (prueba E2E que inspecciona las respuestas HTTP).
- ✅ Una partida se termina tras cortar y restablecer la red a mitad del juego.
- ✅ Cada juego pesa ≤ 1,5 MB y la PWA ≤ 300 KB gzip de JS inicial (verificado en CI).

**Iteración 4 — Puntos y juego justo (módulo 8)**
- ✅ Libro de puntos inmutable; las anulaciones son movimientos inversos auditados.
- ✅ Topes diarios por usuario y por marca respetan la zona horaria de cada país.
- ✅ Un script que responde en 200 ms por pregunta genera alertas y sus puntos no cuentan para ganadores.

**Iteración 5 — Rankings, gerente y perfil (módulos 9, 10, 11)**
- ✅ Rankings individual, farmacia (promedio por activo) y país, con foto diaria y cierre de periodo que exporta ganadores en CSV.
- ✅ Panel del gerente: % de participación, quién no ha entrado y posición de su farmacia.
- ✅ Perfil: puntaje, posiciones, partidas y marcas pendientes.

**Iteración 6 — Medición, carga y endurecimiento (módulo 12 parcial + no funcionales)**
- ✅ Test inicial por marca y eventos de uso; reporte de participación por país, farmacia y marca en CSV.
- ✅ Informe k6 en `docs/informe-carga.md` que cumple los umbrales de la sección 11 (o explica la brecha y la corrección).
- ✅ Revisión de seguridad documentada, respaldo y restauración probados, `docs/operacion.md` completo.

## 13. Forma de trabajar del agente

1. **Antes de escribir código**, crea `PLAN.md` con las tareas de la iteración actual, los riesgos y las preguntas abiertas. Si una decisión es irreversible o costosa, detente y pregunta; si no, decide, regístralo en `docs/decisiones.md` y sigue.
2. Cambios pequeños y verificables. Ejecuta pruebas, lint y tipos antes de dar algo por terminado. No marques una tarea como hecha si una prueba falla.
3. Cada funcionalidad incluye pruebas: unidad para reglas de negocio (puntos, topes, anomalías, ranking de farmacia), integración para la API, E2E para los flujos del dependiente.
4. No agregues dependencias pesadas sin justificar el peso y la licencia en `docs/decisiones.md`.
5. Nunca escribas secretos, datos personales reales ni nombres de marcas reales en el repositorio.
6. Si el contexto se acerca a su límite, actualiza `PLAN.md` con el estado y los siguientes pasos para retomar sin perder información.
7. Al final de cada iteración responde con: qué se hizo, cómo probarlo (comandos), qué quedó pendiente y qué decisiones se tomaron.

**Definición de terminado:** código revisado, pruebas automatizadas en verde, probado en emulación Android de gama baja e iPhone, documentación actualizada y sin advertencias de seguridad críticas.

## 14. Prompts de arranque por iteración

Copia uno a la vez en el agente:

1. `Lee AGENTS.md completo. Crea PLAN.md para la Iteración 0 y ejecútala. Al final, dame los comandos para verificarla.`
2. `Ejecuta la Iteración 1 según AGENTS.md. Empieza actualizando PLAN.md y termina con el resumen de la sección 13.`
3. `Ejecuta la Iteración 2 según AGENTS.md. Incluye un CSV de ejemplo válido y otro con errores en tests/fixtures.`
4. `Ejecuta la Iteración 3 según AGENTS.md. Prioriza el contrato del SDK y documéntalo antes de construir los juegos.`
5. `Ejecuta la Iteración 4 según AGENTS.md. Escribe primero las pruebas de las reglas de puntos, topes y anomalías.`
6. `Ejecuta la Iteración 5 según AGENTS.md. Verifica con pruebas que el ranking de farmacia es un promedio por dependiente activo.`
7. `Ejecuta la Iteración 6 según AGENTS.md. Corre k6 contra el entorno local con docker-compose escalado a 2 réplicas de la API y deja el informe.`

Para revisar el trabajo en cualquier momento:

`Actúa como revisor senior independiente. Contrasta el repositorio con AGENTS.md y lista, por severidad, lo que no cumple (seguridad, juego justo, multi-país, rendimiento, pruebas). No modifiques código; solo informa.`
