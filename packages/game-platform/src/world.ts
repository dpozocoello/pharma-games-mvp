/**
 * Lógica pura de «Ruta del Mostrador» (plataformas): sin DOM ni Canvas, para poder probarla.
 * Coordenadas lógicas en px de un escenario de 360×400; el tiempo en segundos.
 */
export const WORLD = {
  width: 360,
  height: 400,
  /** Altura del piso (y crece hacia abajo). */
  ground: 352,
  gravity: 1900,
  jumpVelocity: -760,
  runSpeed: 190,
  player: { w: 26, h: 38 },
  box: { w: 54, h: 40, bottom: 212 },
} as const;

export interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}
export interface OptionBox extends Rect {
  optionId: string;
  letter: string;
}
export interface Player extends Rect {
  vx: number;
  vy: number;
  onGround: boolean;
}
export interface Input {
  left: boolean;
  right: boolean;
  jump: boolean;
}

export const LETTERS = ['A', 'B', 'C', 'D', 'E', 'F'];

/** Una caja por opción, repartidas a lo ancho y a una altura que se alcanza de un salto. */
export function layoutBoxes(options: { id: string }[], width: number = WORLD.width): OptionBox[] {
  const n = Math.max(1, options.length);
  const slot = width / n;
  return options.map((o, i) => ({
    optionId: o.id,
    letter: LETTERS[i] ?? String(i + 1),
    w: WORLD.box.w,
    h: WORLD.box.h,
    x: Math.round(slot * i + (slot - WORLD.box.w) / 2),
    y: WORLD.box.bottom - WORLD.box.h,
  }));
}

export function spawnPlayer(width: number = WORLD.width): Player {
  return {
    x: Math.round(width / 2 - WORLD.player.w / 2),
    y: WORLD.ground - WORLD.player.h,
    w: WORLD.player.w,
    h: WORLD.player.h,
    vx: 0,
    vy: 0,
    onGround: true,
  };
}

/** Altura máxima que sube la cabeza en un salto, en px (v² / 2g). */
export function jumpHeight(): number {
  return (WORLD.jumpVelocity * WORLD.jumpVelocity) / (2 * WORLD.gravity);
}

const overlapsX = (a: Rect, b: Rect) => a.x < b.x + b.w && a.x + a.w > b.x;

/**
 * Avanza un paso de simulación. Las cajas son sólidas: desde abajo se golpean (eso elige la
 * opción) y desde arriba se puede pararse sobre ellas. Devuelve la caja golpeada, si hubo.
 */
export function step(
  p: Player,
  input: Input,
  dt: number,
  boxes: readonly OptionBox[],
  width: number = WORLD.width,
): { player: Player; hit: OptionBox | null } {
  const next: Player = { ...p };
  next.vx = (input.right ? 1 : 0) * WORLD.runSpeed - (input.left ? 1 : 0) * WORLD.runSpeed;
  if (input.jump && next.onGround) {
    next.vy = WORLD.jumpVelocity;
    next.onGround = false;
  }
  next.vy += WORLD.gravity * dt;
  next.x = Math.min(width - next.w, Math.max(0, next.x + next.vx * dt));

  const prevTop = next.y;
  const prevBottom = next.y + next.h;
  next.y += next.vy * dt;
  let hit: OptionBox | null = null;
  next.onGround = false;

  for (const b of boxes) {
    if (!overlapsX(next, b)) continue;
    const boxBottom = b.y + b.h;
    // Subiendo: la cabeza cruza el borde inferior de la caja → golpe.
    if (next.vy < 0 && prevTop >= boxBottom && next.y < boxBottom) {
      next.y = boxBottom;
      next.vy = 0;
      hit = b;
    }
    // Cayendo: los pies cruzan el borde superior → se para encima.
    else if (next.vy > 0 && prevBottom <= b.y && next.y + next.h > b.y) {
      next.y = b.y - next.h;
      next.vy = 0;
      next.onGround = true;
    }
  }

  if (next.y + next.h >= WORLD.ground) {
    next.y = WORLD.ground - next.h;
    next.vy = 0;
    next.onGround = true;
  }
  return { player: next, hit };
}

/** Caja bajo la que está parado el jugador (para mostrar cuál golpearía al saltar). */
export function boxAbove(p: Player, boxes: readonly OptionBox[]): OptionBox | null {
  const cx = p.x + p.w / 2;
  return boxes.find((b) => cx >= b.x && cx <= b.x + b.w && b.y + b.h <= p.y) ?? null;
}
