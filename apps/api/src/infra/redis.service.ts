import { Inject, Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import Redis from 'ioredis';
import { ENV, type Env } from '../config/env';

@Injectable()
export class RedisService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(RedisService.name);
  readonly client: Redis;

  constructor(@Inject(ENV) env: Env) {
    this.client = new Redis(env.REDIS_URL, {
      lazyConnect: true,
      maxRetriesPerRequest: 2,
      // Sin cola offline: si Redis cae, los comandos fallan rápido en vez de acumularse.
      enableOfflineQueue: false,
    });
  }

  /** Conecta al arrancar. Si Redis no está, la API arranca igual y `/ready` responde 503. */
  async onModuleInit(): Promise<void> {
    await this.ensureConnected().catch((e: unknown) => {
      this.logger.warn(`Redis no disponible al arrancar: ${String(e)}`);
    });
  }

  async ping(): Promise<void> {
    await this.ensureConnected();
    const res = await this.client.ping();
    if (res !== 'PONG') throw new Error('Redis no responde');
  }

  private async ensureConnected(): Promise<void> {
    if (this.client.status === 'wait') await this.client.connect();
  }

  async onModuleDestroy(): Promise<void> {
    if (this.client.status !== 'end') await this.client.quit().catch(() => undefined);
  }
}
