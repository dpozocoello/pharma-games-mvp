import type {
  GamesCatalogResponse,
  RankingsResponse,
  StartedGameSessionResponse,
} from '@pharma/shared';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { LiveRankingStore } from '../../src/rankings/live-ranking.store';
import { RankingsService } from '../../src/rankings/rankings.service';
import {
  bearer,
  createHarness,
  createUser,
  login,
  resetLimits,
  SEED,
  type Harness,
} from './harness';

/**
 * Ranking en vivo contra PostgreSQL y Redis reales (CLAUDE.md §11, ADR-023).
 * Intervalo mínimo 0: cualquier cambio dispara una reconstrucción en la lectura siguiente.
 */
process.env.RANKING_LIVE_MIN_REBUILD_MS = '0';

let h: Harness;
let rankings: RankingsService;
let peId: string;

beforeAll(async () => {
  h = await createHarness();
  rankings = h.app.get(RankingsService);
  peId = (await h.prisma.country.findUniqueOrThrow({ where: { code: 'PE' } })).id;
});
afterAll(async () => {
  await h.close();
});
beforeEach(async () => {
  await resetLimits(h);
  vi.restoreAllMocks();
});

/** Dependiente de PE asignado a una farmacia, con consentimiento aceptado. */
async function newClerk(): Promise<{ userId: string; token: string; pharmacyId: string }> {
  const u = await createUser(h, { country: 'PE' });
  const pharmacy = await h.prisma.pharmacy.findFirstOrThrow({
    where: { countryId: peId, active: true },
    orderBy: { name: 'asc' },
  });
  await h.prisma.pharmacyAssignment.create({
    data: {
      id: crypto.randomUUID(),
      userId: u.id,
      pharmacyId: pharmacy.id,
      from: new Date(),
    },
  });
  const { body } = await login(h, { phone: u.phone, app: 'pwa', countryCode: 'PE' });
  await h
    .http()
    .post('/api/v1/me/consent')
    .set(bearer(body.accessToken))
    .send({ consentVersionId: body.me.consent.current!.id })
    .expect(200);
  return { userId: u.id, token: body.accessToken, pharmacyId: pharmacy.id };
}

async function playAndFinish(token: string): Promise<number> {
  const cat = (await h.http().get('/api/v1/games').set(bearer(token))).body as GamesCatalogResponse;
  const start = await h
    .http()
    .post(`/api/v1/games/${cat.games[0]!.id}/sessions`)
    .set(bearer(token));
  const s = start.body as StartedGameSessionResponse;
  const qs = await h.prisma.question.findMany({
    where: { id: { in: s.questions.map((q) => q.id) } },
    select: { id: true, correctAnswer: true },
  });
  await h
    .http()
    .post(`/api/v1/sessions/${s.session.id}/answers`)
    .set(bearer(token))
    .send({
      token: s.session.token,
      answers: qs.map((q) => ({
        questionId: q.id,
        answer: q.correctAnswer,
        clientElapsedMs: 3000,
      })),
    })
    .expect(200);
  const fin = await h
    .http()
    .post(`/api/v1/sessions/${s.session.id}/finish`)
    .set(bearer(token))
    .send({ token: s.session.token })
    .expect(200);
  return fin.body.score as number;
}

async function getRankings(token: string, query: string): Promise<RankingsResponse> {
  const res = await h.http().get(`/api/v1/rankings?${query}`).set(bearer(token));
  expect(res.status).toBe(200);
  return res.body as RankingsResponse;
}

/** La reconstrucción corre en segundo plano: se lee hasta ver el cambio. */
async function eventually<T>(read: () => Promise<T>, ok: (v: T) => boolean): Promise<T> {
  const deadline = Date.now() + 10_000;
  let last = await read();
  while (!ok(last) && Date.now() < deadline) {
    await new Promise((r) => setTimeout(r, 100));
    last = await read();
  }
  return last;
}

