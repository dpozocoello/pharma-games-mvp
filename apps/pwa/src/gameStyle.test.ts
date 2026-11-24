import type { GameExperience } from '@pharma/shared';
import { describe, expect, it } from 'vitest';
import { pickGameStyle, saveGameStyle } from './gameStyle';

const mem = () => {
  const m = new Map<string, string>();
  return {
    getItem: (k: string) => m.get(k) ?? null,
    setItem: (k: string, v: string) => void m.set(k, v),
  };
};
const arcade: GameExperience = {
  group: 'ARCADE',
  styles: ['PLATFORM', 'LAUNCH'],
  defaultStyle: 'PLATFORM',
};
const control: GameExperience = { group: 'CONTROL', styles: ['CLASSIC'], defaultStyle: 'CLASSIC' };

describe('estilo de juego en la PWA', () => {
  it('usa el estilo por defecto del grupo y recuerda la preferencia permitida', () => {
    const s = mem();
    expect(pickGameStyle(arcade, s)).toBe('PLATFORM');
    saveGameStyle('LAUNCH', s);
    expect(pickGameStyle(arcade, s)).toBe('LAUNCH');
  });
  it('ignora una preferencia que el servidor no permite (grupo de control)', () => {
    const s = mem();
    saveGameStyle('LAUNCH', s);
    expect(pickGameStyle(control, s)).toBe('CLASSIC');
  });
  it('tolera almacenamiento que falla', () => {
    const broken = {
      getItem: () => {
        throw new Error('x');
      },
      setItem: () => {
        throw new Error('x');
      },
    };
    expect(pickGameStyle(arcade, broken)).toBe('PLATFORM');
    expect(() => saveGameStyle('PLATFORM', broken)).not.toThrow();
  });
});
