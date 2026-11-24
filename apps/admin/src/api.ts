import type {
  AdminCountrySummary,
  AnomalyAlertView,
  AnomalyStatus,
  AuthTokenResponse,
  BrandCreate,
  CountryConfigInput,
  CountryConfigView,
  CountryCreate,
  CountryPatch,
  CsvImportBody,
  ImportJobView,
  OtpRequestResponse,
  PharmacyCreate,
  PharmacyPatch,
  QuestionStatus,
  PilotSummaryRow,
} from '@pharma/shared';

export interface AdminPharmacy {
  id: string;
  countryCode: string;
  externalCode: string | null;
  name: string;
  city: string;
  active: boolean;
  activeClerksCount: number;
}

export interface AdminUser {
  id: string;
  countryCode: string | null;
  displayName: string;
  phoneMasked: string;
  role: string;
  status: 'ACTIVE' | 'INACTIVE';
  currentPharmacy: { id: string; name: string; externalCode: string | null } | null;
  assignmentHistory: {
    id: string;
    pharmacyId: string;
    pharmacyName: string;
    from: string;
    to: string | null;
  }[];
  totalPoints: number;
}

export interface AdminBrand {
  id: string;
  slug: string;
  name: string;
  theme: { primary: string; secondary: string; logoUrl: string };
  countries: { code: string; name: string; active: boolean }[];
  publishedQuestionsCount: number;
  totalQuestionsCount: number;
}

export interface AdminQuestion {
  id: string;
  brandId: string;
  brandSlug: string;
  brandName: string;
  countryCode: string | null;
  type: 'MULTIPLE_CHOICE' | 'TRUE_FALSE';
  prompt: string;
  options: { id: string; text: string }[];
  correctAnswer: string;
  locale: string;
  status: QuestionStatus;
  version: number;
  updatedAt: string;
}

export interface ProblemError {
  status: number;
  title?: string;
  detail?: string;
  code?: string;
  errors?: { path: string; message: string }[];
}

export class AdminApiError extends Error {
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
    throw new AdminApiError({ ...data, status: res.status });
  }
  return data;
}

export async function requestAdminOtp(phone: string): Promise<OtpRequestResponse> {
  const res = await fetch('/api/v1/auth/otp/request', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      app: 'admin',
      identifier: { type: 'phone', value: phone.trim() },
    }),
  });
  return parseJson<OtpRequestResponse>(res);
}

export async function verifyAdminOtp(phone: string, code: string): Promise<AuthTokenResponse> {
  const res = await fetch('/api/v1/auth/otp/verify', {
    method: 'POST',
    credentials: 'include',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      app: 'admin',
      identifier: { type: 'phone', value: phone.trim() },
      code: code.trim(),
    }),
  });
  return parseJson<AuthTokenResponse>(res);
}

export async function refreshAdminSession(): Promise<AuthTokenResponse | null> {
  const res = await fetch('/api/v1/auth/refresh', {
    method: 'POST',
    credentials: 'include',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ app: 'admin' }),
  });
  if (res.status === 401) return null;
  return parseJson<AuthTokenResponse>(res);
}

export async function logoutAdminSession(): Promise<void> {
  await fetch('/api/v1/auth/logout', {
    method: 'POST',
    credentials: 'include',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ app: 'admin' }),
  });
}

export async function listAdminCountries(token: string): Promise<AdminCountrySummary[]> {
  const res = await fetch('/api/v1/admin/countries', {
    headers: { Authorization: `Bearer ${token}` },
  });
  return parseJson<AdminCountrySummary[]>(res);
}

export async function getCountryConfig(token: string, code: string): Promise<CountryConfigView> {
  const res = await fetch(`/api/v1/admin/countries/${code}/config`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  return parseJson<CountryConfigView>(res);
}

export async function updateCountryConfig(
  token: string,
  code: string,
  input: CountryConfigInput,
): Promise<CountryConfigView> {
  const res = await fetch(`/api/v1/admin/countries/${code}/config`, {
    method: 'PUT',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify(input),
  });
  return parseJson<CountryConfigView>(res);
}

export async function createCountry(
  token: string,
  input: CountryCreate,
): Promise<CountryConfigView> {
  const res = await fetch('/api/v1/admin/countries', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify(input),
  });
  return parseJson<CountryConfigView>(res);
}