describe('Ranking en vivo', () => {
  it('los puntos en revisión no cuentan; al descartar la anomalía entran al ranking y al perfil', async () => {
    const { userId, token } = await newClerk();
    const score = await playAndFinish(token);
    expect(score).toBeGreaterThan(0);

    // La partida de la prueba dura milisegundos: queda con alerta SHORT_SESSION y en revisión.
    const held = await eventually(
      () => getRankings(token, 'scope=individual'),
      (v) => v.me?.entityId === userId,
    );
    expect(held.me).toMatchObject({ entityId: userId, points: 0 });

    const admin = (await login(h, { phone: SEED.peCountryAdmin, app: 'admin' })).body.accessToken;
    const alerts = await h.prisma.anomalyAlert.findMany({
      where: { session: { userId }, status: 'OPEN' },
    });
    expect(alerts.length).toBeGreaterThan(0);
    for (const a of alerts) {
      await h
        .http()
        .patch(`/api/v1/admin/anomalies/${a.id}`)
        .set(bearer(admin))
        .send({ status: 'DISMISSED' })
        .expect(200);
    }

    const r = await eventually(
      () => getRankings(token, 'scope=individual'),
      (v) => v.me?.points === score,
    );
    expect(r.me).toMatchObject({ entityId: userId, points: score });

    const profile = await h.http().get('/api/v1/me/ranking').set(bearer(token)).expect(200);
    expect(profile.body.totalPoints).toBe(score);
    expect(profile.body.individualPosition).toBe(r.me!.position);
  });

  it('las lecturas sin cambios no recalculan el país desde PostgreSQL', async () => {
    const { token } = await newClerk();
    await getRankings(token, 'scope=individual'); // calienta la generación vigente
    await eventually(
      () => h.app.get(LiveRankingStore).isDirty(peId),
      (dirty) => !dirty,
    );
    const spy = vi.spyOn(rankings, 'computePeriodStandings');

    for (let i = 0; i < 30; i++) {
      await getRankings(token, `scope=${['individual', 'pharmacy', 'country'][i % 3]}`);
    }
    await h.http().get('/api/v1/me/ranking').set(bearer(token)).expect(200);

    expect(spy).not.toHaveBeenCalled();
  });

  it('con muchas lecturas simultáneas tras un cambio, una sola reconstruye', async () => {
    const { token } = await newClerk();
    await getRankings(token, 'scope=individual');
    await h.app.get(LiveRankingStore).markDirty(peId);
    const spy = vi.spyOn(rankings, 'computePeriodStandings');

    const results = await Promise.all(
      Array.from({ length: 25 }, () => h.http().get('/api/v1/rankings').set(bearer(token))),
    );
    for (const r of results) expect(r.status).toBe(200);
    await eventually(
      async () => spy.mock.results.length,
      (n) => n >= 1,
    );
    await Promise.all(spy.mock.results.map((r) => r.value));

    expect(spy).toHaveBeenCalledTimes(1);
  });

  it('limit acota las filas y "me" llega aunque no esté en el top', async () => {
    const { token, pharmacyId } = await newClerk();
    await playAndFinish(token);
    const r = await eventually(
      () => getRankings(token, 'scope=pharmacy&limit=1'),
      (v) => v.me?.entityId === pharmacyId,
    );
    expect(r.rows).toHaveLength(1);
    expect(r.totalRows).toBeGreaterThanOrEqual(1);
    expect(r.me?.entityId).toBe(pharmacyId);

    await h.http().get('/api/v1/rankings?limit=0').set(bearer(token)).expect(400);
    await h.http().get('/api/v1/rankings?limit=201').set(bearer(token)).expect(400);
  });

  it('la vista en vivo coincide con el cálculo directo (farmacia = promedio por activo)', async () => {
    const { token } = await newClerk();
    await playAndFinish(token);
    const period = await h.prisma.rankingPeriod.findFirstOrThrow({
      where: { countryId: peId, status: 'OPEN' },
      orderBy: { startsAt: 'desc' },
    });

    const direct = await rankings.computePeriodStandings(peId, period.id);
    const live = await eventually(
      () => getRankings(token, 'scope=pharmacy&limit=200'),
      (v) => JSON.stringify(v.rows) === JSON.stringify(direct.pharmacyRows.slice(0, 200)),
    );
    expect(live.rows).toEqual(direct.pharmacyRows.slice(0, 200));
    expect(live.totalRows).toBe(direct.pharmacyRows.length);

    const ind = await getRankings(token, 'scope=individual&limit=200');
    expect(ind.rows).toEqual(direct.individualRows.slice(0, 200));
  });
});
