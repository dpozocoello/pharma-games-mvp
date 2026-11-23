# Plataforma de Juegos de Capacitación Farmacéutica — MVP 1 ("Piloto Funcional")

Plataforma web móvil instalable (**PWA**) y panel de administración multi-país (**Colombia, Ecuador y Perú**) con juegos cortos (2–3 minutos), libro de puntos inmutable, control de juego justo, rankings por periodo (individual, promedio por dependiente activo en farmacia y país), panel del gerente de farmacia y medición de conocimiento inicial por marca.

> **Aviso de confidencialidad y datos ficticios**: Todo el contenido incluido en este repositorio (marcas A–I, preguntas, farmacias, nombres, documentos y teléfonos) es **100 % ficticio** y no contiene afirmaciones médicas reales ni datos personales reales.

---

## 1. Alcance Implementado (Iteraciones 0 a 6 Completas)

| Módulo                           | Descripción                                                                                                                                                                                                                                                                                                                        | Estado |
| -------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------ |
| **1. Entrada única y país fijo** | Enlace/QR único para CO, EC y PE. Al primer ingreso OTP, el país queda fijado (`countryLockedAt`) y no puede puntuar en otro país.                                                                                                                                                                                                 | ✅     |
| **2. Ingreso OTP y sesiones**    | Celular o documento (`HMAC-SHA256`) + OTP de 6 dígitos por WhatsApp con **respaldo automático por SMS** (`OtpDeliveryService`). Access JWT (15 min) + Refresh opaco rotativo (90 días, `HttpOnly`, `SameSite=Lax`).                                                                                                                | ✅     |
| **3. Administración de países**  | Alta y configuración en caliente (sin redespliegue): términos locales (`botica`/`droguería`/`farmacia`), marcas activas, reglas de puntos, periodo de ranking (1, 2 o 3 meses) y versiones de consentimiento legal.                                                                                                                | ✅     |
| **4. Usuarios y farmacias**      | Carga masiva CSV (5.000 filas en ~1 s < 60 s) con reporte de errores por fila ([docs/formato-csv.md](docs/formato-csv.md)), CRUD de farmacias y traslados (`POST /admin/users/:id/transfer`) conservando puntos e historial (`PharmacyAssignment`).                                                                                | ✅     |
| **5. Roles y permisos**          | `SUPER_ADMIN`, `COUNTRY_ADMIN`, `CONTENT_EDITOR`, `PHARMACY_MANAGER`, `CLERK` con aislamiento estricto por `countryId` y separación de audiencias (`pwa` vs `admin`).                                                                                                                                                              | ✅     |
| **6. Marcas y contenido**        | Catálogo de 9 marcas y 14 combinaciones marca-país, carga masiva CSV de preguntas y flujo editorial auditado `DRAFT → IN_REVIEW → PUBLISHED` (solo preguntas `PUBLISHED` entran en partidas).                                                                                                                                      | ✅     |
| **7 + B. Motor y juegos**        | Contrato `@pharma/game-sdk` ([docs/contrato-juegos.md](docs/contrato-juegos.md)) con cola offline (`IndexedDB` + memoria) resistente a cortes de red; moldes `@pharma/game-trivia` (`MULTIPLE_CHOICE`) y `@pharma/game-true-false` (`TRUE_FALSE`) tematizados por marca. `correctAnswer` jamás viaja al cliente.                   | ✅     |
| **8. Puntos y juego justo**      | `PointsLedger` inmutable (trigger PostgreSQL); anulaciones mediante movimiento inverso `REVERSAL` (`reversesId`); topes diarios por usuario (`300`) y por marca (`120`) en zona horaria local; detección de anomalías (`FAST_ANSWER` < 800 ms, `SHORT_SESSION`, `PERFECT_STREAK`, `HIGH_FREQUENCY`) con retención `onHold = true`. | ✅     |
| **9. Rankings**                  | En vivo y foto oficial diaria (`RankingSnapshot`): Individual, **Farmacia (promedio de puntos por dependiente activo, excluyendo farmacias con 0 activos)** y País. Cierre de periodo y exportación CSV de ganadores (`winners.csv`).                                                                                              | ✅     |
| **10. Panel del gerente**        | Vista de solo lectura (`GET /manager/pharmacy/summary`): % de participación del equipo, quién no ha ingresado y posición de su farmacia.                                                                                                                                                                                           | ✅     |
| **11. Perfil del dependiente**   | Puntaje del periodo, posiciones individual y de farmacia, partidas jugadas y marcas pendientes (`GET /me/ranking`).                                                                                                                                                                                                                | ✅     |
| **12. Medición y carga**         | Test inicial de conocimiento por marca (`GET /tests/pending`, `POST /tests/:id/submit`), eventos de uso sin PII (`POST /events`), reporte de participación CSV (`GET /admin/reports/participation.csv`) y pruebas k6 a 1.125 req/s ([docs/informe-carga.md](docs/informe-carga.md)).                                               | ✅     |

