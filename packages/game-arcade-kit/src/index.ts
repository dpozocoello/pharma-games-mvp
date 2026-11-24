import type { GameContext, PublicQuestion } from '@pharma/game-sdk';

/**
 * Armazón común de los juegos de acción (plataformas, lanzamiento): cabecera, pregunta, leyenda de
 * opciones, lienzo, controles, temporizador, selección + confirmación, modo simple, sonido y
 * pantalla de resultado. Cada juego aporta solo su escena (`Scene`).
 *
 * Reglas que protegen el propósito del producto:
 * - Golpear un blanco solo SELECCIONA la opción; hay que confirmar (y se puede cambiar antes).
 *   Así decide el conocimiento, no la puntería.
 * - El juego nunca sabe cuál es la respuesta correcta: envía la elegida con `ctx.submitAnswer`
 *   y el servidor puntúa (CLAUDE.md §4.1).
 * - Modo simple con botones (accesibilidad): por defecto si el sistema pide reducir el movimiento.
 */
export interface ArcadeInput {
  left: boolean;
  right: boolean;
  jump: boolean;
}

export interface Scene {
  /** Prepara la escena para una pregunta (opciones en orden de presentación). */
  reset(q: PublicQuestion): void;
  /** Avanza la simulación; devuelve el id de la opción alcanzada en este paso, si hubo. */
  update(dt: number, input: ArcadeInput): string | null;
  /** Dibuja en coordenadas lógicas (`width`×`height`). */
  draw(
    g: CanvasRenderingContext2D,
    view: { selected: string | null; primary: string; secondary: string; brand: string },
  ): void;
  pointerDown?(x: number, y: number): void;
  pointerMove?(x: number, y: number): void;
  pointerUp?(x: number, y: number): void;
  width: number;
  height: number;
}

export interface ArcadeOptions {
  id: string;
  title: string;
  howTo: string;
  /** `platform` muestra botones ◀ ▶ y Saltar; `launch` usa arrastrar sobre el lienzo. */
  controls: 'platform' | 'launch';
  scene: Scene;
}

const LETTERS = ['A', 'B', 'C', 'D', 'E', 'F'];

