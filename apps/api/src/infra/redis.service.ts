import { Inject, Injectable, OnModuleDestroy } from '@nestjs/common';
import Redis from 'ioredis';
import { ENV, type Env } from '../config/env';

@Injectable()
export class RedisService implements OnModuleDestroy {
  readonly client: Redis;

  constructor(@Inject(ENV) env: Env) {
    this.client = new Redis(env.REDIS_URL, {
      lazyConnect: true,
      maxRetriesPerRequest: 2,
      enableOfflineQueue: false,
    });
  }

  async ping(): Promise<void> {
    if (this.client.status === 'wait') await this.client.connect();
    const res = await this.client.ping();
    if (res !== 'PONG') throw new Error('Redis no responde');
  }

  async onModuleDestroy(): Promise<void> {
    if (this.client.status !== 'end') await this.client.quit().catch(() => undefined);
  }
}
