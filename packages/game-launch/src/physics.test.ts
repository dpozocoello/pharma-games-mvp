import { describe, expect, it } from 'vitest';
import { MAX_GAME_BUNDLE_KB } from '@pharma/game-sdk';
import launchGame from './index';
import {
  aimGuide,
  clampDrag,
  hits,
  launchVelocity,
  layoutTargets,
  simulate,
  WORLD,
  type Target,
} from './physics';

const four = [{ id: 'a' }, { id: 'b' }, { id: 'c' }, { id: 'd' }];

/** Busca un arrastre permitido (ángulo × fuerza) que alcance el blanco. */
function findShot(target: Target, targets: Target[]) {
  for (let pull = 20; pull <= WORLD.maxPull; pull += 4) {
    for (let deg = 0; deg <= 85; deg += 1) {
      const a = (deg * Math.PI) / 180;
      // Arrastre hacia atrás y abajo → sale hacia adelante y arriba.
      const drag = {
        x: WORLD.anchor.x - Math.cos(a) * pull,
        y: WORLD.anchor.y + Math.sin(a) * pull,
      };
      if (simulate(launchVelocity(drag), targets)?.optionId === target.optionId) return drag;
    }
  }
  return null;
}

describe('Tiro de Muestras: física', () => {
  it('la velocidad sale opuesta al arrastre y se limita a la fuerza máxima', () => {
    const v = launchVelocity({ x: WORLD.anchor.x - 50, y: WORLD.anchor.y + 30 });
    expect(v.x).toBeGreaterThan(0);
    expect(v.y).toBeLessThan(0);
    const far = launchVelocity({ x: WORLD.anchor.x - 500, y: WORLD.anchor.y });
    expect(Math.hypot(far.x, far.y)).toBeCloseTo(WORLD.maxPull * WORLD.power, 5);
    const c = clampDrag({ x: WORLD.anchor.x - 500, y: WORLD.anchor.y });
    expect(Math.hypot(c.x - WORLD.anchor.x, c.y - WORLD.anchor.y)).toBeCloseTo(WORLD.maxPull, 5);
  });

  it('los blancos no se solapan y caben en el escenario', () => {
    for (const set of [four, four.slice(0, 2), four.slice(0, 3)]) {
      const ts = layoutTargets(set);
      for (const t of ts) {
        expect(t.x + t.w).toBeLessThanOrEqual(WORLD.width);
        expect(t.y + t.h).toBeLessThan(WORLD.ground);
      }
      for (let i = 0; i < ts.length; i++)
        for (let j = i + 1; j < ts.length; j++) {
          const a = ts[i]!;
          const b = ts[j]!;
          const sep = a.x + a.w <= b.x || b.x + b.w <= a.x || a.y + a.h <= b.y || b.y + b.h <= a.y;
          expect(sep).toBe(true);
        }
    }
  });

  it('cada opción se puede alcanzar con un lanzamiento permitido (4 opciones y verdadero/falso)', () => {
    for (const set of [four, four.slice(0, 2)]) {
      const ts = layoutTargets(set);
      for (const t of ts) expect(findShot(t, ts), `opción ${t.letter}`).not.toBeNull();
    }
  });

  it('un tiro flojo cae al suelo sin elegir nada', () => {
    const ts = layoutTargets(four);
    expect(simulate(launchVelocity({ x: WORLD.anchor.x - 8, y: WORLD.anchor.y }), ts)).toBeNull();
  });

  it('detecta el contacto círculo-rectángulo en el borde', () => {
    const t = { optionId: 'x', letter: 'A', x: 100, y: 100, w: 20, h: 20 };
    expect(hits({ x: 100 - WORLD.radius + 1, y: 110 }, t)).toBe(true);
    expect(hits({ x: 100 - WORLD.radius - 1, y: 110 }, t)).toBe(false);
  });

  it('la guía de puntería muestra el inicio de la trayectoria, sin revelar dónde termina', () => {
    const pts = aimGuide(launchVelocity({ x: WORLD.anchor.x - 60, y: WORLD.anchor.y + 40 }));
    expect(pts).toHaveLength(9);
    expect(pts.at(-1)!.x).toBeLessThan(WORLD.width * 0.75);
  });
});

describe('Tiro de Muestras: contrato del SDK', () => {
  it('declara su manifiesto dentro del presupuesto de peso', () => {
    expect(launchGame.manifest.id).toBe('launch');
    expect(launchGame.manifest.maxBundleKb).toBeLessThanOrEqual(MAX_GAME_BUNDLE_KB);
  });
});
