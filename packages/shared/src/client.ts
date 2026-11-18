import type { AppAudience, AuthTokenResponse } from './auth';

/** Error de la API con el cuerpo RFC 7807 (incluye `code` estable para la interfaz). */
export class ApiError extends Error {
  readonly status: number;
  readonly code: string | undefined;
  readonly body: Record<string, unknown>;

  constructor(status: number, body: unknown) {
    const b = (body && typeof body === 'object' ? body : {}) as Record<string, unknown>;
    super(typeof b.detail === 'string' ? b.detail : `Error ${status}`);
    this.status = status;
    this.code = typeof b.code === 'string' ? b.code : undefined;
    this.body = b;
  }
}

/** Sin red: la interfaz muestra un mensaje amable y permite reintentar. */
export class OfflineError extends Error {
  constructor() {
    super('Sin conexión');
  }
}

export interface ApiClient {
  get<T>(path: string): Promise<T>;
  send<T>(method: 'POST' | 'PUT' | 'PATCH' | 'DELETE', path: string, body?: unknown): Promise<T>;
  /** Renueva la sesión con la cookie HttpOnly. Null si no hay sesión. Lanza OfflineError sin red. */
  refresh(): Promise<AuthTokenResponse | null>;
  setSession(res: AuthTokenResponse): void;
  logout(): Promise<void>;
  hasSession(): boolean;
}

export interface ApiClientOptions {
  app: AppAudience;
  baseUrl?: string;
  /** Se llama cuando la sesión no puede renovarse (hay que volver a ingresar). */
  onSessionLost?: () => void;
  fetchImpl?: typeof fetch;
}

/**
 * Cliente HTTP de las apps. El token de acceso vive solo en memoria (nunca en localStorage);
 * la sesión de 90 días está en una cookie HttpOnly que JavaScript no puede leer.
 * Ante un 401 renueva una sola vez (las solicitudes concurrentes comparten la renovación).
 */
export function createApiClient(opts: ApiClientOptions): ApiClient {
  const base = opts.baseUrl ?? '';
  const doFetch = opts.fetchImpl ?? ((...a: Parameters<typeof fetch>) => fetch(...a));
  let access: string | null = null;
  let refreshing: Promise<AuthTokenResponse | null> | null = null;

  async function raw(method: string, path: string, body?: unknown, auth = true): Promise<Response> {
    const headers: Record<string, string> = { accept: 'application/json' };
    if (body !== undefined) headers['content-type'] = 'application/json';
    if (auth && access) headers.authorization = `Bearer ${access}`;
    try {
      return await doFetch(`${base}${path}`, {
        method,
        headers,
        body: body === undefined ? undefined : JSON.stringify(body),
        credentials: 'include',
      });
    } catch {
      throw new OfflineError();
    }
  }

  async function parse<T>(res: Response): Promise<T> {
    if (res.status === 204) return undefined as T;
    const data: unknown = await res.json().catch(() => null);
    if (!res.ok) throw new ApiError(res.status, data);
    return data as T;
  }

  async function doRefresh(): Promise<AuthTokenResponse | null> {
    const res = await raw('POST', '/api/v1/auth/refresh', { app: opts.app }, false);
    if (res.ok) {
      const data = (await res.json()) as AuthTokenResponse;
      access = data.accessToken;
      return data;
    }
    if (res.status >= 500) throw new ApiError(res.status, await res.json().catch(() => null));
    access = null;
    return null;
  }

  function refresh(): Promise<AuthTokenResponse | null> {
    refreshing ??= doRefresh().finally(() => {
      refreshing = null;
    });
    return refreshing;
  }

  async function request<T>(method: string, path: string, body?: unknown): Promise<T> {
    let res = await raw(method, path, body);
    if (res.status === 401 && !path.startsWith('/api/v1/auth/')) {
      const renewed = await refresh();
      if (!renewed) {
        opts.onSessionLost?.();
        return parse<T>(res);
      }
      res = await raw(method, path, body);
    }
    return parse<T>(res);
  }

  return {
    get: (path) => request('GET', path),
    send: (method, path, body) => request(method, path, body),
    refresh,
    setSession(res) {
      access = res.accessToken;
    },
    async logout() {
      try {
        await raw('POST', '/api/v1/auth/logout', { app: opts.app }, false);
      } finally {
        access = null;
      }
    },
    hasSession: () => access !== null,
  };
}
