import 'reflect-metadata';
import { randomInt } from 'node:crypto';
import { createHmac } from 'node:crypto';
import { Controller, Get, type INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import type { AppAudience, AuthTokenResponse, Role } from '@pharma/shared';
import { normalizeDocument } from '@pharma/shared';
import { uuidv7 } from 'uuidv7';
import { inject } from 'vitest';
import { AppModule } from '../../src/app.module';
import { CurrentUser, type Principal } from '../../src/auth/principal';
import { configureApp } from '../../src/bootstrap';
import { loadEnv, type Env } from '../../src/config/env';
import { PrismaService } from '../../src/infra/prisma.service';
import { RedisService } from '../../src/infra/redis.service';
import { httpTest } from '../http-test';

/** Ruta de prueba sin decoradores: exige sesión y consentimiento por defecto. */
@Controller('__probe')
class ProbeController {
  @Get()
  probe(@CurrentUser() p: Principal) {
    return { ok: true, userId: p.userId };
  }
}

export interface Harness {
  app: INestApplication;
  env: Env;
  prisma: PrismaService;
  redis: RedisService;
  http: () => ReturnType<typeof httpTest>;
  close: () => Promise<void>;
}

export async function createHarness(opts: { redisUrl?: string } = {}): Promise<Harness> {
  const env = loadEnv({
    ...process.env,
    NODE_ENV: 'test',
    LOG_LEVEL: 'fatal',
    DATABASE_URL: inject('databaseUrl'),
    REDIS_URL: opts.redisUrl ?? inject('redisUrl'),
    MESSAGING_PROVIDER: 'console',
    COOKIE_SECURE: 'false',
  });
  const mod = await Test.createTestingModule({
    imports: [AppModule.register(env)],
    controllers: [ProbeController],
  }).compile();
  const app = mod.createNestApplication({ logger: false });
  configureApp(app, env);
  await app.init();
  return {
    app,
    env,
    prisma: app.get(PrismaService),
    redis: app.get(RedisService),
    http: () => httpTest(app),
    close: () => app.close(),
  };
}

/** Borra contadores de límites para que las pruebas no dependan del orden. */
export async function resetLimits(h: Harness): Promise<void> {
  for (const pattern of ['rl:*', 'otp:*', 'dev:outbox:*']) {
    const keys = await h.redis.client.keys(pattern);
    if (keys.length) await h.redis.client.del(...keys);
  }
}

const PREFIX: Record<string, string> = { PE: '+51', CO: '+57', EC: '+593' };

export interface TestUser {
  id: string;
  phone: string;
  document: string;
}

/** Usuario nuevo con datos ficticios aleatorios (no depende de ejecuciones anteriores). */
export async function createUser(
  h: Harness,
  opts: { country: string | null; role?: Role; phoneCountry?: string },
): Promise<TestUser> {
  const country = opts.country
    ? await h.prisma.country.findUniqueOrThrow({ where: { code: opts.country } })
    : null;
  const prefix = PREFIX[opts.phoneCountry ?? opts.country ?? 'PE'] ?? '+51';
  const phone = `${prefix}97${String(randomInt(0, 10_000_000)).padStart(7, '0')}`;
  const document = `ZZTEST${randomInt(0, 1e9)}`;
  const id = uuidv7();
  await h.prisma.user.create({
    data: {
      id,
      countryId: country?.id ?? null,
      phoneE164: phone,
      documentHash: createHmac('sha256', h.env.DOCUMENT_HASH_SECRET)
        .update(normalizeDocument(document))
        .digest('hex'),
      displayName: 'Prueba Integración',
      role: opts.role ?? 'CLERK',
    },
  });
  return { id, phone, document };
}

/** Lee el código "enviado" por el ConsoleProvider (el worker de BullMQ es asíncrono). */
export async function readOtp(h: Harness, phone: string, timeoutMs = 5000): Promise<string | null> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const res = await h.http().post('/api/v1/dev/outbox').send({ phone });
    if (res.body.code) return res.body.code as string;
    await new Promise((r) => setTimeout(r, 50));
  }
  return null;
}

export interface LoginOk {
  body: AuthTokenResponse;
  cookie: string;
  setCookie: string;
}

export async function login(
  h: Harness,
  opts: { phone: string; app: AppAudience; countryCode?: string },
): Promise<LoginOk> {
  const identifier = { type: 'phone', value: opts.phone };
  await h.redis.client.del(`dev:outbox:${opts.phone}`);
  const req = await h
    .http()
    .post('/api/v1/auth/otp/request')
    .send({ app: opts.app, countryCode: opts.countryCode, identifier });
  if (req.status !== 202) throw new Error(`request ${req.status} ${JSON.stringify(req.body)}`);
  const code = await readOtp(h, opts.phone);
  if (!code) throw new Error('No llegó el código');
  const res = await h
    .http()
    .post('/api/v1/auth/otp/verify')
    .send({ app: opts.app, countryCode: opts.countryCode, identifier, code });
  if (res.status !== 200) throw new Error(`verify ${res.status} ${JSON.stringify(res.body)}`);
  const setCookie = cookieHeader(res.headers['set-cookie'], `pharma_rt_${opts.app}`);
  return { body: res.body as AuthTokenResponse, cookie: setCookie.split(';')[0]!, setCookie };
}

export function cookieHeader(raw: unknown, name: string): string {
  const list = Array.isArray(raw) ? (raw as string[]) : typeof raw === 'string' ? [raw] : [];
  const found = list.find((c) => c.startsWith(`${name}=`));
  if (!found) throw new Error(`Sin cookie ${name}`);
  return found;
}

export const bearer = (token: string) => ({ Authorization: `Bearer ${token}` });

/** Teléfonos de las semillas (prisma/seed-data.ts). */
export const SEED = {
  peSuperAdmin: '+51900000090',
  peCountryAdmin: '+51900000091',
  peEditor: '+51900000092',
  peManager: '+51900000093',
};
