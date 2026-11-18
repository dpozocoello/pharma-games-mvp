import 'reflect-metadata';
import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { AppModule } from '../src/app.module';
import { OtpQueue } from '../src/auth/messaging/otp-queue';
import { RateLimitService } from '../src/common/rate-limit';
import { configureApp } from '../src/bootstrap';
import { loadEnv } from '../src/config/env';
import { PrismaService } from '../src/infra/prisma.service';
import { RedisService } from '../src/infra/redis.service';
import { httpTest } from './http-test';

const env = loadEnv({
  NODE_ENV: 'test',
  DATABASE_URL: 'postgresql://u:p@localhost:5432/db',
  REDIS_URL: 'redis://localhost:6379',
  CORS_ORIGINS: 'http://localhost:5173',
  DOCUMENT_HASH_SECRET: 'test-document-secret-123',
  SESSION_TOKEN_SECRET: 'test-session-secret-123',
  AUTH_TOKEN_SECRET: 'test-auth-token-secret-123',
  LOG_LEVEL: 'fatal',
});

const prismaMock = {
  ping: vi.fn(),
  country: { findMany: vi.fn() },
  onModuleDestroy: vi.fn(),
};
const redisMock = {
  ping: vi.fn(),
  onModuleInit: vi.fn(),
  onModuleDestroy: vi.fn(),
  client: { get: vi.fn(), set: vi.fn(), del: vi.fn() },
};

describe('API base', () => {
  let app: INestApplication;

  beforeAll(async () => {
    const mod = await Test.createTestingModule({ imports: [AppModule.register(env)] })
      .overrideProvider(PrismaService)
      .useValue(prismaMock)
      .overrideProvider(RedisService)
      .useValue(redisMock)
      .overrideProvider(RateLimitService)
      .useValue({ hit: async () => 0 })
      .overrideProvider(OtpQueue)
      .useValue({ enqueue: vi.fn() })
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
    const res = await httpTest(app).get('/health');
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ status: 'ok' });
  });

  it('GET /ready responde 200 cuando PostgreSQL y Redis están arriba', async () => {
    prismaMock.ping.mockResolvedValue(undefined);
    redisMock.ping.mockResolvedValue(undefined);
    const res = await httpTest(app).get('/ready');
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ status: 'ok', db: 'up', redis: 'up' });
  });

  it('GET /ready responde 503 en formato RFC 7807 si Redis cae', async () => {
    prismaMock.ping.mockResolvedValue(undefined);
    redisMock.ping.mockRejectedValue(new Error('sin redis'));
    const res = await httpTest(app).get('/ready');
    expect(res.status).toBe(503);
    expect(res.headers['content-type']).toContain('application/problem+json');
    expect(res.body).toMatchObject({ status: 503, redis: 'down', db: 'up' });
  });

  it('GET /api/v1/countries lista los países activos', async () => {
    const pe = { code: 'PE', name: 'Perú', locale: 'es-PE', phonePrefix: '+51' };
    prismaMock.country.findMany.mockResolvedValue([pe]);
    const res = await httpTest(app).get('/api/v1/countries');
    expect(res.status).toBe(200);
    expect(res.body).toEqual([pe]);
    expect(prismaMock.country.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { active: true } }),
    );
  });

  it('una ruta inexistente responde 404 en formato RFC 7807', async () => {
    const res = await httpTest(app).get('/api/v1/no-existe');
    expect(res.status).toBe(404);
    expect(res.body).toMatchObject({ status: 404, title: 'NOT_FOUND' });
  });

  it('las rutas no públicas exigen token (denegar por defecto)', async () => {
    const me = await httpTest(app).get('/api/v1/me');
    expect(me.status).toBe(401);
    const admin = await httpTest(app).get('/api/v1/admin/countries');
    expect(admin.status).toBe(401);
  });

  it('valida el cuerpo con Zod y responde 400 con errores por campo', async () => {
    const res = await httpTest(app)
      .post('/api/v1/auth/otp/request')
      .send({ app: 'pwa', identifier: { type: 'document', value: 'X1' } });
    expect(res.status).toBe(400);
    expect(res.body.code).toBe('VALIDATION_ERROR');
    expect(res.body.errors.length).toBeGreaterThan(0);
  });

  it('publica OpenAPI fuera de producción', async () => {
    const res = await httpTest(app).get('/api/docs/openapi.json');
    expect(res.status).toBe(200);
    expect(Object.keys(res.body.paths)).toEqual(
      expect.arrayContaining(['/api/v1/auth/otp/request', '/api/v1/admin/countries/{code}/config']),
    );
  });

  it('aplica cabeceras de seguridad (Helmet)', async () => {
    const res = await httpTest(app).get('/health');
    expect(res.headers['x-content-type-options']).toBe('nosniff');
    expect(res.headers['x-powered-by']).toBeUndefined();
  });
});

describe('loadEnv', () => {
  const prod = {
    NODE_ENV: 'production',
    DATABASE_URL: 'postgresql://u:p@db:5432/db',
    REDIS_URL: 'redis://cache:6379',
    DOCUMENT_HASH_SECRET: 'x'.repeat(40),
    SESSION_TOKEN_SECRET: 'y'.repeat(40),
    AUTH_TOKEN_SECRET: 'z'.repeat(40),
    MESSAGING_PROVIDER: 'whatsapp',
    WHATSAPP_TOKEN: 't',
    WHATSAPP_PHONE_NUMBER_ID: '1',
    SMS_API_URL: 'https://sms.example.invalid/send',
    SMS_API_TOKEN: 's',
  };

  it('acepta una configuración de producción completa (cookie Secure por defecto)', () => {
    const env = loadEnv(prod);
    expect(env.COOKIE_SECURE).toBe(true);
  });

  it('rechaza secretos de desarrollo en producción', () => {
    expect(() =>
      loadEnv({ ...prod, DOCUMENT_HASH_SECRET: 'dev-only-document-hash-secret-change-me' }),
    ).toThrow(/DOCUMENT_HASH_SECRET/);
  });

  it('rechaza el proveedor de consola y la cookie sin Secure en producción', () => {
    expect(() => loadEnv({ ...prod, MESSAGING_PROVIDER: 'console' })).toThrow(/MESSAGING_PROVIDER/);
    expect(() => loadEnv({ ...prod, COOKIE_SECURE: 'false' })).toThrow(/COOKIE_SECURE/);
  });

  it('exige el respaldo SMS en producción', () => {
    expect(() => loadEnv({ ...prod, SMS_API_URL: undefined })).toThrow(/SMS_API_URL/);
  });
});
