import { describe, expect, it } from 'vitest';
import { applyDailyCaps, calculateAnswerPoints, evaluateSessionAnomalies } from './fair-play';
import { DEFAULT_POINTS_RULES } from './schemas';
import { localDay } from './time';

describe('Puntos, topes por zona horaria y detección de anomalías (Iteración 4)', () => {
  it('calcula bono de velocidad solo cuando serverElapsedMs está disponible (nunca usa clientElapsedMs)', () => {
    expect(calculateAnswerPoints(false, 1000, DEFAULT_POINTS_RULES)).toBe(0);
    // Envío por lote offline (serverElapsedMs = null): solo base (10)
    expect(calculateAnswerPoints(true, null, DEFAULT_POINTS_RULES)).toBe(10);
    // Envío en tiempo real con respuesta en 2s de 20s: base 10 + bono ~5 = 15
    expect(calculateAnswerPoints(true, 2000, DEFAULT_POINTS_RULES)).toBe(15);
  });

  it('aplica topes diarios por usuario (300) y por marca (120) e informa dailyCapReached', () => {
    // Primera partida con 90 pts -> acredita 90
    const r1 = applyDailyCaps(90, 0, 0, DEFAULT_POINTS_RULES);
    expect(r1).toEqual({ creditedPoints: 90, dailyCapReached: false });

    // Segunda partida de la misma marca con 80 pts -> tope de marca (120) recorta a 30 pts
    const r2 = applyDailyCaps(80, 90, 90, DEFAULT_POINTS_RULES);
    expect(r2).toEqual({ creditedPoints: 30, dailyCapReached: true });

    // Al alcanzar el tope de usuario (300), permite jugar pero suma 0 puntos
    const r3 = applyDailyCaps(100, 300, 0, DEFAULT_POINTS_RULES);
    expect(r3).toEqual({ creditedPoints: 0, dailyCapReached: true });
  });

  it('respeta la zona horaria local del país (UTC-5) al cambiar de día UTC', () => {
    // 2026-11-18T03:30:00Z son las 22:30 del 2026-11-17 en Lima/Bogotá/Guayaquil (UTC-5)
    const beforeLocalMidnight = new Date('2026-11-18T03:30:00.000Z');
    // 2026-11-18T05:30:00Z son las 00:30 del 2026-11-18 en Lima/Bogotá/Guayaquil (UTC-5)
    const afterLocalMidnight = new Date('2026-11-18T05:30:00.000Z');

    for (const tz of ['America/Lima', 'America/Bogota', 'America/Guayaquil']) {
      expect(localDay(beforeLocalMidnight, tz)).toBe('2026-11-17');
      expect(localDay(afterLocalMidnight, tz)).toBe('2026-11-18');
    }
  });

  it('detecta un script que responde en 200 ms por pregunta (FAST_ANSWER y SHORT_SESSION)', () => {
    const botAnswers = Array.from({ length: 10 }, (_, i) => ({
      questionId: `q-${i + 1}`,
      clientElapsedMs: 200,
      correct: true,
    }));

    const anomalies = evaluateSessionAnomalies({
      rules: DEFAULT_POINTS_RULES,
      questionCount: 10,
      answers: botAnswers,
      sessionDurationMs: 2000, // 10 * 200 ms
      priorConsecutivePerfectSessions: 0,
      sessionsInLastHour: 1,
    });

    const rulesTriggered = anomalies.map((a) => a.rule);
    expect(rulesTriggered).toEqual(expect.arrayContaining(['FAST_ANSWER', 'SHORT_SESSION']));
  });

  it('detecta rachas perfectas improbables (PERFECT_STREAK) y exceso de sesiones por hora (HIGH_FREQUENCY)', () => {
    const normalAnswers = Array.from({ length: 10 }, (_, i) => ({
      questionId: `q-${i + 1}`,
      clientElapsedMs: 2500,
      correct: true,
    }));

    const anomalies = evaluateSessionAnomalies({
      rules: DEFAULT_POINTS_RULES,
      questionCount: 10,
      answers: normalAnswers,
      sessionDurationMs: 25_000,
      priorConsecutivePerfectSessions: 4, // Con la actual suma 5 (= perfectStreakSessions)
      sessionsInLastHour: 11, // > maxSessionsPerHour (10)
    });

    const rulesTriggered = anomalies.map((a) => a.rule);
    expect(rulesTriggered).toEqual(expect.arrayContaining(['PERFECT_STREAK', 'HIGH_FREQUENCY']));
  });
});
