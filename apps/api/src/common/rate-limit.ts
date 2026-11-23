import {
  CanActivate,
  ExecutionContext,
  HttpStatus,
  Injectable,
  Logger,
  SetMetadata,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { Response } from 'express';
import type { AuthedRequest } from '../auth/principal';
import { RedisService } from '../infra/redis.service';
import { AppError } from './errors';
import { isRedisUnavailable, serviceUnavailable, throttledWarn } from './redis-availability';

export interface RateLimitPolicy {
  /** Nombre del cubo (aparece en la clave de Redis). */
  name: string;
  limit: number;
  windowSeconds: number;
}

const RATE_LIMIT = 'rate-limit:policy';
/** Límite adicional por IP para una ruta concreta. */
export const RateLimit = (policy: RateLimitPolicy) => SetMetadata(RATE_LIMIT, policy);

/**
 * Límite general generoso por IP: muchas farmacias comparten IP detrás del NAT del operador móvil.
 * El límite por usuario autenticado es el que realmente protege.
 */
export const DEFAULT_IP_POLICY: RateLimitPolicy = { name: 'ip', limit: 1200, windowSeconds: 60 };
export const DEFAULT_USER_POLICY: RateLimitPolicy = { name: 'user', limit: 300, windowSeconds: 60 };

/** Contador de ventana fija en Redis, compartido por todas las instancias de la API. */
@Injectable()
export class RateLimitService {
  constructor(private readonly redis: RedisService) {}

  /** Devuelve los segundos que faltan si se superó el límite; 0 si está permitido. */
  async hit(policy: RateLimitPolicy, subject: string): Promise<number> {
    const nowSec = Math.floor(Date.now() / 1000);
    const window = Math.floor(nowSec / policy.windowSeconds);
    const key = `rl:${policy.name}:${subject}:${window}`;
    const results = await this.redis.client
      .multi()
      .incr(key)
      .expire(key, policy.windowSeconds + 1)
      .exec();
    const count = Number(results?.[0]?.[1] ?? 0);
    if (count <= policy.limit) return 0;
    return policy.windowSeconds - (nowSec % policy.windowSeconds);
  }
}

/**
 * Si Redis no está disponible, el límite general **falla abierto** (registra y deja pasar: un Redis
 * caído no debe tumbar toda la API, CLAUDE.md §11). Las rutas con política propia (`@RateLimit`,
 * ingreso por OTP y refresh) **fallan cerradas** con 503: sin contador no hay protección contra
 * fuerza bruta, y de todos modos el OTP vive en Redis.
 */
@Injectable()
export class RateLimitGuard implements CanActivate {
  private readonly warn = throttledWarn(new Logger(RateLimitGuard.name));

  constructor(
    private readonly reflector: Reflector,
    private readonly limiter: RateLimitService,
  ) {}

  async canActivate(ctx: ExecutionContext): Promise<boolean> {
    const http = ctx.switchToHttp();
    const req = http.getRequest<AuthedRequest>();
    const ip = req.ip ?? 'unknown';
    const checks: [RateLimitPolicy, string][] = [[DEFAULT_IP_POLICY, ip]];
    if (req.principal) checks.push([DEFAULT_USER_POLICY, req.principal.userId]);
    const route = this.reflector.getAllAndOverride<RateLimitPolicy | undefined>(RATE_LIMIT, [
      ctx.getHandler(),
      ctx.getClass(),
    ]);
    if (route) checks.push([route, ip]);

    for (const [policy, subject] of checks) {
      let retryAfter: number;
      try {
        retryAfter = await this.limiter.hit(policy, subject);
      } catch (e) {
        if (!isRedisUnavailable(e)) throw e;
        if (route) throw serviceUnavailable();
        this.warn('rl', 'Límite de solicitudes sin Redis: se deja pasar (falla abierto)');
        return true;
      }
      if (retryAfter > 0) {
        http.getResponse<Response>().setHeader('Retry-After', String(retryAfter));
        throw new AppError(
          HttpStatus.TOO_MANY_REQUESTS,
          'RATE_LIMITED',
          'Demasiadas solicitudes. Intenta de nuevo en un momento.',
          { retryAfterSeconds: retryAfter },
        );
      }
    }
    return true;
  }
}
