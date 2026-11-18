import 'reflect-metadata';
import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { DEFAULT_POINTS_RULES } from '@pharma/shared';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
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
const PERIOD_ID = '01900000-0000-7000-8000-000000000060';
const PH_BIG_ID = '01900000-0000-7000-8000-000000000101';
const PH_SMALL_ID = '01900000-0000-7000-8000-000000000102';
const PH_EMPTY_ID = '01900000-0000-7000-8000-000000000103';
const BRAND_A_ID = '01900000-0000-7000-8000-000000000010';
const BRAND_B_ID = '01900000-0000-7000-8000-000000000011';

const CLERK_1 = '01900000-0000-7000-8000-000000000501';
const CLERK_2 = '01900000-0000-7000-8000-000000000502';
const CLERK_3 = '01900000-0000-7000-8000-000000000503';
const CLERK_4_INACTIVE_GAME = '01900000-0000-7000-8000-000000000504';
const CLERK_5_SMALL = '01900000-0000-7000-8000-000000000505';
const MANAGER_BIG = '01900000-0000-7000-8000-000000000093';
const ADMIN_PE = '01900000-0000-7000-8000-000000000091';

describe('Iteración 5 — Rankings (promedio por activo), panel del gerente, perfil y cierre de periodo', () => {
  let app: INestApplication;
  let tokens: TokenService;

  let periodsStore: any[] = [];
  let snapshotsStore: any[] = [];
  let winnersStore: any[] = [];
  let auditStore: any[] = [];

  const pharmaciesData = [
    {
      id: PH_BIG_ID,
      countryId: PE_ID,
      externalCode: 'PE-FAR-001',
      name: 'Botica Grande Lima',
      city: 'Lima',
      active: true,
    },
    {
      id: PH_SMALL_ID,
      countryId: PE_ID,
      externalCode: 'PE-FAR-002',
      name: 'Botica Eficiente Arequipa',
      city: 'Arequipa',
      active: true,
    },
    {
      id: PH_EMPTY_ID,
      countryId: PE_ID,
      externalCode: 'PE-FAR-003',
      name: 'Botica Sin Activos Trujillo',
      city: 'Trujillo',
      active: true,
    },
  ];

  // Botica Grande tiene 4 dependientes: 3 activos (60+60+60 = 180 pts -> promedio 60) y 1 que nunca ha entrado
  // Botica Eficiente tiene 1 dependiente activo con 110 pts -> promedio 110 (gana el puesto #1 aunque su suma 110 < 180)
  // Botica Sin Activos no tiene partidas -> no aparece en el ranking
  const usersData = [
    {
      id: CLERK_1,
      countryId: PE_ID,
      displayName: 'Lucía Activa 1',
      phoneE164: '+51900000001',
      role: 'CLERK',
      status: 'ACTIVE',
      lastLoginAt: new Date(),
      pharmacy: pharmaciesData[0]!,
    },
    {
      id: CLERK_2,
      countryId: PE_ID,
      displayName: 'Pedro Activo 2',
      phoneE164: '+51900000002',
      role: 'CLERK',
      status: 'ACTIVE',
      lastLoginAt: new Date(),
      pharmacy: pharmaciesData[0]!,
    },
    {
      id: CLERK_3,
      countryId: PE_ID,
      displayName: 'Rosa Activa 3',
      phoneE164: '+51900000003',
      role: 'CLERK',
      status: 'ACTIVE',
      lastLoginAt: new Date(),
      pharmacy: pharmaciesData[0]!,
    },
    {
      id: CLERK_4_INACTIVE_GAME,
      countryId: PE_ID,
      displayName: 'Jorge Sin Entrar',
      phoneE164: '+51900000004',
      role: 'CLERK',
      status: 'ACTIVE',
      lastLoginAt: null,
      pharmacy: pharmaciesData[0]!,
    },
    {
      id: CLERK_5_SMALL,
      countryId: PE_ID,
      displayName: 'Elena Estrella',
      phoneE164: '+51900000005',
      role: 'CLERK',
      status: 'ACTIVE',
      lastLoginAt: new Date(),
      pharmacy: pharmaciesData[1]!,
    },
  ];

  const ledgerData = [
    {
      id: 'l1',
      userId: CLERK_1,
      countryId: PE_ID,
      brandId: BRAND_A_ID,
      sessionId: 's1',
      delta: 60,
      reason: 'GAME',
      onHold: false,
      reversesId: null,
      createdAt: new Date(),
    },
    {
      id: 'l2',
      userId: CLERK_2,
      countryId: PE_ID,
      brandId: BRAND_A_ID,
      sessionId: 's2',
      delta: 60,
      reason: 'GAME',
      onHold: false,
      reversesId: null,
      createdAt: new Date(),
    },
    {
      id: 'l3',
      userId: CLERK_3,
      countryId: PE_ID,
      brandId: BRAND_A_ID,
      sessionId: 's3',
      delta: 60,
      reason: 'GAME',
      onHold: false,
      reversesId: null,
      createdAt: new Date(),
    },
    {
      id: 'l4',
      userId: CLERK_5_SMALL,
      countryId: PE_ID,
      brandId: BRAND_A_ID,
      sessionId: 's4',
      delta: 110,
      reason: 'GAME',
      onHold: false,
      reversesId: null,
      createdAt: new Date(),
    },
  ];

  const sessionsData = [
    {
      id: 's1',
      userId: CLERK_1,
      countryId: PE_ID,
      brandId: BRAND_A_ID,
      status: 'FINISHED',
      score: 60,
      startedAt: new Date(),
      finishedAt: new Date(),
      game: {
        mechanic: 'MULTIPLE_CHOICE',
        brand: { id: BRAND_A_ID, slug: 'marca-a', name: 'Marca A' },
      },
    },
    {
      id: 's2',
      userId: CLERK_2,
      countryId: PE_ID,
      brandId: BRAND_A_ID,
      status: 'FINISHED',
      score: 60,
      startedAt: new Date(),
      finishedAt: new Date(),
      game: {
        mechanic: 'MULTIPLE_CHOICE',
        brand: { id: BRAND_A_ID, slug: 'marca-a', name: 'Marca A' },
      },
    },
    {
      id: 's3',
      userId: CLERK_3,
      countryId: PE_ID,
      brandId: BRAND_A_ID,
      status: 'FINISHED',
      score: 60,
      startedAt: new Date(),
      finishedAt: new Date(),
      game: {
        mechanic: 'MULTIPLE_CHOICE',
        brand: { id: BRAND_A_ID, slug: 'marca-a', name: 'Marca A' },
      },
    },
    {
      id: 's4',
      userId: CLERK_5_SMALL,
      countryId: PE_ID,
      brandId: BRAND_A_ID,
      status: 'FINISHED',
      score: 110,
      startedAt: new Date(),
      finishedAt: new Date(),
      game: {
        mechanic: 'MULTIPLE_CHOICE',
        brand: { id: BRAND_A_ID, slug: 'marca-a', name: 'Marca A' },
      },
    },
  ];

  const prismaMock: any = {
    $transaction: async (fn: (tx: any) => Promise<any>) => fn(prismaMock),
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
          terms: { 'term.pharmacy': 'botica', 'term.points': 'puntos' },
          pointsRules: DEFAULT_POINTS_RULES,
          rankingPeriodMonths: 1,
          consentVersionId: '01900000-0000-7000-8000-000000000050',
        },
      })),
    },
    rankingPeriod: {
      findFirst: vi.fn(async ({ where }: any) => {
        return (
          periodsStore.find(
            (p) =>
              p.countryId === where.countryId &&
              (!where.status || p.status === where.status) &&
              (!where.id?.not || p.id !== where.id.not),
          ) ?? null
        );
      }),
      findUnique: vi.fn(async ({ where }: any) => {
        const p = periodsStore.find((x) => x.id === where.id);
        if (!p) return null;
        return {
          ...p,
          country: { id: PE_ID, code: 'PE', name: 'Perú', timezone: 'America/Lima' },
        };
      }),
      findUniqueOrThrow: vi.fn(async ({ where }: any) => {
        const p = periodsStore.find((x) => x.id === where.id);
        if (!p) throw new Error('Period not found');
        return p;
      }),
      update: vi.fn(async ({ where, data }: any) => {
        const idx = periodsStore.findIndex((x) => x.id === where.id);
        periodsStore[idx] = { ...periodsStore[idx], ...data };
        return periodsStore[idx];
      }),
      create: vi.fn(async ({ data }: any) => {
        periodsStore.push(data);
        return data;
      }),
    },
    pointsLedger: {
      findMany: vi.fn(async () => ledgerData),
    },
    anomalyAlert: {
      findMany: vi.fn(async () => []),
    },
    gameSession: {
      findMany: vi.fn(async ({ where }: any) => {
        return sessionsData.filter((s) => {
          if (where?.userId && typeof where.userId === 'string' && s.userId !== where.userId) {
            return false;
          }
          if (where?.userId?.in && !where.userId.in.includes(s.userId)) return false;
          return true;
        });
      }),
    },
    user: {
      findMany: vi.fn(async () =>
        usersData.map((u) => ({
          id: u.id,
          displayName: u.displayName,
          assignments: [{ pharmacy: u.pharmacy }],
        })),
      ),
      findUniqueOrThrow: vi.fn(async ({ where }: any) => {
        const u = usersData.find((x) => x.id === where.id)!;
        return {
          ...u,
          assignments: [{ pharmacy: u.pharmacy }],
        };
      }),
    },
    pharmacy: {
      findMany: vi.fn(async () => pharmaciesData),
    },
    pharmacyAssignment: {
      findFirst: vi.fn(async ({ where }: any) => {
        if (where.userId === MANAGER_BIG) {
          return {
            userId: MANAGER_BIG,
            pharmacyId: PH_BIG_ID,
            to: null,
            pharmacy: pharmaciesData[0]!,
          };
        }
        return null;
      }),
      findMany: vi.fn(async ({ where }: any) => {
        return usersData
          .filter((u) => u.pharmacy.id === where.pharmacyId)
          .map((u) => ({
            userId: u.id,
            pharmacyId: where.pharmacyId,
            to: null,
            user: u,
          }));
      }),
    },
    brandCountry: {
      findMany: vi.fn(async () => [
        {
          brandId: BRAND_A_ID,
          active: true,
          brand: { id: BRAND_A_ID, slug: 'marca-a', name: 'Marca A' },
        },
        {
          brandId: BRAND_B_ID,
          active: true,
          brand: { id: BRAND_B_ID, slug: 'marca-b', name: 'Marca B' },
        },
      ]),
    },
    rankingSnapshot: {
      findFirst: vi.fn(async () => snapshotsStore[0] ?? null),
      createMany: vi.fn(async ({ data }: any) => {
        for (const row of data) snapshotsStore.push(row);
        return { count: data.length };
      }),
    },
    winner: {
      findMany: vi.fn(async ({ where }: any) =>
        winnersStore.filter((w) => w.periodId === where.periodId),
      ),
      createMany: vi.fn(async ({ data }: any) => {
        for (const w of data) winnersStore.push(w);
        return { count: data.length };
      }),
      updateMany: vi.fn(async ({ where, data }: any) => {
        for (const w of winnersStore) {
          if (w.periodId === where.periodId) w.exportedAt = data.exportedAt;
        }
        return { count: winnersStore.length };
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
    client: { get: vi.fn(), set: vi.fn(), del: vi.fn(), zadd: vi.fn() },
  };

  const clerk1Principal: Principal = {
    userId: CLERK_1,
    role: 'CLERK',
    countryId: PE_ID,
    countryCode: 'PE',
    app: 'pwa',
  };

  const managerPrincipal: Principal = {
    userId: MANAGER_BIG,
    role: 'PHARMACY_MANAGER',
    countryId: PE_ID,
    countryCode: 'PE',
    app: 'pwa',
  };

  const adminPrincipal: Principal = {
    userId: ADMIN_PE,
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
  });

  afterAll(async () => {
    await app.close();
  });

  beforeEach(() => {
    periodsStore = [
      {
        id: PERIOD_ID,
        countryId: PE_ID,
        startsAt: new Date(Date.now() - 86_400_000 * 5),
        endsAt: new Date(Date.now() + 86_400_000 * 25),
        status: 'OPEN',
      },
    ];
    snapshotsStore = [];
    winnersStore = [];
    auditStore = [];
  });

  it('GET /rankings?scope=pharmacy ordena por promedio por dependiente activo (no suma) y omite farmacias con 0 activos', async () => {
    const token = tokens.signAccess(clerk1Principal);
    const res = await httpTest(app)
      .get('/api/v1/rankings?scope=pharmacy&period=current')
      .set('Authorization', `Bearer ${token}`);

    expect(res.status).toBe(200);
    expect(res.body.rows).toHaveLength(2); // PH_EMPTY_ID tiene 0 activos y no aparece
    // Puesto #1: Botica Eficiente (110 pts / 1 activo = 110)
    expect(res.body.rows[0]).toMatchObject({
      position: 1,
      entityId: PH_SMALL_ID,
      points: 110,
      activeClerks: 1,
    });
    // Puesto #2: Botica Grande (180 pts / 3 activos = 60)
    expect(res.body.rows[1]).toMatchObject({
      position: 2,
      entityId: PH_BIG_ID,
      points: 60,
      activeClerks: 3,
    });
  });

  it('GET /me/ranking devuelve puntaje, posición individual y de farmacia, partidas jugadas y marcas pendientes', async () => {
    const token = tokens.signAccess(clerk1Principal);
    const res = await httpTest(app)
      .get('/api/v1/me/ranking')
      .set('Authorization', `Bearer ${token}`);

    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({
      userId: CLERK_1,
      totalPoints: 60,
      individualPosition: 2, // Detrás de Elena Estrella (110 pts)
      pharmacy: {
        id: PH_BIG_ID,
        averagePoints: 60,
        position: 2,
        activeClerks: 3,
      },
      sessionsPlayedInPeriod: 1,
    });
    // Jugó Marca A, le queda pendiente Marca B
    expect(res.body.pendingBrands.map((b: { brandSlug: string }) => b.brandSlug)).toEqual([
      'marca-b',
    ]);
  });

  it('GET /manager/pharmacy/summary devuelve % de participación (75%), quién no ha entrado y posición de su farmacia', async () => {
    const token = tokens.signAccess(managerPrincipal);
    const res = await httpTest(app)
      .get('/api/v1/manager/pharmacy/summary')
      .set('Authorization', `Bearer ${token}`);

    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({
      pharmacy: { id: PH_BIG_ID, name: 'Botica Grande Lima' },
      teamTotalClerks: 4,
      activeClerksCount: 3,
      participationPercentage: 75,
      pharmacyRankPosition: 2,
      pharmacyAveragePoints: 60,
    });
    expect(res.body.notEnteredMembers).toHaveLength(1);
    expect(res.body.notEnteredMembers[0].userId).toBe(CLERK_4_INACTIVE_GAME);
    expect(res.body.notEnteredMembers[0].displayName).toBe('Jorge Sin Entrar');
  });

  it('POST /admin/periods/:id/close toma foto oficial, genera ganadores, abre siguiente periodo y exporta winners.csv', async () => {
    const adminToken = tokens.signAccess(adminPrincipal);

    const closeRes = await httpTest(app)
      .post(`/api/v1/admin/periods/${PERIOD_ID}/close`)
      .set('Authorization', `Bearer ${adminToken}`);
    expect(closeRes.status).toBe(200);
    expect(closeRes.body.period.status).toBe('CLOSED');
    expect(closeRes.body.winnersCount).toBeGreaterThan(0);
    expect(snapshotsStore.length).toBeGreaterThan(0);
    // Se abrió un nuevo periodo OPEN automáticamente
    expect(periodsStore.filter((p) => p.status === 'OPEN')).toHaveLength(1);

    const csvRes = await httpTest(app)
      .get(`/api/v1/admin/periods/${PERIOD_ID}/winners.csv`)
      .set('Authorization', `Bearer ${adminToken}`);
    expect(csvRes.status).toBe(200);
    expect(csvRes.headers['content-type']).toContain('text/csv');
    expect(csvRes.text).toContain(
      'periodId,countryCode,scope,position,entityId,displayName,points',
    );
    expect(csvRes.text).toContain('Elena Estrella');
    expect(csvRes.text).toContain('Botica Eficiente Arequipa');
    expect(auditStore.some((a) => a.action === 'EXPORT_WINNERS_CSV')).toBe(true);
  });
});
