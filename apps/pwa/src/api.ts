import type {
  AuthTokenResponse,
  ConsentAccept,
  GameFinishResponse,
  GamesCatalogResponse,
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

export async function refreshSession(): Promise<AuthTokenResponse | null> {
  const res = await fetch('/api/v1/auth/refresh', {
    method: 'POST',
    credentials: 'include',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ app: 'pwa' }),
  });
  if (res.status === 401) return null;
  return parseJson<AuthTokenResponse>(res);
}

export async function logoutSession(): Promise<void> {
  await fetch('/api/v1/auth/logout', {
    method: 'POST',
    credentials: 'include',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ app: 'pwa' }),
  });
}

export async function fetchMe(accessToken: string): Promise<MeResponse> {
  const res = await fetch('/api/v1/me', {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  return parseJson<MeResponse>(res);
}

export async function acceptConsent(accessToken: string, body: ConsentAccept): Promise<MeResponse> {
  const res = await fetch('/api/v1/me/consent', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${accessToken}`,
    },
    body: JSON.stringify(body),
  });
  return parseJson<MeResponse>(res);
}

// ───────────────────────────── Iteración 3: Motor de Juegos ─────────────────────────────

export async function fetchGamesCatalog(accessToken: string): Promise<GamesCatalogResponse> {
  const res = await fetch('/api/v1/games', {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  return parseJson<GamesCatalogResponse>(res);
}

export async function startGameSession(
  accessToken: string,
  gameId: string,
): Promise<StartedGameSessionResponse> {
  const res = await fetch(`/api/v1/games/${gameId}/sessions`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  return parseJson<StartedGameSessionResponse>(res);
}

export async function submitSessionAnswersBatch(
  accessToken: string,
  sessionId: string,
  token: string,
  answers: SessionAnswerItem[],
): Promise<{ accepted: number }> {
  const res = await fetch(`/api/v1/sessions/${sessionId}/answers`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${accessToken}`,
    },
    body: JSON.stringify({ token, answers }),
  });
  return parseJson<{ accepted: number }>(res);
}

export async function finishGameSession(
  accessToken: string,
  sessionId: string,
  token: string,
): Promise<GameFinishResponse> {
  const res = await fetch(`/api/v1/sessions/${sessionId}/finish`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${accessToken}`,
    },
    body: JSON.stringify({ token }),
  });
  return parseJson<GameFinishResponse>(res);
}

// ───────────────────────────── Iteración 5: Rankings, Perfil y Gerente ─────────────────────────────

export async function fetchRankings(
  accessToken: string,
  scope: RankingQueryScope,
): Promise<RankingsResponse> {
  const res = await fetch(`/api/v1/rankings?scope=${encodeURIComponent(scope)}&period=current`, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  return parseJson<RankingsResponse>(res);
}

export async function fetchMyRankingAndProfile(
  accessToken: string,
): Promise<MyRankingAndProfileResponse> {
  const res = await fetch('/api/v1/me/ranking', {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  return parseJson<MyRankingAndProfileResponse>(res);
}

export async function fetchManagerPharmacySummary(
  accessToken: string,
): Promise<PharmacyManagerSummaryResponse> {
  const res = await fetch('/api/v1/manager/pharmacy/summary', {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  return parseJson<PharmacyManagerSummaryResponse>(res);
}

// ───────────────────────────── Iteración 6: Medición y Eventos ─────────────────────────────

export async function fetchPendingTests(
  accessToken: string,
): Promise<{ tests: PendingKnowledgeTest[] }> {
  const res = await fetch('/api/v1/tests/pending', {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  return parseJson<{ tests: PendingKnowledgeTest[] }>(res);
}

export async function submitKnowledgeTest(
  accessToken: string,
  testId: string,
  answers: { questionId: string; answer: string }[],
): Promise<SubmitKnowledgeTestResponse> {
  const res = await fetch(`/api/v1/tests/${encodeURIComponent(testId)}/submit`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${accessToken}`,
    },
    body: JSON.stringify({ answers }),
  });
  return parseJson<SubmitKnowledgeTestResponse>(res);
}

export async function recordUsageEvent(
  accessToken: string,
  input: UsageEventInput,
): Promise<{ id: string; occurredAt: string }> {
  const res = await fetch('/api/v1/events', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${accessToken}`,
    },
    body: JSON.stringify(input),
  });
  return parseJson<{ id: string; occurredAt: string }>(res);
}
