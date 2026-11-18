import { describe, expect, it, vi } from 'vitest';
import {
  OfflineAnswerStore,
  createGameContext,
  type AnswerSubmission,
  type GameResult,
} from './index';

describe('@pharma/game-sdk — Offline queue & network cut resilience (Iteration 3)', () => {
  it('termina la partida exitosamente tras cortar y restablecer la red a mitad del juego', async () => {
    let networkOnline = true;
    const serverReceived = new Map<string, AnswerSubmission>();

    const store = new OfflineAnswerStore();
    const transport = {
      submitAnswersBatch: vi.fn(
        async (_sessionId: string, _token: string, batch: AnswerSubmission[]) => {
          if (!networkOnline) {
            throw new Error('Network disconnected');
          }
          for (const a of batch) {
            serverReceived.set(a.questionId, a);
          }
        },
      ),
      finishSession: vi.fn(async (): Promise<GameResult> => {
        if (!networkOnline) {
          throw new Error('Network disconnected');
        }
        return {
          score: serverReceived.size * 10,
          correct: serverReceived.size,
          total: 3,
          dailyCapReached: false,
        };
      }),
    };

    const ctx = createGameContext({
      session: {
        id: '01900000-0000-7000-8000-000000000900',
        token: 'signed-hmac-token',
        expiresAt: new Date(Date.now() + 300_000).toISOString(),
      },
      questions: [
        {
          id: '01900000-0000-7000-8000-000000000901',
          type: 'TRUE_FALSE',
          prompt: 'Pregunta 1',
          options: [
            { id: 'TRUE', text: 'Verdadero' },
            { id: 'FALSE', text: 'Falso' },
          ],
        },
        {
          id: '01900000-0000-7000-8000-000000000902',
          type: 'TRUE_FALSE',
          prompt: 'Pregunta 2',
          options: [
            { id: 'TRUE', text: 'Verdadero' },
            { id: 'FALSE', text: 'Falso' },
          ],
        },
        {
          id: '01900000-0000-7000-8000-000000000903',
          type: 'TRUE_FALSE',
          prompt: 'Pregunta 3',
          options: [
            { id: 'TRUE', text: 'Verdadero' },
            { id: 'FALSE', text: 'Falso' },
          ],
        },
      ],
      theme: {
        primary: '#1D4ED8',
        secondary: '#DBEAFE',
        logoUrl: '/brands/marca-a.svg',
        brandName: 'Marca A',
      },
      locale: 'es-PE',
      terms: {},
      limits: { secondsPerQuestion: 20, totalSeconds: 180 },
      transport,
      store,
    });

    // Pregunta 1: con red activa
    ctx.submitAnswer({
      questionId: '01900000-0000-7000-8000-000000000901',
      answer: 'TRUE',
      clientElapsedMs: 1200,
    });
    await ctx.flushPending();
    expect(serverReceived.size).toBe(1);

    // Se corta la red a mitad de la partida (preguntas 2 y 3 sin conexión)
    networkOnline = false;
    ctx.submitAnswer({
      questionId: '01900000-0000-7000-8000-000000000902',
      answer: 'FALSE',
      clientElapsedMs: 1500,
    });
    ctx.submitAnswer({
      questionId: '01900000-0000-7000-8000-000000000903',
      answer: 'TRUE',
      clientElapsedMs: 1100,
    });

    // Esperar a que la cadena interna intente y guarde en la cola offline
    await new Promise((r) => setTimeout(r, 20));
    const pendingWhileOffline = await store.getPending('01900000-0000-7000-8000-000000000900');
    expect(pendingWhileOffline).toHaveLength(2);

    // Se restablece la red antes de finalizar la partida
    networkOnline = true;
    const result = await ctx.finish();

    expect(serverReceived.size).toBe(3);
    expect(result.score).toBe(30);
    expect(result.correct).toBe(3);
    expect(await store.getPending('01900000-0000-7000-8000-000000000900')).toHaveLength(0);
    ctx.dispose();
  });
});
