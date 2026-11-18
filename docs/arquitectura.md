# Arquitectura

Estado: Iteración 0 (base). Se actualiza en cada iteración.

## Vista general

```
 Celular (PWA)          Navegador (admin)
      │                        │
      └──── HTTPS /api/v1 ─────┘
                 │
      ┌──────────▼──────────┐   ≥ 2 instancias sin estado
      │   API NestJS (Node) │
      └───┬─────────────┬───┘
          │             │
   PostgreSQL 16     Redis 7
   (verdad, libro    (rankings en vivo, topes diarios,
    de puntos)        caché, colas BullMQ)
```

- **Sin estado:** cualquier instancia atiende cualquier solicitud. El estado vive en PostgreSQL y Redis.
- **Multi-país:** toda entidad de negocio lleva `countryId`; agregar un país es insertar `Country` + `CountryConfig`.
- **El cliente nunca puntúa:** las preguntas se proyectan con `toPublicQuestion` (lista blanca, sin `correctAnswer`).

## Paquetes

| Paquete                                          | Formato                                                                             | Uso                                          |
| ------------------------------------------------ | ----------------------------------------------------------------------------------- | -------------------------------------------- |
| `@pharma/shared`                                 | CommonJS (`dist/`) para Node; las apps Vite importan el código fuente ESM por alias | Esquemas Zod, constantes, i18n, zona horaria |
| `@pharma/game-sdk`                               | ESM                                                                                 | Tipos del contrato de juegos (§8)            |
| `@pharma/game-trivia`, `@pharma/game-true-false` | ESM, carga dinámica                                                                 | Moldes de juego                              |
| `@pharma/api`                                    | CommonJS (NestJS)                                                                   | API                                          |
| `@pharma/pwa`, `@pharma/admin`                   | Vite                                                                                | Frontends separados                          |

## API (Iteración 0)

- `GET /health`: proceso vivo (no consulta dependencias).
- `GET /ready`: PostgreSQL y Redis responden; 503 en caso contrario.
- `GET /api/v1/countries`: países activos (público).
- Errores RFC 7807 (`application/problem+json`), Helmet, CORS con lista blanca, apagado ordenado.
- Logs JSON con pino; se eliminan `authorization`, cookies y cuerpos de solicitud.

## Datos

Esquema en `apps/api/prisma/schema.prisma`. Decisiones relevantes: ADR-004 (UUID v7), ADR-006
(libro de puntos y auditoría inmutables por trigger), ADR-008 (tema de marca), ADR-009 (rol y
alcance), ADR-010 (preguntas compartidas o por país).

Índices clave: ranking por país y periodo (`RankingSnapshot`, `PointsLedger(countryId, createdAt)`),
partidas por usuario y día (`GameSession(userId, startedAt)`, `PointsLedger(userId, localDay)`),
preguntas publicadas por marca y país (`Question(brandId, countryId, status)`).

## Zona horaria

Los topes diarios y las fotos de ranking usan el **día local** del país (`localDay` en
`@pharma/shared`), guardado en `PointsLedger.localDay`. Los periodos se calculan con
`rankingPeriodBounds` (medianoche local → UTC).
