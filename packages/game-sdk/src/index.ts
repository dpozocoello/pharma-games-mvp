/**
 * Contrato de integración de juegos y runtime offline (CLAUDE.md §8).
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

// ───────────────────────────── Almacenamiento Offline (IndexedDB + Memoria) ─────────────────────────────

const DB_NAME = 'pharma_game_sdk_db';
const STORE_NAME = 'pending_answers';

interface StoredSessionQueue {
  sessionId: string;
  answers: AnswerSubmission[];
}

/**
 * Cola persistente de respuestas pendientes por partida.
 * Si `indexedDB` está disponible en el navegador, persiste cada respuesta en disco para sobrevivir
 * recargas o cortes de red; además mantiene copia sincrónica en memoria para latencia cero.
 */
export class OfflineAnswerStore {
  private readonly memory = new Map<string, AnswerSubmission[]>();

  async enqueue(sessionId: string, submission: AnswerSubmission): Promise<void> {
    const current = this.memory.get(sessionId) ?? (await this.readIdb(sessionId));
    const idx = current.findIndex((a) => a.questionId === submission.questionId);
    if (idx >= 0) {
      current[idx] = submission;
    } else {
      current.push(submission);
    }
    this.memory.set(sessionId, [...current]);
    await this.writeIdb(sessionId, current);
  }

  async getPending(sessionId: string): Promise<AnswerSubmission[]> {
    const inMem = this.memory.get(sessionId);
    if (inMem) return [...inMem];
    const fromIdb = await this.readIdb(sessionId);
    this.memory.set(sessionId, [...fromIdb]);
    return fromIdb;
  }

  async removeSynced(sessionId: string, questionIds: readonly string[]): Promise<void> {
    const removeSet = new Set(questionIds);
    const current = await this.getPending(sessionId);
    const remaining = current.filter((a) => !removeSet.has(a.questionId));
    if (remaining.length === 0) {
      this.memory.delete(sessionId);
      await this.deleteIdb(sessionId);
    } else {
      this.memory.set(sessionId, remaining);
      await this.writeIdb(sessionId, remaining);
    }
  }

  async clear(sessionId: string): Promise<void> {
    this.memory.delete(sessionId);
    await this.deleteIdb(sessionId);
  }

  private openIdb(): Promise<IDBDatabase | null> {
    if (typeof indexedDB === 'undefined') return Promise.resolve(null);
    return new Promise((resolve) => {
      try {
        const req = indexedDB.open(DB_NAME, 1);
        req.onupgradeneeded = () => {
          const db = req.result;
          if (!db.objectStoreNames.contains(STORE_NAME)) {
            db.createObjectStore(STORE_NAME, { keyPath: 'sessionId' });
          }
        };
        req.onsuccess = () => resolve(req.result);
        req.onerror = () => resolve(null);
      } catch {
        resolve(null);
      }
    });
  }

  private async readIdb(sessionId: string): Promise<AnswerSubmission[]> {
    const db = await this.openIdb();
    if (!db) return [];
    return new Promise((resolve) => {
      try {
        const tx = db.transaction(STORE_NAME, 'readonly');
        const req = tx.objectStore(STORE_NAME).get(sessionId);
        req.onsuccess = () => {
          const res = req.result as StoredSessionQueue | undefined;
          resolve(res?.answers ?? []);
        };
        req.onerror = () => resolve([]);
      } catch {
        resolve([]);
      } finally {
        db.close();
      }
    });
  }

  private async writeIdb(sessionId: string, answers: AnswerSubmission[]): Promise<void> {
    const db = await this.openIdb();
    if (!db) return;
    return new Promise((resolve) => {
      try {
        const tx = db.transaction(STORE_NAME, 'readwrite');
        tx.objectStore(STORE_NAME).put({ sessionId, answers } satisfies StoredSessionQueue);
        tx.oncomplete = () => resolve();
        tx.onerror = () => resolve();
      } catch {
        resolve();
      } finally {
        db.close();
      }
    });
  }

