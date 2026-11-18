/**
 * Países de las semillas y del piloto. Agregar un país NO requiere tocar esta lista: se da de alta
 * desde el panel (`POST /admin/countries`); la lista solo alimenta las semillas de desarrollo.
 */
export const COUNTRY_CODES = ['CO', 'EC', 'PE'] as const;
export type CountryCode = (typeof COUNTRY_CODES)[number];

export const COUNTRY_DEFAULTS: Record<
  CountryCode,
  { name: string; locale: string; timezone: string; phonePrefix: string }
> = {
  CO: { name: 'Colombia', locale: 'es-CO', timezone: 'America/Bogota', phonePrefix: '+57' },
  EC: { name: 'Ecuador', locale: 'es-EC', timezone: 'America/Guayaquil', phonePrefix: '+593' },
  PE: { name: 'Perú', locale: 'es-PE', timezone: 'America/Lima', phonePrefix: '+51' },
};

export const ROLES = [
  'SUPER_ADMIN',
  'COUNTRY_ADMIN',
  'CONTENT_EDITOR',
  'PHARMACY_MANAGER',
  'CLERK',
] as const;
export type Role = (typeof ROLES)[number];

export const USER_STATUSES = ['ACTIVE', 'INACTIVE'] as const;
export type UserStatus = (typeof USER_STATUSES)[number];

export const QUESTION_TYPES = ['MULTIPLE_CHOICE', 'TRUE_FALSE'] as const;
export type QuestionType = (typeof QUESTION_TYPES)[number];

export const QUESTION_STATUSES = ['DRAFT', 'IN_REVIEW', 'PUBLISHED', 'ARCHIVED'] as const;
export type QuestionStatus = (typeof QUESTION_STATUSES)[number];

/** Transiciones permitidas del flujo editorial. */
export const QUESTION_STATUS_TRANSITIONS: Record<QuestionStatus, readonly QuestionStatus[]> = {
  DRAFT: ['IN_REVIEW', 'ARCHIVED'],
  IN_REVIEW: ['DRAFT', 'PUBLISHED', 'ARCHIVED'],
  PUBLISHED: ['ARCHIVED'],
  ARCHIVED: [],
};

export const GAME_MECHANICS = ['MULTIPLE_CHOICE', 'TRUE_FALSE'] as const;
export type GameMechanic = (typeof GAME_MECHANICS)[number];

export const LEDGER_REASONS = ['GAME', 'BONUS', 'REVERSAL'] as const;
export type LedgerReason = (typeof LEDGER_REASONS)[number];

export const RANKING_SCOPES = ['INDIVIDUAL', 'PHARMACY', 'COUNTRY'] as const;
export type RankingScope = (typeof RANKING_SCOPES)[number];

export const RANKING_PERIOD_MONTHS = [1, 2, 3] as const;
export type RankingPeriodMonths = (typeof RANKING_PERIOD_MONTHS)[number];

export const TRUE_FALSE_OPTIONS = ['TRUE', 'FALSE'] as const;
