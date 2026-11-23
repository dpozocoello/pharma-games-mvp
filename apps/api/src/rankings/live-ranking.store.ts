import { randomUUID } from 'node:crypto';
import { Injectable } from '@nestjs/common';
import type { RankingRowView } from '@pharma/shared';
import { RedisService } from '../infra/redis.service';

/** Ámbitos materializados del ranking en vivo. */
export type LiveScope = 'individual' | 'pharmacy' | 'country';
export const LIVE_SCOPES: readonly LiveScope[] = ['individual', 'pharmacy', 'country'];

/** Clasificación completa de un país y periodo, tal como se publica en Redis. */
export interface LiveStandingsInput {
  rows: Record<LiveScope, RankingRowView[]>;
  /** Puntos elegibles de todo usuario con puntos en el periodo (incluye roles que no clasifican). */
  pointsByUser: Map<string, number>;
}

export interface LiveGeneration {
  gen: string;
  generatedAtMs: number;
}

/** Margen para que las lecturas en curso terminen antes de que se borre una generación vieja. */
const OLD_GENERATION_GRACE_SECONDS = 120;
/** Un periodo sin lecturas desaparece de Redis solo (se reconstruye desde PostgreSQL al leerlo). */
const GENERATION_TTL_SECONDS = 24 * 60 * 60;
const LOCK_TTL_MS = 60_000;
const CHUNK = 1000;

const curKey = (periodId: string) => `rk:${periodId}:cur`;
const lockKey = (periodId: string) => `rk:${periodId}:lock`;
const dirtyKey = (countryId: string) => `rk:dirty:${countryId}`;
const posKey = (periodId: string, gen: string, scope: LiveScope) =>
  `rk:${periodId}:${gen}:${scope}:pos`;
const rowKey = (periodId: string, gen: string, scope: LiveScope) =>
  `rk:${periodId}:${gen}:${scope}:row`;
const ptsKey = (periodId: string, gen: string) => `rk:${periodId}:${gen}:pts`;

/**
 * Ranking en vivo en Redis (CLAUDE.md §11), por país y periodo.
 *
 * Cada reconstrucción escribe una **generación** nueva (claves con su id) y después cambia el
 * puntero `rk:{periodId}:cur`, así ninguna lectura ve una clasificación a medio escribir:
 * - `…:{scope}:pos` sorted set `entityId → posición` (las posiciones ya resuelven los empates);
 * - `…:{scope}:row` hash `entityId → fila` (JSON);
 * - `…:pts` hash `userId → puntos elegibles`.
 * Leer el top N es `ZRANGE 0 N-1` + `HMGET`, y "mi fila" es un `HGET`, sin importar el tamaño del país.
 *
 * PostgreSQL sigue siendo la fuente de verdad: esto es una vista derivada y desechable.
 */
@Injectable()
export class LiveRankingStore {
  constructor(private readonly redis: RedisService) {}

  /** Avisa que la clasificación de un país cambió (partida terminada, anomalía resuelta, traslado…). */
  async markDirty(countryId: string): Promise<void> {
    try {
      await this.redis.client.set(dirtyKey(countryId), '1');
    } catch {
      // Sin Redis no hay vista en vivo que invalidar; las lecturas calculan desde PostgreSQL.
    }
  }

  async isDirty(countryId: string): Promise<boolean> {
    return (await this.redis.client.get(dirtyKey(countryId))) !== null;
  }

  /** Se llama justo antes de leer PostgreSQL: un evento posterior vuelve a marcar el país. */
  async clearDirty(countryId: string): Promise<void> {
    await this.redis.client.del(dirtyKey(countryId));
  }

  async current(periodId: string): Promise<LiveGeneration | null> {
    const raw = await this.redis.client.get(curKey(periodId));
    if (!raw) return null;
    const [gen, at] = raw.split('|');
    return gen && at ? { gen, generatedAtMs: Number(at) } : null;
  }

  /** Un solo proceso reconstruye cada periodo a la vez (todas las instancias comparten Redis). */
  async tryLock(periodId: string): Promise<string | null> {
    const token = randomUUID();
    const ok = await this.redis.client.set(lockKey(periodId), token, 'PX', LOCK_TTL_MS, 'NX');
    return ok === 'OK' ? token : null;
  }