---

## 2. Arquitectura y Estructura del Monorepo

```text
/
├─ apps/
│  ├─ pwa/              # React 18 + Vite + TanStack Query (Dependiente y Gerente de Farmacia, JS inicial ≤ 91 KB gzip)
│  ├─ admin/            # React 18 + Vite (Super Admin, Country Admin, Content Editor — app separada)
│  └─ api/              # Node.js 20 LTS + NestJS 11 + Prisma (PostgreSQL 16) + Redis 7 + BullMQ
├─ packages/
│  ├─ shared/           # Esquemas Zod, tipos, reglas de juego justo, rankings, parser CSV, i18n, zonas horarias
│  ├─ game-sdk/         # Contrato de integración de juegos y cola offline IndexedDB
│  ├─ game-trivia/      # Molde reutilizable: Trivia de opción múltiple (< 10 KB)
│  └─ game-true-false/  # Molde reutilizable: Verdadero / Falso (< 10 KB)
├─ infra/
│  ├─ docker-compose.yml
│  └─ terraform/        # Infraestructura como código de referencia
├─ tests/
│  ├─ e2e/              # Pruebas E2E móviles con Playwright (Pixel 5 y iPhone 12)
│  ├─ fixtures/         # Archivos CSV válidos e inválidos de prueba
│  └─ load/             # Escenarios de carga k6 (1.125 req/s pico y cierre de periodo)
├─ docs/
│  ├─ arquitectura.md   # Diseño de componentes, datos y seguridad
│  ├─ decisiones.md     # Registro de decisiones de arquitectura (ADR-001 a ADR-025)
│  ├─ contrato-juegos.md# Especificación del SDK de juegos y flujo offline
│  ├─ formato-csv.md    # Especificación de importación/exportación CSV
│  ├─ informe-carga.md  # Informe de pruebas de carga k6 (1.125 req/s) y presupuesto de bundle
│  └─ operacion.md      # Runbook de producción, respaldos PostgreSQL, derechos ARCO y OWASP ASVS L2
└─ CLAUDE.md            # Especificación maestra del proyecto
```

---

## 3. Requisitos Previos

- **Node.js 20 LTS** o superior (`.nvmrc` = `20`)
- **pnpm 9.15+** (`corepack enable` o `npm i -g pnpm@9.15.9`)
- **Docker Desktop** (para levantar PostgreSQL 16 y Redis 7 localmente)

---

## 4. Arranque Rápido en Desarrollo

```bash
# 1. Instalar dependencias del monorepo
pnpm install

# 2. Crear archivo de variables de entorno locales
cp .env.example .env

# 3. Levantar PostgreSQL 16 + Redis 7, aplicar migraciones y arrancar API, PWA y Admin
pnpm dev

# 4. (En otra terminal, la primera vez) Cargar semillas deterministas e idempotentes
pnpm db:seed
```

### URLs Locales

| Servicio                        | URL                                       | Descripción                                                                         |
| ------------------------------- | ----------------------------------------- | ----------------------------------------------------------------------------------- |
| **PWA (Dependiente / Gerente)** | `http://localhost:5173`                   | Entrada única multi-país, juegos, test inicial, rankings, perfil y panel de gerente |
| **Panel de Administración**     | `http://localhost:5174`                   | Configuración de países, importación CSV, banco de preguntas, anomalías y cierres   |
| **API REST**                    | `http://localhost:3000/api/v1`            | Prefijo versionado con respuestas de error RFC 7807                                 |
| **OpenAPI / Swagger**           | `http://localhost:3000/api/docs`          | Documentación interactiva (habilitada fuera de `production`)                        |
| **Sondas de salud**             | `http://localhost:3000/health` · `/ready` | Liveness y Readiness (PostgreSQL + Redis)                                           |

---

## 5. Cuentas Ficticias de Semilla (`pnpm db:seed`)

