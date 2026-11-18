import { DEFAULT_POINTS_RULES, type CountryConfigView } from '@pharma/shared';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { CountryConfigService } from '../../src/countries/country-config.service';
import {
  bearer,
  createHarness,
  createUser,
  login,
  resetLimits,
  SEED,
  type Harness,
} from './harness';

let h: Harness;
let peAdmin: string;
let superAdmin: string;
let peEditor: string;
let clerk: string;

beforeAll(async () => {
  h = await createHarness();
  await resetLimits(h);
  peAdmin = (await login(h, { phone: SEED.peCountryAdmin, app: 'admin' })).body.accessToken;
  superAdmin = (await login(h, { phone: SEED.peSuperAdmin, app: 'admin' })).body.accessToken;
  peEditor = (await login(h, { phone: SEED.peEditor, app: 'admin' })).body.accessToken;
  const u = await createUser(h, { country: 'PE' });
  clerk = (await login(h, { phone: u.phone, app: 'pwa', countryCode: 'PE' })).body.accessToken;
});
afterAll(async () => {
  await h.close();
});

/** Código Z* libre (global-setup borra los países Z* de ejecuciones anteriores). */
async function freeCode(): Promise<string> {
  const used = new Set(
    (await h.prisma.country.findMany({ where: { code: { startsWith: 'Z' } } })).map((c) => c.code),
  );
  for (let i = 0; i < 26; i++) {
    const code = `Z${String.fromCharCode(65 + i)}`;
    if (!used.has(code)) return code;
  }
  throw new Error('Sin códigos Z* libres');
}
beforeEach(async () => {
  await resetLimits(h);
});

describe('Alcance por país (CLAUDE.md §12, Iteración 1)', () => {
  it('un COUNTRY_ADMIN de PE solo ve su país en la lista', async () => {
    const r = await h.http().get('/api/v1/admin/countries').set(bearer(peAdmin));
    expect(r.status).toBe(200);
    expect(r.body.map((c: { code: string }) => c.code)).toEqual(['PE']);
  });

  it.each(['CO', 'EC'])('un COUNTRY_ADMIN de PE no puede leer ni modificar %s', async (code) => {
    const auth = bearer(peAdmin);
    const get = await h.http().get(`/api/v1/admin/countries/${code}/config`).set(auth);
    expect(get.status).toBe(403);
    expect(JSON.stringify(get.body)).not.toContain('pointsRules');

    const put = await h
      .http()
      .put(`/api/v1/admin/countries/${code}/config`)
      .set(auth)
      .send({ terms: {}, pointsRules: DEFAULT_POINTS_RULES, rankingPeriodMonths: 2 });
    expect(put.status).toBe(403);

    const consent = await h
      .http()
      .post(`/api/v1/admin/countries/${code}/consent-versions`)
      .set(auth)
      .send({ text: 'x'.repeat(60) });
    expect(consent.status).toBe(403);

    const brand = await h
      .http()
      .put(`/api/v1/admin/countries/${code}/brands/01900000-0000-7000-8000-000000000000`)
      .set(auth)
      .send({ active: false });
    expect(brand.status).toBe(403);

    const patch = await h
      .http()
      .patch(`/api/v1/admin/countries/${code}`)
      .set(auth)
      .send({ active: false });
    expect(patch.status).toBe(403);
  });

  it('un COUNTRY_ADMIN de PE sí ve la configuración de PE', async () => {
    const r = await h.http().get('/api/v1/admin/countries/PE/config').set(bearer(peAdmin));
    expect(r.status).toBe(200);
    const view = r.body as CountryConfigView;
    expect(view.country.code).toBe('PE');
    expect(view.brands.length).toBe(4);
    expect(view.consent?.version).toBeGreaterThanOrEqual(1);
  });

  it('SUPER_ADMIN ve todos los países', async () => {
    const r = await h.http().get('/api/v1/admin/countries').set(bearer(superAdmin));
    const codes = r.body.map((c: { code: string }) => c.code);
    expect(codes).toEqual(expect.arrayContaining(['CO', 'EC', 'PE']));
    const co = await h.http().get('/api/v1/admin/countries/CO/config').set(bearer(superAdmin));
    expect(co.status).toBe(200);
  });

  it('CONTENT_EDITOR no administra la configuración del país', async () => {
    const list = await h.http().get('/api/v1/admin/countries').set(bearer(peEditor));
    expect(list.body.map((c: { code: string }) => c.code)).toEqual(['PE']);
    const cfg = await h.http().get('/api/v1/admin/countries/PE/config').set(bearer(peEditor));
    expect(cfg.status).toBe(403);
  });

  it('un token de la PWA no sirve en el panel de administración', async () => {
    const r = await h.http().get('/api/v1/admin/countries').set(bearer(clerk));
    expect(r.status).toBe(403);
  });
});

