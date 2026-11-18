/**
 * Textos base en español. Cada país puede sobrescribir términos con CountryConfig.terms
 * (por ejemplo, "dependiente" frente a "despachador"). Preparado para más idiomas.
 */
export const BASE_MESSAGES = {
  es: {
    'app.title': 'Juega y aprende',
    'country.choose': 'Elige tu país',
    'term.clerk': 'dependiente',
    'term.pharmacy': 'farmacia',
    'term.points': 'puntos',
  },
} as const;

export type BaseLocale = keyof typeof BASE_MESSAGES;
export type MessageKey = keyof (typeof BASE_MESSAGES)['es'];

/** Resuelve un texto aplicando primero los términos del país y luego la base. */
export function t(
  key: MessageKey,
  terms: Record<string, string> = {},
  locale: BaseLocale = 'es',
): string {
  return terms[key] ?? BASE_MESSAGES[locale][key];
}