En modo desarrollo (`MESSAGING_PROVIDER=console`), el código OTP de 6 dígitos se imprime en la consola de la API y también puede consultarse en `GET http://localhost:3000/api/v1/__dev/outbox`.

| Rol                              | País            | Teléfono (`phoneE164`)             | Documento                | App                   |
| -------------------------------- | --------------- | ---------------------------------- | ------------------------ | --------------------- |
| `SUPER_ADMIN`                    | Global          | `+51900000090`                     | `10000090`               | Panel Admin (`:5174`) |
| `COUNTRY_ADMIN`                  | Perú (`PE`)     | `+51900000091`                     | `10000091`               | Panel Admin (`:5174`) |
| `CONTENT_EDITOR`                 | Perú (`PE`)     | `+51900000092`                     | `10000092`               | Panel Admin (`:5174`) |
| `PHARMACY_MANAGER`               | Perú (`PE`)     | `+51900000093`                     | `10000093`               | PWA (`:5173`)         |
| `CLERK` (Dependientes 01..20 PE) | Perú (`PE`)     | `+51900000001` .. `+51900000020`   | `10000001` .. `10000020` | PWA (`:5173`)         |
| `CLERK` (Dependientes 01..20 CO) | Colombia (`CO`) | `+573000000001` .. `+573000000020` | `20000001` .. `20000020` | PWA (`:5173`)         |
| `CLERK` (Dependientes 01..20 EC) | Ecuador (`EC`)  | `+593900000001` .. `+593900000020` | `30000001` .. `30000020` | PWA (`:5173`)         |

---

## 6. Comandos de Verificación y Calidad

| Comando             | Acción                                                                                           |
| ------------------- | ------------------------------------------------------------------------------------------------ |
| `pnpm build`        | Compila todos los paquetes y aplicaciones con Turborepo                                          |
| `pnpm lint`         | Ejecuta ESLint estricto en todo el monorepo                                                      |
| `pnpm typecheck`    | Verifica tipos con `tsc --noEmit` (`strict: true`, `noUncheckedIndexedAccess: true`)             |
| `pnpm test`         | Ejecuta la suite completa de pruebas unitarias y de integración API (Vitest)                     |
| `pnpm test:e2e`     | Ejecuta pruebas E2E móviles en Playwright (emulación Pixel 5 y iPhone 12)                        |
| `pnpm format:check` | Verifica el formato de código con Prettier                                                       |
| `pnpm db:migrate`   | Aplica migraciones Prisma pendientes en PostgreSQL                                               |
| `pnpm db:seed`      | Ejecuta las semillas idempotentes (3 países, 9 marcas, 540 preguntas, tests iniciales, usuarios) |

---

## 7. Documentación Técnica

- [Arquitectura del Sistema](docs/arquitectura.md)
- [Registro de Decisiones de Arquitectura (ADR)](docs/decisiones.md)
- [Contrato del SDK de Juegos (`@pharma/game-sdk`)](docs/contrato-juegos.md)
- [Formato de Archivos CSV e Importación Masiva](docs/formato-csv.md)
- [Informe de Pruebas de Carga (k6 — 1.125 req/s) y Presupuesto de Bundle](docs/informe-carga.md)
- [Manual de Operación, Respaldos, Derechos ARCO y Seguridad OWASP ASVS L2](docs/operacion.md)

## Staging local (configuración de producción)

Con PostgreSQL y Redis en marcha (`pnpm infra:up`):

```bash
infra/staging-local/start.sh          # build + base pharma_staging + 2 réplicas de la API + gateway
node infra/staging-local/emulate.mjs  # recorre el uso real con Playwright y guarda capturas
infra/staging-local/stop.sh
```

Videos de entrega (cada país y cada sección, con subtítulos) y la página para el product owner y el cliente:

```bash
node infra/staging-local/record-demo.mjs /tmp/videos PE,CO,EC   # sobre un staging recién creado
node infra/staging-local/build-entrega.mjs /tmp/videos /tmp/entrega
```

Genera `entrega-mvp.html` (un solo archivo con los videos incrustados) y `web/` (la misma página con los videos aparte). Requiere `ffmpeg`.

PWA en http://localhost:8080, panel en http://localhost:8081. WhatsApp y SMS están simulados: el último código de cada número se ve en `http://localhost:4010/__inbox?to=+51900000001`. Detalle en ADR-032.
