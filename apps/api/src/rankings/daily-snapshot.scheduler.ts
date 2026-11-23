import {
  Inject,
  Injectable,
  Logger,
  type OnApplicationBootstrap,
  type OnModuleDestroy,
} from '@nestjs/common';
import { Queue } from 'bullmq';
import { redisConnection } from '../common/bullmq';
import { ENV, type Env } from '../config/env';
import { PrismaService } from '../infra/prisma.service';

export const RANKINGS_QUEUE = 'rankings';
export const DAILY_SNAPSHOT_JOB = 'daily-snapshot';
const schedulerId = (countryCode: string) => `${DAILY_SNAPSHOT_JOB}:${countryCode}`;

export interface DailySnapshotData {
  countryCode: string;
}

/**
 * Programa la **foto oficial diaria** del ranking por país (CLAUDE.md §9 y §11) con
 * `upsertJobScheduler` de BullMQ: un cron por país en **su** zona horaria
 * (`America/Lima`, `America/Bogota`, `America/Guayaquil`), por defecto a las 23:55 locales.
 *
 * Es idempotente: todas las instancias lo sincronizan al arrancar y el panel lo vuelve a sincronizar
 * al crear o modificar un país (zona horaria, activación). Un país inactivo no tiene programación.
 */
@Injectable()
export class DailySnapshotScheduler implements OnApplicationBootstrap, OnModuleDestroy {
  private readonly logger = new Logger(DailySnapshotScheduler.name);
  private queue?: Queue<DailySnapshotData>;

  constructor(
    @Inject(ENV) private readonly env: Env,
    private readonly prisma: PrismaService,
  ) {}

  async onApplicationBootstrap(): Promise<void> {
    await this.syncAll().catch((e: unknown) =>
      // Sin Redis al arrancar no se cae la API: la siguiente instancia o sincronización lo reintenta.
      this.logger.warn(`No se pudo programar la foto diaria: ${String(e)}`),
    );
  }

  /** Crea, actualiza o quita la programación de cada país según su estado y zona horaria. */
  async syncAll(): Promise<void> {
    const countries = await this.prisma.country.findMany({
      select: { code: true, timezone: true, active: true },
    });
    for (const c of countries) await this.sync(c);
  }

  async sync(c: { code: string; timezone: string; active: boolean }): Promise<void> {
    const queue = this.getQueue();
    if (!c.active) {
      await queue.removeJobScheduler(schedulerId(c.code));
      return;
    }
    await queue.upsertJobScheduler(
      schedulerId(c.code),
      { pattern: this.env.RANKING_SNAPSHOT_CRON, tz: c.timezone },
      {
        name: DAILY_SNAPSHOT_JOB,
        data: { countryCode: c.code },
        opts: {
          attempts: 5,
          backoff: { type: 'exponential', delay: 30_000 },
          removeOnComplete: { count: 400 },
          removeOnFail: { count: 400 },
        },
      },
    );
  }

  /** Programación vigente (para pruebas y diagnóstico). */
  async list() {
    return this.getQueue().getJobSchedulers();
  }

  private getQueue(): Queue<DailySnapshotData> {
    this.queue ??= new Queue<DailySnapshotData>(RANKINGS_QUEUE, {
      connection: redisConnection(this.env.REDIS_URL),
    });
    return this.queue;
  }

  async onModuleDestroy(): Promise<void> {
    await this.queue?.close();
  }
}