describe('Configuración por país sin desplegar', () => {
  it('cambia el periodo de ranking y una regla de puntos, audita y refresca la caché', async () => {
    const auth = bearer(peAdmin);
    const before = (await h.http().get('/api/v1/admin/countries/PE/config').set(auth))
      .body as CountryConfigView;
    // Calienta la caché para comprobar que se invalida.
    const cache = h.app.get(CountryConfigService);
    await cache.getByCode('PE');

    const next = {
      terms: { ...before.terms, 'term.points': 'puntitos' },
      pointsRules: {
        ...before.pointsRules,
        pointsPerCorrect: before.pointsRules.pointsPerCorrect + 5,
      },
      rankingPeriodMonths: before.rankingPeriodMonths === 2 ? 3 : 2,
    };
    try {
      const put = await h.http().put('/api/v1/admin/countries/PE/config').set(auth).send(next);
      expect(put.status).toBe(200);
      expect(put.body).toMatchObject({
        rankingPeriodMonths: next.rankingPeriodMonths,
        pointsRules: { pointsPerCorrect: next.pointsRules.pointsPerCorrect },
        terms: { 'term.points': 'puntitos' },
      });

      const cached = await cache.getByCode('PE');
      expect(cached?.pointsRules.pointsPerCorrect).toBe(next.pointsRules.pointsPerCorrect);
      expect(cached?.rankingPeriodMonths).toBe(next.rankingPeriodMonths);

      const audit = await h.prisma.adminAuditLog.findFirstOrThrow({
        where: { action: 'COUNTRY_CONFIG_UPDATE' },
        orderBy: { createdAt: 'desc' },
      });
      expect(audit.before).toMatchObject({ rankingPeriodMonths: before.rankingPeriodMonths });
      expect(audit.after).toMatchObject({ rankingPeriodMonths: next.rankingPeriodMonths });
    } finally {
      await h
        .http()
        .put('/api/v1/admin/countries/PE/config')
        .set(auth)
        .send({
          terms: before.terms,
          pointsRules: before.pointsRules,
          rankingPeriodMonths: before.rankingPeriodMonths,
        })
        .expect(200);
    }
  });

  it('rechaza reglas inválidas con errores por campo (RFC 7807)', async () => {
    const r = await h
      .http()
      .put('/api/v1/admin/countries/PE/config')
      .set(bearer(peAdmin))
      .send({
        terms: {},
        pointsRules: { ...DEFAULT_POINTS_RULES, dailyCapPerBrand: 9999 },
        rankingPeriodMonths: 4,
      });
    expect(r.status).toBe(400);
    expect(r.headers['content-type']).toContain('application/problem+json');
    const paths = r.body.errors.map((e: { path: string }) => e.path);
    expect(paths).toEqual(
      expect.arrayContaining(['rankingPeriodMonths', 'pointsRules.dailyCapPerBrand']),
    );
  });

  it('una marca se desactiva y reactiva desde el panel', async () => {
    const auth = bearer(peAdmin);
    const view = (await h.http().get('/api/v1/admin/countries/PE/config').set(auth))
      .body as CountryConfigView;
    const brand = view.brands[0]!;
    const off = await h
      .http()
      .put(`/api/v1/admin/countries/PE/brands/${brand.brandId}`)
      .set(auth)
      .send({ active: false });
    expect(
      off.body.brands.find((b: { brandId: string }) => b.brandId === brand.brandId).active,
    ).toBe(false);
    await h
      .http()
      .put(`/api/v1/admin/countries/PE/brands/${brand.brandId}`)
      .set(auth)
      .send({ active: true })
      .expect(200);
  });
});

