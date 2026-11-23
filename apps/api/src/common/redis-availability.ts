import { HttpStatus, type Logger } from '@nestjs/common';
import { AppError } from './errors';

/**
 * Errores de ioredis/BullMQ que significan "Redis no está disponible" (no un error de lógica).
 * Con `enableOfflineQueue: false` los comandos fallan de inmediato en vez de acumularse.
 */
export function isRedisUnavailable(e: unknown): boolean {
  if (!(e instanceof Error)) return false;
  const code = (e as { code?: unknown }).code;
  return (
    e.name === 'MaxRetriesPerRequestError' ||
    code === 'ECONNREFUSED' ||
    code === 'ECONNRESET' ||
    code === 'ETIMEDOUT' ||
    /enableOfflineQueue|Connection is closed|Stream isn't writeable|max retries per request/i.test(
      e.message,
    ) ||
    e.message === REDIS_TIMEOUT
  );
}

export const serviceUnavailable = () =>
  new AppError(
    HttpStatus.SERVICE_UNAVAILABLE,
    'SERVICE_UNAVAILABLE',
    'El servicio no está disponible en este momento. Intenta de nuevo en unos minutos.',
    { retryAfterSeconds: 30 },
  );

const REDIS_TIMEOUT = 'Redis no respondió a tiempo';

/**
 * BullMQ espera a Redis indefinidamente (`maxRetriesPerRequest: null`). Para una solicitud HTTP eso
 * es un cuelgue: esto corta la espera y la convierte en "Redis no disponible".
 */
export async function withRedisTimeout<T>(p: Promise<T>, ms = 3_000): Promise<T> {
  let timer: NodeJS.Timeout | undefined;
  try {
    return await Promise.race([
      p,
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new Error(REDIS_TIMEOUT)), ms);
      }),
    ]);
  } finally {
    clearTimeout(timer);
  }
}

/** Advierte como mucho una vez por intervalo (un Redis caído no inunda los logs). */
export function throttledWarn(logger: Logger, intervalMs = 30_000) {
  const last = new Map<string, number>();
  return (key: string, message: string) => {
    const now = Date.now();
    if ((last.get(key) ?? 0) + intervalMs > now) return;
    last.set(key, now);
    logger.warn(message);
  };
}

/**
 * Cierra colas y workers de BullMQ sin colgar el apagado si Redis no responde: espera un cierre
 * ordenado unos segundos y, si no llega, corta la conexión.
 */
export async function closeBullmq(
  items: ({ close(): Promise<void>; disconnect(): Promise<void> } | undefined)[],
  ms = 3_000,
): Promise<void> {
  await Promise.all(
    items.map(async (item) => {
      if (!item) return;
      await withRedisTimeout(item.close(), ms).catch(() => {
        // Sin respuesta de Redis: se corta sin esperar (`disconnect` también espera a Redis).
        void item.disconnect().catch(() => undefined);
      });
    }),
  );
}
