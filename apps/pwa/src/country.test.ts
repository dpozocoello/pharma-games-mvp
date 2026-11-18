import { describe, expect, it } from 'vitest';
import { readChosenCountry, saveChosenCountry } from './country';

function memoryStorage() {
  const m = new Map<string, string>();
  return {
    getItem: (k: string) => m.get(k) ?? null,
    setItem: (k: string, v: string) => void m.set(k, v),
  };
}

describe('país elegido', () => {
  it('guarda y lee un país válido', () => {
    const s = memoryStorage();
    saveChosenCountry(s, 'PE');
    expect(readChosenCountry(s)).toBe('PE');
  });

  it('ignora valores manipulados', () => {
    const s = memoryStorage();
    s.setItem('pharma.country', 'XX');
    expect(readChosenCountry(s)).toBeNull();
  });

  it('tolera un almacenamiento que lanza errores', () => {
    const broken = {
      getItem: () => {
        throw new Error('bloqueado');
      },
    };
    expect(readChosenCountry(broken)).toBeNull();
  });
});
