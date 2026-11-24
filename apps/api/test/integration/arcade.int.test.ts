import {
  DEFAULT_ARCADE_RULES,
  experimentGroupFor,
  type CountryConfigView,
  type ExperimentGroup,
  type GamesCatalogResponse,
  type StartedGameSessionResponse,
} from '@pharma/shared';
import { uuidv7 } from 'uuidv7';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
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
 * Piloto arcade (ADR-034) contra PostgreSQL y Redis reales: el grupo A/B por farmacia decide los
 * estilos, el servidor valida el estilo, el bono de velocidad usa la ventana del estilo y el
 * reporte del piloto separa grupos y estilos con alcance por país.
 */
let h: Harness;
let peId: string;
let admin: string;
let original: CountryConfigView;
const ab = { ...DEFAULT_ARCADE_RULES.abTest, salt: 'prueba-integracion' };

async function putArcade(enabled: boolean) {
  const cfg = original;
  await h
    .http()
    .put('/api/v1/admin/countries/PE/config')
    .set(bearer(admin))
    .send({
      terms: cfg.terms,
      rankingPeriodMonths: cfg.rankingPeriodMonths,
      pointsRules: { ...cfg.pointsRules, arcade: { ...DEFAULT_ARCADE_RULES, enabled, abTest: ab } },
    })
    .expect(200);
}

/** Farmacia nueva cuyo id cae en el grupo pedido. */
async function pharmacyIn(group: ExperimentGroup): Promise<string> {
  let id = uuidv7();
  while (experimentGroupFor(id, ab) !== group) id = uuidv7();
  await h.prisma.pharmacy.create({
    data: {
      id,
      countryId: peId,
      name: `Arcade ${group} ${id.slice(-6)}`,
      city: 'Lima',
      active: true,
    },
  });
  return id;
}

async function clerkAt(pharmacyId: string): Promise<string> {
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
  return body.accessToken;
}

const catalog = async (token: string) =>
  (await h.http().get('/api/v1/games').set(bearer(token)).expect(200)).body as GamesCatalogResponse;

function start(token: string, gameId: string, body?: object) {
  const req = h.http().post(`/api/v1/games/${gameId}/sessions`).set(bearer(token));
  return body ? req.send(body) : req;
}

/** Responde una pregunta correcta como si hubieran pasado 12 s desde el inicio (tiempo del servidor). */
async function answerOneAfter12s(token: string, s: StartedGameSessionResponse): Promise<number> {
  await h.prisma.gameSession.update({
    where: { id: s.session.id },
    data: { startedAt: new Date(Date.now() - 12_000) },
  });
  const q = s.questions[0]!;
  const { correctAnswer } = await h.prisma.question.findUniqueOrThrow({ where: { id: q.id } });
  await h
    .http()
    .post(`/api/v1/sessions/${s.session.id}/answers`)
    .set(bearer(token))
    .send({
      token: s.session.token,
      answers: [{ questionId: q.id, answer: correctAnswer, clientElapsedMs: 12_000 }],
    })
    .expect(200);
  const a = await h.prisma.sessionAnswer.findFirstOrThrow({ where: { sessionId: s.session.id } });
  return a.points;
}

let arcadeToken: string;
let controlToken: string;
let gameId: string;

beforeAll(async () => {
  h = await createHarness();
  peId = (await h.prisma.country.findUniqueOrThrow({ where: { code: 'PE' } })).id;
  await resetLimits(h);
  admin = (await login(h, { phone: SEED.peCountryAdmin, app: 'admin' })).body.accessToken;
  original = (
    await h.http().get('/api/v1/admin/countries/PE/config').set(bearer(admin)).expect(200)
  ).body as CountryConfigView;
  await putArcade(true);
  arcadeToken = await clerkAt(await pharmacyIn('ARCADE'));
  controlToken = await clerkAt(await pharmacyIn('CONTROL'));
});

afterAll(async () => {
  await resetLimits(h);
  admin = (await login(h, { phone: SEED.peCountryAdmin, app: 'admin' })).body.accessToken;
  await putArcade(false);
  await h.close();
});

beforeEach(async () => {
  await resetLimits(h);
});

