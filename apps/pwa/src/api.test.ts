import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  ApiHttpError,
  authFetch,
  getSessionToken,
  onSessionTokenChange,
  setSessionToken,
} from './api';

/** Respuesta JSON mínima para simular la API. */
const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });

const me = { userId: 'u1' };

let fetchMock: ReturnType<typeof vi.fn>;
beforeEach(() => {
  fetchMock = vi.fn();
  vi.stubGlobal('fetch', fetchMock);
  setSessionToken('viejo');
});
afterEach(() => {
  vi.unstubAllGlobals();
  setSessionToken(null);
});

const authHeader = (call: unknown[]) =>
  new Headers((call[1] as RequestInit | undefined)?.headers).get('Authorization');

describe('authFetch: renovación del token de acceso (15 min)', () => {
  it('ante un 401 renueva con la cookie, reintenta con el token nuevo y lo publica', async () => {
    const seen: (string | null)[] = [];
    const off = onSessionTokenChange((t) => seen.push(t));
    fetchMock.mockImplementation(async (url: string, init?: RequestInit) => {
      if (url === '/api/v1/auth/refresh') return json(200, { accessToken: 'nuevo', me });
      const auth = new Headers(init?.headers).get('Authorization');
      return auth === 'Bearer nuevo' ? json(200, { ok: true }) : json(401, { status: 401 });
    });

    const res = await authFetch('/api/v1/games');

    expect(res.status).toBe(200);
    expect(getSessionToken()).toBe('nuevo');
    expect(seen).toEqual(['nuevo']);
    expect(fetchMock.mock.calls.map((c) => c[0])).toEqual([
      '/api/v1/games',
      '/api/v1/auth/refresh',
      '/api/v1/games',
    ]);
    off();
  });

  it('varias solicitudes vencidas a la vez comparten una sola renovación', async () => {
    let refreshes = 0;
    fetchMock.mockImplementation(async (url: string, init?: RequestInit) => {
      if (url === '/api/v1/auth/refresh') {
        refreshes += 1;
        await new Promise((r) => setTimeout(r, 20));
        return json(200, { accessToken: 'nuevo', me });
      }
      const auth = new Headers(init?.headers).get('Authorization');
      return auth === 'Bearer nuevo' ? json(200, {}) : json(401, {});
    });

    const results = await Promise.all([
      authFetch('/api/v1/games'),
      authFetch('/api/v1/rankings'),
      authFetch('/api/v1/me/ranking'),
    ]);

    expect(results.map((r) => r.status)).toEqual([200, 200, 200]);
    expect(refreshes).toBe(1);
  });

  it('si la sesión de 90 días terminó, limpia el token y propaga el 401', async () => {
    const seen: (string | null)[] = [];
    const off = onSessionTokenChange((t) => seen.push(t));
    fetchMock.mockImplementation(async (url: string) =>
      url === '/api/v1/auth/refresh'
        ? json(401, { code: 'REFRESH_INVALID' })
        : json(401, { status: 401 }),
    );

    const res = await authFetch('/api/v1/games');

    expect(res.status).toBe(401);
    expect(getSessionToken()).toBeNull();
    expect(seen).toEqual([null]);
    off();
  });

  it('REFRESH_RACE (otra pestaña renovó a la vez) reintenta la renovación en lugar de cerrar sesión', async () => {
    let refreshes = 0;
    fetchMock.mockImplementation(async (url: string, init?: RequestInit) => {
      if (url === '/api/v1/auth/refresh') {
        refreshes += 1;
        return refreshes === 1
          ? json(401, { code: 'REFRESH_RACE' })
          : json(200, { accessToken: 'nuevo', me });
      }
      const auth = new Headers(init?.headers).get('Authorization');
      return auth === 'Bearer nuevo' ? json(200, {}) : json(401, {});
    });

    const res = await authFetch('/api/v1/games');

    expect(res.status).toBe(200);
    expect(refreshes).toBe(2);
    expect(getSessionToken()).toBe('nuevo');
  });

  it('otros errores (403, 500) no disparan renovación', async () => {
    fetchMock.mockResolvedValue(json(403, { code: 'CONSENT_REQUIRED' }));
    const res = await authFetch('/api/v1/games');
    expect(res.status).toBe(403);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(authHeader(fetchMock.mock.calls[0]!)).toBe('Bearer viejo');
    expect(ApiHttpError).toBeDefined();
  });
});
