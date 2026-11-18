import { describe, expect, it } from 'vitest';
import {
  DEFAULT_POINTS_RULES,
  canTransitionQuestion,
  countryConfigSchema,
  pointsRulesSchema,
  publicQuestionSchema,
  questionSchema,
  toPublicQuestion,
} from './schemas';
import { t } from './i18n';

describe('pointsRulesSchema', () => {
  it('acepta los valores por defecto', () => {
    expect(pointsRulesSchema.parse(DEFAULT_POINTS_RULES)).toEqual(DEFAULT_POINTS_RULES);
  });

  it('rechaza claves desconocidas', () => {
    expect(() => pointsRulesSchema.parse({ ...DEFAULT_POINTS_RULES, extra: 1 })).toThrow();
  });

  it('rechaza un tope por marca mayor al tope por usuario', () => {
    const r = pointsRulesSchema.safeParse({ ...DEFAULT_POINTS_RULES, dailyCapPerBrand: 999 });
    expect(r.success).toBe(false);
  });
});

describe('countryConfigSchema', () => {
  it('solo permite periodos de 1, 2 o 3 meses', () => {
    const base = { terms: {}, pointsRules: DEFAULT_POINTS_RULES };
    expect(countryConfigSchema.safeParse({ ...base, rankingPeriodMonths: 2 }).success).toBe(true);
    expect(countryConfigSchema.safeParse({ ...base, rankingPeriodMonths: 4 }).success).toBe(false);
  });
});

describe('questionSchema', () => {
  const mc = {
    type: 'MULTIPLE_CHOICE' as const,
    prompt: '¿De qué color es el empaque de Marca A?',
    options: [
      { id: 'a', text: 'Azul' },
      { id: 'b', text: 'Verde' },
      { id: 'c', text: 'Rojo' },
    ],
    correctAnswer: 'a',
  };

  it('acepta una pregunta válida de opción múltiple', () => {
    expect(questionSchema.safeParse(mc).success).toBe(true);
  });

  it('rechaza una respuesta correcta que no está en las opciones', () => {
    expect(questionSchema.safeParse({ ...mc, correctAnswer: 'z' }).success).toBe(false);
  });

  it('exige TRUE y FALSE en verdadero/falso', () => {
    const tf = {
      type: 'TRUE_FALSE' as const,
      prompt: 'Marca A tiene empaque azul.',
      options: [
        { id: 'TRUE', text: 'Verdadero' },
        { id: 'FALSE', text: 'Falso' },
      ],
      correctAnswer: 'TRUE',
    };
    expect(questionSchema.safeParse(tf).success).toBe(true);
    expect(
      questionSchema.safeParse({
        ...tf,
        options: [
          { id: 'TRUE', text: 'Verdadero' },
          { id: 'X', text: 'Otro' },
        ],
      }).success,
    ).toBe(false);
  });
});

describe('toPublicQuestion', () => {
  it('elimina la respuesta correcta y cualquier campo extra', () => {
    const q = {
      id: '0193a1b2-c3d4-7e5f-8a9b-0c1d2e3f4a5b',
      type: 'MULTIPLE_CHOICE' as const,
      prompt: '¿Pregunta?',
      options: [{ id: 'a', text: 'A', isCorrect: true }],
      correctAnswer: 'a',
    };
    const pub = toPublicQuestion(q);
    expect(JSON.stringify(pub)).not.toMatch(/correct/i);
    expect(publicQuestionSchema.safeParse(pub).success).toBe(true);
  });
});

describe('flujo editorial', () => {
  it('no permite publicar directamente desde borrador', () => {
    expect(canTransitionQuestion('DRAFT', 'PUBLISHED')).toBe(false);
    expect(canTransitionQuestion('IN_REVIEW', 'PUBLISHED')).toBe(true);
  });
});

describe('i18n', () => {
  it('aplica términos locales sobre la base', () => {
    expect(t('term.clerk')).toBe('dependiente');
    expect(t('term.clerk', { 'term.clerk': 'despachador' })).toBe('despachador');
  });
});
