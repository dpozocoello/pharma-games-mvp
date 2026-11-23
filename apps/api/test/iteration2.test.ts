import 'reflect-metadata';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { AdminContentService } from '../src/admin/admin-content.service';
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
import { httpTest } from './http-test';

const env = loadEnv({
  NODE_ENV: 'test',
  DATABASE_URL: 'postgresql://u:p@localhost:5432/db',
  REDIS_URL: 'redis://localhost:6379',
  CORS_ORIGINS: 'http://localhost:5174',
  DOCUMENT_HASH_SECRET: 'test-document-secret-123',
  SESSION_TOKEN_SECRET: 'test-session-secret-123',
  AUTH_TOKEN_SECRET: 'test-auth-token-secret-123',
  LOG_LEVEL: 'fatal',
});

const PE_ID = '01900000-0000-7000-8000-000000000001';
const CO_ID = '01900000-0000-7000-8000-000000000002';
const BRAND_A_ID = '01900000-0000-7000-8000-000000000010';
const BRAND_B_ID = '01900000-0000-7000-8000-000000000011';
const BRAND_D_ID = '01900000-0000-7000-8000-000000000013';
const BRAND_I_ID = '01900000-0000-7000-8000-000000000018';

describe('Iteración 2 — Usuarios, farmacias, traslados y contenido', () => {
  let app: INestApplication;
  let tokens: TokenService;
  let contentService: AdminContentService;

  // Almacenamiento en memoria para verificar estado transaccional de punta a punta
  const countries = new Map([
    [
      'PE',
      {
        id: PE_ID,
        code: 'PE',
        name: 'Perú',
        locale: 'es-PE',
        timezone: 'America/Lima',
        phonePrefix: '+51',
        active: true,
      },
    ],
    [
      'CO',
      {
        id: CO_ID,
        code: 'CO',
        name: 'Colombia',
        locale: 'es-CO',
        timezone: 'America/Bogota',
        phonePrefix: '+57',
        active: true,
      },
    ],
  ]);

  let pharmaciesStore: Array<{
    id: string;
    countryId: string;
    chainId: string | null;
    externalCode: string | null;
    name: string;
    city: string;
    active: boolean;
  }> = [];

  let usersStore: Array<{
    id: string;
    countryId: string | null;
    phoneE164: string;
    documentHash: string | null;
    displayName: string;
    role: 'CLERK' | 'PHARMACY_MANAGER' | 'COUNTRY_ADMIN' | 'SUPER_ADMIN' | 'CONTENT_EDITOR';
    status: 'ACTIVE' | 'INACTIVE';
    createdAt: Date;
  }> = [];

  let assignmentsStore: Array<{
    id: string;
    userId: string;
    pharmacyId: string;
    from: Date;
    to: Date | null;
  }> = [];

  let ledgerStore: Array<{
    id: string;
    userId: string;
    countryId: string;
    brandId: string;
    delta: number;
    onHold: boolean;
  }> = [];

  let questionsStore: Array<{
    id: string;
    brandId: string;
    countryId: string | null;
    type: 'MULTIPLE_CHOICE' | 'TRUE_FALSE';
    prompt: string;
    options: Array<{ id: string; text: string }>;
    correctAnswer: string;
    locale: string;
    status: 'DRAFT' | 'IN_REVIEW' | 'PUBLISHED' | 'ARCHIVED';
    version: number;
    updatedAt: Date;
  }> = [];

  let importJobsStore: Array<{
    id: string;
    countryId: string;
    kind: 'USERS' | 'QUESTIONS';
    fileName: string;
    status: 'PENDING' | 'PROCESSING' | 'COMPLETED' | 'FAILED';
    totalRows: number;
    validRows: number;
    errors: unknown;
    createdBy: string;
    createdAt: Date;
    finishedAt: Date | null;
  }> = [];

  let auditLogsStore: Array<{
    id: string;
    actorId: string;
    countryId: string | null;
    action: string;
    entity: string;
    entityId: string | null;
    before?: unknown;
    after?: unknown;
  }> = [];

  const prismaMock: any = {
    $transaction: async (fn: (tx: any) => Promise<any>) => fn(prismaMock),
    country: {
      findUnique: vi.fn(async ({ where }: any) => {
        if (where.code) return countries.get(where.code) ?? null;
        if (where.id) {
          return Array.from(countries.values()).find((c) => c.id === where.id) ?? null;
        }
        return null;
      }),
      findMany: vi.fn(async () => Array.from(countries.values())),
    },
    pharmacy: {
      findMany: vi.fn(async ({ where }: any) => {
        return pharmaciesStore
          .filter((p) => {
            if (where?.countryId && p.countryId !== where.countryId) return false;
            if (where?.externalCode?.in && !where.externalCode.in.includes(p.externalCode)) {
              return false;
            }
            return true;
          })
          .map((p) => ({
            ...p,
            country: { code: p.countryId === PE_ID ? 'PE' : 'CO' },
            _count: {
              assignments: assignmentsStore.filter((a) => a.pharmacyId === p.id && a.to === null)
                .length,
            },
          }));
      }),
      findUnique: vi.fn(async ({ where }: any) => {
        if (where.id) {
          const found = pharmaciesStore.find((p) => p.id === where.id);
          return found
            ? { ...found, country: { code: found.countryId === PE_ID ? 'PE' : 'CO' } }
            : null;
        }
        if (where.countryId_externalCode) {
          const { countryId, externalCode } = where.countryId_externalCode;
          return (
            pharmaciesStore.find(
              (p) => p.countryId === countryId && p.externalCode === externalCode,
            ) ?? null
          );
        }
        return null;
      }),
      create: vi.fn(async ({ data }: any) => {
        const ph = { ...data, chainId: data.chainId ?? null };
        pharmaciesStore.push(ph);
        return ph;
      }),
      createMany: vi.fn(async ({ data }: any) => {
        for (const item of data) {
          if (
            !pharmaciesStore.some(
              (p) => p.countryId === item.countryId && p.externalCode === item.externalCode,
            )
          ) {
            pharmaciesStore.push({ ...item, chainId: null, active: true });
          }
        }
        return { count: data.length };
      }),
      update: vi.fn(async ({ where, data }: any) => {
        const idx = pharmaciesStore.findIndex((p) => p.id === where.id);
        pharmaciesStore[idx] = { ...pharmaciesStore[idx]!, ...data };
        const updated = pharmaciesStore[idx]!;
        return {
          ...updated,
          _count: {
            assignments: assignmentsStore.filter(
              (a) => a.pharmacyId === updated.id && a.to === null,
            ).length,
          },
        };
      }),
    },
    user: {
      findMany: vi.fn(async ({ where }: any) => {
        if (where?.OR) {
          const phonesSet = new Set(where.OR[0]?.phoneE164?.in ?? []);
          const docsSet = new Set(where.OR[1]?.documentHash?.in ?? []);
          const cId = where.OR[1]?.countryId;
          return usersStore
            .filter(
              (u) =>
                phonesSet.has(u.phoneE164) ||
                (u.countryId === cId && u.documentHash && docsSet.has(u.documentHash)),
            )
            .map((u) => ({
              ...u,
              assignments: assignmentsStore.filter((a) => a.userId === u.id && a.to === null),
            }));
        }
        return usersStore
          .filter((u) => !where?.countryId || u.countryId === where.countryId)
          .map((u) => ({
            ...u,
            country: u.countryId ? { code: u.countryId === PE_ID ? 'PE' : 'CO' } : null,
            assignments: assignmentsStore
              .filter((a) => a.userId === u.id)
              .map((a) => ({
                ...a,
                pharmacy: pharmaciesStore.find((p) => p.id === a.pharmacyId)!,
              })),
            ledger: ledgerStore.filter((l) => l.userId === u.id),
          }));
      }),
      findUnique: vi.fn(async ({ where }: any) => {
        const u = usersStore.find((x) => x.id === where.id);
        if (!u) return null;
        return {
          ...u,
          country: u.countryId ? { code: u.countryId === PE_ID ? 'PE' : 'CO' } : null,
          assignments: assignmentsStore
            .filter((a) => a.userId === u.id)
            .sort((a, b) => b.from.getTime() - a.from.getTime())
            .map((a) => ({
              ...a,
              pharmacy: pharmaciesStore.find((p) => p.id === a.pharmacyId)!,
            })),
          ledger: ledgerStore.filter((l) => l.userId === u.id),
        };
      }),
      createMany: vi.fn(async ({ data }: any) => {
        const now = new Date();
        for (const item of data) {
          usersStore.push({ ...item, createdAt: now });
        }
        return { count: data.length };
      }),
      update: vi.fn(async ({ where, data }: any) => {
        const idx = usersStore.findIndex((u) => u.id === where.id);
        usersStore[idx] = { ...usersStore[idx]!, ...data };
        return usersStore[idx];
      }),
    },
    pharmacyAssignment: {
      create: vi.fn(async ({ data }: any) => {
        assignmentsStore.push(data);
        return data;
      }),
      createMany: vi.fn(async ({ data }: any) => {
        for (const item of data) assignmentsStore.push(item);
        return { count: data.length };
      }),
      update: vi.fn(async ({ where, data }: any) => {
        const idx = assignmentsStore.findIndex((a) => a.id === where.id);
        assignmentsStore[idx] = { ...assignmentsStore[idx]!, ...data };
        return assignmentsStore[idx];
      }),
      updateMany: vi.fn(async ({ where, data }: any) => {
        const idSet = new Set(where.id?.in ?? []);
        for (const a of assignmentsStore) {
          if (idSet.has(a.id)) a.to = data.to;
        }
        return { count: idSet.size };
      }),
    },
    refreshToken: {
      updateMany: vi.fn(async () => ({ count: 1 })),
    },
    brand: {
      findMany: vi.fn(async () => [
        {
          id: BRAND_A_ID,
          slug: 'marca-a',
          name: 'Marca A',
          theme: { primary: '#1D4ED8', secondary: '#DBEAFE', logoUrl: '/brands/marca-a.svg' },
          countries: [
            {
              countryId: PE_ID,
              active: true,
              country: { id: PE_ID, code: 'PE', name: 'Perú' },
            },
            {
              countryId: CO_ID,
              active: true,
              country: { id: CO_ID, code: 'CO', name: 'Colombia' },
            },
          ],
          questions: questionsStore.filter((q) => q.brandId === BRAND_A_ID),
        },
        {
          id: BRAND_B_ID,
          slug: 'marca-b',
          name: 'Marca B',
          theme: { primary: '#047857', secondary: '#D1FAE5', logoUrl: '/brands/marca-b.svg' },
          countries: [
            {
              countryId: PE_ID,
              active: true,
              country: { id: PE_ID, code: 'PE', name: 'Perú' },
            },
          ],
          questions: questionsStore.filter((q) => q.brandId === BRAND_B_ID),
        },
        {
          id: BRAND_D_ID,
          slug: 'marca-d',
          name: 'Marca D',
          theme: { primary: '#7C3AED', secondary: '#EDE9FE', logoUrl: '/brands/marca-d.svg' },
          countries: [
            {
              countryId: CO_ID,
              active: true,
              country: { id: CO_ID, code: 'CO', name: 'Colombia' },
            },
          ],
          questions: questionsStore.filter((q) => q.brandId === BRAND_D_ID),
        },
        {
          id: BRAND_I_ID,
          slug: 'marca-i',
          name: 'Marca I',
          theme: { primary: '#334155', secondary: '#E2E8F0', logoUrl: '/brands/marca-i.svg' },
          countries: [
            {
              countryId: PE_ID,
              active: true,
              country: { id: PE_ID, code: 'PE', name: 'Perú' },
            },
          ],
          questions: questionsStore.filter((q) => q.brandId === BRAND_I_ID),
        },
      ]),
      findUnique: vi.fn(async () => null),
    },
    question: {
      createMany: vi.fn(async ({ data }: any) => {
        const now = new Date();
        for (const q of data) {
          questionsStore.push({ ...q, updatedAt: now });
        }
        return { count: data.length };
      }),
      findUnique: vi.fn(async ({ where }: any) => {
        const q = questionsStore.find((x) => x.id === where.id);
        if (!q) return null;
        return {
          ...q,
          brand: { slug: 'marca-a', name: 'Marca A', countries: [{ countryId: PE_ID }] },
          country: q.countryId ? { code: q.countryId === PE_ID ? 'PE' : 'CO' } : null,
        };
      }),
      update: vi.fn(async ({ where, data }: any) => {
        const idx = questionsStore.findIndex((x) => x.id === where.id);
        questionsStore[idx] = {
          ...questionsStore[idx]!,
          ...data,
          updatedAt: new Date(),
        };
        const updated = questionsStore[idx]!;
        return {
          ...updated,
          brand: { slug: 'marca-a', name: 'Marca A' },
          country: updated.countryId ? { code: updated.countryId === PE_ID ? 'PE' : 'CO' } : null,
        };
      }),
      findMany: vi.fn(async ({ where }: any) => {
        return questionsStore
          .filter((q) => {
            if (where?.brandId && q.brandId !== where.brandId) return false;
            if (where?.status && q.status !== where.status) return false;
            if (where?.OR) {
              const allowedCountryId = where.OR[1]?.countryId;
              if (q.countryId !== null && q.countryId !== allowedCountryId) return false;
            }
            return true;
          })
          .map((q) => ({
            ...q,
            brand: { slug: 'marca-a', name: 'Marca A' },
            country: q.countryId ? { code: q.countryId === PE_ID ? 'PE' : 'CO' } : null,
            termOverrides: [],
          }));
      }),
    },
    importJob: {
      create: vi.fn(async ({ data }: any) => {
        const job = {
          ...data,
          validRows: 0,
          errors: [],
          createdAt: new Date(),
          finishedAt: null,
        };
        importJobsStore.push(job);
        return job;
      }),
      update: vi.fn(async ({ where, data }: any) => {
        const idx = importJobsStore.findIndex((j) => j.id === where.id);
        importJobsStore[idx] = { ...importJobsStore[idx]!, ...data };
        const updated = importJobsStore[idx]!;
        return {
          ...updated,
          country: { code: updated.countryId === PE_ID ? 'PE' : 'CO' },
        };
      }),
      findUnique: vi.fn(async ({ where }: any) => {
        const found = importJobsStore.find((j) => j.id === where.id);
        if (!found) return null;
        return {
          ...found,
          country: { code: found.countryId === PE_ID ? 'PE' : 'CO' },
        };
      }),
    },
    adminAuditLog: {
      create: vi.fn(async ({ data }: any) => {
        auditLogsStore.push(data);
        return data;
      }),
    },
    onModuleDestroy: vi.fn(),
  };

  const redisMock = {
    ping: vi.fn(),
    onModuleInit: vi.fn(),
    onModuleDestroy: vi.fn(),
    client: { get: vi.fn(), set: vi.fn(), del: vi.fn() },
  };

  const peAdminPrincipal: Principal = {
    userId: '01900000-0000-7000-8000-000000000091',
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
      // Sin BullMQ real en pruebas unitarias (las de integración usan Redis real).
      .overrideProvider(DailySnapshotScheduler)
      .useValue({ sync: vi.fn(), syncAll: vi.fn() })
      .overrideProvider(RankingJobsWorker)
      .useValue({})
      .compile();

    app = mod.createNestApplication({ logger: false });
    configureApp(app, env);
    await app.init();

    tokens = app.get(TokenService);
    contentService = app.get(AdminContentService);
  });

  afterAll(async () => {
    await app.close();
  });

  beforeEach(() => {
    pharmaciesStore = [
      {
        id: '01900000-0000-7000-8000-000000000101',
        countryId: PE_ID,
        chainId: null,
        externalCode: 'PE-FAR-001',
        name: 'Farmacia Demo 1 Lima',
        city: 'Lima',
        active: true,
      },
      {
        id: '01900000-0000-7000-8000-000000000102',
        countryId: PE_ID,
        chainId: null,
        externalCode: 'PE-FAR-002',
        name: 'Farmacia Demo 2 Arequipa',
        city: 'Arequipa',
        active: true,
      },
    ];
    usersStore = [];
    assignmentsStore = [];
    ledgerStore = [];
    questionsStore = [];
    importJobsStore = [];
    auditLogsStore = [];
  });

  it('importa 5.000 usuarios por CSV en < 60 s y consulta el trabajo en GET /admin/imports/:id', async () => {
    const token = tokens.signAccess(peAdminPrincipal);
    const lines = ['countryCode,pharmacyCode,pharmacyName,city,phone,document,displayName,role'];
    for (let i = 1; i <= 5000; i++) {
      const phIdx = (i % 3) + 1;
      const phCode = `PE-FAR-00${phIdx}`;
      const phone = `+5191${String(i).padStart(7, '0')}`;
      const doc = `PEMASS${String(i).padStart(6, '0')}`;
      lines.push(
        `PE,${phCode},Farmacia Masiva ${phIdx},Lima,${phone},${doc},Dependiente Masivo ${i},CLERK`,
      );
    }
    const csv = lines.join('\n');

    const startMs = Date.now();
    const res = await httpTest(app)
      .post('/api/v1/admin/imports/users')
      .set('Authorization', `Bearer ${token}`)
      .send({ countryCode: 'PE', fileName: '5000-users.csv', csv });
    const elapsedMs = Date.now() - startMs;

    expect(res.status).toBe(201);
    expect(elapsedMs).toBeLessThan(60_000);
    expect(res.body.totalRows).toBe(5000);
    expect(res.body.validRows).toBe(5000);
    expect(res.body.errors).toEqual([]);
    expect(usersStore).toHaveLength(5000);
    expect(assignmentsStore).toHaveLength(5000);

    const jobRes = await httpTest(app)
      .get(`/api/v1/admin/imports/${res.body.id}`)
      .set('Authorization', `Bearer ${token}`);
    expect(jobRes.status).toBe(200);
    expect(jobRes.body.validRows).toBe(5000);
  });

  it('reporta errores por fila al importar tests/fixtures/users-invalid.csv e importa las filas válidas', async () => {
    const token = tokens.signAccess(peAdminPrincipal);
    const fixturePath = resolve(__dirname, '../../../tests/fixtures/users-invalid.csv');
    const csv = readFileSync(fixturePath, 'utf8');

    const res = await httpTest(app)
      .post('/api/v1/admin/imports/users')
      .set('Authorization', `Bearer ${token}`)
      .send({ countryCode: 'PE', fileName: 'users-invalid.csv', csv });

    expect(res.status).toBe(201);
    expect(res.body.totalRows).toBe(7);
    expect(res.body.validRows).toBe(1);
    expect(res.body.errors.length).toBeGreaterThanOrEqual(6);

    const errorRows = res.body.errors.map((e: { row: number }) => e.row);
    // Las filas 3..8 del archivo tienen errores (país CO, teléfono corto, doc corto, fórmula, duplicado, rol SUPER_ADMIN)
    expect(errorRows).toEqual(expect.arrayContaining([3, 4, 5, 6, 7, 8]));
  });

  it('traslada un dependiente entre farmacias conservando sus puntos e historial de asignaciones', async () => {
    const token = tokens.signAccess(peAdminPrincipal);
    const clerkId = '01900000-0000-7000-8000-000000000501';
    const ph1Id = pharmaciesStore[0]!.id;
    const ph2Id = pharmaciesStore[1]!.id;

    usersStore.push({
      id: clerkId,
      countryId: PE_ID,
      phoneE164: '+51900500501',
      documentHash: 'hash-501',
      displayName: 'Dependiente Con Puntos',
      role: 'CLERK',
      status: 'ACTIVE',
      createdAt: new Date(Date.now() - 86_400_000),
    });
    assignmentsStore.push({
      id: '01900000-0000-7000-8000-000000000601',
      userId: clerkId,
      pharmacyId: ph1Id,
      from: new Date(Date.now() - 86_400_000),
      to: null,
    });
    // El dependiente acumuló 120 puntos antes del traslado
    ledgerStore.push(
      {
        id: '01900000-0000-7000-8000-000000000701',
        userId: clerkId,
        countryId: PE_ID,
        brandId: BRAND_A_ID,
        delta: 70,
        onHold: false,
      },
      {
        id: '01900000-0000-7000-8000-000000000702',
        userId: clerkId,
        countryId: PE_ID,
        brandId: BRAND_A_ID,
        delta: 50,
        onHold: false,
      },
    );

    const res = await httpTest(app)
      .post(`/api/v1/admin/users/${clerkId}/transfer`)
      .set('Authorization', `Bearer ${token}`)
      .send({ pharmacyId: ph2Id });

    expect(res.status).toBe(200);
    expect(res.body.totalPoints).toBe(120);
    expect(res.body.currentPharmacy.id).toBe(ph2Id);
    expect(res.body.assignmentHistory).toHaveLength(2);

    const closedAssign = res.body.assignmentHistory.find(
      (a: { pharmacyId: string }) => a.pharmacyId === ph1Id,
    );
    const activeAssign = res.body.assignmentHistory.find(
      (a: { pharmacyId: string }) => a.pharmacyId === ph2Id,
    );
    expect(closedAssign.to).not.toBeNull();
    expect(activeAssign.to).toBeNull();
    expect(auditLogsStore.some((a) => a.action === 'USER_TRANSFER_PHARMACY')).toBe(true);
  });

  it('importa preguntas en DRAFT, audita el flujo DRAFT → IN_REVIEW → PUBLISHED y solo incluye PUBLISHED en partidas', async () => {
    const token = tokens.signAccess(peAdminPrincipal);
    const validCsv = readFileSync(
      resolve(__dirname, '../../../tests/fixtures/questions-valid.csv'),
      'utf8',
    );
    const invalidCsv = readFileSync(
      resolve(__dirname, '../../../tests/fixtures/questions-invalid.csv'),
      'utf8',
    );

    // 1. Verifica reporte de errores en questions-invalid.csv
    const badRes = await httpTest(app)
      .post('/api/v1/admin/imports/questions')
      .set('Authorization', `Bearer ${token}`)
      .send({ countryCode: 'PE', fileName: 'questions-invalid.csv', csv: invalidCsv });
    expect(badRes.status).toBe(201);
    expect(badRes.body.validRows).toBe(1);
    expect(badRes.body.errors.length).toBe(4);

    // Limpiar preguntas para probar el flujo con questions-valid.csv
    questionsStore = [];

    const okRes = await httpTest(app)
      .post('/api/v1/admin/imports/questions')
      .set('Authorization', `Bearer ${token}`)
      .send({ countryCode: 'PE', fileName: 'questions-valid.csv', csv: validCsv });
    expect(okRes.status).toBe(201);
    expect(okRes.body.validRows).toBe(3); // marca-a, marca-b y marca-i válidas en PE
    expect(okRes.body.errors).toEqual([]);

    // Todas nacen en DRAFT -> ninguna es elegible aún para una partida
    const q1 = questionsStore.find((q) => q.brandId === BRAND_A_ID)!;
    expect(q1.status).toBe('DRAFT');
    expect(await contentService.getPlayableQuestionsForBrand(PE_ID, BRAND_A_ID)).toHaveLength(0);

    // No se puede saltar directamente de DRAFT a PUBLISHED
    const skipRes = await httpTest(app)
      .patch(`/api/v1/admin/questions/${q1.id}/status`)
      .set('Authorization', `Bearer ${token}`)
      .send({ status: 'PUBLISHED' });
    expect(skipRes.status).toBe(409);
    expect(skipRes.body.code).toBe('INVALID_QUESTION_TRANSITION');

    // Transición 1: DRAFT -> IN_REVIEW
    const revRes = await httpTest(app)
      .patch(`/api/v1/admin/questions/${q1.id}/status`)
      .set('Authorization', `Bearer ${token}`)
      .send({ status: 'IN_REVIEW' });
    expect(revRes.status).toBe(200);
    expect(revRes.body.status).toBe('IN_REVIEW');

    // En IN_REVIEW tampoco entra a una partida
    expect(await contentService.getPlayableQuestionsForBrand(PE_ID, BRAND_A_ID)).toHaveLength(0);

    // Transición 2: IN_REVIEW -> PUBLISHED
    const pubRes = await httpTest(app)
      .patch(`/api/v1/admin/questions/${q1.id}/status`)
      .set('Authorization', `Bearer ${token}`)
      .send({ status: 'PUBLISHED' });
    expect(pubRes.status).toBe(200);
    expect(pubRes.body.status).toBe('PUBLISHED');

    // Ahora sí entra a la partida, y nunca incluye correctAnswer
    const playable = await contentService.getPlayableQuestionsForBrand(PE_ID, BRAND_A_ID);
    expect(playable).toHaveLength(1);
    expect(playable[0]?.id).toBe(q1.id);
    expect(JSON.stringify(playable)).not.toContain('correctAnswer');

    // Las dos transiciones quedaron registradas en AdminAuditLog
    const transitionsAudit = auditLogsStore.filter((a) => a.action === 'QUESTION_STATUS_UPDATE');
    expect(transitionsAudit).toHaveLength(2);
    expect(transitionsAudit[0]?.before).toEqual({ status: 'DRAFT' });
    expect(transitionsAudit[0]?.after).toEqual({ status: 'IN_REVIEW' });
    expect(transitionsAudit[1]?.before).toEqual({ status: 'IN_REVIEW' });
    expect(transitionsAudit[1]?.after).toEqual({ status: 'PUBLISHED' });
  });
});
