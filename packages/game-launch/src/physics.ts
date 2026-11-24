/**
 * Física pura de «Tiro de Muestras» (lanzamiento): sin DOM ni Canvas, para poder probarla.
 * Escenario lógico de 360×400 px, y hacia abajo, tiempo en segundos.
 */
export const WORLD = {
  width: 360,
  height: 400,
  ground: 362,
  gravity: 760,
  anchor: { x: 66, y: 280 },
  maxPull: 92,
  power: 7.6,
  radius: 9,
} as const;

export interface Vec {
  x: number;
  y: number;
}
export interface Target {
  optionId: string;
  letter: string;
  x: number;
  y: number;
  w: number;
  h: number;
}

const LETTERS = ['A', 'B', 'C', 'D', 'E', 'F'];

/**
 * Blancos en estantes a la derecha: 2 opciones → dos blancos grandes; 3–4 → cuadrícula 2×2;
 * más → filas de dos. Todos se pueden alcanzar (lo comprueban las pruebas).
 */
export function layoutTargets(options: { id: string }[]): Target[] {
  if (options.length <= 2) {
    return options.map((o, i) => ({
      optionId: o.id,
      letter: LETTERS[i]!,
      w: 62,
      h: 76,
      x: 198 + i * 86,
      y: 212,
    }));
  }
  return options.map((o, i) => {
    const col = i % 2;
    const row = Math.floor(i / 2);
    return {
      optionId: o.id,
      letter: LETTERS[i] ?? String(i + 1),
      w: 52,
      h: 58,
      x: 206 + col * 84,
      y: 112 + row * 118,
    };
  });
}

/** Estantes sobre los que se apoyan los blancos (decorativos, no chocan). */
export function shelvesFor(targets: readonly Target[]): { x: number; y: number; w: number }[] {
  const rows = [...new Set(targets.map((t) => t.y + t.h))];
  return rows.map((y) => ({ x: 186, y, w: 166 }));
}

/** Arrastre desde el ancla (limitado a `maxPull`) → velocidad de salida, opuesta al arrastre. */
export function launchVelocity(drag: Vec): Vec {
  const dx = drag.x - WORLD.anchor.x;
  const dy = drag.y - WORLD.anchor.y;
  const len = Math.hypot(dx, dy);
  const k = len > WORLD.maxPull ? WORLD.maxPull / len : 1;
  return { x: -dx * k * WORLD.power, y: -dy * k * WORLD.power };
}

/** Punto de arrastre limitado al radio máximo (para dibujar la banda). */
export function clampDrag(drag: Vec): Vec {
  const dx = drag.x - WORLD.anchor.x;
  const dy = drag.y - WORLD.anchor.y;
  const len = Math.hypot(dx, dy);
  if (len <= WORLD.maxPull) return drag;
  return {
    x: WORLD.anchor.x + (dx / len) * WORLD.maxPull,
    y: WORLD.anchor.y + (dy / len) * WORLD.maxPull,
  };
}

export function stepProjectile(pos: Vec, vel: Vec, dt: number): { pos: Vec; vel: Vec } {
  const v = { x: vel.x, y: vel.y + WORLD.gravity * dt };
  return { pos: { x: pos.x + v.x * dt, y: pos.y + v.y * dt }, vel: v };
}

/** ¿El círculo del proyectil toca el rectángulo? */
export function hits(pos: Vec, t: Target): boolean {
  const cx = Math.max(t.x, Math.min(pos.x, t.x + t.w));
  const cy = Math.max(t.y, Math.min(pos.y, t.y + t.h));
  return Math.hypot(pos.x - cx, pos.y - cy) <= WORLD.radius;
}

export function outOfBounds(pos: Vec): boolean {
  return pos.x > WORLD.width + 20 || pos.x < -20 || pos.y > WORLD.ground;
}

/** Simula un lanzamiento completo: devuelve el primer blanco alcanzado o `null` si falla. */
export function simulate(
  vel: Vec,
  targets: readonly Target[],
  dt = 1 / 120,
  maxSeconds = 4,
): Target | null {
  let s: { pos: Vec; vel: Vec } = { pos: { x: WORLD.anchor.x, y: WORLD.anchor.y }, vel };
  for (let t = 0; t < maxSeconds; t += dt) {
    s = stepProjectile(s.pos, s.vel, dt);
    const hit = targets.find((tg) => hits(s.pos, tg));
    if (hit) return hit;
    if (outOfBounds(s.pos)) return null;
  }
  return null;
}

/** Puntos de la guía de puntería: el primer tramo de la trayectoria. */
export function aimGuide(vel: Vec, seconds = 0.4, points = 9): Vec[] {
  const out: Vec[] = [];
  let s: { pos: Vec; vel: Vec } = { pos: { x: WORLD.anchor.x, y: WORLD.anchor.y }, vel };
  const dt = seconds / points;
  for (let i = 0; i < points; i++) {
    s = stepProjectile(s.pos, s.vel, dt);
    out.push(s.pos);
  }
  return out;
}