  private async deleteIdb(sessionId: string): Promise<void> {
    const db = await this.openIdb();
    if (!db) return;
    return new Promise((resolve) => {
      try {
        const tx = db.transaction(STORE_NAME, 'readwrite');
        tx.objectStore(STORE_NAME).delete(sessionId);
        tx.oncomplete = () => resolve();
        tx.onerror = () => resolve();
      } catch {
        resolve();
      } finally {
        db.close();
      }
    });
  }
}

// ───────────────────────────── Transporte y Runtime del SDK ─────────────────────────────

export interface GameTransport {
  submitAnswersBatch(
    sessionId: string,
    sessionToken: string,
    answers: AnswerSubmission[],
  ): Promise<void>;
  finishSession(sessionId: string, sessionToken: string): Promise<GameResult>;
  trackEvent?(event: string, data?: Record<string, unknown>): void;
}

export interface CreateGameContextOptions {
  session: { id: string; token: string; expiresAt: string };
  questions: PublicQuestion[];
  theme: GameTheme;
  locale: string;
  terms: Record<string, string>;
  limits: { secondsPerQuestion: number; totalSeconds: number };
  transport: GameTransport;
  store?: OfflineAnswerStore;
}

/**
 * Construye un `GameContext` conectado a la cola offline:
 * - `submitAnswer(a)` guarda inmediatamente en `OfflineAnswerStore` y dispara un intento de envío en
 *   segundo plano; si no hay red, queda encolado sin interrumpir la partida.
 * - Si el navegador dispara el evento `online`, reintenta sincronizar lo pendiente antes de que venza la sesión.
 * - `finish()` espera cualquier encolado en curso, envía todas las respuestas pendientes al servidor
 *   y luego invoca `finishSession` para obtener el puntaje oficial calculado en el servidor.
 */
export function createGameContext(opts: CreateGameContextOptions): GameContext & {
  flushPending(): Promise<void>;
  dispose(): void;
} {
  const store = opts.store ?? new OfflineAnswerStore();
  let pendingChain: Promise<unknown> = Promise.resolve();
  let flushing: Promise<void> | null = null;

  async function doFlush(): Promise<void> {
    const pending = await store.getPending(opts.session.id);
    if (pending.length === 0) return;
    await opts.transport.submitAnswersBatch(opts.session.id, opts.session.token, pending);
    await store.removeSynced(
      opts.session.id,
      pending.map((a) => a.questionId),
    );
  }

  function flushPending(): Promise<void> {
    flushing ??= pendingChain
      .then(() => doFlush())
      .finally(() => {
        flushing = null;
      });
    return flushing;
  }

  const onOnline = () => {
    void flushPending().catch(() => undefined);
  };

  if (typeof window !== 'undefined' && typeof window.addEventListener === 'function') {
    window.addEventListener('online', onOnline);
  }

  return {
    session: opts.session,
    questions: opts.questions,
    theme: opts.theme,
    locale: opts.locale,
    terms: opts.terms,
    limits: opts.limits,
    submitAnswer(a: AnswerSubmission): void {
      pendingChain = pendingChain
        .then(() => store.enqueue(opts.session.id, a))
        .then(() => doFlush())
        .catch(() => {
          // Sin red: la respuesta permanece segura en `store` y se enviará al reconectar o en `finish()`.
        });
    },
    async finish(): Promise<GameResult> {
      await pendingChain;
      await flushPending();
      const result = await opts.transport.finishSession(opts.session.id, opts.session.token);
      await store.clear(opts.session.id);
      return result;
    },
    track(event: string, data?: Record<string, unknown>): void {
      opts.transport.trackEvent?.(event, data);
    },
    flushPending,
    dispose() {
      if (typeof window !== 'undefined' && typeof window.removeEventListener === 'function') {
        window.removeEventListener('online', onOnline);
      }
    },
  };
}
