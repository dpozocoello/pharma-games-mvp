/**
 * Estilo de juego elegido por la persona (ADR-033): «Clásico» (botones), «Plataformas» o
 * «Lanzamiento». Es solo una preferencia local de presentación: las preguntas, el envío de
 * respuestas y el puntaje son los mismos y los decide el servidor.
 */
export const GAME_STYLES = [
  { id: 'classic', label: 'Clásico', hint: 'Toca la respuesta' },
  { id: 'platform', label: 'Plataformas', hint: 'Salta a la caja de tu respuesta' },
  { id: 'launch', label: 'Lanzamiento', hint: 'Lanza la cápsula a tu respuesta' },
] as const;
export type GameStyle = (typeof GAME_STYLES)[number]['id'];

const KEY = 'pharma.gameStyle';

function safeStorage(): Pick<Storage, 'getItem' | 'setItem'> | undefined {
  try {
    return typeof window !== 'undefined' ? window.localStorage : undefined;
  } catch {
    return undefined;
  }
}

export function readGameStyle(storage = safeStorage()): GameStyle {
  try {
    const v = storage?.getItem(KEY);
    return GAME_STYLES.some((s) => s.id === v) ? (v as GameStyle) : 'classic';
  } catch {
    return 'classic';
  }
}

export function saveGameStyle(style: GameStyle, storage = safeStorage()): void {
  try {
    storage?.setItem(KEY, style);
  } catch {
    // Modo privado: se usa el estilo clásico.
  }
}
