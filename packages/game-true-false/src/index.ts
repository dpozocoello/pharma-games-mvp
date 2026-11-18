import type { GameContext, GameHandle, GameModule } from '@pharma/game-sdk';

/** Molde de verdadero/falso. Iteración 0: esqueleto; la mecánica llega en la Iteración 3. */
const game: GameModule = {
  manifest: { id: 'true-false', mechanic: 'TRUE_FALSE', version: '0.1.0', maxBundleKb: 1536 },
  mount(container: HTMLElement, ctx: GameContext): GameHandle {
    const el = document.createElement('p');
    el.textContent = `${ctx.theme.brandName}: verdadero o falso en construcción`;
    container.appendChild(el);
    return { unmount: () => el.remove() };
  },
};

export default game;
