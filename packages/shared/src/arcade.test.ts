import { describe, expect, it } from 'vitest';
import {
  DEFAULT_ARCADE_RULES,
  experimentGroupFor,
  gameExperienceFor,
  rulesForStyle,
  startSessionSchema,
} from './arcade';
import { DEFAULT_POINTS_RULES, pointsRulesSchema } from './schemas';

const ab = DEFAULT_ARCADE_RULES.abTest;
const ids = Array.from(
  { length: 2000 },
  (_, i) => `01900000-0000-7000-8000-${String(i).padStart(12, '0')}`,
);

describe('asignación A/B por farmacia', () => {
  it('es determinista: la misma farmacia cae siempre en el mismo grupo', () => {
    for (const id of ids.slice(0, 50))
      expect(experimentGroupFor(id, ab)).toBe(experimentGroupFor(id, ab));
  });

  it('respeta la proporción configurada (50 % ± 4 puntos en 2.000 farmacias)', () => {
    const arcade = ids.filter((id) => experimentGroupFor(id, ab) === 'ARCADE').length;
    expect(arcade / ids.length).toBeGreaterThan(0.46);
    expect(arcade / ids.length).toBeLessThan(0.54);
    expect(
      ids.every((id) => experimentGroupFor(id, { ...ab, arcadeSharePct: 0 }) === 'CONTROL'),
    ).toBe(true);
    expect(
      ids.every((id) => experimentGroupFor(id, { ...ab, arcadeSharePct: 100 }) === 'ARCADE'),
    ).toBe(true);
  });

  it('otra semilla reasigna las farmacias', () => {
    const changed = ids.filter(
      (id) => experimentGroupFor(id, ab) !== experimentGroupFor(id, { ...ab, salt: 'otro' }),
    );
    expect(changed.length).toBeGreaterThan(ids.length * 0.3);
  });
});

describe('experiencia de juego', () => {
  it('país sin arcade: solo clásico y sin grupo', () => {
    expect(gameExperienceFor(DEFAULT_POINTS_RULES, ids[0]!)).toEqual({
      group: null,
      styles: ['CLASSIC'],
      defaultStyle: 'CLASSIC',
    });
    const off = { ...DEFAULT_POINTS_RULES, arcade: { ...DEFAULT_ARCADE_RULES, enabled: false } };
    expect(gameExperienceFor(off, ids[0]!).styles).toEqual(['CLASSIC']);
  });

  it('arcade sin experimento: los tres estilos', () => {
    const rules = { arcade: { ...DEFAULT_ARCADE_RULES, abTest: { ...ab, enabled: false } } };
    expect(gameExperienceFor(rules, ids[0]!)).toEqual({
      group: null,
      styles: ['CLASSIC', 'PLATFORM', 'LAUNCH'],
      defaultStyle: 'CLASSIC',
    });
  });

  it('experimento: control solo clásico, arcade solo estilos arcade; sin farmacia → control', () => {
    const rules = { arcade: DEFAULT_ARCADE_RULES };
    const arcadeId = ids.find((id) => experimentGroupFor(id, ab) === 'ARCADE')!;
    const controlId = ids.find((id) => experimentGroupFor(id, ab) === 'CONTROL')!;
    expect(gameExperienceFor(rules, arcadeId)).toEqual({
      group: 'ARCADE',
      styles: ['PLATFORM', 'LAUNCH'],
      defaultStyle: 'PLATFORM',
    });
    expect(gameExperienceFor(rules, controlId).styles).toEqual(['CLASSIC']);
    expect(gameExperienceFor(rules, null).group).toBe('CONTROL');
  });
});

describe('reglas por estilo', () => {
  const rules = { ...DEFAULT_POINTS_RULES, arcade: DEFAULT_ARCADE_RULES };
  it('arcade usa sus segundos por pregunta; clásico conserva los del país', () => {
    expect(rulesForStyle(rules, 'PLATFORM').secondsPerQuestion).toBe(30);
    expect(rulesForStyle(rules, 'LAUNCH').secondsPerQuestion).toBe(30);
    expect(rulesForStyle(rules, 'CLASSIC').secondsPerQuestion).toBe(20);
    expect(rulesForStyle(DEFAULT_POINTS_RULES, 'PLATFORM').secondsPerQuestion).toBe(20);
  });
  it('no cambia preguntas por partida ni puntos por acierto (puntajes comparables)', () => {
    const r = rulesForStyle(rules, 'PLATFORM');
    expect(r.questionsPerSession).toBe(rules.questionsPerSession);
    expect(r.pointsPerCorrect).toBe(rules.pointsPerCorrect);
  });
});

describe('esquemas', () => {
  it('pointsRules acepta arcade opcional y rechaza valores fuera de rango', () => {
    expect(pointsRulesSchema.safeParse(DEFAULT_POINTS_RULES).success).toBe(true);
    expect(
      pointsRulesSchema.safeParse({ ...DEFAULT_POINTS_RULES, arcade: DEFAULT_ARCADE_RULES })
        .success,
    ).toBe(true);
    const bad = { ...DEFAULT_ARCADE_RULES, abTest: { ...ab, arcadeSharePct: 120 } };
    expect(pointsRulesSchema.safeParse({ ...DEFAULT_POINTS_RULES, arcade: bad }).success).toBe(
      false,
    );
  });
  it('el estilo de inicio es opcional y cerrado a valores conocidos', () => {
    expect(startSessionSchema.parse({})).toEqual({});
    expect(startSessionSchema.parse({ style: 'LAUNCH' })).toEqual({ style: 'LAUNCH' });
    expect(startSessionSchema.safeParse({ style: 'OTRO' }).success).toBe(false);
  });
});
