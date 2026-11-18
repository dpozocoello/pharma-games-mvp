import 'reflect-metadata';
import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { AppModule } from '../src/app.module';
import { configureApp } from '../src/bootstrap';
import { loadEnv } from '../src/config/env';
import { PrismaService } from '../src/infra/prisma.service';
import { RedisService } from '../src/infra/redis.service';

const env = loadEnv({
  NODE_ENV: 'test',
  DATABASE_URL: 'postgresql://u:p@localhost:5432/db',
  REDIS_URL: 'redis://localhost:6379',
  CORS_ORIGINS: 'http://localhost:5173',
  DOCUMENT_HASH_SECRET: 'test-document-secret-123',
  SESSION_TOKEN_SECRET: 'test-session-secret-123',
  LOG_LEVEL: 'fatal',
});

const prismaMock = {
  ping: vi.fn(),
  country: { findMany: vi.fn() },
  onModuleDestroy: vi.fn(),
};
const redisMock = { ping: vi.fn(), onModuleDestroy: vi.fn() };

describe('API base', () => {
  let app: INestApplication;

  beforeAll(async () => {
    const mod = await Test.createTestingModule({ imports: [AppModule.register(env)] })
      .overrideProvider(PrismaService)
      .useValue(prismaMock)
      .overrideProvider(RedisService)
      .useValue(redisMock)
      .compile();
    app = mod.createNestApplication({ logger: false });
    configureApp(app, env);
    await app.init();
  });

  afterAll(async () => {
    await app.close();
  });

  beforeEach(() => {
    vi.resetAllMocks();
  });

  it('GET /health responde 200 sin depender de la base de datos', async () => {
    prismaMock.ping.mockRejectedValue(new Error('db caída'));
    const res = await request(app.getHttpServer()).get('/health');
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ status: 'ok' });
  });

  it('GET /ready responde 200 cuando PostgreSQL y Redis están arriba', async () => {
    prismaMock.ping.mockResolvedValue(undefined);
    redisMock.ping.mockResolvedValue(undefined);
    const res = await request(app.getHttpServer()).get('/ready');
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ status: 'ok', db: 'up', redis: 'up' });
  });

  it('GET /ready responde 503 en formato RFC 7807 si Redis cae', async () => {
    prismaMock.ping.mockResolvedValue(undefined);
    redisMock.ping.mockRejectedValue(new Error('sin redis'));
    const res = await request(app.getHttpServer()).get('/ready');
    expect(res.status).toBe(503);
    expect(res.headers['content-type']).toContain('application/problem+json');
    expect(res.body).toMatchObject({ status: 503, redis: 'down', db: 'up' });
  });

  it('GET /api/v1/countries lista los países activos', async () => {
    prismaMock.country.findMany.mockResolvedValue([{ code: 'PE', name: 'Perú', locale: 'es-PE' }]);
    const res = await request(app.getHttpServer()).get('/api/v1/countries');
    expect(res.status).toBe(200);
    expect(res.body).toEqual([{ code: 'PE', name: 'Perú', locale: 'es-PE' }]);
    expect(prismaMock.country.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { active: true } }),
    );
  });

  it('una ruta inexistente responde 404 en formato RFC 7807', async () => {
    const res = await request(app.getHttpServer()).get('/api/v1/no-existe');
    expect(res.status).toBe(404);
    expect(res.body).toMatchObject({ status: 404, title: 'NOT_FOUND' });
  });

  it('aplica cabeceras de seguridad (Helmet)', async () => {
    const res = await request(app.getHttpServer()).get('/health');
    expect(res.headers['x-content-type-options']).toBe('nosniff');
    expect(res.headers['x-powered-by']).toBeUndefined();
  });
});

describe('loadEnv', () => {
  it('rechaza secretos de desarrollo en producción', () => {
    expect(() =>
      loadEnv({
        NODE_ENV: 'production',
        DATABASE_URL: 'postgresql://u:p@db:5432/db',
        REDIS_URL: 'redis://cache:6379',
        DOCUMENT_HASH_SECRET: 'dev-only-document-hash-secret-change-me',
        SESSION_TOKEN_SECRET: 'x'.repeat(40),
      }),
    ).toThrow(/DOCUMENT_HASH_SECRET/);
  });
});