export async function patchCountry(
  token: string,
  code: string,
  input: CountryPatch,
): Promise<CountryConfigView> {
  const res = await fetch(`/api/v1/admin/countries/${code}`, {
    method: 'PATCH',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify(input),
  });
  return parseJson<CountryConfigView>(res);
}

export async function publishConsentVersion(
  token: string,
  code: string,
  text: string,
): Promise<CountryConfigView> {
  const res = await fetch(`/api/v1/admin/countries/${code}/consent-versions`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify({ text }),
  });
  return parseJson<CountryConfigView>(res);
}

export async function setCountryBrandActive(
  token: string,
  code: string,
  brandId: string,
  active: boolean,
): Promise<CountryConfigView> {
  const res = await fetch(`/api/v1/admin/countries/${code}/brands/${brandId}`, {
    method: 'PUT',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify({ active }),
  });
  return parseJson<CountryConfigView>(res);
}

// ───────────────────────────── Iteración 2: Usuarios, Farmacias y Contenido ─────────────────────────────

export async function listPharmacies(
  token: string,
  countryCode?: string,
): Promise<AdminPharmacy[]> {
  const qs = countryCode ? `?countryCode=${encodeURIComponent(countryCode)}` : '';
  const res = await fetch(`/api/v1/admin/pharmacies${qs}`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  return parseJson<AdminPharmacy[]>(res);
}

export async function createPharmacy(token: string, input: PharmacyCreate): Promise<AdminPharmacy> {
  const res = await fetch('/api/v1/admin/pharmacies', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify(input),
  });
  return parseJson<AdminPharmacy>(res);
}

export async function patchPharmacy(
  token: string,
  id: string,
  input: PharmacyPatch,
): Promise<AdminPharmacy> {
  const res = await fetch(`/api/v1/admin/pharmacies/${id}`, {
    method: 'PATCH',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify(input),
  });
  return parseJson<AdminPharmacy>(res);
}

export async function listUsers(token: string, countryCode?: string): Promise<AdminUser[]> {
  const qs = countryCode ? `?countryCode=${encodeURIComponent(countryCode)}` : '';
  const res = await fetch(`/api/v1/admin/users${qs}`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  return parseJson<AdminUser[]>(res);
}

export async function transferUserPharmacy(
  token: string,
  userId: string,
  pharmacyId: string,
): Promise<AdminUser> {
  const res = await fetch(`/api/v1/admin/users/${userId}/transfer`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify({ pharmacyId }),
  });
  return parseJson<AdminUser>(res);
}

export async function updateUserStatus(
  token: string,
  userId: string,
  status: 'ACTIVE' | 'INACTIVE',
): Promise<AdminUser> {
  const res = await fetch(`/api/v1/admin/users/${userId}/status`, {
    method: 'PATCH',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify({ status }),
  });
  return parseJson<AdminUser>(res);
}

export async function importUsersCsv(token: string, body: CsvImportBody): Promise<ImportJobView> {
  const res = await fetch('/api/v1/admin/imports/users', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify(body),
  });
  return parseJson<ImportJobView>(res);
}

export async function importQuestionsCsv(
  token: string,
  body: CsvImportBody,
): Promise<ImportJobView> {
  const res = await fetch('/api/v1/admin/imports/questions', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify(body),
  });
  return parseJson<ImportJobView>(res);
}

export async function listBrands(token: string): Promise<AdminBrand[]> {
  const res = await fetch('/api/v1/admin/brands', {
    headers: { Authorization: `Bearer ${token}` },
  });
  return parseJson<AdminBrand[]>(res);
}

export async function createBrand(token: string, body: BrandCreate): Promise<AdminBrand> {
  const res = await fetch('/api/v1/admin/brands', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify(body),
  });
  return parseJson<AdminBrand>(res);
}

