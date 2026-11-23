import 'reflect-metadata';
import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { DEFAULT_POINTS_RULES } from '@pharma/shared';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { AppModule } from '../src/app.module';
import { OtpQueue } from '../src/auth/messaging/otp-queue';
import { DailySnapshotScheduler } from '../src/rankings/daily-snapshot.scheduler';
import { RankingJobsWorker } from '../src/rankings/daily-snapshot.worker';
import type { Principal } from '../src/auth/principal';
import { TokenService } from '../src/auth/token.service';
import { configureApp } from '../src/bootstrap';
import { RateLimitService } from '../src/common/rate-limit';
import { loadEnv } from '../src/config/env';
import { ConsentService } from '../src/me/consent.service';
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

const PE_ID = '01900000-0000-7000-8000-000000000001';
const BRAND_A_ID = '01900000-0000-7000-8000-000000000010';
const GAME_MC_ID = '01900000-0000-7000-8000-000000000201';
const CLERK_ID = '01900000-0000-7000-8000-000000000501';

describe('Iteración 3 — Motor de juegos, contrato SDK y seguridad de respuestas', () => {
  let app: INestApplication;
  let tokens: TokenService;

  let sessionsStore: any[] = [];
  let answersStore: any[] = [];
  let ledgerStore: any[] = [];

  const sampleQuestions = Array.from({ length: 12 }, (_, idx) => ({
    id: `01900000-0000-7000-8000-0000000008${String(idx + 1).padStart(2, '0')}`,
    brandId: BRAND_A_ID,
    countryId: PE_ID,
    type: 'MULTIPLE_CHOICE' as const,
    prompt: `¿Pregunta ficticia #${idx + 1} de Marca A?`,
    options: [
      { id: 'a', text: 'Opción A' },
      { id: 'b', text: 'Opción B' },
      { id: 'c', text: 'Opción C' },
    ],
    correctAnswer: 'b', // Secreto en el servidor
    locale: 'es-PE',
    status: 'PUBLISHED' as const,
    termOverrides: [],
  }));

  const prismaMock: any = {
    $transaction: async (fn: (tx: any) => Promise<any>) => fn(prismaMock),
    // Bloqueos de PostgreSQL: `FOR SHARE` devuelve el estado de la partida; el advisory lock no hace nada.
    $queryRaw: vi.fn(async (strings: TemplateStringsArray, ...values: unknown[]) => {
      if (strings.join('?').includes('FOR SHARE')) {
        const s = sessionsStore.find((x) => x.id === values[0]);
        return s ? [{ status: s.status }] : [];
      }
      return [{ '?column?': 1 }];
    }),
    usageEvent: { create: vi.fn(async ({ data }: any) => data) },
    country: {
      findUnique: vi.fn(async () => ({
        id: PE_ID,
        code: 'PE',
        name: 'Perú',
        locale: 'es-PE',
        timezone: 'America/Lima',
        phonePrefix: '+51',
        active: true,
        config: {
          terms: { 'term.points': 'puntos' },
          pointsRules: DEFAULT_POINTS_RULES,
          rankingPeriodMonths: 1,
          consentVersionId: '01900000-0000-7000-8000-000000000050',
        },
      })),
    },
    rankingPeriod: {
      findFirst: vi.fn(async () => ({
        id: '01900000-0000-7000-8000-000000000060',
        countryId: PE_ID,
        startsAt: new Date(Date.now() - 86_400_000),
        endsAt: new Date(Date.now() + 86_400_000 * 20),
        status: 'OPEN',
      })),
    },
    game: {
      findMany: vi.fn(async () => [
        {
          id: GAME_MC_ID,
          brandId: BRAND_A_ID,
          countryId: PE_ID,
          mechanic: 'MULTIPLE_CHOICE',
          version: '1.0.0',
          status: 'ACTIVE',
          brand: {
            id: BRAND_A_ID,
            slug: 'marca-a',
            name: 'Marca A',
            theme: { primary: '#1D4ED8', secondary: '#DBEAFE', logoUrl: '/brands/marca-a.svg' },
            countries: [{ countryId: PE_ID, active: true, theme: null }],
          },
        },
      ]),
      findUnique: vi.fn(async ({ where }: any) => {
        if (where.id !== GAME_MC_ID) return null;
        return {
          id: GAME_MC_ID,
          brandId: BRAND_A_ID,
          countryId: PE_ID,
          mechanic: 'MULTIPLE_CHOICE',
          version: '1.0.0',
          status: 'ACTIVE',
          brand: {
            id: BRAND_A_ID,
            slug: 'marca-a',
            name: 'Marca A',
            theme: { primary: '#1D4ED8', secondary: '#DBEAFE', logoUrl: '/brands/marca-a.svg' },
            countries: [{ countryId: PE_ID, active: true, theme: null }],
          },
        };
      }),
    },
    question: {
      findMany: vi.fn(async ({ where }: any) => {
        if (where?.id?.in) {
          const set = new Set(where.id.in);
          return sampleQuestions.filter((q) => set.has(q.id));
        }
        return sampleQuestions;
      }),
    },
    gameSession: {
      findMany: vi.fn(async ({ where }: any) => {
        return sessionsStore
          .filter((s) => s.userId === where.userId)
          .map((s) => ({ ...s, answers: answersStore.filter((a) => a.sessionId === s.id) }));
      }),
      count: vi.fn(async ({ where }: any) => {
        return sessionsStore.filter((s) => s.userId === where.userId && s.gameId === where.gameId)
          .length;
      }),
      create: vi.fn(async ({ data }: any) => {
        const s = { ...data, score: null, finishedAt: null, flags: [] };
        sessionsStore.push(s);
        return s;
      }),
      findUnique: vi.fn(async ({ where }: any) => {
        const s = sessionsStore.find((x) => x.id === where.id);
        if (!s) return null;
        return {
          ...s,
          answers: answersStore.filter((a) => a.sessionId === s.id),
        };
      }),
      update: vi.fn(async ({ where, data }: any) => {
        const idx = sessionsStore.findIndex((x) => x.id === where.id);
        sessionsStore[idx] = { ...sessionsStore[idx], ...data };
        return sessionsStore[idx];
      }),
      // Actualización condicional (`where.status`), como la usa finishSession para reclamar la partida.
      updateMany: vi.fn(async ({ where, data }: any) => {
        const idx = sessionsStore.findIndex(
          (x) => x.id === where.id && (!where.status || x.status === where.status),
        );
        if (idx < 0) return { count: 0 };
        sessionsStore[idx] = { ...sessionsStore[idx], ...data };
        return { count: 1 };
      }),
      findUniqueOrThrow: vi.fn(async ({ where }: any) => {
        const s = sessionsStore.find((x) => x.id === where.id);
        if (!s) throw new Error('No encontrado');
        return { ...s, answers: answersStore.filter((a) => a.sessionId === s.id) };
      }),
    },
    sessionAnswer: {
      findMany: vi.fn(async ({ where }: any) =>
        answersStore.filter((a) => a.sessionId === where.sessionId),
      ),
      upsert: vi.fn(async ({ where, create }: any) => {
        const { sessionId, questionId } = where.sessionId_questionId;
        const existing = answersStore.find(
          (a) => a.sessionId === sessionId && a.questionId === questionId,
        );
        if (existing) return existing;
        answersStore.push(create);
        return create;
      }),
    },
    pointsLedger: {
      findMany: vi.fn(async ({ where }: any) => {
        return ledgerStore.filter(
          (l) => l.userId === where.userId && l.localDay === where.localDay,
        );
      }),
      create: vi.fn(async ({ data }: any) => {
        ledgerStore.push(data);
        return data;
      }),
    },
    anomalyAlert: {
      create: vi.fn(async ({ data }: any) => data),
      findMany: vi.fn(async () => []),
    },
    onModuleDestroy: vi.fn(),
  };

  const redisMock = {
    ping: vi.fn(),
    onModuleInit: vi.fn(),
    onModuleDestroy: vi.fn(),
    client: { get: vi.fn(), set: vi.fn(), del: vi.fn() },
  };

  const clerkPrincipal: Principal = {
    userId: CLERK_ID,
    role: 'CLERK',
    countryId: PE_ID,
    countryCode: 'PE',
    app: 'pwa',
  };

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
      // Sin BullMQ real en pruebas unitarias (las de integración usan Redis real).
      .overrideProvider(DailySnapshotScheduler)
      .useValue({ sync: vi.fn(), syncAll: vi.fn() })
      .overrideProvider(RankingJobsWorker)
      .useValue({})
      .overrideProvider(ConsentService)
      .useValue({ hasAcceptedCurrent: async () => true, hasAccepted: async () => true })
      .compile();

    app = mod.createNestApplication({ logger: false });
    configureApp(app, env);
    await app.init();
    tokens = app.get(TokenService);
  });

  afterAll(async () => {
    await app.close();
  });

  beforeEach(() => {
    sessionsStore = [];
    answersStore = [];
    ledgerStore = [];
  });

  it('NUNCA expone correctAnswer en las respuestas HTTP de catálogo ni al iniciar sesión', async () => {
    const token = tokens.signAccess(clerkPrincipal);

    const catRes = await httpTest(app).get('/api/v1/games').set('Authorization', `Bearer ${token}`);
    expect(catRes.status).toBe(200);
    expect(catRes.text).not.toContain('correctAnswer');
    expect(catRes.body.pendingBrands).toHaveLength(1);

    const startRes = await httpTest(app)
      .post(`/api/v1/games/${GAME_MC_ID}/sessions`)
      .set('Authorization', `Bearer ${token}`);
    expect(startRes.status).toBe(201);
    expect(startRes.text).not.toContain('correctAnswer');
    expect(startRes.body.questions).toHaveLength(10);
    for (const q of startRes.body.questions) {
      expect(Object.keys(q).sort()).toEqual(['id', 'options', 'prompt', 'type']);
    }
  });

  it('valida token HMAC de sesión, puntúa en servidor y es idempotente al reenviar finish', async () => {
    const token = tokens.signAccess(clerkPrincipal);

    const startRes = await httpTest(app)
      .post(`/api/v1/games/${GAME_MC_ID}/sessions`)
      .set('Authorization', `Bearer ${token}`);
    const { session, questions } = startRes.body;

    // Rechaza un token manipulado
    const tamperedRes = await httpTest(app)
      .post(`/api/v1/sessions/${session.id}/answers`)
      .set('Authorization', `Bearer ${token}`)
      .send({
        token: `${session.token}tampered`,
        answers: [{ questionId: questions[0].id, answer: 'b', clientElapsedMs: 1200 }],
      });
    expect(tamperedRes.status).toBe(401);
    expect(tamperedRes.body.code).toBe('SESSION_TOKEN_INVALID');

    // Envía 8 respuestas correctas ('b') y 2 incorrectas ('a') en lote (como al reconectar red)
    const batch = questions.map((q: { id: string }, idx: number) => ({
      questionId: q.id,
      answer: idx < 8 ? 'b' : 'a',
      clientElapsedMs: 1500,
    }));

    const ansRes = await httpTest(app)
      .post(`/api/v1/sessions/${session.id}/answers`)
      .set('Authorization', `Bearer ${token}`)
      .send({ token: session.token, answers: batch });
    expect(ansRes.status).toBe(200);
    expect(ansRes.body.accepted).toBe(10);

    // Finaliza la partida y recibe el puntaje calculado por el servidor (8 * 10 = 80)
    const fin1 = await httpTest(app)
      .post(`/api/v1/sessions/${session.id}/finish`)
      .set('Authorization', `Bearer ${token}`)
      .send({ token: session.token });
    expect(fin1.status).toBe(200);
    expect(fin1.body).toEqual({
      score: 80,
      correct: 8,
      total: 10,
      dailyCapReached: false,
    });
    expect(ledgerStore).toHaveLength(1);
    expect(ledgerStore[0].delta).toBe(80);

    // Reenviar finish sobre la misma sesión es idempotente y no duplica puntos en PointsLedger
    const fin2 = await httpTest(app)
      .post(`/api/v1/sessions/${session.id}/finish`)
      .set('Authorization', `Bearer ${token}`)
      .send({ token: session.token });
    expect(fin2.status).toBe(200);
    expect(fin2.body).toEqual(fin1.body);
    expect(ledgerStore).toHaveLength(1);
  });
});
