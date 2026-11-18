import { z } from 'zod';

const SECRET_KEYS = ['DOCUMENT_HASH_SECRET', 'SESSION_TOKEN_SECRET'] as const;
const secret = (name: string) => z.string().min(16, `${name} debe tener al menos 16 caracteres`);

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
    DOCUMENT_HASH_SECRET: secret('DOCUMENT_HASH_SECRET'),
    SESSION_TOKEN_SECRET: secret('SESSION_TOKEN_SECRET'),
    LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace']).default('info'),
  })
  .superRefine((env, ctx) => {
    if (env.NODE_ENV !== 'production') return;
    for (const key of SECRET_KEYS) {
      const v = env[key];
      if (v.length < 32 || /^(dev|ci|test)-only/.test(v)) {
        ctx.addIssue({
          code: 'custom',
          path: [key],
          message: `${key} debe ser un secreto real de al menos 32 caracteres en producción`,
        });
      }
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
