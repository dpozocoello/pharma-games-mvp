import { z } from 'zod';
import type { PointsRules } from './schemas';

/**
 * Estilos de juego (ADR-033, ADR-034). Solo cambian cómo se elige la respuesta: las preguntas,
 * el puntaje en el servidor, los topes y las anomalías son los mismos.
 */
export const GAME_STYLES = ['CLASSIC', 'PLATFORM', 'LAUNCH'] as const;
export type GameStyle = (typeof GAME_STYLES)[number];
export const ARCADE_STYLES: readonly GameStyle[] = ['PLATFORM', 'LAUNCH'];

export const EXPERIMENT_GROUPS = ['CONTROL', 'ARCADE'] as const;
export type ExperimentGroup = (typeof EXPERIMENT_GROUPS)[number];

/**
 * Reglas arcade por país (opcionales dentro de `pointsRules`; sin ellas el país solo tiene el
 * estilo clásico). `secondsPerQuestion` reemplaza al del país en partidas arcade: el temporizador
 * y la ventana del bono de velocidad crecen juntos, así ningún grupo compite en desventaja.
 */
export const arcadeRulesSchema = z
  .object({
    enabled: z.boolean(),
    secondsPerQuestion: z.number().int().min(5).max(300),
    abTest: z
      .object({
        enabled: z.boolean(),
        /** Porcentaje de farmacias asignadas al grupo arcade. */
        arcadeSharePct: z.number().int().min(0).max(100),
        /** Cambiarla reasigna todas las farmacias: solo entre pilotos, nunca durante uno. */
        salt: z.string().min(1).max(64),
      })
      .strict(),
  })
  .strict();
export type ArcadeRules = z.infer<typeof arcadeRulesSchema>;

export const DEFAULT_ARCADE_RULES: ArcadeRules = {
  enabled: true,
  secondsPerQuestion: 30,
  abTest: { enabled: true, arcadeSharePct: 50, salt: 'piloto-arcade-1' },
};

/** FNV-1a de 32 bits: estable entre versiones de Node y navegadores, sin dependencias. */
function fnv1a(text: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h >>> 0;
}

/**
 * Grupo del experimento para una farmacia: determinista (misma farmacia → mismo grupo en cualquier
 * instancia de la API) y con la proporción configurada. La unidad es la farmacia para que los
 * compañeros de un mismo equipo no mezclen estilos.
 */
export function experimentGroupFor(pharmacyId: string, ab: ArcadeRules['abTest']): ExperimentGroup {
  const bucket = fnv1a(`${ab.salt}:${pharmacyId}`) % 100;
  return bucket < ab.arcadeSharePct ? 'ARCADE' : 'CONTROL';
}

export interface GameExperience {
  /** `null` si no hay experimento activo en el país. */
  group: ExperimentGroup | null;
  styles: GameStyle[];
  defaultStyle: GameStyle;
}

/**
 * Qué estilos puede jugar una persona:
 * - País sin arcade → solo clásico.
 * - Arcade sin experimento → los tres, clásico por defecto.
 * - Experimento: control → solo clásico; arcade → solo estilos arcade (su modo simple cubre
 *   accesibilidad). Sin farmacia vigente → control.
 */
export function gameExperienceFor(
  rules: Pick<PointsRules, 'arcade'>,
  pharmacyId: string | null,
): GameExperience {
  const arcade = rules.arcade;
  if (!arcade?.enabled) return { group: null, styles: ['CLASSIC'], defaultStyle: 'CLASSIC' };
  if (!arcade.abTest.enabled) {
    return { group: null, styles: [...GAME_STYLES], defaultStyle: 'CLASSIC' };
  }
  const group = pharmacyId ? experimentGroupFor(pharmacyId, arcade.abTest) : 'CONTROL';
  return group === 'ARCADE'
    ? { group, styles: [...ARCADE_STYLES], defaultStyle: 'PLATFORM' }
    : { group, styles: ['CLASSIC'], defaultStyle: 'CLASSIC' };
}

/** Reglas efectivas de una partida según su estilo (temporizador y ventana del bono). */
export function rulesForStyle<R extends Pick<PointsRules, 'secondsPerQuestion' | 'arcade'>>(
  rules: R,
  style: GameStyle,
): R {
  if (style === 'CLASSIC' || !rules.arcade?.enabled) return rules;
  return { ...rules, secondsPerQuestion: rules.arcade.secondsPerQuestion };
}

/** Sin `style`, el servidor usa el estilo por defecto de la persona (clientes anteriores). */
export const startSessionSchema = z.object({ style: z.enum(GAME_STYLES).optional() }).strict();
export type StartSessionInput = z.infer<typeof startSessionSchema>;
/** Cuerpo de `POST /games/:id/sessions`: vacío equivale a `{}`. */
export const startSessionBodySchema = z.preprocess(
  (v) => (v === undefined || v === null || v === '' ? {} : v),
  startSessionSchema,
);
