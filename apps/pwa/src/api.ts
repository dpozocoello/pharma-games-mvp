import type {
  AuthTokenResponse,
  ConsentAccept,
  GameFinishResponse,
  GamesCatalogResponse,
  GameStyle,
  Identifier,
  MeResponse,
  MyRankingAndProfileResponse,
  OtpRequestResponse,
  PendingKnowledgeTest,
  PharmacyManagerSummaryResponse,
  PublicCountry,
  RankingQueryScope,
  RankingsResponse,
  SessionAnswerItem,
  StartedGameSessionResponse,
  SubmitKnowledgeTestResponse,
  UsageEventInput,
} from '@pharma/shared';

export interface ProblemError {
  status: number;
  title?: string;
  detail?: string;
  code?: string;
  attemptsLeft?: number;
  retryAfterSeconds?: number;
  lockedCountry?: { code: string; name: string } | null;
}

export class ApiHttpError extends Error {
  readonly problem: ProblemError;
  constructor(problem: ProblemError) {
    super(problem.detail ?? problem.title ?? `HTTP ${problem.status}`);
    this.problem = problem;
  }
}

async function parseJson<T>(res: Response): Promise<T> {
  if (res.status === 204) return undefined as T;
  const data = (await res.json().catch(() => ({}))) as T & ProblemError;
  if (!res.ok) {
    throw new ApiHttpError({ ...data, status: res.status });
  }
  return data;
}

export async function fetchCountries(): Promise<PublicCountry[]> {
  const res = await fetch('/api/v1/countries');
  return parseJson<PublicCountry[]>(res);
}

export async function requestOtp(
  countryCode: string,
  identifier: Identifier,
): Promise<OtpRequestResponse> {
  const res = await fetch('/api/v1/auth/otp/request', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ app: 'pwa', countryCode, identifier }),
  });
  return parseJson<OtpRequestResponse>(res);
}

export async function verifyOtp(
  countryCode: string,
  identifier: Identifier,
  code: string,
): Promise<AuthTokenResponse> {
  const res = await fetch('/api/v1/auth/otp/verify', {
    method: 'POST',
    credentials: 'include',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ app: 'pwa', countryCode, identifier, code }),
  });
  return parseJson<AuthTokenResponse>(res);
}

async function refreshOnce(): Promise<AuthTokenResponse | null | 'RACE'> {
  const res = await fetch('/api/v1/auth/refresh', {
    method: 'POST',
    credentials: 'include',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ app: 'pwa' }),
  });
  if (res.status === 401) {
    const body = (await res.json().catch(() => ({}))) as ProblemError;
    // Otra pestaña rotó el refresh hace segundos: no es un cierre de sesión, se reintenta.
    return body.code === 'REFRESH_RACE' ? 'RACE' : null;
  }
  return parseJson<AuthTokenResponse>(res);
}

/**
 * Renueva la sesión con la cookie HttpOnly de 90 días. Devuelve `null` si la sesión terminó.
 * Publica el token nuevo (o `null`) a quien escuche con `onSessionTokenChange`.
 */
export async function refreshSession(): Promise<AuthTokenResponse | null> {
  let res = await refreshOnce();
  for (let i = 0; res === 'RACE' && i < 3; i++) {
    await new Promise((r) => setTimeout(r, 300 * (i + 1)));
    res = await refreshOnce();
  }
  const out = res === 'RACE' ? null : res;
  setSessionToken(out?.accessToken ?? null);
  return out;
}

// ───────────────────────── Token de acceso (15 min) y renovación automática ─────────────────────────

let sessionToken: string | null = null;
const tokenListeners = new Set<(token: string | null) => void>();
let refreshing: Promise<AuthTokenResponse | null> | null = null;

/** El token vive aquí (solo en memoria) y no en el estado de React: renovarlo no remonta el juego. */
export function setSessionToken(token: string | null): void {
  if (token === sessionToken) return;
  sessionToken = token;
  for (const l of tokenListeners) l(token);
}

export function getSessionToken(): string | null {
  return sessionToken;
}

export function onSessionTokenChange(listener: (token: string | null) => void): () => void {
  tokenListeners.add(listener);
  return () => tokenListeners.delete(listener);
}

/** Una sola renovación en curso aunque varias solicitudes venzan a la vez. */
function refreshShared(): Promise<AuthTokenResponse | null> {
  refreshing ??= refreshSession().finally(() => {
    refreshing = null;
  });
  return refreshing;
}

