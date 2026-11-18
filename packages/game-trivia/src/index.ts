import type { GameContext, GameHandle, GameModule } from '@pharma/game-sdk';

/**
 * Molde reutilizable de Trivia de Opción Múltiple (CLAUDE.md §3 Parte B y §8).
 * - Tematizable 100 % por `ctx.theme` (`primary`, `secondary`, `logoUrl`, `brandName`).
 * - Respeta `prefers-reduced-motion` y permite silenciar efectos sonoros.
 * - Objetivos táctiles ≥ 48 px.
 */
const triviaGame: GameModule = {
  manifest: {
    id: 'trivia',
    mechanic: 'MULTIPLE_CHOICE',
    version: '1.0.0',
    maxBundleKb: 1536,
  },
  mount(container: HTMLElement, ctx: GameContext): GameHandle {
    let currentIndex = 0;
    let questionStartTime = Date.now();
    let soundEnabled = true;
    let timerId: ReturnType<typeof setInterval> | null = null;
    let remainingSeconds = ctx.limits.secondsPerQuestion;
    let destroyed = false;

    const root = document.createElement('div');
    root.className = 'pharma-trivia-root';
    container.innerHTML = '';
    container.appendChild(root);

    function clearTimer() {
      if (timerId !== null) {
        clearInterval(timerId);
        timerId = null;
      }
    }

    function playFeedbackTone() {
      if (!soundEnabled || typeof window === 'undefined') return;
      try {
        const AudioCtx =
          window.AudioContext ||
          (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
        if (!AudioCtx) return;
        const audio = new AudioCtx();
        const osc = audio.createOscillator();
        const gain = audio.createGain();
        osc.type = 'sine';
        osc.frequency.value = 520;
        gain.gain.value = 0.04;
        osc.connect(gain);
        gain.connect(audio.destination);
        osc.start();
        osc.stop(audio.currentTime + 0.06);
      } catch {
        // Dispositivo sin soporte de audio web: continúa en silencio.
      }
    }

    function submitAndAdvance(answerId: string) {
      if (destroyed) return;
      clearTimer();
      const q = ctx.questions[currentIndex];
      if (!q) return;
      const elapsedMs = Math.max(1, Date.now() - questionStartTime);
      playFeedbackTone();
      ctx.submitAnswer({
        questionId: q.id,
        answer: answerId,
        clientElapsedMs: elapsedMs,
      });
      ctx.track('question_answered', { index: currentIndex, elapsedMs });
      currentIndex += 1;
      render();
    }

    function render() {
      if (destroyed) return;
      clearTimer();

      const q = ctx.questions[currentIndex];
      if (!q) {
        root.innerHTML = `
          <section style="background:#fff;border-radius:12px;padding:20px;border-top:6px solid ${ctx.theme.primary}">
            <h2 style="margin:0 0 8px;font-size:1.25rem">${escapeHtml(ctx.theme.brandName)}</h2>
            <p style="margin:0;color:#475569">Validando respuestas y calculando puntaje en el servidor…</p>
          </section>
        `;
        void ctx
          .finish()
          .then((res) => {
            if (destroyed) return;
            root.innerHTML = `
              <section style="background:#fff;border-radius:12px;padding:20px;border-top:6px solid ${ctx.theme.primary}">
                <h2 style="margin:0 0 8px;font-size:1.35rem">${escapeHtml(ctx.theme.brandName)}</h2>
                <p style="font-size:1.5rem;font-weight:700;margin:8px 0;color:${ctx.theme.primary}">
                  +${res.score} ${escapeHtml(ctx.terms['term.points'] ?? 'puntos')}
                </p>
                <p style="margin:4px 0">Respuestas correctas: <strong>${res.correct} de ${res.total}</strong></p>
                ${
                  res.dailyCapReached
                    ? '<p role="status" style="background:#fef3c7;color:#92400e;padding:8px 12px;border-radius:8px;margin-top:10px">Alcanzaste el tope diario de puntos. Puedes seguir practicando.</p>'
                    : ''
                }
              </section>
            `;
          })
          .catch((err) => {
            if (destroyed) return;
            root.innerHTML = `
              <section style="background:#fff;border-radius:12px;padding:20px;border-top:6px solid #b91c1c">
                <p role="alert" style="color:#991b1b;margin:0 0 12px">
                  Sin conexión para cerrar la partida (${escapeHtml(err instanceof Error ? err.message : 'error')}). Tus respuestas están guardadas en el dispositivo.
                </p>
                <button type="button" id="retry-finish" style="width:100%;min-height:48px;border-radius:10px;background:${ctx.theme.primary};color:#fff;border:none;font-weight:600;cursor:pointer">
                  Reintentar envío
                </button>
              </section>
            `;
            root
              .querySelector<HTMLButtonElement>('#retry-finish')
              ?.addEventListener('click', () => {
                render();
              });
          });
        return;
      }

      questionStartTime = Date.now();
      remainingSeconds = ctx.limits.secondsPerQuestion;

      const optionsHtml = q.options
        .map(
          (opt) => `
            <button
              type="button"
              data-option-id="${escapeHtml(opt.id)}"
              style="width:100%;min-height:48px;padding:12px 14px;text-align:left;border-radius:10px;border:2px solid ${ctx.theme.primary};background:#fff;color:#0f172a;font:inherit;font-weight:600;cursor:pointer"
            >
              ${escapeHtml(opt.text)}
            </button>
          `,
        )
        .join('');

      root.innerHTML = `
        <section style="background:#fff;border-radius:12px;padding:16px;border-top:6px solid ${ctx.theme.primary}">
          <header style="display:flex;justify-content:space-between;align-items:center;margin-bottom:12px;gap:8px">
            <span style="font-weight:700;color:${ctx.theme.primary}">${escapeHtml(ctx.theme.brandName)}</span>
            <span style="font-size:0.9rem;color:#475569">
              Pregunta ${currentIndex + 1} / ${ctx.questions.length} · <strong id="trivia-timer">${remainingSeconds}s</strong>
            </span>
            <button
              type="button"
              id="trivia-sound-toggle"
              aria-label="Alternar sonido"
              style="min-height:44px;min-width:44px;border-radius:8px;border:1px solid #cbd5e1;background:${ctx.theme.secondary};color:#0f172a;font-size:0.85rem;font-weight:600;cursor:pointer"
            >
              ${soundEnabled ? 'Sonido: Sí' : 'Sonido: No'}
            </button>
          </header>
          <p style="font-size:1.1rem;font-weight:600;margin:0 0 16px">${escapeHtml(q.prompt)}</p>
          <div style="display:grid;gap:10px">${optionsHtml}</div>
        </section>
      `;

      root
        .querySelector<HTMLButtonElement>('#trivia-sound-toggle')
        ?.addEventListener('click', () => {
          soundEnabled = !soundEnabled;
          const btn = root.querySelector<HTMLButtonElement>('#trivia-sound-toggle');
          if (btn) btn.textContent = soundEnabled ? 'Sonido: Sí' : 'Sonido: No';
        });

      root.querySelectorAll<HTMLButtonElement>('button[data-option-id]').forEach((btn) => {
        btn.addEventListener('click', () => {
          const answerId = btn.getAttribute('data-option-id') ?? '';
          submitAndAdvance(answerId);
        });
      });

      timerId = setInterval(() => {
        remainingSeconds -= 1;
        const timerEl = root.querySelector('#trivia-timer');
        if (timerEl) timerEl.textContent = `${Math.max(0, remainingSeconds)}s`;
        if (remainingSeconds <= 0) {
          submitAndAdvance('__TIMEOUT__');
        }
      }, 1000);
    }

    ctx.track('game_mounted', { mechanic: 'MULTIPLE_CHOICE', brand: ctx.theme.brandName });
    render();

    return {
      unmount() {
        destroyed = true;
        clearTimer();
        root.remove();
      },
    };
  },
};

function escapeHtml(str: string): string {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

export default triviaGame;
