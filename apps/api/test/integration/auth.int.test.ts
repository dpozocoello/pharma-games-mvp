import { OTP_RULES } from '@pharma/shared';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  bearer,
  cookieHeader,
  createHarness,
  createUser,
  login,
  readOtp,
  resetLimits,
  type Harness,
} from './harness';

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
afterEach(() => {
  vi.useRealTimers();
});

const phoneId = (value: string) => ({ type: 'phone', value });

describe('Solicitud de OTP', () => {
  it('responde lo mismo exista o no la cuenta, y solo envía a cuentas registradas', async () => {
    const user = await createUser(h, { country: 'PE' });
    const unknown = '+51970000000';

    const a = await h
      .http()
      .post('/api/v1/auth/otp/request')
      .send({ app: 'pwa', countryCode: 'PE', identifier: phoneId(user.phone) });
    const b = await h
      .http()
      .post('/api/v1/auth/otp/request')
      .send({ app: 'pwa', countryCode: 'PE', identifier: phoneId(unknown) });

    expect(a.status).toBe(202);
    expect(b.status).toBe(202);
    expect(a.body).toEqual(b.body);
    expect(a.body).toEqual({ status: 'SENT_IF_REGISTERED', expiresInSeconds: 300 });
    expect(await readOtp(h, user.phone)).toMatch(/^\d{6}$/);
    expect(await readOtp(h, unknown, 300)).toBeNull();
  });

  it('acepta el número local y lo normaliza con el prefijo del país', async () => {
    const user = await createUser(h, { country: 'PE' });
    const local = user.phone.replace('+51', '').replace(/(\d{3})(\d{3})(\d{3})/, '$1 $2 $3');
    const res = await h
      .http()
      .post('/api/v1/auth/otp/request')
      .send({ app: 'pwa', countryCode: 'PE', identifier: phoneId(local) });
    expect(res.status).toBe(202);
    expect(await readOtp(h, user.phone)).not.toBeNull();
  });

  it(`limita a ${OTP_RULES.maxSends} envíos por número cada 15 minutos (también si no existe)`, async () => {
    for (const phone of [(await createUser(h, { country: 'PE' })).phone, '+51970000001']) {
      const send = () =>
        h
          .http()
          .post('/api/v1/auth/otp/request')
          .send({ app: 'pwa', countryCode: 'PE', identifier: phoneId(phone) });
      for (let i = 0; i < OTP_RULES.maxSends; i++) expect((await send()).status).toBe(202);
      const blocked = await send();
      expect(blocked.status).toBe(429);
      expect(blocked.body.code).toBe('OTP_RATE_LIMITED');
      expect(blocked.body.retryAfterSeconds).toBeGreaterThan(0);
      expect(blocked.body.retryAfterSeconds).toBeLessThanOrEqual(OTP_RULES.sendWindowSeconds);
    }
  });

  it('no envía código a un dependiente que intenta entrar al panel de administración', async () => {
    const user = await createUser(h, { country: 'PE' });
    const res = await h
      .http()
      .post('/api/v1/auth/otp/request')
      .send({ app: 'admin', identifier: phoneId(user.phone) });
    expect(res.status).toBe(202);
    expect(await readOtp(h, user.phone, 300)).toBeNull();
  });

  it('ingresa con documento: se busca por HMAC dentro del país elegido', async () => {
    const user = await createUser(h, { country: 'PE' });
    const identifier = { type: 'document', value: user.document.toLowerCase() };
    await h
      .http()
      .post('/api/v1/auth/otp/request')
      .send({ app: 'pwa', countryCode: 'PE', identifier })
      .expect(202);
    const code = await readOtp(h, user.phone);
    const res = await h
      .http()
      .post('/api/v1/auth/otp/verify')
      .send({ app: 'pwa', countryCode: 'PE', identifier, code });
    expect(res.status).toBe(200);
    expect(res.body.me.id).toBe(user.id);
  });
});

