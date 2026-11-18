/**
 * Contrato de integración de juegos (CLAUDE.md §8). Iteración 0: solo tipos.
 * La implementación (cola offline en IndexedDB, envío y `finish`) llega en la Iteración 3.
 */
import type { GameMechanic, PublicQuestion } from '@pharma/shared';

export type { PublicQuestion };

export interface GameManifest {
  id: string;
  mechanic: GameMechanic;
  version: string;
  maxBundleKb: number;
}

export interface GameTheme {
  primary: string;
  secondary: string;
  logoUrl: string;
  brandName: string;
}

export interface AnswerSubmission {
  questionId: string;
  answer: string;
  clientElapsedMs: number;
}

export interface GameResult {
  score: number;
  correct: number;
  total: number;
  dailyCapReached: boolean;
  rankPosition?: number;
}

export interface GameContext {
  session: { id: string; token: string; expiresAt: string };
  /** SIN respuesta correcta. */
  questions: PublicQuestion[];
  theme: GameTheme;
  /** es-CO | es-EC | es-PE */
  locale: string;
  terms: Record<string, string>;
  limits: { secondsPerQuestion: number; totalSeconds: number };
  /** Se encola offline y se envía al reconectar. */
  submitAnswer(a: AnswerSubmission): void;
  /** Envía lo pendiente y devuelve el puntaje calculado por el servidor. */
  finish(): Promise<GameResult>;
  track(event: string, data?: Record<string, unknown>): void;
}

export interface GameHandle {
  unmount(): void;
}

export interface GameModule {
  manifest: GameManifest;
  mount(container: HTMLElement, ctx: GameContext): GameHandle;
}

/** Tamaño máximo de un juego con recursos (CLAUDE.md §4.6). */
export const MAX_GAME_BUNDLE_KB = 1536;
