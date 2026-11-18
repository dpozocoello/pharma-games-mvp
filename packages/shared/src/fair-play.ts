import { z } from 'zod';
import type { PointsRules } from './schemas';

export const ANOMALY_STATUSES = ['OPEN', 'CONFIRMED', 'DISMISSED'] as const;
export type AnomalyStatus = (typeof ANOMALY_STATUSES)[number];

export interface DetectedAnomaly {
  rule: 'FAST_ANSWER' | 'SHORT_SESSION' | 'PERFECT_STREAK' | 'HIGH_FREQUENCY';
  details: Record<string, unknown>;
}

export interface SessionEvaluationInput {
  rules: PointsRules;
  questionCount: number;
  answers: {
    questionId: string;
    clientElapsedMs: number;
    correct: boolean;
  }[];
  sessionDurationMs: number;
  /** Rachas previas consecutivas con puntaje 100 % perfecto (sin contar la actual). */
  priorConsecutivePerfectSessions: number;
  /** Partidas iniciadas por el usuario en la última hora (incluyendo la actual). */
  sessionsInLastHour: number;
}

/**
 * Evalúa las 4 reglas de anomalía configurables por país (CLAUDE.md §9):
 * 1) `FAST_ANSWER`: alguna respuesta tiene `clientElapsedMs < rules.minAnswerMs` (ej. script que responde en 200 ms).
 * 2) `SHORT_SESSION`: duración total de la sesión < `questionCount * rules.anomaly.minSessionMsPerQuestion`.
 * 3) `PERFECT_STREAK`: la partida actual es 100 % perfecta y alcanza `rules.anomaly.perfectStreakSessions` seguidas.
 * 4) `HIGH_FREQUENCY`: el usuario supera `rules.anomaly.maxSessionsPerHour` en los últimos 60 minutos.
 */
export function evaluateSessionAnomalies(input: SessionEvaluationInput): DetectedAnomaly[] {
  const out: DetectedAnomaly[] = [];
  const { rules } = input;

  // 1. Respuestas más rápidas que minAnswerMs
  const fastAnswers = input.answers.filter((a) => a.clientElapsedMs < rules.minAnswerMs);
  if (fastAnswers.length > 0) {
    out.push({
      rule: 'FAST_ANSWER',
      details: {
        minAnswerMs: rules.minAnswerMs,
        fastAnswerCount: fastAnswers.length,
        minObservedMs: Math.min(...fastAnswers.map((a) => a.clientElapsedMs)),
      },
    });
  }

  // 2. Sesión demasiado corta en total
  const minTotalMs = input.questionCount * rules.anomaly.minSessionMsPerQuestion;
  if (input.sessionDurationMs < minTotalMs) {
    out.push({
      rule: 'SHORT_SESSION',
      details: {
        sessionDurationMs: input.sessionDurationMs,
        minExpectedMs: minTotalMs,
      },
    });
  }

  // 3. Racha perfecta improbable
  const isCurrentPerfect =
    input.questionCount > 0 &&
    input.answers.length === input.questionCount &&
    input.answers.every((a) => a.correct);
  if (isCurrentPerfect) {
    const streak = input.priorConsecutivePerfectSessions + 1;
    if (streak >= rules.anomaly.perfectStreakSessions) {
      out.push({
        rule: 'PERFECT_STREAK',
        details: {
          streakSessions: streak,
          threshold: rules.anomaly.perfectStreakSessions,
        },
      });
    }
  }

  // 4. Exceso de sesiones por hora
  if (input.sessionsInLastHour > rules.anomaly.maxSessionsPerHour) {
    out.push({
      rule: 'HIGH_FREQUENCY',
      details: {
        sessionsInLastHour: input.sessionsInLastHour,
        maxSessionsPerHour: rules.anomaly.maxSessionsPerHour,
      },
    });
  }

  return out;
}

/**
 * Calcula los puntos de una respuesta individual:
 * - Si es incorrecta -> 0.
 * - Si es correcta -> `pointsPerCorrect` + bono de velocidad calculado exclusivamente con
 *   `serverElapsedMs` cuando está disponible (§9: el tiempo del cliente solo se usa para anomalías).
 */
export function calculateAnswerPoints(
  correct: boolean,
  serverElapsedMs: number | null,
  rules: Pick<PointsRules, 'pointsPerCorrect' | 'speedBonusMax' | 'secondsPerQuestion'>,
): number {
  if (!correct) return 0;
  let bonus = 0;
  if (serverElapsedMs !== null && serverElapsedMs >= 0) {
    const windowMs = rules.secondsPerQuestion * 1000;
    if (serverElapsedMs < windowMs && windowMs > 0) {
      const ratio = Math.max(0, 1 - serverElapsedMs / windowMs);
      bonus = Math.round(rules.speedBonusMax * ratio);
    }
  }
  return rules.pointsPerCorrect + bonus;
}

/**
 * Aplica los topes diarios por usuario y por marca en la zona horaria del país (§9):
 * Devuelve los puntos efectivos a acreditar y si se alcanzó el tope diario.
 */
export function applyDailyCaps(
  rawScore: number,
  userTodayPoints: number,
  brandTodayPoints: number,
  rules: Pick<PointsRules, 'dailyCapPerUser' | 'dailyCapPerBrand'>,
): { creditedPoints: number; dailyCapReached: boolean } {
  const remUser = Math.max(0, rules.dailyCapPerUser - userTodayPoints);
  const remBrand = Math.max(0, rules.dailyCapPerBrand - brandTodayPoints);
  const creditedPoints = Math.max(0, Math.min(rawScore, remUser, remBrand));
  const dailyCapReached = rawScore > creditedPoints || remUser === 0 || remBrand === 0;
  return { creditedPoints, dailyCapReached };
}

// ───────────────────────────── Esquemas de Administración de Anomalías ─────────────────────────────

export const anomalyResolveSchema = z
  .object({
    status: z.enum(['CONFIRMED', 'DISMISSED']),
  })
  .strict();
export type AnomalyResolveInput = z.infer<typeof anomalyResolveSchema>;

export interface AnomalyAlertView {
  id: string;
  countryCode: string;
  sessionId: string;
  userId: string;
  userDisplayName: string;
  brandName: string;
  sessionScore: number;
  rule: string;
  details: Record<string, unknown>;
  status: AnomalyStatus;
  reviewedBy: string | null;
  reviewedAt: string | null;
  createdAt: string;
}
