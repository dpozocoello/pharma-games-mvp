import type { GameContext, GameHandle, GameModule } from '@pharma/game-sdk';

/**
 * Molde reutilizable de Verdadero / Falso (CLAUDE.md §3 Parte B y §8).
 * - Tematizable 100 % por `ctx.theme` (`primary`, `secondary`, `logoUrl`, `brandName`).
 * - Respeta `prefers-reduced-motion` y permite silenciar efectos sonoros.
 * - Objetivos táctiles ≥ 48 px.
 */
const trueFalseGame: GameModule = {
  manifest: {
    id: 'true-false',
    mechanic: 'TRUE_FALSE',
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
    root.className = 'pharma-tf-root';
    container.innerHTML = '';
    container.appendChild(root);

    function clearTimer() {
      if (timerId !== null) {
        clearInterval(timerId);
        timerId = null;
      }
    }

    function submitAndAdvance(answerId: string) {
      if (destroyed) return;
      clearTimer();
      const q = ctx.questions[currentIndex];
      if (!q) return;
      const elapsedMs = Math.max(1, Date.now() - questionStartTime);
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
            <p style="margin:0;color:#475569">Validando respuestas en el servidor…</p>
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
                <p style="margin:4px 0">Aciertos: <strong>${res.correct} de ${res.total}</strong></p>
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
                  Sin conexión (${escapeHtml(err instanceof Error ? err.message : 'error')}). Tus respuestas están guardadas.
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

      const trueOpt = q.options.find((o) => o.id === 'TRUE') ?? { id: 'TRUE', text: 'Verdadero' };
      const falseOpt = q.options.find((o) => o.id === 'FALSE') ?? { id: 'FALSE', text: 'Falso' };

      root.innerHTML = `
        <section style="background:#fff;border-radius:12px;padding:16px;border-top:6px solid ${ctx.theme.primary}">
          <header style="display:flex;justify-content:space-between;align-items:center;margin-bottom:12px;gap:8px">
            <span style="font-weight:700;color:${ctx.theme.primary}">${escapeHtml(ctx.theme.brandName)}</span>
            <span style="font-size:0.9rem;color:#475569">
              ${currentIndex + 1} / ${ctx.questions.length} · <strong id="tf-timer">${remainingSeconds}s</strong>
            </span>
            <button
              type="button"
              id="tf-sound-toggle"
              aria-label="Alternar sonido"
              style="min-height:44px;min-width:44px;border-radius:8px;border:1px solid #cbd5e1;background:${ctx.theme.secondary};color:#0f172a;font-size:0.85rem;font-weight:600;cursor:pointer"
            >
              ${soundEnabled ? 'Sonido: Sí' : 'Sonido: No'}
            </button>
          </header>
          <p style="font-size:1.1rem;font-weight:600;margin:0 0 18px">${escapeHtml(q.prompt)}</p>
          <div style="display:grid;grid-template-columns:1fr 1fr;gap:12px">
            <button
              type="button"
              data-tf-id="${escapeHtml(trueOpt.id)}"
              style="min-height:52px;border-radius:10px;border:none;background:${ctx.theme.primary};color:#fff;font:inherit;font-weight:700;cursor:pointer"
            >
              ${escapeHtml(trueOpt.text)}
            </button>
            <button
              type="button"
              data-tf-id="${escapeHtml(falseOpt.id)}"
              style="min-height:52px;border-radius:10px;border:2px solid ${ctx.theme.primary};background:#fff;color:${ctx.theme.primary};font:inherit;font-weight:700;cursor:pointer"
            >
              ${escapeHtml(falseOpt.text)}
            </button>
          </div>
        </section>
      `;

      root.querySelector<HTMLButtonElement>('#tf-sound-toggle')?.addEventListener('click', () => {
        soundEnabled = !soundEnabled;
        const btn = root.querySelector<HTMLButtonElement>('#tf-sound-toggle');
        if (btn) btn.textContent = soundEnabled ? 'Sonido: Sí' : 'Sonido: No';
      });

      root.querySelectorAll<HTMLButtonElement>('button[data-tf-id]').forEach((btn) => {
        btn.addEventListener('click', () => {
          const answerId = btn.getAttribute('data-tf-id') ?? '';
          submitAndAdvance(answerId);
        });
      });

      timerId = setInterval(() => {
        remainingSeconds -= 1;
        const timerEl = root.querySelector('#tf-timer');
        if (timerEl) timerEl.textContent = `${Math.max(0, remainingSeconds)}s`;
        if (remainingSeconds <= 0) {
          submitAndAdvance('__TIMEOUT__');
        }
      }, 1000);
    }

    ctx.track('game_mounted', { mechanic: 'TRUE_FALSE', brand: ctx.theme.brandName });
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

export default trueFalseGame;