export async function listQuestions(
  token: string,
  brandSlug?: string,
  status?: QuestionStatus,
): Promise<AdminQuestion[]> {
  const params = new URLSearchParams();
  if (brandSlug) params.set('brandSlug', brandSlug);
  if (status) params.set('status', status);
  const qs = params.toString() ? `?${params.toString()}` : '';
  const res = await fetch(`/api/v1/admin/questions${qs}`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  return parseJson<AdminQuestion[]>(res);
}

export async function updateQuestionStatus(
  token: string,
  questionId: string,
  status: QuestionStatus,
): Promise<AdminQuestion> {
  const res = await fetch(`/api/v1/admin/questions/${questionId}/status`, {
    method: 'PATCH',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify({ status }),
  });
  return parseJson<AdminQuestion>(res);
}

// ───────────────────────────── Iteración 4: Anomalías y Juego Justo ─────────────────────────────

export async function listAnomalies(
  token: string,
  countryCode?: string,
  status?: AnomalyStatus,
): Promise<AnomalyAlertView[]> {
  const params = new URLSearchParams();
  if (countryCode) params.set('countryCode', countryCode);
  if (status) params.set('status', status);
  const qs = params.toString() ? `?${params.toString()}` : '';
  const res = await fetch(`/api/v1/admin/anomalies${qs}`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  return parseJson<AnomalyAlertView[]>(res);
}

export async function resolveAnomaly(
  token: string,
  alertId: string,
  status: 'CONFIRMED' | 'DISMISSED',
): Promise<AnomalyAlertView> {
  const res = await fetch(`/api/v1/admin/anomalies/${alertId}`, {
    method: 'PATCH',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify({ status }),
  });
  return parseJson<AnomalyAlertView>(res);
}

// ───────────────────────────── Iteración 5: Cierre de Periodo y Ganadores CSV ─────────────────────────────

export async function closeRankingPeriod(
  token: string,
  periodId: string,
): Promise<{ winnersCount: number }> {
  const res = await fetch(`/api/v1/admin/periods/${periodId}/close`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}` },
  });
  return parseJson<{ winnersCount: number }>(res);
}

export async function downloadWinnersCsv(token: string, periodId: string): Promise<string> {
  const res = await fetch(`/api/v1/admin/periods/${periodId}/winners.csv`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!res.ok) {
    throw new AdminApiError({ status: res.status, detail: 'No se pudo exportar ganadores CSV' });
  }
  return res.text();
}

// ───────────────────────────── Iteración 6: Reporte de Participación CSV ─────────────────────────────

export async function downloadParticipationCsv(
  token: string,
  countryCode?: string,
): Promise<string> {
  const qs = countryCode ? `?countryCode=${encodeURIComponent(countryCode)}` : '';
  const res = await fetch(`/api/v1/admin/reports/participation.csv${qs}`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!res.ok) {
    throw new AdminApiError({
      status: res.status,
      detail: 'No se pudo exportar el reporte de participación CSV',
    });
  }
  return res.text();
}

/** Indicadores del piloto arcade (ADR-034), por grupo A/B y estilo. */
export interface ArcadePilotReportView {
  countryCode: string;
  from: string;
  to: string;
  abTest: { enabled: boolean; arcadeSharePct: number } | null;
  groups: Record<
    'CONTROL' | 'ARCADE',
    { pharmacies: number; clerksAssigned: number; participationPct: number | null }
  >;
  rows: PilotSummaryRow[];
  verdict: {
    sessionsLiftPct: number;
    accuracyDeltaPts: number;
    return7dDeltaPts: number;
    arcadeAbandonPct: number;
    meetsCriteria: boolean;
  } | null;
}

export async function getArcadePilotReport(
  token: string,
  countryCode: string,
): Promise<ArcadePilotReportView> {
  const res = await fetch(
    `/api/v1/admin/reports/arcade-pilot?countryCode=${encodeURIComponent(countryCode)}`,
    { headers: { Authorization: `Bearer ${token}` } },
  );
  return parseJson<ArcadePilotReportView>(res);
}

export async function downloadArcadePilotCsv(token: string, countryCode: string): Promise<string> {
  const res = await fetch(
    `/api/v1/admin/reports/arcade-pilot.csv?countryCode=${encodeURIComponent(countryCode)}`,
    { headers: { Authorization: `Bearer ${token}` } },
  );
  if (!res.ok) {
    throw new AdminApiError({
      status: res.status,
      detail: 'No se pudo exportar el reporte del piloto',
    });
  }
  return res.text();
}
