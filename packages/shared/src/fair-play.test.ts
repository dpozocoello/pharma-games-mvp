import { describe, expect, it } from 'vitest';
import {
  applyDailyCaps,
  calculateAnswerPoints,
  evaluateSessionAnomalies,
  serverObservedTimes,
} from './fair-play';
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

describe('Tiempos del servidor contra un cliente que miente (§9)', () => {
  const t0 = new Date('2026-11-23T15:00:00.000Z');
  const at = (ms: number) => new Date(t0.getTime() + ms);
  const base = {
    rules: DEFAULT_POINTS_RULES,
    questionCount: 3,
    sessionDurationMs: 60_000,
    priorConsecutivePerfectSessions: 0,
    sessionsInLastHour: 1,
  };

  it('el servidor mide el intervalo entre llegadas; en un lote lo reparte entre sus respuestas', () => {
    const times = serverObservedTimes(t0, [
      { questionId: 'q1', receivedAt: at(5_000) },
      // q2 y q3 llegaron juntas (lote) 2 s después: 1 s cada una
      { questionId: 'q2', receivedAt: at(7_000) },
      { questionId: 'q3', receivedAt: at(7_000) },
    ]);
    expect(times).toEqual(
      new Map([
        ['q1', 5_000],
        ['q2', 1_000],
        ['q3', 1_000],
      ]),
    );
  });

  it('FAST_ANSWER salta con el tiempo del servidor aunque el cliente declare 5 s', () => {
    const anomalies = evaluateSessionAnomalies({
      ...base,
      answers: ['q1', 'q2', 'q3'].map((questionId) => ({
        questionId,
        clientElapsedMs: 5_000, // mentira
        serverObservedMs: 200, // lo que vio el servidor
        correct: true,
      })),
    });
    const fast = anomalies.find((a) => a.rule === 'FAST_ANSWER');
    expect(fast?.details).toMatchObject({ fastAnswerCount: 3, minObservedMs: 200 });
  });

  it('un lote enviado al reconectar tras jugar sin red no es anomalía', () => {
    // Respondió las 3 sin conexión durante 45 s y el SDK las envió juntas al volver la red.
    const times = serverObservedTimes(t0, [
      { questionId: 'q1', receivedAt: at(45_000) },
      { questionId: 'q2', receivedAt: at(45_000) },
      { questionId: 'q3', receivedAt: at(45_000) },
    ]);
    const anomalies = evaluateSessionAnomalies({
      ...base,
      answers: ['q1', 'q2', 'q3'].map((questionId) => ({
        questionId,
        clientElapsedMs: 15_000,
        serverObservedMs: times.get(questionId)!,
        correct: false,
      })),
    });
    expect(anomalies.map((a) => a.rule)).not.toContain('FAST_ANSWER');
  });

  it('sin bono de velocidad si la respuesta llegó más rápido que minAnswerMs', () => {
    // 50 ms desde la respuesta anterior: imposible para una persona, solo el punto base.
    expect(calculateAnswerPoints(true, 50, DEFAULT_POINTS_RULES)).toBe(10);
    expect(
      calculateAnswerPoints(true, DEFAULT_POINTS_RULES.minAnswerMs, DEFAULT_POINTS_RULES),
    ).toBe(15);
  });
});