describe('Verificación de OTP', () => {
  it('abre sesión: token de acceso + cookie de refresh HttpOnly, SameSite=Lax, 90 días', async () => {
    const user = await createUser(h, { country: 'PE' });
    const { body, setCookie } = await login(h, {
      phone: user.phone,
      app: 'pwa',
      countryCode: 'PE',
    });

    expect(body.accessToken).toBeTruthy();
    expect(body.expiresInSeconds).toBe(900);
    expect(body.me).toMatchObject({
      id: user.id,
      role: 'CLERK',
      country: { code: 'PE' },
      countryLocked: true,
      consent: { required: true, accepted: false },
    });
    expect(body.me.phoneMasked).not.toContain(user.phone.slice(3, 9));
    expect(setCookie).toMatch(/HttpOnly/i);
    expect(setCookie).toMatch(/SameSite=Lax/i);
    expect(setCookie).toMatch(/Path=\/api\/v1\/auth/);
    const maxAge = Number(/Max-Age=(\d+)/.exec(setCookie)?.[1]);
    expect(maxAge).toBe(90 * 24 * 60 * 60);

    const me = await h.http().get('/api/v1/me').set(bearer(body.accessToken));
    expect(me.status).toBe(200);
    expect(me.body.id).toBe(user.id);
  });

  it(`bloquea el código tras ${OTP_RULES.maxAttempts} intentos fallidos`, async () => {
    const user = await createUser(h, { country: 'PE' });
    const identifier = phoneId(user.phone);
    await h
      .http()
      .post('/api/v1/auth/otp/request')
      .send({ app: 'pwa', countryCode: 'PE', identifier });
    const code = (await readOtp(h, user.phone))!;
    const wrong = code === '000000' ? '111111' : '000000';
    const verify = (c: string) =>
      h
        .http()
        .post('/api/v1/auth/otp/verify')
        .send({ app: 'pwa', countryCode: 'PE', identifier, code: c });

    for (let left = OTP_RULES.maxAttempts - 1; left >= 1; left--) {
      const r = await verify(wrong);
      expect(r.status).toBe(400);
      expect(r.body).toMatchObject({ code: 'OTP_INVALID', attemptsLeft: left });
    }
    const locked = await verify(wrong);
    expect(locked.status).toBe(429);
    expect(locked.body.code).toBe('OTP_LOCKED');
    // El código correcto ya no sirve: hay que pedir uno nuevo.
    const after = await verify(code);
    expect(after.status).toBe(400);
    expect(after.body.code).toBe('OTP_EXPIRED');
  });

  it('el código vence a los 5 minutos', async () => {
    const user = await createUser(h, { country: 'PE' });
    const identifier = phoneId(user.phone);
    await h
      .http()
      .post('/api/v1/auth/otp/request')
      .send({ app: 'pwa', countryCode: 'PE', identifier });
    const code = await readOtp(h, user.phone);
    const ttl = await h.redis.client.ttl(`otp:code:pwa:${user.id}`);
    expect(ttl).toBeGreaterThan(OTP_RULES.ttlSeconds - 10);
    expect(ttl).toBeLessThanOrEqual(OTP_RULES.ttlSeconds);
    await h.redis.client.del(`otp:code:pwa:${user.id}`); // equivalente a que venza
    const r = await h
      .http()
      .post('/api/v1/auth/otp/verify')
      .send({ app: 'pwa', countryCode: 'PE', identifier, code });
    expect(r.body.code).toBe('OTP_EXPIRED');
  });

  it('el código se guarda como HMAC, nunca en claro', async () => {
    const user = await createUser(h, { country: 'PE' });
    await h
      .http()
      .post('/api/v1/auth/otp/request')
      .send({ app: 'pwa', countryCode: 'PE', identifier: phoneId(user.phone) });
    const code = (await readOtp(h, user.phone))!;
    const stored = await h.redis.client.hgetall(`otp:code:pwa:${user.id}`);
    expect(JSON.stringify(stored)).not.toContain(code);
    expect(stored.h).toMatch(/^[0-9a-f]{64}$/);
  });
});

describe('País fijado a la cuenta', () => {
  it('rechaza ingresar en otro país y no cambia el país de la cuenta', async () => {
    const user = await createUser(h, { country: 'PE' });
    const identifier = phoneId(user.phone);
    await h
      .http()
      .post('/api/v1/auth/otp/request')
      .send({ app: 'pwa', countryCode: 'CO', identifier })
      .expect(202);
    const code = await readOtp(h, user.phone);
    const r = await h
      .http()
      .post('/api/v1/auth/otp/verify')
      .send({ app: 'pwa', countryCode: 'CO', identifier, code });
    expect(r.status).toBe(409);
    expect(r.body).toMatchObject({ code: 'COUNTRY_LOCKED', lockedCountry: { code: 'PE' } });
    expect(r.headers['set-cookie']).toBeUndefined();

    const row = await h.prisma.user.findUniqueOrThrow({
      where: { id: user.id },
      include: { country: true },
    });
    expect(row.country?.code).toBe('PE');
  });

  it('una cuenta sin país queda fijada al primero que elige y luego no puede cambiarlo', async () => {
    const user = await createUser(h, { country: null, phoneCountry: 'EC' });
    const first = await login(h, { phone: user.phone, app: 'pwa', countryCode: 'EC' });
    expect(first.body.me.country?.code).toBe('EC');
    expect(first.body.me.countryLocked).toBe(true);

    await resetLimits(h);
    await expect(login(h, { phone: user.phone, app: 'pwa', countryCode: 'PE' })).rejects.toThrow(
      /409.*COUNTRY_LOCKED/,
    );
    const row = await h.prisma.user.findUniqueOrThrow({ where: { id: user.id } });
    expect(row.countryLockedAt).not.toBeNull();
  });
});

