import { useEffect, useState } from 'react';
import { installUpdate, onGameInProgressChange, onUpdateReady } from './pwa';
import styles from './App.module.css';

/** Avisos globales: sin conexión y versión nueva disponible (fuera de una partida). */
export function StatusBanners() {
  const [online, setOnline] = useState(() => navigator.onLine);
  const [updateReady, setUpdateReady] = useState(false);
  const [inGame, setInGame] = useState(false);

  useEffect(() => {
    const up = () => setOnline(true);
    const down = () => setOnline(false);
    window.addEventListener('online', up);
    window.addEventListener('offline', down);
    const offUpdate = onUpdateReady(() => setUpdateReady(true));
    const offGame = onGameInProgressChange(setInGame);
    return () => {
      window.removeEventListener('online', up);
      window.removeEventListener('offline', down);
      offUpdate();
      offGame();
    };
  }, []);

  return (
    <>
      {!online && (
        <p role="status" className={styles.banner}>
          Sin conexión.{' '}
          {inGame
            ? 'Sigue jugando: tus respuestas se guardan y se envían al volver la red.'
            : 'Puedes abrir la app; para ingresar o ver rankings necesitas conexión.'}
        </p>
      )}
      {updateReady && !inGame && (
        <p role="status" className={styles.banner}>
          Hay una versión nueva de la app.{' '}
          <button
            type="button"
            className={styles.bannerAction}
            onClick={() => void installUpdate()}
          >
            Actualizar
          </button>
        </p>
      )}
    </>
  );
}