  async unlock(periodId: string, token: string): Promise<void> {
    // Solo libera el lock si sigue siendo el propio (no el de otro proceso tras vencer el TTL).
    await this.redis.client.eval(
      "if redis.call('get', KEYS[1]) == ARGV[1] then return redis.call('del', KEYS[1]) else return 0 end",
      1,
      lockKey(periodId),
      token,
    );
  }

  /** Escribe una generación nueva completa y la deja vigente. */
  async publish(periodId: string, input: LiveStandingsInput, generatedAtMs: number): Promise<void> {
    const gen = randomUUID();
    const keys: string[] = [];
    const pipe = this.redis.client.pipeline();

    for (const scope of LIVE_SCOPES) {
      const rows = input.rows[scope];
      const pk = posKey(periodId, gen, scope);
      const rk = rowKey(periodId, gen, scope);
      keys.push(pk, rk);
      for (let i = 0; i < rows.length; i += CHUNK) {
        const chunk = rows.slice(i, i + CHUNK);
        pipe.zadd(pk, ...chunk.flatMap((r) => [r.position, r.entityId]));
        pipe.hset(rk, ...chunk.flatMap((r) => [r.entityId, JSON.stringify(r)]));
      }
    }
    const pk = ptsKey(periodId, gen);
    keys.push(pk);
    const pts = [...input.pointsByUser.entries()];
    for (let i = 0; i < pts.length; i += CHUNK) {
      pipe.hset(pk, ...pts.slice(i, i + CHUNK).flatMap(([id, v]) => [id, String(v)]));
    }
    for (const k of keys) pipe.expire(k, GENERATION_TTL_SECONDS);
    await this.exec(pipe);

    const previous = await this.current(periodId);
    await this.redis.client.set(
      curKey(periodId),
      `${gen}|${generatedAtMs}`,
      'EX',
      GENERATION_TTL_SECONDS,
    );
    if (previous) await this.expireGeneration(periodId, previous.gen);
  }

  /** Top N de un ámbito y el total de filas. */
  async top(
    periodId: string,
    gen: string,
    scope: LiveScope,
    limit: number,
  ): Promise<{ rows: RankingRowView[]; total: number }> {
    const [ids, total] = await Promise.all([
      this.redis.client.zrange(posKey(periodId, gen, scope), 0, limit - 1),
      this.redis.client.zcard(posKey(periodId, gen, scope)),
    ]);
    if (ids.length === 0) return { rows: [], total };
    const raw = await this.redis.client.hmget(rowKey(periodId, gen, scope), ...ids);
    return { rows: raw.filter((r): r is string => r !== null).map(parseRow), total };
  }

  async row(
    periodId: string,
    gen: string,
    scope: LiveScope,
    entityId: string,
  ): Promise<RankingRowView | null> {
    const raw = await this.redis.client.hget(rowKey(periodId, gen, scope), entityId);
    return raw ? parseRow(raw) : null;
  }

  async userPoints(periodId: string, gen: string, userId: string): Promise<number> {
    const raw = await this.redis.client.hget(ptsKey(periodId, gen), userId);
    return raw ? Number(raw) : 0;
  }

  private async expireGeneration(periodId: string, gen: string): Promise<void> {
    const pipe = this.redis.client.pipeline();
    for (const scope of LIVE_SCOPES) {
      pipe.expire(posKey(periodId, gen, scope), OLD_GENERATION_GRACE_SECONDS);
      pipe.expire(rowKey(periodId, gen, scope), OLD_GENERATION_GRACE_SECONDS);
    }
    pipe.expire(ptsKey(periodId, gen), OLD_GENERATION_GRACE_SECONDS);
    await this.exec(pipe);
  }

  private async exec(pipe: ReturnType<RedisService['client']['pipeline']>): Promise<void> {
    const results = await pipe.exec();
    const failed = results?.find(([err]) => err);
    if (failed?.[0]) throw failed[0];
  }
}

function parseRow(raw: string): RankingRowView {
  return JSON.parse(raw) as RankingRowView;
}
