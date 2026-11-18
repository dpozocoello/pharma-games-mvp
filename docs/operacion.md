# Manual de Operación, Seguridad y Continuidad (Runbook)

Estado: **Completo — Iteración 6 (MVP 1 "Piloto funcional")**

---

## 1. Variables de Entorno y Validación de Arranque

Ver [.env.example](file:///C:/applications/pharma-games-mvp/.env.example). La API valida todas las variables al iniciar mediante Zod ([apps/api/src/config/env.ts](file:///C:/applications/pharma-games-mvp/apps/api/src/config/env.ts)).
En producción (`NODE_ENV=production`) la API **aborta el arranque inmediatamente** si:

- `DOCUMENT_HASH_SECRET`, `SESSION_TOKEN_SECRET` o `AUTH_TOKEN_SECRET` tienen menos de 32 caracteres o comienzan con `dev-only`, `ci-only` o `test-only`.
- `COOKIE_SECURE` no es `true`.
- `MESSAGING_PROVIDER` es `console` o faltan las credenciales de WhatsApp (`WHATSAPP_TOKEN`, `WHATSAPP_PHONE_NUMBER_ID`) y respaldo SMS (`SMS_API_URL`, `SMS_API_TOKEN`).

---

## 2. Sondas de Salud, Observabilidad y Apagado Ordenado

| Ruta        | Uso                   | Comportamiento                                                                                     |
| ----------- | --------------------- | -------------------------------------------------------------------------------------------------- |
| `/health`   | **Liveness probe**    | Responde `200 OK` (`{ "status": "ok" }`) si el bucle de eventos de Node.js está vivo.              |
| `/ready`    | **Readiness probe**   | Ejecuta `SELECT 1` en PostgreSQL y `PING` en Redis. Devuelve `200 OK` o `503 Service Unavailable`. |
| `/api/docs` | **OpenAPI / Swagger** | Disponible solo cuando `NODE_ENV !== 'production'`.                                                |

- **Logs JSON estructurados (`nestjs-pino`)**:
  - Redacta automáticamente `req.headers.authorization`, `req.headers.cookie`, `res.headers["set-cookie"]` y `req.body` para garantizar **cero datos personales (PII) en los logs**.
- **Apagado ordenado (`enableShutdownHooks`)**:
  - Ante `SIGTERM` / `SIGINT`, la instancia deja de aceptar tráfico nuevo, drena solicitudes en vuelo y cierra ordenadamente los pools de Prisma y Redis.

---

## 3. Alta de un Nuevo País por Configuración (Sin Despliegue)

1. Ingresar al panel de administración (`http://localhost:5174`) con cuenta `SUPER_ADMIN`.
2. Crear el país indicando código ISO-2 (ej. `EC`, `CO` o `BO`), nombre, `locale` (`es-EC`), zona horaria IANA (`America/Guayaquil`) y prefijo telefónico (`+593`). El país se crea con sus reglas de puntos por defecto y primer periodo de ranking abierto.
3. Publicar la versión vigente del texto de consentimiento legal del país.
4. Activar las marcas correspondientes y activar el país desde el panel: la caché de Redis (`country:config:<code>`) se invalida al instante y el país aparece en la pantalla de entrada de la PWA.

---

## 4. Respaldo y Restauración de Base de Datos (Probado)

### 4.1 Tablas Críticas e Inmutabilidad

- `PointsLedger` y `AdminAuditLog` tienen triggers en PostgreSQL (`prevent_immutable_modification`) que rechazan `UPDATE`, `DELETE` y `TRUNCATE`.
- Las migraciones están versionadas en `apps/api/prisma/migrations` y se aplican en producción con `pnpm --filter @pharma/api exec prisma migrate deploy`.

### 4.2 Procedimiento de Respaldo (`pg_dump` en formato custom comprimido)

```bash
# Generar respaldo consistente (formato custom -Fc con compresión)
docker exec pharma-postgres-1 pg_dump \
  -U pharma \
  -d pharma \
  -Fc \
  -f /tmp/pharma_backup_$(date -u +%Y%m%dT%H%M%SZ).dump

# Copiar el archivo fuera del contenedor hacia almacenamiento seguro cifrado (S3 / GCS)
docker cp pharma-postgres-1:/tmp/pharma_backup_*.dump ./backups/
```

### 4.3 Procedimiento de Restauración y Verificación (`pg_restore`)

```bash
# 1. Crear base de datos limpia de verificación o recuperación
docker exec pharma-postgres-1 createdb -U pharma pharma_restore_verify

# 2. Restaurar el respaldo completo (incluyendo triggers de inmutabilidad e índices)
docker exec pharma-postgres-1 pg_restore \
  -U pharma \
  -d pharma_restore_verify \
  --no-owner \
  --clean \
  --if-exists \
  /tmp/pharma_backup.dump

# 3. Verificar integridad de conteos y triggers de inmutabilidad
docker exec pharma-postgres-1 psql -U pharma -d pharma_restore_verify \
  -c "SELECT count(*) AS countries FROM \"Country\"; SELECT count(*) AS ledger FROM \"PointsLedger\";"
```

---

## 5. Derechos de los Titulares de Datos Personales (ARCO / Ley 1581 CO, LOPDP EC, Ley 29733 PE)

En cumplimiento de la **Ley 1581 de 2012 (Colombia)**, la **LOPDP (Ecuador)** y la **Ley 29733 (Perú)**:

1. **Minimización y cifrado desde el diseño**:
   - El documento de identidad **nunca** se almacena en texto claro; solo se guarda `documentHash = HMAC-SHA256(DOCUMENT_HASH_SECRET, normalizeDocument(doc))`.
   - La dirección IP al aceptar el consentimiento (`UserConsent.ipTruncated`) se trunca en el último octeto IPv4 (`/24`, ej. `190.12.34.0`) o a `/48` en IPv6.
   - Los teléfonos se muestran enmascarados (`+51•••••001`) en el panel de administración y del gerente.
   - Los eventos de uso (`UsageEvent.payload`) pasan por `sanitizeUsagePayload()`, que elimina cualquier campo con nombres, teléfonos, documentos o IPs.

2. **Flujo operativo para solicitudes de Acceso, Rectificación o Eliminación (Anonimización)**:
   - **Acceso**: El `COUNTRY_ADMIN` del país valida la identidad del titular y consulta su perfil, historial de consentimiento (`UserConsent`) y asignaciones de farmacia (`PharmacyAssignment`).
   - **Rectificación / Traslado**:
     - Cambio de farmacia: desde el panel Admin o `POST /api/v1/admin/users/:id/transfer` (conserva puntos e historial).
     - Actualización de estado (`ACTIVE` / `INACTIVE`): `PATCH /api/v1/admin/users/:id/status`.
   - **Eliminación / Revocación del consentimiento**:
     - Dado que `PointsLedger` y `AdminAuditLog` son libros contables inmutables referenciados por `userId` (UUID opaco), la eliminación de datos personales se ejecuta mediante **anonimización irreversible** del registro en `User` y revocación de sus sesiones:
       1. Marcar `status = 'INACTIVE'`.
       2. Reemplazar `displayName = 'Usuario Anonimizado'`, `phoneE164 = '+000' || substr(id::text, 1, 11)` y `documentHash = NULL`.
       3. Revocar todos los `RefreshToken` activos del usuario (`UPDATE "RefreshToken" SET "revokedAt" = NOW() WHERE "userId" = '<UUID>'`).
       4. Registrar la operación en `AdminAuditLog` con el número de ticket ARCO.

---

## 6. Revisión de Seguridad (Guía OWASP ASVS Nivel 2)

| Control OWASP ASVS L2                                   | Implementación en el repositorio                                                                                                                                                                                                                                                                                                                  | Estado    |
| ------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------- |
| **V1 / V4 Control de acceso y aislamiento multi-país**  | `AuthGuard` + `RolesGuard` + `ConsentGuard` globales por defecto; `RequireApp('pwa' \| 'admin')` separa audiencias JWT; ninguna consulta cruza `countryId` salvo para `SUPER_ADMIN` (verificado en `app.test.ts`, `iteration5.test.ts`, `iteration6.test.ts`).                                                                                    | ✅ Cumple |
| **V2 Autenticación y OTP**                              | OTP de 6 dígitos almacenado solo como hash HMAC en Redis, TTL 5 min, máx. 5 intentos, límite de 3 envíos/15 min por número; respaldo automático de WhatsApp a SMS (`OtpDeliveryService`).                                                                                                                                                         | ✅ Cumple |
| **V3 Gestión de sesiones**                              | Access JWT de 15 min + Refresh token opaco (hash SHA-256 en BD) de 90 días en cookie `HttpOnly`, `Secure`, `SameSite=Lax`, con rotación y revocación de toda la familia (`familyId`) ante detección de reutilización.                                                                                                                             | ✅ Cumple |
| **V5 Validación de entradas y prevención de inyección** | Esquemas Zod estrictos (`ZodPipe`) en todos los endpoints; consultas 100 % parametrizadas vía Prisma; sanitización contra CSV Formula Injection (`sanitizeCsvCell` prefija `'`, `=`, `+`, `-`, `@`, `\t`, `\r`) en todas las importaciones y exportaciones CSV.                                                                                   | ✅ Cumple |
| **V6 Juego justo e integridad en servidor**             | El cliente jamás calcula el puntaje; `toPublicQuestion()` garantiza que `correctAnswer` nunca viaja por la red (verificado por prueba automatizada); sesión firmada con HMAC (`SESSION_TOKEN_SECRET`); detección de anomalías (`FAST_ANSWER` < 800 ms, `SHORT_SESSION`, `PERFECT_STREAK`, `HIGH_FREQUENCY`) que retiene puntos (`onHold = true`). | ✅ Cumple |
| **V7 / V9 Errores, cabeceras y registro sin PII**       | Respuestas de error normalizadas en RFC 7807 (`application/problem+json`); `helmet` activo; CORS estricto por lista blanca (`CORS_ORIGINS`); logs `pino` con redacción automática de cabeceras y cuerpos sensibles.                                                                                                                               | ✅ Cumple |