/**
 * `fetch` autenticado: agrega el token vigente y, ante un 401, renueva una vez y reintenta.
 * Si la sesión de 90 días terminó, el token queda en `null` y se devuelve el 401.
 */
export async function authFetch(url: string, init: RequestInit = {}): Promise<Response> {
  const send = (token: string | null) => {
    const headers = new Headers(init.headers);
    if (token) headers.set('Authorization', `Bearer ${token}`);
    return fetch(url, { ...init, headers });
  };
  const sentWith = sessionToken;
  const res = await send(sentWith);
  if (res.status !== 401) return res;
  // Si otra solicitud ya renovó mientras esta viajaba, basta con reintentar.
  const token =
    sessionToken && sessionToken !== sentWith ? sessionToken : (await refreshShared())?.accessToken;
  return token ? send(token) : res;
}

export async function logoutSession(): Promise<void> {
  await fetch('/api/v1/auth/logout', {
    method: 'POST',
    credentials: 'include',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ app: 'pwa' }),
  });
}

export async function fetchMe(): Promise<MeResponse> {
  const res = await authFetch('/api/v1/me', {});
  return parseJson<MeResponse>(res);
}

export async function acceptConsent(body: ConsentAccept): Promise<MeResponse> {
  const res = await authFetch('/api/v1/me/consent', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(body),
  });
  return parseJson<MeResponse>(res);
}

// ───────────────────────────── Iteración 3: Motor de Juegos ─────────────────────────────

export async function fetchGamesCatalog(): Promise<GamesCatalogResponse> {
  const res = await authFetch('/api/v1/games', {});
  return parseJson<GamesCatalogResponse>(res);
}

export async function startGameSession(
  gameId: string,
  style?: GameStyle,
): Promise<StartedGameSessionResponse> {
  const res = await authFetch(`/api/v1/games/${gameId}/sessions`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    // El servidor valida el estilo contra el grupo del piloto (ADR-034).
    body: JSON.stringify(style ? { style } : {}),
  });
  return parseJson<StartedGameSessionResponse>(res);
}

export async function submitSessionAnswersBatch(
  sessionId: string,
  token: string,
  answers: SessionAnswerItem[],
): Promise<{ accepted: number }> {
  const res = await authFetch(`/api/v1/sessions/${sessionId}/answers`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ token, answers }),
  });
  return parseJson<{ accepted: number }>(res);
}

export async function finishGameSession(
  sessionId: string,
  token: string,
): Promise<GameFinishResponse> {
  const res = await authFetch(`/api/v1/sessions/${sessionId}/finish`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ token }),
  });
  return parseJson<GameFinishResponse>(res);
}

// ───────────────────────────── Iteración 5: Rankings, Perfil y Gerente ─────────────────────────────

export async function fetchRankings(scope: RankingQueryScope): Promise<RankingsResponse> {
  const res = await authFetch(
    `/api/v1/rankings?scope=${encodeURIComponent(scope)}&period=current`,
    {},
  );
  return parseJson<RankingsResponse>(res);
}

export async function fetchMyRankingAndProfile(): Promise<MyRankingAndProfileResponse> {
  const res = await authFetch('/api/v1/me/ranking', {});
  return parseJson<MyRankingAndProfileResponse>(res);
}

export async function fetchManagerPharmacySummary(): Promise<PharmacyManagerSummaryResponse> {
  const res = await authFetch('/api/v1/manager/pharmacy/summary', {});
  return parseJson<PharmacyManagerSummaryResponse>(res);
}

// ───────────────────────────── Iteración 6: Medición y Eventos ─────────────────────────────

export async function fetchPendingTests(): Promise<{ tests: PendingKnowledgeTest[] }> {
  const res = await authFetch('/api/v1/tests/pending', {});
  return parseJson<{ tests: PendingKnowledgeTest[] }>(res);
}

export async function submitKnowledgeTest(
  testId: string,
  answers: { questionId: string; answer: string }[],
): Promise<SubmitKnowledgeTestResponse> {
  const res = await authFetch(`/api/v1/tests/${encodeURIComponent(testId)}/submit`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ answers }),
  });
  return parseJson<SubmitKnowledgeTestResponse>(res);
}

export async function recordUsageEvent(
  input: UsageEventInput,
): Promise<{ id: string; occurredAt: string }> {
  const res = await authFetch('/api/v1/events', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(input),
  });
  return parseJson<{ id: string; occurredAt: string }>(res);
}
