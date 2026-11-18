import { createHmac, randomInt, timingSafeEqual } from 'node:crypto';
import { Inject, Injectable } from '@nestjs/common';
import { OTP_RULES, type AppAudience } from '@pharma/shared';
import { ENV, type Env } from '../config/env';
import { RedisService } from '../infra/redis.service';

export type OtpCheck =
  | { ok: true }
  | { ok: false; reason: 'INVALID'; attemptsLeft: number }
  | { ok: false; reason: 'EXPIRED' | 'LOCKED' };

const codeKey = (app: AppAudience, userId: string) => `otp:code:${app}:${userId}`;
const sendsKey = (subject: string) => `otp:sends:${subject}`;

/**
 * Códigos OTP en Redis (CLAUDE.md §10): 6 dígitos, vencen en 5 minutos, máximo 5 intentos y
 * 3 envíos por número cada 15 minutos. Solo se guarda el HMAC del código, nunca el código.
 */
@Injectable()
export class OtpService {
  constructor(
    private readonly redis: RedisService,
    @Inject(ENV) private readonly env: Env,
  ) {}

  generateCode(): string {
    return String(randomInt(0, 10 ** OTP_RULES.length)).padStart(OTP_RULES.length, '0');
  }

  /**
   * Cuenta un envío para cada sujeto (número, documento) y devuelve los segundos a esperar si
   * alguno superó el límite; 0 si se puede enviar.
   */
  async registerSend(subjects: string[]): Promise<number> {
    let wait = 0;
    for (const subject of new Set(subjects)) {
      const key = sendsKey(subject);
      const res = await this.redis.client
        .multi()
        .incr(key)
        .expire(key, OTP_RULES.sendWindowSeconds, 'NX')
        .ttl(key)
        .exec();
      const count = Number(res?.[0]?.[1] ?? 0);
      const ttl = Number(res?.[2]?.[1] ?? OTP_RULES.sendWindowSeconds);
      if (count > OTP_RULES.maxSends) wait = Math.max(wait, ttl > 0 ? ttl : 1);
    }
    return wait;
  }

  /** Guarda un código nuevo; invalida el anterior de ese usuario y app. */
  async store(app: AppAudience, userId: string, code: string): Promise<void> {
    const key = codeKey(app, userId);
    await this.redis.client
      .multi()
      .del(key)
      .hset(key, { h: this.hash(code), a: 0 })
      .expire(key, OTP_RULES.ttlSeconds)
      .exec();
  }

  /** Verifica un código. Un acierto lo consume (solo una solicitud concurrente puede ganar). */
  async verify(app: AppAudience, userId: string, code: string): Promise<OtpCheck> {
    const key = codeKey(app, userId);
    const stored = await this.redis.client.hget(key, 'h');
    if (!stored) return { ok: false, reason: 'EXPIRED' };

    const attempts = await this.redis.client.hincrby(key, 'a', 1);
    if (attempts > OTP_RULES.maxAttempts) {
      await this.redis.client.del(key);
      return { ok: false, reason: 'LOCKED' };
    }

    const a = Buffer.from(stored, 'hex');
    const b = Buffer.from(this.hash(code), 'hex');
    if (a.length !== b.length || !timingSafeEqual(a, b)) {
      const attemptsLeft = OTP_RULES.maxAttempts - attempts;
      if (attemptsLeft <= 0) {
        await this.redis.client.del(key);
        return { ok: false, reason: 'LOCKED' };
      }
      return { ok: false, reason: 'INVALID', attemptsLeft };
    }

    const deleted = await this.redis.client.del(key);
    return deleted === 1 ? { ok: true } : { ok: false, reason: 'EXPIRED' };
  }

  private hash(code: string): string {
    return createHmac('sha256', this.env.AUTH_TOKEN_SECRET).update(`otp:${code}`).digest('hex');
  }
}
