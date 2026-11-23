import type { GamesCatalogResponse, StartedGameSessionResponse } from '@pharma/shared';
import { uuidv7 } from 'uuidv7';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { TokenService } from '../../src/auth/token.service';
import { bearer, createHarness, createUser, type Harness } from './harness';

/**
 * Disponibilidad (CLAUDE.md §11): con Redis caído, la API arranca, `/ready` lo reporta y lo que
 * no depende de Redis sigue funcionando desde PostgreSQL (la caché nunca es la fuente de verdad).
 * Solo el ingreso por OTP, que vive en Redis, responde 503.
 */
let h: Harness;
let token: string;

beforeAll(async () => {
  // Un puerto donde no hay Redis.
  const started = Date.now();
  h = await createHarness({ redisUrl: 'redis://127.0.0.1:6399' });
  expect(Date.now() - started).toBeLessThan(15_000);

  // Sin OTP no se puede iniciar sesión: el token se firma directo, como lo haría el login.
  const u = await createUser(h, { country: 'PE' });
  const pe = await h.prisma.country.findUniqueOrThrow({
    where: { code: 'PE' },
    include: { config: true },
  });
  await h.prisma.userConsent.create({
    data: {
      id: uuidv7(),
      userId: u.id,
      consentVersionId: pe.config!.consentVersionId!,
      ipTruncated: '0.0.0.0',
    },
  });
  token = h.app.get(TokenService).signAccess({
    userId: u.id,
    role: 'CLERK',
    countryId: pe.id,
    countryCode: 'PE',
    app: 'pwa',
  });
}, 60_000);
afterAll(async () => {
  await h?.close();
});

describe('Con Redis caído', () => {
  it('/health responde y /ready reporta 503', async () => {
    await h.http().get('/health').expect(200);
    await h.http().get('/ready').expect(503);
  });

  it('el catálogo público de países sale de PostgreSQL', async () => {
    const res = await h.http().get('/api/v1/countries').expect(200);
    expect(res.body.map((c: { code: string }) => c.code)).toContain('PE');
  });

  it('se puede jugar una partida completa', async () => {
    const cat = (await h.http().get('/api/v1/games').set(bearer(token)).expect(200))
      .body as GamesCatalogResponse;
    const s = (
      await h
        .http()
        .post(`/api/v1/games/${cat.games[0]!.id}/sessions`)
        .set(bearer(token))
        .expect(201)
    ).body as StartedGameSessionResponse;
    await h
      .http()
      .post(`/api/v1/sessions/${s.session.id}/answers`)
      .set(bearer(token))
      .send({
        token: s.session.token,
        answers: [{ questionId: s.questions[0]!.id, answer: 'x', clientElapsedMs: 3000 }],
      })
      .expect(200);
    await h
      .http()
      .post(`/api/v1/sessions/${s.session.id}/finish`)
      .set(bearer(token))
      .send({ token: s.session.token })
      .expect(200);
  });

  it('rankings y perfil se calculan desde PostgreSQL', async () => {
    await h.http().get('/api/v1/rankings?scope=pharmacy').set(bearer(token)).expect(200);
    await h.http().get('/api/v1/me/ranking').set(bearer(token)).expect(200);
  });

  it('pedir un código OTP responde 503 con un error claro, no 500', async () => {
    const res = await h
      .http()
      .post('/api/v1/auth/otp/request')
      .send({ app: 'pwa', countryCode: 'PE', identifier: { type: 'phone', value: '987654321' } });
    expect(res.status).toBe(503);
    expect(res.body.code).toBe('SERVICE_UNAVAILABLE');
  });
});
