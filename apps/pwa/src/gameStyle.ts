import type { GameExperience, GameStyle } from '@pharma/shared';

/**
 * Estilo de juego (ADR-033, ADR-034). El servidor decide qué estilos puede jugar cada persona
 * (grupo del piloto A/B por farmacia); aquí solo se recuerda la preferencia entre los permitidos.
 */
export const STYLE_INFO: Record<GameStyle, { label: string; hint: string }> = {
  CLASSIC: { label: 'Clásico', hint: 'Toca la respuesta' },
  PLATFORM: { label: 'Plataformas', hint: 'Salta a la caja de tu respuesta' },
  LAUNCH: { label: 'Lanzamiento', hint: 'Lanza la cápsula a tu respuesta' },
};

const KEY = 'pharma.gameStyle';

function safeStorage(): Pick<Storage, 'getItem' | 'setItem'> | undefined {
  try {
    return typeof window !== 'undefined' ? window.localStorage : undefined;
  } catch {
    return undefined;
  }
}

/** Preferencia guardada si el servidor la permite; si no, el estilo por defecto del grupo. */
export function pickGameStyle(experience: GameExperience, storage = safeStorage()): GameStyle {
  try {
    const v = storage?.getItem(KEY) as GameStyle | null | undefined;
    if (v && experience.styles.includes(v)) return v;
  } catch {
    // Almacenamiento bloqueado: se usa el estilo por defecto.
  }
  return experience.defaultStyle;
}

export function saveGameStyle(style: GameStyle, storage = safeStorage()): void {
  try {
    storage?.setItem(KEY, style);
  } catch {
    // Modo privado: se usará el estilo por defecto.
  }
}
