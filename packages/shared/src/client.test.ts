import { describe, expect, it, vi } from 'vitest';
import { ApiError, OfflineError, createApiClient } from './client';

const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

const session = (token: string) => ({ accessToken: token, expiresInSeconds: 900, me: {} });

describe('createApiClient', () => {
  it('renueva una sola vez ante 401 y reintenta la solicitud', async () => {
    const calls: string[] = [];
    const fetchImpl = vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
      const u = String(url);
      const auth = (init?.headers as Record<string, string>).authorization;
      calls.push(`${u} ${auth ?? '-'}`);
      if (u.endsWith('/auth/refresh')) return json(200, session('nuevo'));
      if (auth === 'Bearer nuevo') return json(200, { ok: true });
      return json(401, { code: 'X' });
    }) as unknown as typeof fetch;

    const api = createApiClient({ app: 'pwa', fetchImpl });
    api.setSession(session('viejo') as never);
    const [a, b] = await Promise.all([api.get('/api/v1/me'), api.get('/api/v1/me')]);
    expect(a).toEqual({ ok: true });
    expect(b).toEqual({ ok: true });
    expect(calls.filter((c) => c.includes('/auth/refresh'))).toHaveLength(1);
  });

  it('avisa que la sesión se perdió si no puede renovarla', async () => {
    const onSessionLost = vi.fn();
    const fetchImpl = vi.fn(async (url: string | URL | Request) =>
      String(url).endsWith('/auth/refresh')
        ? json(401, { code: 'REFRESH_INVALID' })
        : json(401, { code: 'X' }),
    ) as unknown as typeof fetch;
    const api = createApiClient({ app: 'pwa', fetchImpl, onSessionLost });
    await expect(api.get('/api/v1/me')).rejects.toBeInstanceOf(ApiError);
    expect(onSessionLost).toHaveBeenCalledOnce();
    expect(api.hasSession()).toBe(false);
  });

  it('un error del servidor al renovar no cierra la sesión (se puede reintentar)', async () => {
    const fetchImpl = vi.fn(async () => json(503, { status: 503 })) as unknown as typeof fetch;
    const api = createApiClient({ app: 'pwa', fetchImpl });
    await expect(api.refresh()).rejects.toBeInstanceOf(ApiError);
  });

  it('distingue la falta de red de una sesión vencida', async () => {
    const fetchImpl = vi.fn(async () => {
      throw new TypeError('Failed to fetch');
    }) as unknown as typeof fetch;
    const api = createApiClient({ app: 'pwa', fetchImpl });
    await expect(api.refresh()).rejects.toBeInstanceOf(OfflineError);
  });

  it('expone el código y el detalle del error RFC 7807', async () => {
    const fetchImpl = vi.fn(async () =>
      json(409, { status: 409, code: 'COUNTRY_LOCKED', detail: 'Tu cuenta está en Perú' }),
    ) as unknown as typeof fetch;
    const api = createApiClient({ app: 'pwa', fetchImpl });
    const err = await api.send('POST', '/api/v1/auth/otp/verify', {}).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(ApiError);
    expect((err as ApiError).code).toBe('COUNTRY_LOCKED');
    expect((err as ApiError).message).toBe('Tu cuenta está en Perú');
  });
});
