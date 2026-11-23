import type { GamesCatalogResponse, StartedGameSessionResponse } from '@pharma/shared';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { bearer, createHarness, createUser, login, resetLimits, type Harness } from './harness';

/**
 * Juego justo contra PostgreSQL real (CLAUDE.md §9): las carreras no se ven con Prisma simulado.
 * Reproduce reintentos de `finish` (red irregular, SDK que reenvía) y partidas que terminan a la vez.
 */
let h: Harness;

beforeAll(async () => {
  h = await createHarness();
});
afterAll(async () => {
  await h.close();
});
beforeEach(async () => {
  await resetLimits(h);
});

/** Dependiente de PE nuevo, con sesión abierta y consentimiento aceptado. */
async function newClerk(): Promise<{ userId: string; token: string }> {
  const u = await createUser(h, { country: 'PE' });
  const { body } = await login(h, { phone: u.phone, app: 'pwa', countryCode: 'PE' });
  const consent = await h
    .http()
    .post('/api/v1/me/consent')
    .set(bearer(body.accessToken))
    .send({ consentVersionId: body.me.consent.current!.id });
  expect(consent.status).toBe(200);
  return { userId: u.id, token: body.accessToken };
}

async function catalog(token: string): Promise<GamesCatalogResponse> {
  const res = await h.http().get('/api/v1/games').set(bearer(token));
  expect(res.status).toBe(200);
  return res.body as GamesCatalogResponse;
}

/** Inicia una partida y responde todo correctamente (la respuesta se lee de la base, no de la red). */
async function playPerfect(token: string, gameId: string): Promise<StartedGameSessionResponse> {
  const start = await h.http().post(`/api/v1/games/${gameId}/sessions`).set(bearer(token));
  expect(start.status).toBe(201);
  const started = start.body as StartedGameSessionResponse;
  const questions = await h.prisma.question.findMany({
    where: { id: { in: started.questions.map((q) => q.id) } },
    select: { id: true, correctAnswer: true },
  });
  const answers = questions.map((q) => ({
    questionId: q.id,
    answer: q.correctAnswer,
    clientElapsedMs: 3000,
  }));
  const res = await h
    .http()
    .post(`/api/v1/sessions/${started.session.id}/answers`)
    .set(bearer(token))
    .send({ token: started.session.token, answers });
  expect(res.status).toBe(200);
  return started;
}

function finish(token: string, s: StartedGameSessionResponse) {
  return h
    .http()
    .post(`/api/v1/sessions/${s.session.id}/finish`)
    .set(bearer(token))
    .send({ token: s.session.token });
}

describe('Fin de partida concurrente', () => {
  it('varios finish simultáneos de la misma partida acreditan puntos una sola vez', async () => {
    const { userId, token } = await newClerk();
    const game = (await catalog(token)).games[0]!;
    const started = await playPerfect(token, game.id);

    const results = await Promise.all(Array.from({ length: 6 }, () => finish(token, started)));

    for (const r of results) expect(r.status).toBe(200);
    // Todas las respuestas son idénticas (idempotencia, §9).
    const first = JSON.stringify(results[0]!.body);
    for (const r of results) expect(JSON.stringify(r.body)).toBe(first);

    const ledger = await h.prisma.pointsLedger.findMany({
      where: { userId, sessionId: started.session.id },
    });
    expect(ledger).toHaveLength(1);
    expect(ledger[0]!.delta).toBe(results[0]!.body.score);
    expect(results[0]!.body.score).toBeGreaterThan(0);
  });

  it('dos partidas de la misma marca que terminan a la vez respetan el tope diario por marca', async () => {
    const { userId, token } = await newClerk();
    const cat = await catalog(token);
    // Las dos mecánicas de una misma marca: cada partida perfecta supera la mitad del tope.
    const byBrand = new Map<string, string[]>();
    for (const g of cat.games) byBrand.set(g.brandId, [...(byBrand.get(g.brandId) ?? []), g.id]);
    const [brandId, gameIds] = [...byBrand.entries()].find(([, ids]) => ids.length >= 2)!;

    const country = await h.prisma.country.findUniqueOrThrow({
      where: { code: 'PE' },
      include: { config: true },
    });
    const cap = (country.config!.pointsRules as { dailyCapPerBrand: number }).dailyCapPerBrand;

    const a = await playPerfect(token, gameIds[0]!);
    const b = await playPerfect(token, gameIds[1]!);
    const [ra, rb] = await Promise.all([finish(token, a), finish(token, b)]);
    expect(ra.status).toBe(200);
    expect(rb.status).toBe(200);
    expect(ra.body.score + rb.body.score).toBeGreaterThan(cap / 2);

    const ledger = await h.prisma.pointsLedger.findMany({ where: { userId, brandId } });
    const credited = ledger.reduce((acc, e) => acc + e.delta, 0);
    expect(credited).toBeLessThanOrEqual(cap);
    expect(credited).toBe(ra.body.score + rb.body.score);
  });

  it('la base de datos rechaza un segundo movimiento GAME para la misma partida', async () => {
    const { userId, token } = await newClerk();
    const game = (await catalog(token)).games[0]!;
    const started = await playPerfect(token, game.id);
    expect((await finish(token, started)).status).toBe(200);

    const original = await h.prisma.pointsLedger.findFirstOrThrow({
      where: { userId, sessionId: started.session.id, reason: 'GAME' },
    });
    await expect(
      h.prisma.pointsLedger.create({
        data: {
          ...original,
          id: '01900000-0000-7000-8000-00000000abcd',
          createdAt: undefined,
          updatedAt: undefined,
        },
      }),
    ).rejects.toThrow();
  });

  it('un script que responde en ráfaga declarando 5 s por pregunta queda en revisión y sin bono', async () => {
    const { userId, token } = await newClerk();
    const game = (await catalog(token)).games[0]!;
    const start = await h.http().post(`/api/v1/games/${game.id}/sessions`).set(bearer(token));
    const s = start.body as StartedGameSessionResponse;
    const qs = await h.prisma.question.findMany({
      where: { id: { in: s.questions.map((q) => q.id) } },
      select: { id: true, correctAnswer: true },
    });

    // Una respuesta por solicitud, lo más rápido posible, mintiendo sobre el tiempo.
    for (const q of qs) {
      await h
        .http()
        .post(`/api/v1/sessions/${s.session.id}/answers`)
        .set(bearer(token))
        .send({
          token: s.session.token,
          answers: [{ questionId: q.id, answer: q.correctAnswer, clientElapsedMs: 5000 }],
        })
        .expect(200);
    }
    const fin = await finish(token, s);
    expect(fin.status).toBe(200);

    // Todas correctas pero sin bono de velocidad: solo el punto base por respuesta.
    const rules = (
      await h.prisma.countryConfig.findFirstOrThrow({ where: { country: { code: 'PE' } } })
    ).pointsRules as { pointsPerCorrect: number };
    expect(fin.body.correct).toBe(qs.length);
    expect(fin.body.score).toBe(qs.length * rules.pointsPerCorrect);

    const alerts = await h.prisma.anomalyAlert.findMany({ where: { sessionId: s.session.id } });
    const fast = alerts.find((a) => a.rule === 'FAST_ANSWER');
    expect(fast?.details).toMatchObject({ detectedByServerOnly: qs.length });
    const ledger = await h.prisma.pointsLedger.findFirstOrThrow({
      where: { userId, sessionId: s.session.id },
    });
    expect(ledger.onHold).toBe(true); // no cuenta para ganadores hasta que un admin resuelva
  });
});
