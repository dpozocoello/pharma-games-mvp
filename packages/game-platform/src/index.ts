import { mountArcade, roundRect, type Scene } from '@pharma/game-arcade-kit';
import type { GameContext, GameHandle, GameModule, PublicQuestion } from '@pharma/game-sdk';
import {
  boxAbove,
  layoutBoxes,
  spawnPlayer,
  step,
  WORLD,
  type OptionBox,
  type Player,
} from './world';

/**
 * «Ruta del Mostrador»: juego de plataformas original. Una dependiente recorre el pasillo de la
 * farmacia; cada opción es una caja con su letra y se elige saltando para golpearla desde abajo.
 * Sirve para trivia (4 opciones) y verdadero/falso (2). El puntaje lo calcula el servidor.
 */
function createScene(): Scene {
  let boxes: OptionBox[] = [];
  let player: Player = spawnPlayer();
  let bump: { id: string; t: number } | null = null;
  let clock = 0;

  return {
    width: WORLD.width,
    height: WORLD.height,
    reset(q: PublicQuestion) {
      boxes = layoutBoxes(q.options);
      player = spawnPlayer();
      bump = null;
    },
    update(dt, input) {
      clock += dt;
      if (bump) bump.t += dt;
      const r = step(player, input, dt, boxes);
      player = r.player;
      if (r.hit) {
        bump = { id: r.hit.optionId, t: 0 };
        return r.hit.optionId;
      }
      return null;
    },
    draw(g, view) {
      drawAisle(g, view.secondary, view.primary);
      const target = boxAbove(player, boxes);
      for (const b of boxes) {
        const lift =
          bump && bump.id === b.optionId && bump.t < 0.18
            ? -8 * Math.sin((bump.t / 0.18) * Math.PI)
            : 0;
        drawBox(g, b, lift, view.selected === b.optionId, target === b, view.primary);
      }
      drawClerk(g, player, view.primary, clock);
    },
  };
}

function drawAisle(g: CanvasRenderingContext2D, secondary: string, primary: string) {
  const W = WORLD.width;
  const sky = g.createLinearGradient(0, 0, 0, WORLD.ground);
  sky.addColorStop(0, '#f8fafc');
  sky.addColorStop(1, '#e2e8f0');
  g.fillStyle = sky;
  g.fillRect(0, 0, W, WORLD.ground);
  // Estanterías al fondo con productos genéricos.
  for (let row = 0; row < 3; row++) {
    const y = 40 + row * 62;
    g.fillStyle = '#cbd5e1';
    g.fillRect(0, y + 44, W, 6);
    for (let x = 8; x < W - 20; x += 26) {
      const h = 22 + ((x * 7 + row * 13) % 18);
      g.fillStyle =
        (x / 26 + row) % 3 === 0 ? primary : (x / 26 + row) % 3 === 1 ? secondary : '#94a3b8';
      g.globalAlpha = 0.28;
      roundRect(g, x, y + 44 - h, 18, h, 3);
      g.fill();
      g.globalAlpha = 1;
    }
  }
  // Piso de baldosas.
  g.fillStyle = '#475569';
  g.fillRect(0, WORLD.ground, W, WORLD.height - WORLD.ground);
  g.fillStyle = '#64748b';
  for (let x = 0; x < W; x += 30) g.fillRect(x, WORLD.ground, 28, 4);
}

function drawBox(
  g: CanvasRenderingContext2D,
  b: OptionBox,
  lift: number,
  selected: boolean,
  aimed: boolean,
  primary: string,
) {
  const y = b.y + lift;
  g.fillStyle = selected ? '#facc15' : '#ffffff';
  g.strokeStyle = selected ? '#a16207' : primary;
  g.lineWidth = 3;
  roundRect(g, b.x, y, b.w, b.h, 8);
  g.fill();
  g.stroke();
  // Cruz verde de farmacia pequeña en la esquina.
  g.fillStyle = '#16a34a';
  g.fillRect(b.x + 6, y + 9, 10, 3);
  g.fillRect(b.x + 9.5, y + 5.5, 3, 10);
  g.fillStyle = selected ? '#713f12' : primary;
  g.font = '700 22px system-ui, sans-serif';
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  g.fillText(b.letter, b.x + b.w / 2 + 4, y + b.h / 2 + 1);
  if (aimed && !selected) {
    // Indicador de «saltando aquí golpeas esta caja».
    g.fillStyle = primary;
    g.globalAlpha = 0.35;
    g.beginPath();
    g.moveTo(b.x + b.w / 2, y + b.h + 6);
    g.lineTo(b.x + b.w / 2 - 7, y + b.h + 16);
    g.lineTo(b.x + b.w / 2 + 7, y + b.h + 16);
    g.fill();
    g.globalAlpha = 1;
  }
}

/** Dependiente original: gorra y delantal con el color de la marca. */
function drawClerk(g: CanvasRenderingContext2D, p: Player, primary: string, clock: number) {
  const { x, y, w, h } = p;
  const stride = p.onGround && p.vx !== 0 ? Math.sin(clock * 18) * 3 : 0;
  // Piernas
  g.fillStyle = '#1e293b';
  g.fillRect(x + 5, y + h - 10, 6, 10 + stride);
  g.fillRect(x + w - 11, y + h - 10, 6, 10 - stride);
  // Cuerpo con delantal
  g.fillStyle = '#ffffff';
  roundRect(g, x + 2, y + 14, w - 4, h - 22, 6);
  g.fill();
  g.fillStyle = primary;
  roundRect(g, x + 6, y + 18, w - 12, h - 26, 4);
  g.fill();
  // Cabeza y gorra
  g.fillStyle = '#f2c9a0';
  g.beginPath();
  g.arc(x + w / 2, y + 8, 8, 0, Math.PI * 2);
  g.fill();
  g.fillStyle = primary;
  g.fillRect(x + w / 2 - 9, y - 1, 18, 5);
  g.fillRect(x + w / 2 + (p.vx < 0 ? -13 : 5), y + 2, 8, 3);
}

const platformGame: GameModule = {
  manifest: { id: 'platform', mechanic: 'MULTIPLE_CHOICE', version: '0.1.0', maxBundleKb: 1536 },
  mount(container: HTMLElement, ctx: GameContext): GameHandle {
    return mountArcade(container, ctx, {
      id: 'platform',
      title: 'Ruta del Mostrador',
      howTo:
        'Muévete con ◀ ▶ y salta debajo de la caja de tu respuesta para elegirla. Luego confirma. Teclado: flechas, espacio y Enter.',
      controls: 'platform',
      scene: createScene(),
    });
  },
};

export default platformGame;
export { createScene };