describe('Agregar un país = configuración', () => {
  it('SUPER_ADMIN da de alta un país; solo se activa con consentimiento publicado', async () => {
    const auth = bearer(superAdmin);
    const code = await freeCode();
    const created = await h.http().post('/api/v1/admin/countries').set(auth).send({
      code,
      name: 'País de prueba',
      locale: 'es-BO',
      timezone: 'America/La_Paz',
      phonePrefix: '+591',
    });
    expect(created.status).toBe(201);
    expect(created.body.country).toMatchObject({ code, active: false });
    expect(created.body.currentPeriod).not.toBeNull();

    const early = await h
      .http()
      .patch(`/api/v1/admin/countries/${code}`)
      .set(auth)
      .send({ active: true });
    expect(early.status).toBe(409);
    expect(early.body.code).toBe('CONSENT_MISSING');

    await h
      .http()
      .post(`/api/v1/admin/countries/${code}/consent-versions`)
      .set(auth)
      .send({ text: 'Texto de consentimiento de prueba, ficticio, con finalidad declarada.' })
      .expect(201);
    await h
      .http()
      .patch(`/api/v1/admin/countries/${code}`)
      .set(auth)
      .send({ active: true })
      .expect(200);

    const pub = await h.http().get('/api/v1/countries');
    expect(pub.body.map((c: { code: string }) => c.code)).toContain(code);
  });

  it('COUNTRY_ADMIN no puede dar de alta países', async () => {
    const r = await h.http().post('/api/v1/admin/countries').set(bearer(peAdmin)).send({
      code: 'ZZ',
      name: 'No',
      locale: 'es-BO',
      timezone: 'America/La_Paz',
      phonePrefix: '+591',
    });
    expect(r.status).toBe(403);
  });

  it('publicar una versión nueva de consentimiento obliga a aceptarla otra vez', async () => {
    const auth = bearer(superAdmin);
    const code = await freeCode();
    await h.http().post('/api/v1/admin/countries').set(auth).send({
      code,
      name: 'País de prueba 2',
      locale: 'es-BO',
      timezone: 'America/La_Paz',
      phonePrefix: '+591',
    });
    await h
      .http()
      .post(`/api/v1/admin/countries/${code}/consent-versions`)
      .set(auth)
      .send({ text: 'Versión uno del consentimiento de prueba, ficticio y sin valor legal.' })
      .expect(201);
    await h
      .http()
      .patch(`/api/v1/admin/countries/${code}`)
      .set(auth)
      .send({ active: true })
      .expect(200);

    const user = await createUser(h, { country: code, phoneCountry: 'PE' });
    const s = await login(h, { phone: user.phone, app: 'pwa', countryCode: code });
    const userAuth = bearer(s.body.accessToken);
    await h
      .http()
      .post('/api/v1/me/consent')
      .set(userAuth)
      .send({ consentVersionId: s.body.me.consent.current!.id })
      .expect(200);
    expect((await h.http().get('/api/v1/__probe').set(userAuth)).status).toBe(200);

    const v2 = await h
      .http()
      .post(`/api/v1/admin/countries/${code}/consent-versions`)
      .set(auth)
      .send({
        text: 'Versión dos del consentimiento de prueba, con una finalidad nueva declarada.',
      });
    expect(v2.body.consent.version).toBe(2);

    const blocked = await h.http().get('/api/v1/__probe').set(userAuth);
    expect(blocked.status).toBe(403);
    expect(blocked.body.code).toBe('CONSENT_REQUIRED');
  });
});