describe('Piloto arcade A/B por farmacia', () => {
  it('el catálogo informa el grupo y los estilos permitidos', async () => {
    const arc = await catalog(arcadeToken);
    const ctl = await catalog(controlToken);
    expect(arc.experience).toEqual({
      group: 'ARCADE',
      styles: ['PLATFORM', 'LAUNCH'],
      defaultStyle: 'PLATFORM',
    });
    expect(ctl.experience).toEqual({
      group: 'CONTROL',
      styles: ['CLASSIC'],
      defaultStyle: 'CLASSIC',
    });
    gameId = arc.games.find((g) => g.mechanic === 'MULTIPLE_CHOICE')!.id;
  });

  it('el servidor rechaza un estilo fuera del grupo y elige el del grupo si no se envía', async () => {
    const denied = await start(controlToken, gameId, { style: 'PLATFORM' }).expect(403);
    expect(denied.body.code).toBe('STYLE_NOT_ALLOWED');
    await start(arcadeToken, gameId, { style: 'CLASSIC' }).expect(403);
    await start(arcadeToken, gameId, { style: 'OTRO' }).expect(400);

    const legacy = (await start(arcadeToken, gameId).expect(201))
      .body as StartedGameSessionResponse;
    expect(legacy.game.style).toBe('PLATFORM');
    const row = await h.prisma.gameSession.findUniqueOrThrow({ where: { id: legacy.session.id } });
    expect(row).toMatchObject({ style: 'PLATFORM', experimentGroup: 'ARCADE' });
  });

  it('arcade: temporizador y ventana del bono de 30 s; la respuesta correcta nunca viaja', async () => {
    const res = await start(arcadeToken, gameId, { style: 'LAUNCH' }).expect(201);
    expect(JSON.stringify(res.body)).not.toMatch(/correctAnswer/);
    const s = res.body as StartedGameSessionResponse;
    expect(s.game.style).toBe('LAUNCH');
    expect(s.limits.secondsPerQuestion).toBe(30);
    // 12 s de 30: 10 + round(5 × 0,6) = 13
    expect(await answerOneAfter12s(arcadeToken, s)).toBe(13);
  });

  it('control: 20 s por pregunta; 12 s de 20 dan 10 + round(5 × 0,4) = 12', async () => {
    const s = (await start(controlToken, gameId).expect(201)).body as StartedGameSessionResponse;
    expect(s.game.style).toBe('CLASSIC');
    expect(s.limits.secondsPerQuestion).toBe(20);
    expect(await answerOneAfter12s(controlToken, s)).toBe(12);
    const row = await h.prisma.gameSession.findUniqueOrThrow({ where: { id: s.session.id } });
    expect(row).toMatchObject({ style: 'CLASSIC', experimentGroup: 'CONTROL' });
  });
});

describe('Reporte del piloto', () => {
  it('separa grupos y estilos, y el evento de uso registra estilo y grupo', async () => {
    const s = (await start(arcadeToken, gameId, { style: 'LAUNCH' }).expect(201))
      .body as StartedGameSessionResponse;
    await h
      .http()
      .post(`/api/v1/sessions/${s.session.id}/finish`)
      .set(bearer(arcadeToken))
      .send({ token: s.session.token })
      .expect(200);
    const ev = await h.prisma.usageEvent.findFirstOrThrow({
      where: {
        type: 'game.session_finished',
        payload: { path: ['sessionId'], equals: s.session.id },
      },
    });
    expect(ev.payload).toMatchObject({ style: 'LAUNCH', experimentGroup: 'ARCADE' });

    const r = await h
      .http()
      .get('/api/v1/admin/reports/arcade-pilot')
      .set(bearer(admin))
      .expect(200);
    expect(r.body.countryCode).toBe('PE');
    expect(r.body.abTest).toEqual({ enabled: true, arcadeSharePct: 50 });
    expect(r.body.groups.ARCADE.pharmacies).toBeGreaterThanOrEqual(1);
    expect(r.body.groups.CONTROL.clerksAssigned).toBeGreaterThanOrEqual(1);
    // Participación: solo asignados hoy al grupo que jugaron; nunca más del 100 %.
    expect(r.body.groups.ARCADE.participationPct).toBeGreaterThan(0);
    expect(r.body.groups.ARCADE.participationPct).toBeLessThanOrEqual(100);
    const launch = r.body.rows.find(
      (x: { group: string; style: string }) => x.group === 'ARCADE' && x.style === 'LAUNCH',
    );
    expect(launch.sessionsFinished).toBeGreaterThanOrEqual(1);
    expect(launch.activeClerks).toBeGreaterThanOrEqual(1);
  });

  it('CSV auditado y con alcance por país', async () => {
    const before = await h.prisma.adminAuditLog.count({
      where: { action: 'arcade_pilot.export_csv' },
    });
    const csv = await h
      .http()
      .get('/api/v1/admin/reports/arcade-pilot.csv')
      .set(bearer(admin))
      .expect(200);
    expect(csv.headers['content-type']).toMatch(/text\/csv/);
    const lines = csv.text.trim().split('\n');
    expect(lines[0]).toMatch(
      /^countryCode,from,to,group,style,pharmacies,clerksAssigned,activeClerks,participationPct/,
    );
    expect(lines.some((l) => l.includes(',ARCADE,ALL,'))).toBe(true);
    expect(
      await h.prisma.adminAuditLog.count({ where: { action: 'arcade_pilot.export_csv' } }),
    ).toBe(before + 1);

    await h
      .http()
      .get('/api/v1/admin/reports/arcade-pilot?countryCode=CO')
      .set(bearer(admin))
      .expect(403);
    await h.http().get('/api/v1/admin/reports/arcade-pilot').set(bearer(arcadeToken)).expect(403);
    const sa = (await login(h, { phone: SEED.peSuperAdmin, app: 'admin' })).body.accessToken;
    await h.http().get('/api/v1/admin/reports/arcade-pilot').set(bearer(sa)).expect(400);
    await h
      .http()
      .get('/api/v1/admin/reports/arcade-pilot?countryCode=PE')
      .set(bearer(sa))
      .expect(200);
  });
});
