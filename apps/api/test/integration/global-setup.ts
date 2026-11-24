import { execSync } from 'node:child_process';
import { resolve } from 'node:path';
import { PrismaClient } from '@prisma/client';
import Redis from 'ioredis';
import type { GlobalSetupContext } from 'vitest/node';

/**
 * Prepara una base `pharma_test` y la base 1 de Redis, separadas de las de desarrollo.
 * Requiere PostgreSQL y Redis en marcha (`pnpm infra:up` en local; servicios en CI).
 */
export function testUrls(env: NodeJS.ProcessEnv = process.env) {
  if (!env.DATABASE_URL || !env.REDIS_URL) {
    throw new Error('Faltan DATABASE_URL y REDIS_URL (copia .env.example a .env)');
  }
  const db = new URL(env.TEST_DATABASE_URL ?? env.DATABASE_URL);
  if (!env.TEST_DATABASE_URL) db.pathname = '/pharma_test';
  const redis = new URL(env.TEST_REDIS_URL ?? env.REDIS_URL);
  if (!env.TEST_REDIS_URL) redis.pathname = '/1';
  return { databaseUrl: db.toString(), redisUrl: redis.toString() };
}

export default async function setup({ provide }: GlobalSetupContext) {
  const { databaseUrl, redisUrl } = testUrls();
  const env = { ...process.env, DATABASE_URL: databaseUrl, REDIS_URL: redisUrl };
  const opts = { env, stdio: 'pipe' as const, cwd: resolve(__dirname, '../..') };

  execSync('pnpm exec prisma migrate deploy', opts);
  execSync('pnpm exec tsx prisma/seed.ts', opts);

  // Limpia países creados por pruebas anteriores (códigos Z*), que no existen en las semillas.
  const prisma = new PrismaClient({ datasourceUrl: databaseUrl });
  try {
    const stale = await prisma.country.findMany({ where: { code: { startsWith: 'Z' } } });
    for (const c of stale) {
      // Primero lo que referencia al país: usuarios de prueba y sus aceptaciones y sesiones.
      const users = { countryId: c.id };
      await prisma.userConsent.deleteMany({ where: { consentVersion: { countryId: c.id } } });
      await prisma.refreshToken.deleteMany({ where: { user: users } });
      await prisma.user.deleteMany({ where: users });
      await prisma.countryConfig.updateMany({
        where: { countryId: c.id },
        data: { consentVersionId: null },
      });
      await prisma.countryConfig.deleteMany({ where: { countryId: c.id } });
      await prisma.consentVersion.deleteMany({ where: { countryId: c.id } });
      const periods = { period: { countryId: c.id } };
      await prisma.winner.deleteMany({ where: periods });
      await prisma.rankingSnapshot.deleteMany({ where: periods });
      await prisma.rankingPeriod.deleteMany({ where: { countryId: c.id } });
      await prisma.country.delete({ where: { id: c.id } });
    }

    // Las semillas activan el piloto arcade en PE (ADR-034). Las pruebas parten sin él para que
    // el grupo A/B de farmacias aleatorias no cambie sus resultados; arcade.int.test lo activa.
    const pe = await prisma.countryConfig.findFirstOrThrow({ where: { country: { code: 'PE' } } });
    const rules = pe.pointsRules as Record<string, unknown> & { arcade?: Record<string, unknown> };
    if (rules.arcade) {
      await prisma.countryConfig.update({
        where: { id: pe.id },
        data: { pointsRules: { ...rules, arcade: { ...rules.arcade, enabled: false } } },
      });
    }
  } finally {
    await prisma.$disconnect();
  }

  const redis = new Redis(redisUrl);
  await redis.flushdb();
  await redis.quit();

  provide('databaseUrl', databaseUrl);
  provide('redisUrl', redisUrl);
}

declare module 'vitest' {
  export interface ProvidedContext {
    databaseUrl: string;
    redisUrl: string;
  }
}