describe('Consentimiento obligatorio por país', () => {
  it('bloquea las rutas protegidas hasta aceptar la versión vigente', async () => {
    const user = await createUser(h, { country: 'PE' });
    const { body } = await login(h, { phone: user.phone, app: 'pwa', countryCode: 'PE' });
    const auth = bearer(body.accessToken);

    const blocked = await h.http().get('/api/v1/__probe').set(auth);
    expect(blocked.status).toBe(403);
    expect(blocked.body.code).toBe('CONSENT_REQUIRED');

    const current = body.me.consent.current!;
    expect(current.text).toContain('Ley');
    const accepted = await h
      .http()
      .post('/api/v1/me/consent')
      .set(auth)
      .send({ consentVersionId: current.id });
    expect(accepted.status).toBe(200);
    expect(accepted.body.consent.accepted).toBe(true);

    const row = await h.prisma.userConsent.findFirstOrThrow({ where: { userId: user.id } });
    expect(row.ipTruncated).toMatch(/\.0$|::$/);

    expect((await h.http().get('/api/v1/__probe').set(auth)).status).toBe(200);
  });

  it('rechaza aceptar una versión que no es la vigente', async () => {
    const user = await createUser(h, { country: 'PE' });
    const { body } = await login(h, { phone: user.phone, app: 'pwa', countryCode: 'PE' });
    const r = await h
      .http()
      .post('/api/v1/me/consent')
      .set(bearer(body.accessToken))
      .send({ consentVersionId: '01900000-0000-7000-8000-000000000000' });
    expect(r.status).toBe(409);
    expect(r.body.code).toBe('CONSENT_OUTDATED');
  });

  it('sin token, las rutas protegidas responden 401', async () => {
    expect((await h.http().get('/api/v1/__probe')).status).toBe(401);
    expect((await h.http().get('/api/v1/me')).status).toBe(401);
    const bad = await h.http().get('/api/v1/me').set(bearer('x.y.z'));
    expect(bad.status).toBe(401);
  });
});

describe('Sesión de 90 días con rotación de refresh', () => {
  it('rota el refresh y detecta la reutilización de uno viejo (revoca la familia)', async () => {
    const user = await createUser(h, { country: 'PE' });
    const first = await login(h, { phone: user.phone, app: 'pwa', countryCode: 'PE' });

    const r1 = await h
      .http()
      .post('/api/v1/auth/refresh')
      .set('Cookie', first.cookie)
      .send({ app: 'pwa' });
    expect(r1.status).toBe(200);
    expect(r1.body.accessToken).toBeTruthy();
    const second = cookieHeader(r1.headers['set-cookie'], 'pharma_rt_pwa').split(';')[0]!;
    expect(second).not.toBe(first.cookie);

    // Reutilizar el viejo enseguida = carrera entre pestañas: no se revoca nada.
    const race = await h
      .http()
      .post('/api/v1/auth/refresh')
      .set('Cookie', first.cookie)
      .send({ app: 'pwa' });
    expect(race.status).toBe(401);
    expect(race.body.code).toBe('REFRESH_RACE');

    // Pasado el margen, reutilizarlo es sospechoso: se revoca toda la familia.
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(Date.now() + 60_000);
    const reuse = await h
      .http()
      .post('/api/v1/auth/refresh')
      .set('Cookie', first.cookie)
      .send({ app: 'pwa' });
    expect(reuse.status).toBe(401);
    expect(reuse.body.code).toBe('REFRESH_INVALID');
    const stolen = await h
      .http()
      .post('/api/v1/auth/refresh')
      .set('Cookie', second)
      .send({ app: 'pwa' });
    expect(stolen.status).toBe(401);
  });

  it('la cookie de una app no sirve para la otra', async () => {
    const user = await createUser(h, { country: 'PE' });
    const { cookie } = await login(h, { phone: user.phone, app: 'pwa', countryCode: 'PE' });
    const r = await h
      .http()
      .post('/api/v1/auth/refresh')
      .set('Cookie', cookie.replace('pharma_rt_pwa', 'pharma_rt_admin'))
      .send({ app: 'admin' });
    expect(r.status).toBe(401);
  });

  it('cerrar sesión revoca el refresh', async () => {
    const user = await createUser(h, { country: 'PE' });
    const { cookie } = await login(h, { phone: user.phone, app: 'pwa', countryCode: 'PE' });
    await h
      .http()
      .post('/api/v1/auth/logout')
      .set('Cookie', cookie)
      .send({ app: 'pwa' })
      .expect(204);
    const r = await h
      .http()
      .post('/api/v1/auth/refresh')
      .set('Cookie', cookie)
      .send({ app: 'pwa' });
    expect(r.status).toBe(401);
  });

  it('una cuenta desactivada no puede renovar la sesión', async () => {
    const user = await createUser(h, { country: 'PE' });
    const { cookie } = await login(h, { phone: user.phone, app: 'pwa', countryCode: 'PE' });
    await h.prisma.user.update({ where: { id: user.id }, data: { status: 'INACTIVE' } });
    const r = await h
      .http()
      .post('/api/v1/auth/refresh')
      .set('Cookie', cookie)
      .send({ app: 'pwa' });
    expect(r.status).toBe(401);
  });
});
