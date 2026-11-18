import { questionSchema } from '@pharma/shared';
import { describe, expect, it } from 'vitest';
import {
  SEED_BRANDS,
  consentText,
  fakePhone,
  generateBrandQuestions,
  seedPharmacies,
} from './seed-data';

describe('distribución de marcas', () => {
  it('9 marcas y 14 combinaciones marca-país: CO 5, EC 5, PE 4', () => {
    expect(SEED_BRANDS).toHaveLength(9);
    const per = { CO: 0, EC: 0, PE: 0 };
    for (const b of SEED_BRANDS) for (const c of b.countries) per[c]++;
    expect(per).toEqual({ CO: 5, EC: 5, PE: 4 });
  });

  it('2 en los tres países, 1 en EC y PE, 3 solo CO, 2 solo EC, 1 solo PE', () => {
    const key = (cs: string[]) => [...cs].sort().join('+');
    const groups: Record<string, number> = {};
    for (const b of SEED_BRANDS) groups[key(b.countries)] = (groups[key(b.countries)] ?? 0) + 1;
    expect(groups).toEqual({ 'CO+EC+PE': 2, 'EC+PE': 1, CO: 3, EC: 2, PE: 1 });
  });

  it('solo usa nombres ficticios', () => {
    for (const b of SEED_BRANDS) expect(b.name).toMatch(/^Marca [A-I]$/);
  });
});

describe('preguntas generadas', () => {
  it('60 preguntas válidas y únicas por marca, deterministas', () => {
    SEED_BRANDS.forEach((b, i) => {
      const qs = generateBrandQuestions(i, b.name);
      expect(qs).toHaveLength(60);
      for (const q of qs) expect(questionSchema.safeParse(q).success).toBe(true);
      expect(new Set(qs.map((q) => q.prompt)).size).toBe(60);
      expect(generateBrandQuestions(i, b.name)).toEqual(qs);
    });
  });

  it('mezcla ambas mecánicas', () => {
    const qs = generateBrandQuestions(0, 'Marca A');
    expect(qs.filter((q) => q.type === 'MULTIPLE_CHOICE')).toHaveLength(30);
    expect(qs.filter((q) => q.type === 'TRUE_FALSE')).toHaveLength(30);
  });
});

describe('farmacias, teléfonos y consentimiento', () => {
  it('3 farmacias por país con código externo único', () => {
    const ph = seedPharmacies('PE');
    expect(ph).toHaveLength(3);
    expect(new Set(ph.map((p) => p.externalCode)).size).toBe(3);
  });

  it('teléfonos E.164 ficticios y únicos', () => {
    const all = (['CO', 'EC', 'PE'] as const).flatMap((c) =>
      Array.from({ length: 20 }, (_, i) => fakePhone(c, i + 1)),
    );
    expect(new Set(all).size).toBe(60);
    for (const p of all) expect(p).toMatch(/^\+[1-9]\d{7,14}$/);
  });

  it('el consentimiento cita la ley de cada país', () => {
    expect(consentText('CO')).toContain('1581');
    expect(consentText('PE')).toContain('29733');
    expect(consentText('EC')).toContain('Ecuador');
  });
});
