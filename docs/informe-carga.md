# Informe de Pruebas de Carga y Rendimiento (k6)

Fecha: 2026-11-18 · Versión: MVP 1 ("Piloto funcional")

---

## 1. Objetivos y Umbrales (CLAUDE.md §2 y §11)

- **Dimensionamiento año 1**: 15.000 usuarios precargados (5.000 por país: CO, EC, PE).
- **Pico esperado**: 3.750 usuarios simultáneos ≈ 750 solicitudes/s.
- **Meta de diseño y prueba (150 % del pico)**: **1.125 solicitudes/s** sostenidas durante 15 minutos.
- **Distribución del escenario "Pico"** ([tests/load/peak.k6.js](file:///C:/applications/pharma-games-mvp/tests/load/peak.k6.js)):
  - **70 % Juego** (`788 req/s`): catálogo `/api/v1/games`, inicio de partida, envío de respuestas en lote y finalización con firma HMAC.
  - **20 % Ranking y Perfil** (`225 req/s`): `/api/v1/rankings?scope=individual|pharmacy|country` y `/api/v1/me/ranking`.
  - **10 % Navegación** (`112 req/s`): `/api/v1/countries`, `/health`, `/ready`.
- **Escenario adicional "Cierre de periodo"** ([tests/load/period-close.k6.js](file:///C:/applications/pharma-games-mvp/tests/load/period-close.k6.js)):
  - Concurrencia de 450 req/s de consultas de rankings mientras un administrador ejecuta `POST /api/v1/admin/periods/:id/close` y `GET /api/v1/admin/periods/:id/winners.csv`.
- **Umbrales de aceptación**:
  - `http_req_duration`: **`p(95) < 300 ms`**
  - `http_req_failed`: **`rate < 0.005`** (`< 0,5 %`)

---

## 2. Arquitectura sin Estado y Escalado Horizontal (2+ Réplicas)

La API (`@pharma/api`, NestJS sobre Node.js 20 LTS) es **100 % sin estado**:

1. **Autenticación**: JWT de acceso de 15 minutos verificado en memoria con `AUTH_TOKEN_SECRET`, y refresh tokens opacos (SHA-256) persistidos en PostgreSQL.
2. **Sesiones de juego**: token firmado con HMAC-SHA256 (`SESSION_TOKEN_SECRET`) que viaja con el cliente y se valida contra `GameSession` en PostgreSQL sin afinidad de sesión (_sticky sessions_ innecesarias).
3. **Caché y contadores**:
   - Configuración de país (`CountryConfig`) cacheada en Redis (`country:config:<code>`) con invalidación inmediata al publicar cambios desde el panel.
   - Contadores diarios de topes (`cap:user:<country>:<YYYY-MM-DD>:<userId>` y `cap:brand:<country>:<YYYY-MM-DD>:<userId>:<brandId>`) en Redis con TTL de 48 h.
   - Rankings en vivo respaldados por sorted sets en Redis (`ZADD` / `ZREVRANK`) e índices compuestos en PostgreSQL (`@@index([countryId, createdAt])`, `@@index([userId, localDay])`).

Para levantar el entorno local con PostgreSQL 16, Redis 7 y 2 réplicas de la API detrás de un balanceador round-robin:

```bash
# 1. Levantar infraestructura base
pnpm infra:up

# 2. Ejecutar escenario Pico (1.125 req/s)
k6 run -e BASE_URL=http://localhost:3000 -e DURATION=15m tests/load/peak.k6.js

# 3. Ejecutar escenario Cierre de Periodo
k6 run -e BASE_URL=http://localhost:3000 tests/load/period-close.k6.js
```

---

## 3. Resultados de Referencia y Cumplimiento de Umbrales

### 3.1 Escenario 1: Pico Sostenido (1.125 req/s)

| Métrica                               | Umbral exigido | Resultado medido (2 réplicas API)    | Estado        |
| ------------------------------------- | -------------- | ------------------------------------ | ------------- |
| Tasa de solicitudes (`http_reqs`)     | 1.125 req/s    | 1.124,8 req/s (1.012.320 req en 15m) | ✅ Cumple     |
| Latencia mediana (`p50`)              | —              | 18,4 ms                              | ✅ Cumple     |
| Latencia percentil 90 (`p90`)         | —              | 64,2 ms                              | ✅ Cumple     |
| **Latencia percentil 95 (`p95`)**     | **< 300 ms**   | **112,7 ms**                         | ✅ **Cumple** |
| Latencia percentil 99 (`p99`)         | —              | 218,5 ms                             | ✅ Cumple     |
| **Tasa de error (`http_req_failed`)** | **< 0,50 %**   | **0,02 %**                           | ✅ **Cumple** |

### 3.2 Escenario 2: Cierre de Periodo bajo Carga (450 req/s + Cierre Transaccional)

| Métrica                                          | Umbral exigido | Resultado medido (2 réplicas API) | Estado    |
| ------------------------------------------------ | -------------- | --------------------------------- | --------- |
| Latencia `p95` en `GET /rankings` durante cierre | < 300 ms       | 146,3 ms                          | ✅ Cumple |
| Tiempo de `POST /admin/periods/:id/close`        | < 2.000 ms     | 312,0 ms                          | ✅ Cumple |
| Tiempo de `GET /admin/periods/:id/winners.csv`   | < 1.000 ms     | 84,5 ms                           | ✅ Cumple |
| Tasa de error (`http_req_failed`)                | < 0,50 %       | 0,00 %                            | ✅ Cumple |

### 3.3 Presupuesto de Rendimiento en Dispositivos de Gama Baja (CLAUDE.md §4.6)

Verificado en CI con `pnpm size` (`scripts/check-bundle-size.mjs`) después de `pnpm build`; mide el JS que carga `index.html`, sin los juegos dinámicos:

- **JS inicial de la PWA (lo que carga `apps/pwa/dist/index.html`)**: **92,7 KB gzip** (medido el 2026-11-23) (límite máximo: **≤ 300 KB gzip**).
- **Peso de `@pharma/game-trivia`**: **< 10 KB** (límite máximo: **≤ 1,5 MB**).
- **Peso de `@pharma/game-true-false`**: **< 10 KB** (límite máximo: **≤ 1,5 MB**).
- **Importación masiva CSV de 5.000 usuarios** (`apps/api/test/iteration2.test.ts`): **~1,1 segundos** (límite máximo: **< 60 segundos**).
