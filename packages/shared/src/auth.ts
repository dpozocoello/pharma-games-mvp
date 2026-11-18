import { z } from 'zod';
import { ROLES, type Role } from './constants';
import { countryCodeSchema, pointsRulesSchema, termsSchema } from './schemas';

// ───────────────────────────── Reglas de ingreso ─────────────────────────────

/** Apps cliente. Cada una tiene su propia cookie de refresh y su audiencia en el token. */
export const APP_AUDIENCES = ['pwa', 'admin'] as const;
export type AppAudience = (typeof APP_AUDIENCES)[number];

/** Roles que pueden ingresar a cada app. */
export const AUDIENCE_ROLES: Record<AppAudience, readonly Role[]> = {
  pwa: ['CLERK', 'PHARMACY_MANAGER'],
  admin: ['SUPER_ADMIN', 'COUNTRY_ADMIN', 'CONTENT_EDITOR'],
};

/** Roles que deben aceptar el consentimiento de su país antes de usar la plataforma. */
export const CONSENT_REQUIRED_ROLES: readonly Role[] = ['CLERK', 'PHARMACY_MANAGER'];

/** Roles con acceso al panel de configuración de países. */
export const COUNTRY_CONFIG_ROLES: readonly Role[] = ['SUPER_ADMIN', 'COUNTRY_ADMIN'];

/** CLAUDE.md §10. */
export const OTP_RULES = {
  length: 6,
  ttlSeconds: 5 * 60,
  maxAttempts: 5,
  maxSends: 3,
  sendWindowSeconds: 15 * 60,
} as const;

export const ACCESS_TOKEN_TTL_SECONDS = 15 * 60;
export const REFRESH_TOKEN_TTL_DAYS = 90;

export function canUseApp(role: Role, app: AppAudience): boolean {
  return AUDIENCE_ROLES[app].includes(role);
}

// ───────────────────────────── Normalización ─────────────────────────────

/** Documento de identidad normalizado antes de calcular su HMAC: mayúsculas y solo alfanuméricos. */
export function normalizeDocument(input: string): string {
  return input
    .normalize('NFKC')
    .toUpperCase()
    .replace(/[^0-9A-Z]/g, '');
}

const E164 = /^\+[1-9]\d{7,14}$/;

/**
 * Convierte lo que escribe el usuario a E.164 usando el prefijo de su país.
 * Acepta "+51 900 000 001", "0051900000001", "900000001" o "0991234567" (cero troncal).
 * Devuelve null si el resultado no es un E.164 válido.
 */
export function normalizePhone(input: string, phonePrefix: string): string | null {
  const raw = input.trim().replace(/[\s().-]/g, '');
  let e164: string;
  if (raw.startsWith('+')) e164 = raw;
  else if (raw.startsWith('00')) e164 = `+${raw.slice(2)}`;
  else e164 = `${phonePrefix}${raw.replace(/^0+/, '')}`;
  return E164.test(e164) ? e164 : null;
}

/** Teléfono enmascarado para interfaces y registros: "+51•••••001". */
export function maskPhone(e164: string): string {
  if (e164.length < 7) return '•••';
  return `${e164.slice(0, 3)}•••••${e164.slice(-3)}`;
}

// ───────────────────────────── Esquemas de la API ─────────────────────────────

export const appAudienceSchema = z.enum(APP_AUDIENCES);

export const identifierSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('phone'), value: z.string().trim().min(6).max(24) }).strict(),
  z.object({ type: z.literal('document'), value: z.string().trim().min(3).max(32) }).strict(),
]);
export type Identifier = z.infer<typeof identifierSchema>;

const otpBase = z.object({
  app: appAudienceSchema,
  /** País elegido en la PWA. Obligatorio para ingresar con documento. */
  countryCode: countryCodeSchema.optional(),
  identifier: identifierSchema,
});

const documentNeedsCountry = (v: { countryCode?: string; identifier: Identifier }) =>
  v.identifier.type !== 'document' || v.countryCode !== undefined;
const documentNeedsCountryMsg = {
  message: 'Elige tu país para ingresar con documento',
  path: ['countryCode'],
};

export const otpRequestSchema = otpBase
  .strict()
  .refine(documentNeedsCountry, documentNeedsCountryMsg);
export type OtpRequest = z.infer<typeof otpRequestSchema>;

export const otpVerifySchema = otpBase
  .extend({ code: z.string().regex(/^\d{6}$/, 'El código tiene 6 dígitos') })
  .strict()
  .refine(documentNeedsCountry, documentNeedsCountryMsg);
export type OtpVerify = z.infer<typeof otpVerifySchema>;

/** Respuesta idéntica exista o no la cuenta (no revela qué números están registrados). */
export interface OtpRequestResponse {
  status: 'SENT_IF_REGISTERED';
  expiresInSeconds: number;
}

export const consentAcceptSchema = z.object({ consentVersionId: z.string().uuid() }).strict();
export type ConsentAccept = z.infer<typeof consentAcceptSchema>;

export interface MeCountry {
  code: string;
  name: string;
  locale: string;
  terms: Record<string, string>;
}

export interface MeResponse {
  id: string;
  displayName: string;
  role: Role;
  phoneMasked: string;
  /** Nulo solo para SUPER_ADMIN. */
  country: MeCountry | null;
  /** País fijado: no puede cambiarse desde la app. */
  countryLocked: boolean;
  pharmacy: { id: string; name: string } | null;
  consent: {
    required: boolean;
    accepted: boolean;
    current: { id: string; version: number; text: string } | null;
  };
}

export interface AuthTokenResponse {
  accessToken: string;
  expiresInSeconds: number;
  me: MeResponse;
}

// ───────────────────────────── Administración de países ─────────────────────────────

export function isValidTimeZone(tz: string): boolean {
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: tz });
    return true;
  } catch {
    return false;
  }
}

export const countryCreateSchema = z
  .object({
    code: countryCodeSchema,
    name: z.string().trim().min(2).max(60),
    locale: z.string().regex(/^[a-z]{2}-[A-Z]{2}$/, 'Locale con formato es-PE'),
    timezone: z.string().refine(isValidTimeZone, 'Zona horaria IANA inválida'),
    phonePrefix: z.string().regex(/^\+[1-9]\d{0,3}$/, 'Prefijo con formato +51'),
  })
  .strict();
export type CountryCreate = z.infer<typeof countryCreateSchema>;

export const countryPatchSchema = z
  .object({ active: z.boolean().optional(), name: z.string().trim().min(2).max(60).optional() })
  .strict()
  .refine((v) => Object.keys(v).length > 0, 'Sin cambios');
export type CountryPatch = z.infer<typeof countryPatchSchema>;

export const consentVersionCreateSchema = z
  .object({ text: z.string().trim().min(50).max(20_000) })
  .strict();
export type ConsentVersionCreate = z.infer<typeof consentVersionCreateSchema>;

export const brandActivationSchema = z.object({ active: z.boolean() }).strict();

export const roleSchema = z.enum(ROLES);

export interface AdminCountrySummary {
  code: string;
  name: string;
  locale: string;
  timezone: string;
  phonePrefix: string;
  active: boolean;
}

export interface CountryConfigView {
  country: AdminCountrySummary;
  terms: z.infer<typeof termsSchema>;
  pointsRules: z.infer<typeof pointsRulesSchema>;
  rankingPeriodMonths: 1 | 2 | 3;
  consent: { id: string; version: number; text: string; publishedAt: string } | null;
  brands: { brandId: string; slug: string; name: string; active: boolean }[];
  currentPeriod: { id: string; startsAt: string; endsAt: string } | null;
  updatedAt: string;
}
