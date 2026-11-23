# Arquitectura

Estado: Iteración 1 (Entrada única, ingreso OTP, países, configuración en caliente y roles).

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
    de puntos)        caché, OTP, límites, colas BullMQ)
```

- **Sin estado:** cualquier instancia atiende cualquier solicitud. El estado vive en PostgreSQL y Redis.
- **Multi-país:** toda entidad de negocio lleva `countryId`; agregar un país es insertar `Country` + `CountryConfig` desde `POST /api/v1/admin/countries`.
- **Ranking en vivo (ADR-023):** las lecturas leen una clasificación materializada en Redis; una sola instancia la reconstruye desde PostgreSQL cuando algo cambió (como mucho cada 10 s). La foto diaria, el cierre y los ganadores se calculan directo desde PostgreSQL.
- **El cliente nunca puntúa:** las preguntas se proyectan con `toPublicQuestion` (lista blanca, sin `correctAnswer`).

## Paquetes

| Paquete                                          | Formato                                                                             | Uso                                                |
| ------------------------------------------------ | ----------------------------------------------------------------------------------- | -------------------------------------------------- |
| `@pharma/shared`                                 | CommonJS (`dist/`) para Node; las apps Vite importan el código fuente ESM por alias | Esquemas Zod, constantes, auth, i18n, zona horaria |
| `@pharma/game-sdk`                               | ESM                                                                                 | Tipos del contrato de juegos (§8)                  |
| `@pharma/game-trivia`, `@pharma/game-true-false` | ESM, carga dinámica                                                                 | Moldes de juego                                    |
| `@pharma/api`                                    | CommonJS (NestJS)                                                                   | API                                                |
| `@pharma/pwa`, `@pharma/admin`                   | Vite                                                                                | Frontends separados (audiencias `pwa` y `admin`)   |

## API (Iteración 0 + Iteración 1)

- **Salud y sistema:**
  - `GET /health`: proceso vivo (no consulta dependencias).
  - `GET /ready`: PostgreSQL y Redis responden; 503 en caso contrario.
  - `GET /api/docs`: OpenAPI interactivo (solo fuera de producción).
- **Países públicos:**
  - `GET /api/v1/countries`: países activos con `code`, `name`, `locale` y `phonePrefix`.
- **Autenticación y sesión (`AuthController`):**
  - `POST /api/v1/auth/otp/request`: solicita código de 6 dígitos (vigencia 5 min, máx. 3 envíos cada 15 min por número/documento). Respuesta idéntica exista o no la cuenta (`SENT_IF_REGISTERED`). Encola el envío en BullMQ (`WhatsAppCloudProvider` con respaldo automático `HttpSmsProvider`, o `ConsoleProvider` en desarrollo).
  - `POST /api/v1/auth/otp/verify`: verifica código (máx. 5 intentos), fija el país a la cuenta en el primer ingreso (`countryLockedAt`), emite JWT de acceso (15 min) con audiencia (`pwa` o `admin`) y cookie `HttpOnly`, `SameSite=Lax`, `Path=/api/v1/auth` con refresh opaco de 90 días (`pharma_rt_pwa` / `pharma_rt_admin`).
  - `POST /api/v1/auth/refresh`: rota el refresh token y detecta reutilización (revoca la familia de tokens si un token rotado se presenta fuera de la ventana de carrera).
  - `POST /api/v1/auth/logout`: revoca el refresh token y limpia la cookie.
- **Perfil y consentimiento (`MeController`):**
  - `GET /api/v1/me`: devuelve perfil con teléfono enmascarado, país fijado, farmacia actual y estado de consentimiento vigente.
  - `POST /api/v1/me/consent`: registra aceptación de la versión vigente del consentimiento del país con IP truncada (`/24` en IPv4, `/48` en IPv6).
- **Administración de países (`AdminCountriesController`, requiere audiencia `admin`):**
  - `GET /api/v1/admin/countries`: lista países dentro del alcance del actor (`SUPER_ADMIN` ve todos; `COUNTRY_ADMIN` y `CONTENT_EDITOR` solo el suyo).
  - `POST /api/v1/admin/countries` (`SUPER_ADMIN`): alta de país por configuración (nace inactivo hasta publicar consentimiento).
  - `PATCH /api/v1/admin/countries/:code` (`SUPER_ADMIN`): activa/desactiva país (exige consentimiento publicado).
  - `GET/PUT /api/v1/admin/countries/:code/config` (`SUPER_ADMIN`, `COUNTRY_ADMIN` de ese país): lee y actualiza términos locales, reglas de puntos y meses de periodo de ranking; registra en `AdminAuditLog` e invalida caché en Redis.
  - `POST /api/v1/admin/countries/:code/consent-versions`: publica nueva versión de consentimiento (obliga a re-aceptar antes de seguir jugando).
  - `PUT /api/v1/admin/countries/:code/brands/:brandId`: activa/desactiva marca en el país.

## Guardas Globales (Defensa en profundidad)

1. `AuthGuard`: exige token Bearer válido en todas las rutas salvo `@Public()`.
2. `RateLimitGuard`: aplica límites por IP y ruta en Redis.
3. `RolesGuard`: valida que la audiencia del token (`pwa` vs `admin`) coincida con `@RequireApp()` y que el rol esté autorizado en `@Roles()`.
4. `ConsentGuard`: exige que `CLERK` y `PHARMACY_MANAGER` hayan aceptado la `ConsentVersion` vigente de su país en toda ruta salvo `@AllowWithoutConsent()`.
