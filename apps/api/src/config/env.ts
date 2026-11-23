import { z } from 'zod';

const SECRET_KEYS = ['DOCUMENT_HASH_SECRET', 'SESSION_TOKEN_SECRET', 'AUTH_TOKEN_SECRET'] as const;
const secret = (name: string) => z.string().min(16, `${name} debe tener al menos 16 caracteres`);
const bool = z
  .enum(['true', 'false', '1', '0'])
  .transform((v) => v === 'true' || v === '1')
  .optional();

export const envSchema = z
  .object({
    NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
    API_PORT: z.coerce.number().int().positive().default(3000),
    DATABASE_URL: z.string().url(),
    REDIS_URL: z.string().url(),
    CORS_ORIGINS: z
      .string()
      .default('')
      .transform((s) =>
        s
          .split(',')
          .map((o) => o.trim())
          .filter(Boolean),
      ),
    /** Saltos de proxy de confianza para obtener la IP real (0 = conexión directa). */
    TRUST_PROXY_HOPS: z.coerce.number().int().min(0).max(5).default(0),
    DOCUMENT_HASH_SECRET: secret('DOCUMENT_HASH_SECRET'),
    SESSION_TOKEN_SECRET: secret('SESSION_TOKEN_SECRET'),
    /** Firma de tokens de acceso (JWT HS256) y hash de códigos OTP. */
    AUTH_TOKEN_SECRET: secret('AUTH_TOKEN_SECRET'),
    /** Cookie de refresh solo por HTTPS. Por defecto: verdadero en producción. */
    COOKIE_SECURE: bool,
    /** `console` (desarrollo) o `whatsapp` (WhatsApp Cloud API con respaldo SMS). */
    MESSAGING_PROVIDER: z.enum(['console', 'whatsapp']).default('console'),
    WHATSAPP_API_URL: z.string().url().default('https://graph.facebook.com/v21.0'),
    WHATSAPP_TOKEN: z.string().optional(),
    WHATSAPP_PHONE_NUMBER_ID: z.string().optional(),
    WHATSAPP_TEMPLATE: z.string().default('otp_code'),
    /** Idioma de la plantilla tal como fue aprobada en Meta (p. ej. `es`). */
    WHATSAPP_TEMPLATE_LANG: z.string().default('es'),
    /** Proveedor SMS genérico: POST JSON { to, message } con token Bearer. */
    SMS_API_URL: z.string().url().optional(),
    SMS_API_TOKEN: z.string().optional(),
    /** Ejecuta el worker de BullMQ en este proceso (se puede separar en otro servicio). */
    OTP_WORKER_ENABLED: bool,
    /**
     * Ranking en vivo (ADR-023): tras un cambio, se reconstruye como mucho cada MIN ms; sin cambios,
     * se refresca igual cada MAX ms. El retraso visible del ranking es ~MIN más el tiempo del cálculo.
     */
    RANKING_LIVE_MIN_REBUILD_MS: z.coerce.number().int().min(0).default(10_000),
    RANKING_LIVE_MAX_AGE_MS: z.coerce.number().int().min(1_000).default(300_000),
    /** Hora local de la foto oficial diaria del ranking (cron de 5 campos, en la zona de cada país). */
    RANKING_SNAPSHOT_CRON: z.string().default('55 23 * * *'),
    /** Ejecuta el worker de la cola `rankings` (foto diaria) en este proceso. */
    JOBS_WORKER_ENABLED: bool,
    LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace']).default('info'),
  })
  .transform((env) => ({
    ...env,
    COOKIE_SECURE: env.COOKIE_SECURE ?? env.NODE_ENV === 'production',
    OTP_WORKER_ENABLED: env.OTP_WORKER_ENABLED ?? true,
    JOBS_WORKER_ENABLED: env.JOBS_WORKER_ENABLED ?? true,
  }))
  .superRefine((env, ctx) => {
    if (env.NODE_ENV !== 'production') return;
    const fail = (path: string, message: string) =>
      ctx.addIssue({ code: 'custom', path: [path], message });
    for (const key of SECRET_KEYS) {
      const v = env[key];
      if (v.length < 32 || /^(dev|ci|test)-only/.test(v)) {
        fail(key, `${key} debe ser un secreto real de al menos 32 caracteres en producción`);
      }
    }
    if (!env.COOKIE_SECURE)
      fail('COOKIE_SECURE', 'La cookie de sesión debe ser Secure en producción');
    if (env.MESSAGING_PROVIDER === 'console') {
      fail('MESSAGING_PROVIDER', 'El proveedor de consola no se permite en producción');
    }
    for (const key of [
      'WHATSAPP_TOKEN',
      'WHATSAPP_PHONE_NUMBER_ID',
      'SMS_API_URL',
      'SMS_API_TOKEN',
    ] as const) {
      if (!env[key]) fail(key, `${key} es obligatorio en producción`);
    }
  });

export type Env = z.infer<typeof envSchema>;

export function loadEnv(source: NodeJS.ProcessEnv = process.env): Env {
  const parsed = envSchema.safeParse(source);
  if (!parsed.success) {
    const issues = parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; ');
    throw new Error(`Configuración inválida: ${issues}`);
  }
  return parsed.data;
}

export const ENV = Symbol('ENV');

/** Herramientas de desarrollo (bandeja OTP, OpenAPI) solo fuera de producción. */
export function devToolsEnabled(env: Env): boolean {
  return env.NODE_ENV !== 'production';
}
