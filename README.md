# Plataforma de juegos de capacitación farmacéutica — MVP

PWA con juegos cortos, puntos y rankings para dependientes de farmacia en Colombia, Ecuador y Perú.
Especificación completa en [CLAUDE.md](CLAUDE.md); estado de la iteración actual en [PLAN.md](PLAN.md).

> Todo el contenido (marcas, preguntas, usuarios, teléfonos) es **ficticio**.

## Requisitos

- Node.js 20 LTS o superior (`.nvmrc` = 20)
- pnpm 9 (`npm i -g pnpm@9.15.9`, o `corepack enable` si tienes permisos)
- Docker Desktop (PostgreSQL 16 y Redis 7)

## Primer arranque

```bash
pnpm install
cp .env.example .env        # valores solo de desarrollo
pnpm dev                    # levanta Postgres y Redis, aplica migraciones y arranca todo
pnpm db:seed                # en otra terminal, la primera vez (es idempotente)
```

| Servicio                    | URL                                                        |
| --------------------------- | ---------------------------------------------------------- |
| PWA (dependiente y gerente) | http://localhost:5173                                      |
| Panel de administración     | http://localhost:5174                                      |
| API                         | http://localhost:3000/api/v1                               |
| Sondas                      | http://localhost:3000/health · http://localhost:3000/ready |

## Comandos

| Comando                             | Qué hace                                                            |
| ----------------------------------- | ------------------------------------------------------------------- |
| `pnpm dev`                          | Infraestructura + migraciones + API, PWA y admin en modo desarrollo |
| `pnpm build`                        | Compila todos los paquetes (Turborepo)                              |
| `pnpm lint` / `pnpm typecheck`      | ESLint y TypeScript estricto                                        |
| `pnpm test`                         | Pruebas unitarias y de API (Vitest + Supertest)                     |
| `pnpm format` / `pnpm format:check` | Prettier                                                            |
| `pnpm infra:up` / `pnpm infra:down` | Inicia o detiene PostgreSQL y Redis                                 |
| `pnpm db:migrate`                   | Aplica migraciones pendientes                                       |
| `pnpm db:seed`                      | Carga datos ficticios (idempotente)                                 |
| `pnpm db:reset`                     | Borra la base local, migra y vuelve a sembrar                       |

## Estructura

```
apps/api         NestJS + Prisma (PostgreSQL) + Redis
apps/pwa         React + Vite: dependiente y gerente
apps/admin       React + Vite: administración (no se descarga en la PWA)
packages/shared  Esquemas Zod, constantes, i18n, utilidades de zona horaria
packages/game-*  SDK de juegos y moldes (trivia, verdadero/falso)
infra/           docker-compose y Terraform de referencia
docs/            Arquitectura, decisiones, operación
```

## Datos de semilla

- 3 países (CO, EC, PE) con configuración, consentimiento v1 y periodo de ranking abierto.
- 9 marcas ficticias (Marca A–I), 14 combinaciones marca-país (CO 5, EC 5, PE 4), 60 preguntas publicadas por marca.
- 3 farmacias y 20 dependientes por país.
- Usuarios de administración (Perú, país piloto): super admin, admin de país, editor y gerente de farmacia.
  Sus teléfonos ficticios están en `apps/api/prisma/seed-data.ts` (`fakePhone('PE', 90..93)`).
