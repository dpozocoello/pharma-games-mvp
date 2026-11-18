import type { GameContext, GameHandle, GameModule } from '@pharma/game-sdk';

/** Molde de trivia de opción múltiple. Iteración 0: esqueleto; la mecánica llega en la Iteración 3. */
const game: GameModule = {
  manifest: { id: 'trivia', mechanic: 'MULTIPLE_CHOICE', version: '0.1.0', maxBundleKb: 1536 },
  mount(container: HTMLElement, ctx: GameContext): GameHandle {
    const el = document.createElement('p');
    el.textContent = `${ctx.theme.brandName}: trivia en construcción`;
    container.appendChild(el);
    return { unmount: () => el.remove() };
  },
};

export default game;
