import { registerSW } from 'virtual:pwa-register';

/**
 * Registro del service worker (ADR-030). Con `registerType: 'prompt'`, una versión nueva queda
 * esperando hasta que la persona la acepta: la app decide cuándo ofrecerla (nunca durante una
 * partida, para no recargar a mitad del juego).
 */
let applyUpdate: ((reload?: boolean) => Promise<void>) | null = null;
let updateReady = false;
const listeners = new Set<() => void>();

export function registerPwa(): void {
  if (!('serviceWorker' in navigator)) return;
  applyUpdate = registerSW({
    onNeedRefresh() {
      updateReady = true;
      for (const l of listeners) l();
    },
  });
}

/** Avisa cuando hay una versión nueva lista (si ya lo está, avisa de inmediato). */
export function onUpdateReady(listener: () => void): () => void {
  listeners.add(listener);
  if (updateReady) listener();
  return () => listeners.delete(listener);
}

/** Activa la versión nueva y recarga la app. */
export async function installUpdate(): Promise<void> {
  await applyUpdate?.(true);
}

// ───────────────────────── Partida en curso: no ofrecer actualizaciones ─────────────────────────

let gameInProgress = false;
const gameListeners = new Set<(inProgress: boolean) => void>();

export function setGameInProgress(inProgress: boolean): void {
  if (gameInProgress === inProgress) return;
  gameInProgress = inProgress;
  for (const l of gameListeners) l(inProgress);
}

export function onGameInProgressChange(listener: (inProgress: boolean) => void): () => void {
  gameListeners.add(listener);
  listener(gameInProgress);
  return () => gameListeners.delete(listener);
}
