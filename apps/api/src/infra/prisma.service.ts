import { Inject, Injectable, OnModuleDestroy } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';
import { ENV, type Env } from '../config/env';

@Injectable()
export class PrismaService extends PrismaClient implements OnModuleDestroy {
  // La URL sale de la configuración validada (no de process.env), igual que Redis.
  constructor(@Inject(ENV) env: Env) {
    super({ datasourceUrl: env.DATABASE_URL });
  }

  async ping(): Promise<void> {
    await this.$queryRaw`SELECT 1`;
  }

  async onModuleDestroy(): Promise<void> {
    await this.$disconnect();
  }
}
