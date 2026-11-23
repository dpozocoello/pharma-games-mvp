import 'reflect-metadata';
import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { DEFAULT_POINTS_RULES } from '@pharma/shared';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { AdminAnomaliesService } from '../src/admin/admin-anomalies.service';
import { AppModule } from '../src/app.module';
import { OtpQueue } from '../src/auth/messaging/otp-queue';
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
const BRAND_A_ID = '01900000-0000-7000-8000-000000000010';
const GAME_MC_ID = '01900000-0000-7000-8000-000000000201';
const CLERK_ID = '01900000-0000-7000-8000-000000000501';
const ADMIN_ID = '01900000-0000-7000-8000-000000000091';

describe('Iteración 4 — Puntos inmutables, topes diarios por zona horaria y detección de anomalías', () => {
  let app: INestApplication;
  let tokens: TokenService;
  let anomaliesService: AdminAnomaliesService;

  let sessionsStore: any[] = [];
  let answersStore: any[] = [];
  let ledgerStore: any[] = [];
  let anomaliesStore: any[] = [];
  let auditStore: any[] = [];

  const sampleQuestions = Array.from({ length: 10 }, (_, idx) => ({
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
    correctAnswer: 'b',
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
    game: {
      findUnique: vi.fn(async () => ({
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
      })),
    },
    question: {
      findMany: vi.fn(async () => sampleQuestions),
    },
    gameSession: {
      count: vi.fn(async ({ where }: any) => {
        return sessionsStore.filter(
          (s) =>
            s.userId === where.userId &&
            (!where.gameId || s.gameId === where.gameId) &&
            (!where.startedAt?.gte || s.startedAt >= where.startedAt.gte),
        ).length;
      }),
      findMany: vi.fn(async ({ where }: any) => {
        return sessionsStore
          .filter(
            (s) =>
              s.userId === where.userId &&
              (!where.status || s.status === where.status) &&
              (!where.id?.not || s.id !== where.id.not),
          )
          .map((s) => ({
            ...s,
            answers: answersStore.filter((a) => a.sessionId === s.id),
          }));
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
        return ledgerStore.filter((l) => {
          if (where?.userId && l.userId !== where.userId) return false;
          if (where?.countryId && l.countryId !== where.countryId) return false;
          if (where?.localDay && l.localDay !== where.localDay) return false;
          return true;
        });
      }),
      create: vi.fn(async ({ data }: any) => {
        const entry = { ...data, createdAt: new Date() };
        ledgerStore.push(entry);
        return entry;
      }),
      // Inmutabilidad: update y delete lanzan error como el trigger de PostgreSQL
      update: vi.fn(async () => {
        throw new Error('La tabla PointsLedger es inmutable: UPDATE no permitido');
      }),
      delete: vi.fn(async () => {
        throw new Error('La tabla PointsLedger es inmutable: DELETE no permitido');
      }),
    },
    anomalyAlert: {
      create: vi.fn(async ({ data }: any) => {
        const alert = {
          ...data,
          reviewedBy: null,
          reviewedAt: null,
          createdAt: new Date(),
        };
        anomaliesStore.push(alert);
        return alert;
      }),
      findMany: vi.fn(async ({ where }: any) => {
        return anomaliesStore
          .filter((a) => {
            if (where?.countryId && a.countryId !== where.countryId) return false;
            if (where?.status?.in && !where.status.in.includes(a.status)) return false;
            if (typeof where?.status === 'string' && a.status !== where.status) return false;
            return true;
          })
          .map((a) => {
            const sess = sessionsStore.find((s) => s.id === a.sessionId);
            return {
              ...a,
              country: { code: 'PE' },
              session: {
                ...sess,
                user: { id: CLERK_ID, displayName: 'Dependiente Prueba' },
                game: { brand: { name: 'Marca A' } },
              },
            };
          });
      }),
      findUnique: vi.fn(async ({ where }: any) => {
        const a = anomaliesStore.find((x) => x.id === where.id);
        if (!a) return null;
        const sess = sessionsStore.find((s) => s.id === a.sessionId);
        return {
          ...a,
          country: { id: PE_ID, code: 'PE', timezone: 'America/Lima' },
          session: {
            ...sess,
            user: { id: CLERK_ID, displayName: 'Dependiente Prueba' },
            game: { brand: { name: 'Marca A' } },
            ledger: ledgerStore.filter((l) => l.sessionId === a.sessionId),
          },
        };
      }),
      update: vi.fn(async ({ where, data }: any) => {
        const idx = anomaliesStore.findIndex((x) => x.id === where.id);
        anomaliesStore[idx] = { ...anomaliesStore[idx], ...data };
        return anomaliesStore[idx];
      }),
    },
    adminAuditLog: {
      create: vi.fn(async ({ data }: any) => {
        auditStore.push(data);
        return data;
      }),
    },
    onModuleDestroy: vi.fn(),
  };

  const redisMock = {
    ping: vi.fn(),
    onModuleInit: vi.fn(),
    onModuleDestroy: vi.fn(),
    client: {
      get: vi.fn(),
      set: vi.fn(),
      del: vi.fn(),
      incrby: vi.fn(),
      expire: vi.fn(),
    },
  };

  const clerkPrincipal: Principal = {
    userId: CLERK_ID,
    role: 'CLERK',
    countryId: PE_ID,
    countryCode: 'PE',
    app: 'pwa',
  };

  const adminPrincipal: Principal = {
    userId: ADMIN_ID,
    role: 'COUNTRY_ADMIN',
    countryId: PE_ID,
    countryCode: 'PE',
    app: 'admin',
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
      .overrideProvider(ConsentService)
      .useValue({ hasAcceptedCurrent: async () => true, hasAccepted: async () => true })
      .compile();

    app = mod.createNestApplication({ logger: false });
    configureApp(app, env);
    await app.init();

    tokens = app.get(TokenService);
    anomaliesService = app.get(AdminAnomaliesService);
  });

  afterAll(async () => {
    await app.close();
  });

  beforeEach(() => {
    sessionsStore = [];
    answersStore = [];
    ledgerStore = [];
    anomaliesStore = [];
    auditStore = [];
  });

  it('un script que responde en 200 ms por pregunta genera alertas, sus puntos no cuentan para ganadores y al confirmar emite un REVERSAL inmutable auditado', async () => {
    const clerkToken = tokens.signAccess(clerkPrincipal);
    const adminToken = tokens.signAccess(adminPrincipal);

    // 1. Iniciar partida
    const startRes = await httpTest(app)
      .post(`/api/v1/games/${GAME_MC_ID}/sessions`)
      .set('Authorization', `Bearer ${clerkToken}`);
    expect(startRes.status).toBe(201);
    const { session, questions } = startRes.body;

    // 2. El script envía las 10 respuestas en 200 ms por pregunta (< minAnswerMs 800 ms)
    const botAnswers = questions.map((q: { id: string }) => ({
      questionId: q.id,
      answer: 'b',
      clientElapsedMs: 200,
    }));

    await httpTest(app)
      .post(`/api/v1/sessions/${session.id}/answers`)
      .set('Authorization', `Bearer ${clerkToken}`)
      .send({ token: session.token, answers: botAnswers })
      .expect(200);

    const finishRes = await httpTest(app)
      .post(`/api/v1/sessions/${session.id}/finish`)
      .set('Authorization', `Bearer ${clerkToken}`)
      .send({ token: session.token });
    expect(finishRes.status).toBe(200);
    expect(finishRes.body.score).toBe(100);

    // 3. Verificar que se crearon alertas de anomalía (FAST_ANSWER y SHORT_SESSION) y el movimiento quedó onHold = true
    expect(anomaliesStore.length).toBeGreaterThanOrEqual(2);
    expect(ledgerStore).toHaveLength(1);
    expect(ledgerStore[0].onHold).toBe(true);

    // 4. Mientras las alertas están OPEN, los puntos elegantes para ganadores son 0
    const eligibleWhileOpen = await anomaliesService.computeEligiblePointsByUser(PE_ID);
    expect(eligibleWhileOpen.get(CLERK_ID) ?? 0).toBe(0);

    // 5. El administrador consulta GET /api/v1/admin/anomalies y confirma la alerta (CONFIRMED)
    const listRes = await httpTest(app)
      .get('/api/v1/admin/anomalies?countryCode=PE&status=OPEN')
      .set('Authorization', `Bearer ${adminToken}`);
    expect(listRes.status).toBe(200);
    expect(listRes.body.length).toBeGreaterThanOrEqual(2);

    const firstAlertId = listRes.body[0].id;
    const confirmRes = await httpTest(app)
      .patch(`/api/v1/admin/anomalies/${firstAlertId}`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ status: 'CONFIRMED' });
    expect(confirmRes.status).toBe(200);
    expect(confirmRes.body.status).toBe('CONFIRMED');

    // 6. Se insertó un movimiento inverso REVERSAL en PointsLedger (-100) sin tocar el original
    expect(ledgerStore).toHaveLength(2);
    const originalEntry = ledgerStore[0];
    const reversalEntry = ledgerStore[1];
    expect(reversalEntry.reason).toBe('REVERSAL');
    expect(reversalEntry.delta).toBe(-originalEntry.delta);
    expect(reversalEntry.reversesId).toBe(originalEntry.id);
    expect(auditStore.some((a) => a.action === 'ANOMALY_CONFIRM_REVERSAL')).toBe(true);

    // Los puntos elegibles siguen siendo 0
    const eligibleAfterConfirm = await anomaliesService.computeEligiblePointsByUser(PE_ID);
    expect(eligibleAfterConfirm.get(CLERK_ID) ?? 0).toBe(0);
  });
});
