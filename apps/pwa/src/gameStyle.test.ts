import { describe, expect, it } from 'vitest';
import { readGameStyle, saveGameStyle } from './gameStyle';

const mem = () => {
  const m = new Map<string, string>();
  return {
    getItem: (k: string) => m.get(k) ?? null,
    setItem: (k: string, v: string) => void m.set(k, v),
  };
};

describe('preferencia de estilo de juego', () => {
  it('por defecto es clásico y guarda la elección', () => {
    const s = mem();
    expect(readGameStyle(s)).toBe('classic');
    saveGameStyle('launch', s);
    expect(readGameStyle(s)).toBe('launch');
  });
  it('ignora valores desconocidos y almacenamiento que falla', () => {
    const s = mem();
    s.setItem('pharma.gameStyle', 'otro');
    expect(readGameStyle(s)).toBe('classic');
    const broken = {
      getItem: () => {
        throw new Error('x');
      },
      setItem: () => {
        throw new Error('x');
      },
    };
    expect(readGameStyle(broken)).toBe('classic');
    expect(() => saveGameStyle('platform', broken)).not.toThrow();
  });
});
