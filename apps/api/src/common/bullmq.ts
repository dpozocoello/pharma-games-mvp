import type { ConnectionOptions } from 'bullmq';

/** Conexión de BullMQ a partir de `REDIS_URL` (colas OTP y rankings). */
export function redisConnection(url: string): ConnectionOptions {
  const u = new URL(url);
  return {
    host: u.hostname,
    port: Number(u.port || 6379),
    username: u.username || undefined,
    password: u.password ? decodeURIComponent(u.password) : undefined,
    db: u.pathname.length > 1 ? Number(u.pathname.slice(1)) : 0,
    tls: u.protocol === 'rediss:' ? {} : undefined,
    // Requerido por BullMQ para conexiones bloqueantes del worker.
    maxRetriesPerRequest: null,
  };
}
