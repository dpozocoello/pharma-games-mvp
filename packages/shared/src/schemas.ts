import { z } from 'zod';
import {
  COUNTRY_CODES,
  QUESTION_STATUS_TRANSITIONS,
  QUESTION_TYPES,
  TRUE_FALSE_OPTIONS,
  type QuestionStatus,
  type QuestionType,
} from './constants';

export const countryCodeSchema = z.enum(COUNTRY_CODES);

/** Reglas de puntos y juego justo por país (CLAUDE.md §9). */
export const pointsRulesSchema = z
  .object({
    pointsPerCorrect: z.number().int().min(0).max(1000),
    speedBonusMax: z.number().int().min(0).max(1000),
    questionsPerSession: z.number().int().min(1).max(50),
    secondsPerQuestion: z.number().int().min(5).max(300),
    maxSessionsPerGamePerDay: z.number().int().min(1).max(100),
    dailyCapPerUser: z.number().int().min(0),
    dailyCapPerBrand: z.number().int().min(0),
    minAnswerMs: z.number().int().min(0),
    anomaly: z
      .object({
        minSessionMsPerQuestion: z.number().int().min(0),
        perfectStreakSessions: z.number().int().min(1),
        maxSessionsPerHour: z.number().int().min(1),
      })
      .strict(),
  })
  .strict()
  .refine((r) => r.dailyCapPerBrand <= r.dailyCapPerUser, {
    message: 'dailyCapPerBrand no puede superar dailyCapPerUser',
    path: ['dailyCapPerBrand'],
  });
export type PointsRules = z.infer<typeof pointsRulesSchema>;

export const DEFAULT_POINTS_RULES: PointsRules = {
  pointsPerCorrect: 10,
  speedBonusMax: 5,
  questionsPerSession: 10,
  secondsPerQuestion: 20,
  maxSessionsPerGamePerDay: 3,
  dailyCapPerUser: 300,
  dailyCapPerBrand: 120,
  minAnswerMs: 800,
  anomaly: { minSessionMsPerQuestion: 1500, perfectStreakSessions: 5, maxSessionsPerHour: 10 },
};

/** Diccionario de términos locales: clave → texto. */
export const termsSchema = z.record(z.string().min(1).max(64), z.string().max(500));
export type Terms = z.infer<typeof termsSchema>;

export const rankingPeriodMonthsSchema = z.union([z.literal(1), z.literal(2), z.literal(3)]);

export const countryConfigSchema = z
  .object({
    terms: termsSchema,
    pointsRules: pointsRulesSchema,
    rankingPeriodMonths: rankingPeriodMonthsSchema,
  })
  .strict();
export type CountryConfigInput = z.infer<typeof countryConfigSchema>;

export const hexColorSchema = z.string().regex(/^#[0-9a-fA-F]{6}$/);

export const brandThemeSchema = z
  .object({
    primary: hexColorSchema,
    secondary: hexColorSchema,
    logoUrl: z.string().max(500),
  })
  .strict();
export type BrandTheme = z.infer<typeof brandThemeSchema>;

export const questionOptionSchema = z.object({
  id: z.string().min(1).max(8),
  text: z.string().min(1).max(300),
});
export type QuestionOption = z.infer<typeof questionOptionSchema>;

/** Pregunta tal como se guarda (incluye la respuesta correcta). Solo servidor. */
export const questionSchema = z
  .object({
    type: z.enum(QUESTION_TYPES),
    prompt: z.string().min(5).max(500),
    options: z.array(questionOptionSchema).min(2).max(6),
    correctAnswer: z.string().min(1).max(8),
  })
  .superRefine((q, ctx) => {
    const ids = q.options.map((o) => o.id);
    if (new Set(ids).size !== ids.length) {
      ctx.addIssue({ code: 'custom', path: ['options'], message: 'IDs de opción duplicados' });
    }
    if (!ids.includes(q.correctAnswer)) {
      ctx.addIssue({
        code: 'custom',
        path: ['correctAnswer'],
        message: 'La respuesta correcta debe ser una de las opciones',
      });
    }
    if (q.type === 'TRUE_FALSE') {
      const ok = ids.length === 2 && TRUE_FALSE_OPTIONS.every((v) => ids.includes(v));
      if (!ok) {
        ctx.addIssue({
          code: 'custom',
          path: ['options'],
          message: 'Verdadero/falso requiere exactamente las opciones TRUE y FALSE',
        });
      }
    }
    if (q.type === 'MULTIPLE_CHOICE' && ids.length < 3) {
      ctx.addIssue({
        code: 'custom',
        path: ['options'],
        message: 'Opción múltiple requiere al menos 3 opciones',
      });
    }
  });
export type QuestionInput = z.infer<typeof questionSchema>;

/** Pregunta que viaja al cliente: NUNCA incluye la respuesta correcta. */
export const publicQuestionSchema = z
  .object({
    id: z.string().uuid(),
    type: z.enum(QUESTION_TYPES),
    prompt: z.string(),
    options: z.array(questionOptionSchema.strict()),
  })
  .strict();
export type PublicQuestion = z.infer<typeof publicQuestionSchema>;

/** Proyecta una pregunta del servidor a su forma pública (lista blanca de campos). */
export function toPublicQuestion(q: {
  id: string;
  type: QuestionType;
  prompt: string;
  options: QuestionOption[];
}): PublicQuestion {
  return publicQuestionSchema.parse({
    id: q.id,
    type: q.type,
    prompt: q.prompt,
    options: q.options.map((o) => ({ id: o.id, text: o.text })),
  });
}

export function canTransitionQuestion(from: QuestionStatus, to: QuestionStatus): boolean {
  return QUESTION_STATUS_TRANSITIONS[from].includes(to);
}

/** Teléfono en formato E.164. */
export const phoneE164Schema = z.string().regex(/^\+[1-9]\d{7,14}$/, 'Teléfono E.164 inválido');

export const publicCountrySchema = z.object({
  code: countryCodeSchema,
  name: z.string(),
  locale: z.string(),
});
export type PublicCountry = z.infer<typeof publicCountrySchema>;
