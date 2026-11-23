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
import { PrismaService } from '../src/infra/prisma.service';
import { RedisService } from '../src/infra/redis.service';
import { ConsentService } from '../src/me/consent.service';
import { httpTest } from './http-test';

const env = loadEnv({
  NODE_ENV: 'test',
  DATABASE_URL: 'postgresql://u:p@localhost:5432/db',
  REDIS_URL: 'redis://localhost:6379',
  CORS_ORIGINS: 'http://localhost:5173,http://localhost:5174',
  DOCUMENT_HASH_SECRET: 'test-document-secret-123',
  SESSION_TOKEN_SECRET: 'test-session-secret-123',
  AUTH_TOKEN_SECRET: 'test-auth-token-secret-123',
  LOG_LEVEL: 'fatal',
});

const PE_ID = '01900000-0000-7000-8000-000000000001';
const CO_ID = '01900000-0000-7000-8000-000000000002';
const PH_1_ID = '01900000-0000-7000-8000-000000000101';
const BRAND_A_ID = '01900000-0000-7000-8000-000000000010';
const CLERK_1 = '01900000-0000-7000-8000-000000000501';
const ADMIN_PE = '01900000-0000-7000-8000-000000000091';

const Q1_ID = '01900000-0000-7000-8000-000000000801';
const Q2_ID = '01900000-0000-7000-8000-000000000802';

