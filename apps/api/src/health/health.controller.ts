import { Controller, Get, HttpCode, ServiceUnavailableException } from '@nestjs/common';
import { PrismaService } from '../infra/prisma.service';
import { RedisService } from '../infra/redis.service';

/** Sondas fuera del prefijo /api/v1: `/health` (vivo) y `/ready` (listo para tráfico). */
@Controller()
export class HealthController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly redis: RedisService,
  ) {}

  @Get('health')
  @HttpCode(200)
  health() {
    return { status: 'ok' };
  }

  @Get('ready')
  async ready() {
    const checks = await Promise.allSettled([this.prisma.ping(), this.redis.ping()]);
    const [db, cache] = checks.map((c) => (c.status === 'fulfilled' ? 'up' : 'down'));
    if (db !== 'up' || cache !== 'up') {
      throw new ServiceUnavailableException({
        message: 'Dependencias no disponibles',
        db,
        redis: cache,
      });
    }
    return { status: 'ok', db, redis: cache };
  }
}
