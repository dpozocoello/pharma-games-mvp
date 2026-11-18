# Operación

Estado: esqueleto (Iteración 0). Se completa en la Iteración 6.

## Variables de entorno

Ver `.env.example`. En producción la API **no arranca** si `DOCUMENT_HASH_SECRET` o
`SESSION_TOKEN_SECRET` tienen menos de 32 caracteres o usan un valor de desarrollo.

## Sondas

| Ruta      | Uso                                                 |
| --------- | --------------------------------------------------- |
| `/health` | Liveness: el proceso responde                       |
| `/ready`  | Readiness: PostgreSQL y Redis responden (503 si no) |

## Base de datos

- Migraciones versionadas en `apps/api/prisma/migrations`; en despliegue: `prisma migrate deploy`.
- `PointsLedger` y `AdminAuditLog` rechazan `UPDATE`, `DELETE` y `TRUNCATE` (trigger).
- Respaldo y restauración: pendiente (Iteración 6).

## Derechos de los titulares de datos

Proceso de acceso, rectificación y eliminación: pendiente (Iteración 6).