describe('Iteración 6 — Medición (Test inicial por marca, eventos sin PII y reporte de participación CSV)', () => {
  let app: INestApplication;
  let tokens: TokenService;

  let knowledgeTestsStore: any[] = [];
  let testResultsStore: any[] = [];
  let usageEventsStore: any[] = [];
  let auditStore: any[] = [];

  const questionsData = [
    {
      id: Q1_ID,
      brandId: BRAND_A_ID,
      countryId: null,
      type: 'MULTIPLE_CHOICE',
      prompt: '¿En qué zona de la botica se ubica Alivex Forte?',
      options: [
        { id: 'a', text: 'Mostrador principal OTC' },
        { id: 'b', text: 'Refrigerador de cadena de frío' },
      ],
      correctAnswer: 'a',
      locale: 'es',
      status: 'PUBLISHED',
      termOverrides: [],
      createdAt: new Date(),
    },
    {
      id: Q2_ID,
      brandId: BRAND_A_ID,
      countryId: null,
      type: 'TRUE_FALSE',
      prompt: 'Alivex Forte es una marca ficticia de venta libre (OTC).',
      options: [
        { id: 'true', text: 'Verdadero' },
        { id: 'false', text: 'Falso' },
      ],
      correctAnswer: 'true',
      locale: 'es',
      status: 'PUBLISHED',
      termOverrides: [],
      createdAt: new Date(),
    },
  ];

  const prismaStub = {
    country: {
      findUnique: vi.fn(({ where }: any) => {
        if (where.id === PE_ID || where.code === 'PE') {
          return Promise.resolve({
            id: PE_ID,
            code: 'PE',
            name: 'Perú',
            locale: 'es-PE',
            timezone: 'America/Lima',
            phonePrefix: '+51',
            active: true,
            config: {
              terms: { pharmacy: 'botica', clerk: 'dependiente' },
              pointsRules: DEFAULT_POINTS_RULES,
              rankingPeriodMonths: 1,
            },
          });
        }
        return Promise.resolve(null);
      }),
      findMany: vi.fn(({ where }: any) => {
        const list = [
          {
            id: PE_ID,
            code: 'PE',
            name: 'Perú',
            locale: 'es-PE',
            timezone: 'America/Lima',
            phonePrefix: '+51',
            active: true,
          },
        ];
        if (where?.id?.in) {
          return Promise.resolve(list.filter((c) => where.id.in.includes(c.id)));
        }
        return Promise.resolve(list);
      }),
    },
    brandCountry: {
      findMany: vi.fn(({ where }: any) => {
        if (where.countryId === PE_ID) {
          return Promise.resolve([
            {
              brandId: BRAND_A_ID,
              countryId: PE_ID,
              active: true,
              brand: {
                id: BRAND_A_ID,
                slug: 'marca-a',
                name: 'Alivex Forte',
              },
            },
          ]);
        }
        return Promise.resolve([]);
      }),
    },
    question: {
      findMany: vi.fn(({ where }: any) => {
        if (where?.id?.in) {
          return Promise.resolve(questionsData.filter((q) => where.id.in.includes(q.id)));
        }
        return Promise.resolve(questionsData);
      }),
    },
    knowledgeTest: {
      findUnique: vi.fn(({ where }: any) => {
        if (where.id) {
          return Promise.resolve(knowledgeTestsStore.find((t) => t.id === where.id) ?? null);
        }
        if (where.brandId_countryId_kind) {
          const { brandId, countryId, kind } = where.brandId_countryId_kind;
          return Promise.resolve(
            knowledgeTestsStore.find(
              (t) => t.brandId === brandId && t.countryId === countryId && t.kind === kind,
            ) ?? null,
          );
        }
        return Promise.resolve(null);
      }),
      create: vi.fn(({ data }: any) => {
        const row = {
          ...data,
          brand: { id: BRAND_A_ID, slug: 'marca-a', name: 'Alivex Forte' },
        };
        knowledgeTestsStore.push(row);
        return Promise.resolve(row);
      }),
      findMany: vi.fn(({ where, include }: any) => {
        const list = knowledgeTestsStore
          .filter(
            (t) =>
              t.countryId === where.countryId && t.kind === where.kind && t.active === where.active,
          )
          .map((t) => ({
            ...t,
            results: include?.results?.where?.userId
              ? testResultsStore.filter(
                  (r) => r.testId === t.id && r.userId === include.results.where.userId,
                )
              : [],
          }));
        return Promise.resolve(list);
      }),
    },
    testResult: {
      findUnique: vi.fn(({ where }: any) => {
        const { testId, userId } = where.testId_userId;
        return Promise.resolve(
          testResultsStore.find((r) => r.testId === testId && r.userId === userId) ?? null,
        );
      }),
      create: vi.fn(({ data }: any) => {
        testResultsStore.push(data);
        return Promise.resolve(data);
      }),
      findMany: vi.fn(() => {
        return Promise.resolve(
          testResultsStore.map((r) => {
            const test = knowledgeTestsStore.find((t) => t.id === r.testId);
            return {
              ...r,
              test: { brandId: test?.brandId ?? BRAND_A_ID },
            };
          }),
        );
      }),
    },
    usageEvent: {
      create: vi.fn(({ data }: any) => {
        usageEventsStore.push(data);
        return Promise.resolve(data);
      }),
    },
    pharmacy: {
      findMany: vi.fn(() => {
        return Promise.resolve([
          {
            id: PH_1_ID,
            countryId: PE_ID,
            externalCode: 'PE-FAR-001',
            name: 'Botica Central Lima',
            city: 'Lima',
            active: true,
            assignments: [
              {
                userId: CLERK_1,
                pharmacyId: PH_1_ID,
                to: null,
                user: {
                  id: CLERK_1,
                  role: 'CLERK',
                  status: 'ACTIVE',
                  lastLoginAt: new Date(),
                },
              },
            ],
          },
        ]);
      }),
    },
    gameSession: {
      findMany: vi.fn(() =>
        Promise.resolve([
          {
            userId: CLERK_1,
            brandId: BRAND_A_ID,
            status: 'FINISHED',
          },
        ]),
      ),
    },
    pointsLedger: {
      findMany: vi.fn(() =>
        Promise.resolve([
          {
            userId: CLERK_1,
            brandId: BRAND_A_ID,
            delta: 95,
          },
        ]),
      ),
    },
    adminAuditLog: {
      create: vi.fn(({ data }: any) => {
        auditStore.push(data);
        return Promise.resolve(data);
      }),
    },
  };

  beforeAll(async () => {
    const mod = await Test.createTestingModule({
      imports: [AppModule.register(env)],
    })
      .overrideProvider(PrismaService)
      .useValue(prismaStub)
      .overrideProvider(RedisService)
      .useValue({ client: { get: vi.fn().mockResolvedValue(null), set: vi.fn(), del: vi.fn() } })
      .overrideProvider(OtpQueue)
      .useValue({ enqueue: vi.fn() })
      // Sin BullMQ real en pruebas unitarias (las de integración usan Redis real).
      .overrideProvider(DailySnapshotScheduler)
      .useValue({ sync: vi.fn(), syncAll: vi.fn() })
      .overrideProvider(RankingJobsWorker)
      .useValue({})
      .overrideProvider(RateLimitService)
      .useValue({ hit: vi.fn().mockResolvedValue({ allowed: true, retryAfterSeconds: 0 }) })
      .overrideProvider(ConsentService)
      .useValue({ hasAcceptedCurrent: vi.fn().mockResolvedValue(true) })
      .compile();

    app = mod.createNestApplication();
    configureApp(app, env);
    await app.init();
    tokens = app.get(TokenService);
  });

  beforeEach(() => {
    knowledgeTestsStore = [];
    testResultsStore = [];
    usageEventsStore = [];
    auditStore = [];
  });

  afterAll(async () => {
    await app?.close();
  });

  function tokenFor(p: Principal) {
    return tokens.signAccess(p);
  }

  it('1. GET /tests/pending devuelve el test inicial por marca sin exponer jamás correctAnswer y POST /tests/:id/submit calcula el puntaje en el servidor', async () => {
    const clerkToken = tokenFor({
      userId: CLERK_1,
      role: 'CLERK',
      countryId: PE_ID,
      countryCode: 'PE',
      app: 'pwa',
    });

    const pendingRes = await httpTest(app)
      .get('/api/v1/tests/pending')
      .set('Authorization', `Bearer ${clerkToken}`);

    expect(pendingRes.status).toBe(200);
    expect(JSON.stringify(pendingRes.body)).not.toContain('correctAnswer');
    expect(pendingRes.body.tests).toHaveLength(1);

    const test = pendingRes.body.tests[0];
    expect(test.brandSlug).toBe('marca-a');
    expect(test.kind).toBe('INITIAL');
    expect(test.questions).toHaveLength(2);

    // Enviamos 1 respuesta correcta (Q1 = 'a') y 1 incorrecta (Q2 = 'false')
    const submitRes = await httpTest(app)
      .post(`/api/v1/tests/${test.id}/submit`)
      .set('Authorization', `Bearer ${clerkToken}`)
      .send({
        answers: [
          { questionId: Q1_ID, answer: 'a' },
          { questionId: Q2_ID, answer: 'false' },
        ],
      });

    expect(submitRes.status).toBe(200);
    expect(submitRes.body.score).toBe(1);
    expect(submitRes.body.total).toBe(2);

    // Verificar idempotencia al reenviar el mismo test
    const repeatRes = await httpTest(app)
      .post(`/api/v1/tests/${test.id}/submit`)
      .set('Authorization', `Bearer ${clerkToken}`)
      .send({
        answers: [
          { questionId: Q1_ID, answer: 'a' },
          { questionId: Q2_ID, answer: 'true' },
        ],
      });
    expect(repeatRes.status).toBe(200);
    expect(repeatRes.body.resultId).toBe(submitRes.body.resultId);
    expect(repeatRes.body.score).toBe(1);

    // Ya no debe aparecer pendiente
    const pendingAfter = await httpTest(app)
      .get('/api/v1/tests/pending')
      .set('Authorization', `Bearer ${clerkToken}`);
    expect(pendingAfter.status).toBe(200);
    expect(pendingAfter.body.tests).toHaveLength(0);

    // Debe haberse registrado el UsageEvent de knowledge_test.submitted
    expect(usageEventsStore).toHaveLength(1);
    expect(usageEventsStore[0].type).toBe('knowledge_test.submitted');
  });

  it('2. POST /events registra eventos de uso filtrando cualquier campo con datos personales (PII)', async () => {
    const clerkToken = tokenFor({
      userId: CLERK_1,
      role: 'CLERK',
      countryId: PE_ID,
      countryCode: 'PE',
      app: 'pwa',
    });

    const res = await httpTest(app)
      .post('/api/v1/events')
      .set('Authorization', `Bearer ${clerkToken}`)
      .send({
        type: 'pwa.navigation',
        brandId: BRAND_A_ID,
        payload: {
          tab: 'rankings',
          phoneE164: '+51900000001',
          document: '10000001',
          displayName: 'Lucía Activa 1',
        },
      });

    expect(res.status).toBe(201);
    expect(usageEventsStore).toHaveLength(1);
    expect(usageEventsStore[0].payload).toEqual({ tab: 'rankings' });
  });

  it('3. GET /admin/reports/participation.csv exporta participación por país, farmacia y marca, registra auditoría e impide cruce de países', async () => {
    const clerkToken = tokenFor({
      userId: CLERK_1,
      role: 'CLERK',
      countryId: PE_ID,
      countryCode: 'PE',
      app: 'pwa',
    });

    // Completar el test inicial con 2/2 (100%)
    const pendingRes = await httpTest(app)
      .get('/api/v1/tests/pending')
      .set('Authorization', `Bearer ${clerkToken}`);
    const testId = pendingRes.body.tests[0].id;
    await httpTest(app)
      .post(`/api/v1/tests/${testId}/submit`)
      .set('Authorization', `Bearer ${clerkToken}`)
      .send({
        answers: [
          { questionId: Q1_ID, answer: 'a' },
          { questionId: Q2_ID, answer: 'true' },
        ],
      });

    const adminPeToken = tokenFor({
      userId: ADMIN_PE,
      role: 'COUNTRY_ADMIN',
      countryId: PE_ID,
      countryCode: 'PE',
      app: 'admin',
    });

    // Intento de COUNTRY_ADMIN de PE de exportar otro país (CO) -> 403
    const forbiddenRes = await httpTest(app)
      .get(`/api/v1/admin/reports/participation.csv?countryId=${CO_ID}`)
      .set('Authorization', `Bearer ${adminPeToken}`);
    expect(forbiddenRes.status).toBe(403);

    // Exportación válida del propio país (PE)
    const csvRes = await httpTest(app)
      .get('/api/v1/admin/reports/participation.csv')
      .set('Authorization', `Bearer ${adminPeToken}`);

    expect(csvRes.status).toBe(200);
    expect(csvRes.text).toContain(
      'countryCode,pharmacyCode,pharmacyName,city,brandSlug,brandName,activeClerks,clerksWithLogin,clerksPlayedBrand,sessionsFinished,initialTestsCompleted,avgInitialTestScorePct,totalPointsAwarded',
    );
    expect(csvRes.text).toContain(
      'PE,PE-FAR-001,Botica Central Lima,Lima,marca-a,Alivex Forte,1,1,1,1,1,100,95',
    );

    expect(auditStore).toHaveLength(1);
    expect(auditStore[0].action).toBe('participation.export_csv');
  });
});
