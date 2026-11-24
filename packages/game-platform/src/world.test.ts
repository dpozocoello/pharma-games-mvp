import { describe, expect, it } from 'vitest';
import { MAX_GAME_BUNDLE_KB } from '@pharma/game-sdk';
import platformGame from './index';
import { boxAbove, jumpHeight, layoutBoxes, spawnPlayer, step, WORLD, type Player } from './world';

const none = { left: false, right: false, jump: false };
const opts4 = [{ id: 'a' }, { id: 'b' }, { id: 'c' }, { id: 'd' }];

/** Corre la simulación hasta que golpea una caja o pasa el tiempo. */
function runUntilHit(p: Player, input: typeof none, seconds = 2) {
  const boxes = layoutBoxes(opts4);
  let player = p;
  let first = true;
  for (let t = 0; t < seconds; t += 1 / 60) {
    const r = step(player, first ? input : { ...input, jump: false }, 1 / 60, boxes);
    first = false;
    player = r.player;
    if (r.hit) return { hit: r.hit, player };
  }
  return { hit: null, player };
}

describe('Ruta del Mostrador: mundo', () => {
  it('reparte una caja por opción sin solaparse y dentro del escenario', () => {
    const boxes = layoutBoxes(opts4);
    expect(boxes.map((b) => b.letter)).toEqual(['A', 'B', 'C', 'D']);
    for (let i = 1; i < boxes.length; i++) {
      expect(boxes[i]!.x).toBeGreaterThanOrEqual(boxes[i - 1]!.x + boxes[i - 1]!.w);
    }
    expect(boxes.at(-1)!.x + boxes.at(-1)!.w).toBeLessThanOrEqual(WORLD.width);
  });

  it('un salto desde el piso alcanza la base de las cajas', () => {
    const headAtRest = WORLD.ground - WORLD.player.h;
    expect(headAtRest - jumpHeight()).toBeLessThan(WORLD.box.bottom);
  });

  it('saltar debajo de una caja la golpea y elige esa opción', () => {
    const boxes = layoutBoxes(opts4);
    const target = boxes[2]!;
    const p = { ...spawnPlayer(), x: target.x + target.w / 2 - WORLD.player.w / 2 };
    expect(boxAbove(p, boxes)?.optionId).toBe('c');
    const { hit, player } = runUntilHit(p, { ...none, jump: true });
    expect(hit?.optionId).toBe('c');
    expect(player.vy).toBe(0); // rebota al golpear
  });

  it('saltar entre dos cajas no elige ninguna', () => {
    const boxes = layoutBoxes(opts4);
    const gapX = (boxes[0]!.x + boxes[0]!.w + boxes[1]!.x) / 2 - WORLD.player.w / 2;
    const { hit } = runUntilHit({ ...spawnPlayer(), x: gapX }, { ...none, jump: true });
    expect(hit).toBeNull();
  });

  it('no sale del escenario ni atraviesa el piso', () => {
    let p = { ...spawnPlayer(), x: 2 };
    for (let i = 0; i < 120; i++) p = step(p, { ...none, left: true }, 1 / 60, []).player;
    expect(p.x).toBe(0);
    expect(p.y + p.h).toBe(WORLD.ground);
    expect(p.onGround).toBe(true);
  });

  it('verdadero/falso: dos cajas más anchas de separación', () => {
    const boxes = layoutBoxes([{ id: 'TRUE' }, { id: 'FALSE' }]);
    expect(boxes.map((b) => b.optionId)).toEqual(['TRUE', 'FALSE']);
    expect(boxes[1]!.x - (boxes[0]!.x + boxes[0]!.w)).toBeGreaterThan(100);
  });
});

describe('Ruta del Mostrador: contrato del SDK', () => {
  it('declara su manifiesto dentro del presupuesto de peso', () => {
    expect(platformGame.manifest.id).toBe('platform');
    expect(platformGame.manifest.maxBundleKb).toBeLessThanOrEqual(MAX_GAME_BUNDLE_KB);
    expect(typeof platformGame.mount).toBe('function');
  });
});