export function mountArcade(container: HTMLElement, ctx: GameContext, opts: ArcadeOptions) {
  const reduceMotion =
    typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;
  let simple = reduceMotion;
  let sound = true;
  let index = 0;
  let selected: string | null = null;
  let questionStart = Date.now();
  let remaining = ctx.limits.secondsPerQuestion;
  let destroyed = false;
  let raf = 0;
  let timer: ReturnType<typeof setInterval> | null = null;
  let last = 0;
  const input: ArcadeInput = { left: false, right: false, jump: false };

  const t = ctx.theme;
  const root = document.createElement('div');
  root.className = `pharma-arcade pharma-${opts.id}`;
  root.innerHTML = `
  <style>
    .pharma-arcade{font-family:system-ui,-apple-system,"Segoe UI",sans-serif;color:#0f172a;display:grid;gap:10px;max-width:520px;margin:0 auto}
    .pharma-arcade .bar{display:flex;align-items:center;gap:8px;flex-wrap:wrap}
    .pharma-arcade .brand{font-weight:700;color:${t.primary};margin-right:auto}
    .pharma-arcade .pill{font-size:.85rem;background:#f1f5f9;border-radius:999px;padding:4px 10px;font-variant-numeric:tabular-nums}
    .pharma-arcade .tgl{min-height:44px;min-width:44px;border-radius:10px;border:1px solid #cbd5e1;background:#fff;font:inherit;font-size:.85rem;font-weight:600;padding:0 10px;cursor:pointer;color:#0f172a}
    .pharma-arcade .q{background:#fff;border-radius:12px;padding:12px 14px;border-top:5px solid ${t.primary};font-weight:600;font-size:1.05rem;line-height:1.35}
    .pharma-arcade .legend{display:grid;gap:6px;margin:0;padding:0;list-style:none}
    .pharma-arcade .legend li{display:flex;gap:8px;align-items:flex-start;font-size:.95rem;background:#fff;border-radius:10px;padding:8px 10px;border:2px solid transparent}
    .pharma-arcade .legend li.sel{border-color:${t.primary};background:#eef2ff}
    .pharma-arcade .legend b{display:inline-grid;place-items:center;min-width:26px;height:26px;border-radius:7px;background:${t.primary};color:#fff;font-size:.85rem}
    .pharma-arcade .legend button{all:unset;display:flex;gap:8px;align-items:center;width:100%;min-height:44px;cursor:pointer}
    .pharma-arcade canvas{width:100%;height:auto;border-radius:14px;touch-action:none;display:block;background:#e2e8f0}
    .pharma-arcade .pad{display:grid;grid-template-columns:1fr 1fr 1.4fr;gap:8px}
    .pharma-arcade .pad button{min-height:56px;border-radius:12px;border:0;background:#1e293b;color:#fff;font:inherit;font-size:1.1rem;font-weight:700;touch-action:none;user-select:none;-webkit-user-select:none}
    .pharma-arcade .pad button.jump{background:${t.primary}}
    .pharma-arcade .confirm{display:flex;gap:8px;align-items:center;background:#fef9c3;border-radius:12px;padding:10px 12px}
    .pharma-arcade .confirm p{margin:0;flex:1;font-size:.95rem}
    .pharma-arcade .confirm button{min-height:48px;border-radius:10px;border:0;background:${t.primary};color:#fff;font:inherit;font-weight:700;padding:0 16px;cursor:pointer}
    .pharma-arcade .help{font-size:.85rem;color:#475569;margin:0}
    .pharma-arcade [hidden]{display:none!important}
  </style>
  <div class="bar">
    <span class="brand"></span>
    <span class="pill" data-ref="count"></span>
    <span class="pill" data-ref="timer" aria-live="off"></span>
    <button type="button" class="tgl" data-ref="mode"></button>
    <button type="button" class="tgl" data-ref="sound" aria-label="Alternar sonido">Sonido: Sí</button>
  </div>
  <p class="q" data-ref="prompt"></p>
  <ul class="legend" data-ref="legend"></ul>
  <div data-ref="play">
    <canvas data-ref="canvas" aria-label="${escapeHtml(opts.title)}: escena del juego"></canvas>
  </div>
  <div class="pad" data-ref="pad" ${opts.controls === 'platform' ? '' : 'hidden'}>
    <button type="button" data-k="left" aria-label="Mover a la izquierda">◀</button>
    <button type="button" data-k="right" aria-label="Mover a la derecha">▶</button>
    <button type="button" class="jump" data-k="jump">Saltar</button>
  </div>
  <div class="confirm" data-ref="confirm" role="status" hidden>
    <p data-ref="confirmText"></p>
    <button type="button" data-ref="confirmBtn">Confirmar</button>
  </div>
  <p class="help" data-ref="help"></p>`;
  container.innerHTML = '';
  container.appendChild(root);

  const $ = <T extends HTMLElement>(ref: string) => root.querySelector<T>(`[data-ref="${ref}"]`)!;
  $('help').textContent = opts.howTo;
  root.querySelector('.brand')!.textContent = `${t.brandName} · ${opts.title}`;

  // Lienzo nítido sin pasarse en gama baja (DPR máximo 2).
  const canvas = $<HTMLCanvasElement>('canvas');
  const dpr = Math.min(2, typeof devicePixelRatio === 'number' ? devicePixelRatio : 1);
  canvas.width = opts.scene.width * dpr;
  canvas.height = opts.scene.height * dpr;
  const g = canvas.getContext('2d');
  g?.scale(dpr, dpr);

  function tone(freq: number) {
    if (!sound) return;
    try {
      const A =
        window.AudioContext ||
        (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
      if (!A) return;
      const a = new A();
      const o = a.createOscillator();
      const v = a.createGain();
      o.frequency.value = freq;
      v.gain.value = 0.04;
      o.connect(v);
      v.connect(a.destination);
      o.start();
      o.stop(a.currentTime + 0.07);
    } catch {
      // Sin audio web: sigue en silencio.
    }
  }

  function question(): PublicQuestion | undefined {
    return ctx.questions[index];
  }
  function optionText(id: string) {
    const q = question();
    const i = q?.options.findIndex((o) => o.id === id) ?? -1;
    return i < 0 ? '' : `${LETTERS[i]}: ${q!.options[i]!.text}`;
  }

  function renderLegend() {
    const q = question();
    if (!q) return;
    $('legend').innerHTML = q.options
      .map((o, i) => {
        const body = `<b>${LETTERS[i]}</b><span>${escapeHtml(o.text)}</span>`;
        const sel = selected === o.id ? ' class="sel"' : '';
        return simple
          ? `<li${sel}><button type="button" data-option="${escapeHtml(o.id)}">${body}</button></li>`
          : `<li${sel}>${body}</li>`;
      })
      .join('');
    $('legend')
      .querySelectorAll<HTMLButtonElement>('button[data-option]')
      .forEach((b) => b.addEventListener('click', () => select(b.dataset.option!)));
  }

  function select(id: string) {
    selected = id;
    tone(660);
    $('confirmText').textContent =
      `Elegiste ${optionText(id)}.${simple ? '' : ' Confirma o golpea otra opción.'}`;
    $('confirm').hidden = false;
    renderLegend();
    ctx.track('arcade_option_selected', { game: opts.id, index });
  }

  function submit(answer: string) {
    const q = question();
    if (!q || destroyed) return;
    ctx.submitAnswer({
      questionId: q.id,
      answer,
      clientElapsedMs: Math.max(1, Date.now() - questionStart),
    });
    ctx.track('question_answered', { game: opts.id, index, timeout: answer === '__TIMEOUT__' });
    index += 1;
    startQuestion();
  }

  function applyMode() {
    $('mode').textContent = simple ? 'Modo juego' : 'Modo simple';
    $('play').hidden = simple;
    $('pad').hidden = simple || opts.controls !== 'platform';
    $('help').hidden = simple;
    renderLegend();
  }

  function startQuestion() {
    if (timer) clearInterval(timer);
    const q = question();
    if (!q) return finishGame();
    selected = null;
    $('confirm').hidden = true;
    $('count').textContent = `${index + 1} / ${ctx.questions.length}`;
    $('prompt').textContent = q.prompt;
    opts.scene.reset(q);
    renderLegend();
    questionStart = Date.now();
    remaining = ctx.limits.secondsPerQuestion;
    $('timer').textContent = `${remaining}s`;
    timer = setInterval(() => {
      remaining -= 1;
      $('timer').textContent = `${Math.max(0, remaining)}s`;
      if (remaining <= 0) submit(selected ?? '__TIMEOUT__');
    }, 1000);
  }

  function frame(now: number) {
    if (destroyed) return;
    raf = requestAnimationFrame(frame);
    if (simple || document.hidden || !g) {
      last = now;
      return;
    }
    const dt = Math.min(0.05, last ? (now - last) / 1000 : 0);
    last = now;
    const hit = opts.scene.update(dt, input);
    input.jump = false; // un salto por pulsación
    if (hit) select(hit);
    g.clearRect(0, 0, opts.scene.width, opts.scene.height);
    opts.scene.draw(g, {
      selected,
      primary: t.primary,
      secondary: t.secondary,
      brand: t.brandName,
    });
  }

  async function finishGame() {
    cancelAnimationFrame(raf);
    root.querySelectorAll('[data-ref]').forEach((el) => {
      if ((el as HTMLElement).dataset.ref !== 'result') (el as HTMLElement).hidden = true;
    });
    root.querySelector('.bar')!.removeAttribute('hidden');
    const box = document.createElement('section');
    box.dataset.ref = 'result';
    box.className = 'q';
    box.textContent = 'Enviando tus respuestas…';
    root.appendChild(box);
    try {
      const res = await ctx.finish();
      if (destroyed) return;
      box.innerHTML = `<h2 style="margin:0 0 6px;font-size:1.3rem">${escapeHtml(t.brandName)}</h2>
        <p style="font-size:1.5rem;font-weight:700;margin:6px 0;color:${t.primary}">+${res.score} ${escapeHtml(ctx.terms['term.points'] ?? 'puntos')}</p>
        <p style="margin:4px 0">Respuestas correctas: <strong>${res.correct} de ${res.total}</strong></p>
        ${res.dailyCapReached ? '<p role="status" style="background:#fef3c7;color:#92400e;padding:8px 12px;border-radius:8px">Alcanzaste el tope diario de puntos. Puedes seguir practicando.</p>' : ''}`;
    } catch (err) {
      if (destroyed) return;
      box.innerHTML = `<p role="alert" style="color:#991b1b;margin:0 0 10px">Sin conexión para cerrar la partida (${escapeHtml(err instanceof Error ? err.message : 'error')}). Tus respuestas están guardadas en el dispositivo.</p>
        <button type="button" class="tgl" data-retry>Reintentar envío</button>`;
      box.querySelector('[data-retry]')?.addEventListener('click', () => {
        box.remove();
        void finishGame();
      });
    }
  }

  // ── Controles ──
  const keyMap: Record<string, keyof ArcadeInput> = {
    ArrowLeft: 'left',
    ArrowRight: 'right',
    ArrowUp: 'jump',
    ' ': 'jump',
  };
  const onKey = (down: boolean) => (e: KeyboardEvent) => {
    if (e.key === 'Enter' && down && selected && !$('confirm').hidden) return submit(selected);
    const k = keyMap[e.key];
    if (!k || simple || opts.controls !== 'platform') return;
    e.preventDefault();
    if (k === 'jump') {
      if (down && !e.repeat) input.jump = true;
    } else input[k] = down;
  };
  const kd = onKey(true);
  const ku = onKey(false);
  window.addEventListener('keydown', kd);
  window.addEventListener('keyup', ku);
  $('pad')
    .querySelectorAll<HTMLButtonElement>('button[data-k]')
    .forEach((b) => {
      const k = b.dataset.k as keyof ArcadeInput;
      b.addEventListener('pointerdown', (e) => {
        e.preventDefault();
        if (k === 'jump') input.jump = true;
        else input[k] = true;
      });
      const up = () => {
        if (k !== 'jump') input[k] = false;
      };
      b.addEventListener('pointerup', up);
      b.addEventListener('pointerleave', up);
      b.addEventListener('pointercancel', up);
    });
  const toLogical = (e: PointerEvent) => {
    const r = canvas.getBoundingClientRect();
    return [
      ((e.clientX - r.left) / r.width) * opts.scene.width,
      ((e.clientY - r.top) / r.height) * opts.scene.height,
    ] as const;
  };
  canvas.addEventListener('pointerdown', (e) => {
    canvas.setPointerCapture?.(e.pointerId);
    opts.scene.pointerDown?.(...toLogical(e));
  });
  canvas.addEventListener('pointermove', (e) => opts.scene.pointerMove?.(...toLogical(e)));
  canvas.addEventListener('pointerup', (e) => opts.scene.pointerUp?.(...toLogical(e)));
  $('confirmBtn').addEventListener('click', () => selected && submit(selected));
  $('mode').addEventListener('click', () => {
    simple = !simple;
    ctx.track('arcade_mode', { game: opts.id, simple });
    applyMode();
  });
  $('sound').addEventListener('click', () => {
    sound = !sound;
    $('sound').textContent = sound ? 'Sonido: Sí' : 'Sonido: No';
  });

  ctx.track('game_mounted', { game: opts.id, brand: t.brandName, simple });
  applyMode();
  startQuestion();
  raf = requestAnimationFrame(frame);

  return {
    unmount() {
      destroyed = true;
      cancelAnimationFrame(raf);
      if (timer) clearInterval(timer);
      window.removeEventListener('keydown', kd);
      window.removeEventListener('keyup', ku);
      root.remove();
    },
  };
}

export function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

/** Rectángulo con esquinas redondeadas (sin depender de `roundRect`, ausente en navegadores viejos). */
export function roundRect(
  g: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  r: number,
) {
  g.beginPath();
  g.moveTo(x + r, y);
  g.arcTo(x + w, y, x + w, y + h, r);
  g.arcTo(x + w, y + h, x, y + h, r);
  g.arcTo(x, y + h, x, y, r);
  g.arcTo(x, y, x + w, y, r);
  g.closePath();
}
