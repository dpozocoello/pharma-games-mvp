import { mountArcade, roundRect, type Scene } from '@pharma/game-arcade-kit';
import type { GameContext, GameHandle, GameModule, PublicQuestion } from '@pharma/game-sdk';
import {
  aimGuide,
  clampDrag,
  hits,
  launchVelocity,
  layoutTargets,
  outOfBounds,
  shelvesFor,
  stepProjectile,
  WORLD,
  type Target,
  type Vec,
} from './physics';

/**
 * «Tiro de Muestras»: juego de lanzamiento original con física simple. Se estira una banda y se
 * lanza una cápsula contra el blanco de la respuesta, apilado en estantes. El impacto solo elige
 * la opción; hay que confirmar. El puntaje lo calcula el servidor.
 */
function createScene(): Scene {
  let targets: Target[] = [];
  let shelves: { x: number; y: number; w: number }[] = [];
  let drag: Vec | null = null;
  let shot: { pos: Vec; vel: Vec; trail: Vec[] } | null = null;
  let knocked: { id: string; t: number } | null = null;

  return {
    width: WORLD.width,
    height: WORLD.height,
    reset(q: PublicQuestion) {
      targets = layoutTargets(q.options);
      shelves = shelvesFor(targets);
      drag = null;
      shot = null;
      knocked = null;
    },
    pointerDown(x, y) {
      if (shot) return;
      if (Math.hypot(x - WORLD.anchor.x, y - WORLD.anchor.y) < 70) drag = clampDrag({ x, y });
    },
    pointerMove(x, y) {
      if (drag) drag = clampDrag({ x, y });
    },
    pointerUp() {
      if (!drag) return;
      const vel = launchVelocity(drag);
      drag = null;
      if (Math.hypot(vel.x, vel.y) < 120) return; // tirón demasiado corto: no lanza
      shot = { pos: { ...WORLD.anchor }, vel, trail: [] };
    },
    update(dt) {
      if (knocked) knocked.t += dt;
      if (!shot) return null;
      // Subpasos para no atravesar blancos delgados en dispositivos lentos.
      const sub = 4;
      for (let i = 0; i < sub; i++) {
        const s = stepProjectile(shot.pos, shot.vel, dt / sub);
        shot.pos = s.pos;
        shot.vel = s.vel;
        const hit = targets.find((t) => hits(shot!.pos, t));
        if (hit) {
          knocked = { id: hit.optionId, t: 0 };
          shot = null;
          return hit.optionId;
        }
        if (outOfBounds(shot.pos)) {
          shot = null;
          return null;
        }
      }
      shot.trail.push({ ...shot.pos });
      if (shot.trail.length > 24) shot.trail.shift();
      return null;
    },
    draw(g, view) {
      drawBackdrop(g, shelves, view.secondary);
      for (const t of targets) {
        const k = knocked?.id === t.optionId ? Math.min(1, knocked.t / 0.35) : 0;
        drawTarget(g, t, view.selected === t.optionId, k, view.primary);
      }
      drawSling(g, drag, shot, view.primary);
    },
  };
}

function drawBackdrop(
  g: CanvasRenderingContext2D,
  shelves: { x: number; y: number; w: number }[],
  secondary: string,
) {
  const sky = g.createLinearGradient(0, 0, 0, WORLD.ground);
  sky.addColorStop(0, '#eff6ff');
  sky.addColorStop(1, '#dbeafe');
  g.fillStyle = sky;
  g.fillRect(0, 0, WORLD.width, WORLD.ground);
  // Mueble de farmacia al fondo.
  g.fillStyle = secondary;
  g.globalAlpha = 0.18;
  roundRect(g, 176, 70, 184, WORLD.ground - 70, 10);
  g.fill();
  g.globalAlpha = 1;
  g.fillStyle = '#92400e';
  for (const s of shelves) g.fillRect(s.x, s.y, s.w, 8);
  // Mostrador (suelo).
  g.fillStyle = '#334155';
  g.fillRect(0, WORLD.ground, WORLD.width, WORLD.height - WORLD.ground);
}

