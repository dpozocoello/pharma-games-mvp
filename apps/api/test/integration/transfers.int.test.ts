import type { GamesCatalogResponse, StartedGameSessionResponse } from '@pharma/shared';
import { uuidv7 } from 'uuidv7';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
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
 * Traslados (ADR-025) y perfil, contra PostgreSQL y Redis reales: los puntos se quedan en la
 * farmacia donde se ganaron, y el perfil cuenta todas las partidas del periodo.
 */
let h: Harness;
let peId: string;
let admin: string;

beforeAll(async () => {
  h = await createHarness();
  peId = (await h.prisma.country.findUniqueOrThrow({ where: { code: 'PE' } })).id;
});
afterAll(async () => {
  await h.close();
});
beforeEach(async () => {
  await resetLimits(h);
  admin = (await login(h, { phone: SEED.peCountryAdmin, app: 'admin' })).body.accessToken;
});

async function newPharmacy(name: string): Promise<string> {
  const id = uuidv7();
  await h.prisma.pharmacy.create({
    data: { id, countryId: peId, name: `${name} ${id.slice(-6)}`, city: 'Lima', active: true },
  });
  return id;
}

async function newClerkAt(pharmacyId: string) {
  const u = await createUser(h, { country: 'PE' });
  await h.prisma.pharmacyAssignment.create({
    data: { id: uuidv7(), userId: u.id, pharmacyId, from: new Date(Date.now() - 60_000) },
  });
  const { body } = await login(h, { phone: u.phone, app: 'pwa', countryCode: 'PE' });
  await h
    .http()
    .post('/api/v1/me/consent')
    .set(bearer(body.accessToken))
    .send({ consentVersionId: body.me.consent.current!.id })
    .expect(200);
  return { userId: u.id, token: body.accessToken };
}

/** Juega una partida perfecta y descarta sus alertas (la prueba juega en milisegundos). */
async function earnPoints(userId: string, token: string): Promise<number> {
  const cat = (await h.http().get('/api/v1/games').set(bearer(token))).body as GamesCatalogResponse;
  const s = (await h.http().post(`/api/v1/games/${cat.games[0]!.id}/sessions`).set(bearer(token)))
    .body as StartedGameSessionResponse;
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
  for (const a of await h.prisma.anomalyAlert.findMany({
    where: { sessionId: s.session.id, status: 'OPEN' },
  })) {
    await h
      .http()
      .patch(`/api/v1/admin/anomalies/${a.id}`)
      .set(bearer(admin))
      .send({ status: 'DISMISSED' })
      .expect(200);
  }
  return fin.body.score as number;
}

async function standings() {
  const period = await h.prisma.rankingPeriod.findFirstOrThrow({
    where: { countryId: peId, status: 'OPEN' },
    orderBy: { startsAt: 'desc' },
  });
  return h.app.get(RankingsService).computePeriodStandings(peId, period.id);
}

describe('Traslados entre farmacias', () => {
  it('los puntos ganados se quedan en la farmacia de origen; la nueva no gana puntos ni activos', async () => {
    const origin = await newPharmacy('Origen');
    const target = await newPharmacy('Destino');
    const { userId, token } = await newClerkAt(origin);
    const score = await earnPoints(userId, token);
    expect(score).toBeGreaterThan(0);

    const before = await standings();
    expect(before.pharmacyRows.find((r) => r.entityId === origin)).toMatchObject({
      points: score,
      activeClerks: 1,
    });

    const moved = await h
      .http()
      .post(`/api/v1/admin/users/${userId}/transfer`)
      .set(bearer(admin))
      .send({ pharmacyId: target })
      .expect(200);
    // El panel muestra los puntos de la anomalía descartada (antes los ocultaba por onHold).
    expect(moved.body.totalPoints).toBe(score);

    const after = await standings();
    expect(after.pharmacyRows.find((r) => r.entityId === origin)).toMatchObject({
      points: score,
      activeClerks: 1,
    });
    // Sin partidas en el destino, la farmacia nueva no aparece (0 activos).
    expect(after.pharmacyRows.find((r) => r.entityId === target)).toBeUndefined();
    // El dependiente conserva sus puntos individuales y ya figura en su farmacia nueva.
    expect(after.individualRows.find((r) => r.entityId === userId)).toMatchObject({
      points: score,
    });
  });

  it('lo que juega después del traslado cuenta para la farmacia nueva', async () => {
    const origin = await newPharmacy('Origen');
    const target = await newPharmacy('Destino');
    const { userId, token } = await newClerkAt(origin);
    const first = await earnPoints(userId, token);
    await h
      .http()
      .post(`/api/v1/admin/users/${userId}/transfer`)
      .set(bearer(admin))
      .send({ pharmacyId: target })
      .expect(200);
    const second = await earnPoints(userId, token);

    const s = await standings();
    expect(s.pharmacyRows.find((r) => r.entityId === origin)).toMatchObject({ points: first });
    expect(s.pharmacyRows.find((r) => r.entityId === target)).toMatchObject({
      points: second,
      activeClerks: 1,
    });
    expect(s.individualRows.find((r) => r.entityId === userId)!.points).toBe(first + second);
  });
});

describe('Perfil del dependiente', () => {
  it('cuenta todas las partidas del periodo, no solo las últimas 20', async () => {
    const ph = await newPharmacy('Perfil');
    const { userId, token } = await newClerkAt(ph);
    const game = await h.prisma.game.findFirstOrThrow({
      where: { countryId: peId, status: 'ACTIVE' },
    });
    const now = Date.now();
    await h.prisma.gameSession.createMany({
      data: Array.from({ length: 25 }, (_, i) => ({
        id: uuidv7(),
        userId,
        gameId: game.id,
        countryId: peId,
        brandId: game.brandId,
        questionIds: [],
        seed: 'perfil',
        startedAt: new Date(now - (i + 1) * 60_000),
        expiresAt: new Date(now),
        finishedAt: new Date(now - i * 60_000),
        score: 0,
        status: 'FINISHED' as const,
      })),
    });

    const res = await h.http().get('/api/v1/me/ranking').set(bearer(token)).expect(200);
    expect(res.body.sessionsPlayedInPeriod).toBe(25);
    expect(res.body.recentSessions).toHaveLength(20);
    expect(
      res.body.pendingBrands.some((b: { brandId: string }) => b.brandId === game.brandId),
    ).toBe(false);
  });
});