function drawTarget(
  g: CanvasRenderingContext2D,
  t: Target,
  selected: boolean,
  knock: number,
  primary: string,
) {
  g.save();
  // Al recibir el impacto, el blanco se inclina hacia atrás.
  g.translate(t.x + t.w, t.y + t.h);
  g.rotate(knock * 0.35);
  g.translate(-(t.x + t.w), -(t.y + t.h));
  g.fillStyle = selected ? '#facc15' : '#ffffff';
  g.strokeStyle = selected ? '#a16207' : primary;
  g.lineWidth = 3;
  roundRect(g, t.x, t.y, t.w, t.h, 8);
  g.fill();
  g.stroke();
  // Franja de marca, como una caja de producto genérica.
  g.fillStyle = selected ? '#ca8a04' : primary;
  g.fillRect(t.x + 3, t.y + t.h - 16, t.w - 6, 10);
  g.fillStyle = selected ? '#713f12' : primary;
  g.font = '700 24px system-ui, sans-serif';
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  g.fillText(t.letter, t.x + t.w / 2, t.y + (t.h - 16) / 2 + 2);
  g.restore();
}

function drawSling(
  g: CanvasRenderingContext2D,
  drag: Vec | null,
  shot: { pos: Vec; trail: Vec[] } | null,
  primary: string,
) {
  const a = WORLD.anchor;
  // Poste en Y.
  g.strokeStyle = '#475569';
  g.lineWidth = 7;
  g.lineCap = 'round';
  g.beginPath();
  g.moveTo(a.x, WORLD.ground);
  g.lineTo(a.x, a.y + 26);
  g.moveTo(a.x, a.y + 26);
  g.lineTo(a.x - 14, a.y - 4);
  g.moveTo(a.x, a.y + 26);
  g.lineTo(a.x + 14, a.y - 4);
  g.stroke();
  const ball = drag ?? (shot ? null : a);
  if (drag) {
    g.strokeStyle = primary;
    g.lineWidth = 3;
    g.beginPath();
    g.moveTo(a.x - 14, a.y - 4);
    g.lineTo(drag.x, drag.y);
    g.lineTo(a.x + 14, a.y - 4);
    g.stroke();
    // Guía de puntería: solo el comienzo de la trayectoria.
    g.fillStyle = primary;
    for (const [i, p] of aimGuide(launchVelocity(drag)).entries()) {
      g.globalAlpha = 0.65 - i * 0.06;
      g.beginPath();
      g.arc(p.x, p.y, 3, 0, Math.PI * 2);
      g.fill();
    }
    g.globalAlpha = 1;
  }
  if (shot) {
    g.fillStyle = primary;
    shot.trail.forEach((p, i) => {
      g.globalAlpha = (i / shot.trail.length) * 0.4;
      g.beginPath();
      g.arc(p.x, p.y, 3, 0, Math.PI * 2);
      g.fill();
    });
    g.globalAlpha = 1;
    drawCapsule(g, shot.pos, primary);
  } else if (ball) drawCapsule(g, ball, primary);
}

/** Cápsula de dos colores (proyectil). */
function drawCapsule(g: CanvasRenderingContext2D, p: Vec, primary: string) {
  const r = WORLD.radius;
  g.save();
  g.translate(p.x, p.y);
  g.rotate(-0.6);
  g.fillStyle = primary;
  roundRect(g, -r * 1.5, -r * 0.8, r * 1.5, r * 1.6, r * 0.8);
  g.fill();
  g.fillStyle = '#f8fafc';
  roundRect(g, 0, -r * 0.8, r * 1.5, r * 1.6, r * 0.8);
  g.fill();
  g.strokeStyle = '#0f172a';
  g.lineWidth = 1.5;
  roundRect(g, -r * 1.5, -r * 0.8, r * 3, r * 1.6, r * 0.8);
  g.stroke();
  g.restore();
}

const launchGame: GameModule = {
  manifest: { id: 'launch', mechanic: 'MULTIPLE_CHOICE', version: '0.1.0', maxBundleKb: 1536 },
  mount(container: HTMLElement, ctx: GameContext): GameHandle {
    return mountArcade(container, ctx, {
      id: 'launch',
      title: 'Tiro de Muestras',
      howTo:
        'Arrastra la cápsula hacia atrás desde la honda y suelta para lanzarla contra el blanco de tu respuesta. Luego confirma.',
      controls: 'launch',
      scene: createScene(),
    });
  },
};

export default launchGame;
export { createScene };
