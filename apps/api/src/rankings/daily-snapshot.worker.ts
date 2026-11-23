import {
  Inject,
  Injectable,
  Logger,
  type OnApplicationBootstrap,
  type OnModuleDestroy,
} from '@nestjs/common';
import { Worker, type Job } from 'bullmq';
import { redisConnection } from '../common/bullmq';
import { closeBullmq, throttledWarn } from '../common/redis-availability';
import { ENV, type Env } from '../config/env';
import { PrismaService } from '../infra/prisma.service';
import {
  DAILY_SNAPSHOT_JOB,
  RANKINGS_QUEUE,
  type DailySnapshotData,
} from './daily-snapshot.scheduler';
import { RankingsService } from './rankings.service';

/**
 * Worker de la cola `rankings`. Se activa con `JOBS_WORKER_ENABLED` (por defecto en cada instancia;
 * se puede separar en un servicio propio). Aunque haya varias instancias, BullMQ entrega cada
 * ejecución a un solo worker y la foto es idempotente (`skipDuplicates` sobre la clave única).
 */
@Injectable()
export class RankingJobsWorker implements OnApplicationBootstrap, OnModuleDestroy {
  private readonly logger = new Logger(RankingJobsWorker.name);
  private worker?: Worker<DailySnapshotData>;

  constructor(
    @Inject(ENV) private readonly env: Env,
    private readonly prisma: PrismaService,
    private readonly rankings: RankingsService,
  ) {}

  onApplicationBootstrap(): void {
    if (!this.env.JOBS_WORKER_ENABLED) return;
    this.worker = new Worker<DailySnapshotData>(RANKINGS_QUEUE, (job) => this.process(job), {
      connection: redisConnection(this.env.REDIS_URL),
      concurrency: 1,
    });
    const warn = throttledWarn(this.logger);
    this.worker.on('error', (e) => warn('worker', `Worker rankings: ${e.message}`));
    this.worker.on('failed', (job, err) => {
      this.logger.error(
        `Foto diaria fallida (${job?.data.countryCode ?? '?'}, intento ${job?.attemptsMade ?? '?'}): ${err.message}`,
      );
    });
  }

  async process(job: Job<DailySnapshotData>) {
    if (job.name !== DAILY_SNAPSHOT_JOB) throw new Error(`Trabajo desconocido: ${job.name}`);
    const country = await this.prisma.country.findUnique({
      where: { code: job.data.countryCode },
      select: { id: true, code: true, active: true },
    });
    if (!country?.active) return { skipped: 'COUNTRY_INACTIVE' };
    // El día de la foto es el de la hora PROGRAMADA (23:55 local), no el de la ejecución: un
    // reintento o una cola atrasada después de medianoche no cambia el día de la foto.
    const scheduledAt = new Date(job.opts.prevMillis ?? job.timestamp);
    const period = await this.prisma.rankingPeriod.findFirst({
      where: { countryId: country.id, status: 'OPEN' },
      orderBy: { startsAt: 'desc' },
    });
    if (!period || scheduledAt < period.startsAt) {
      this.logger.warn(`Foto diaria ${country.code}: no hay periodo abierto vigente`);
      return { skipped: 'NO_OPEN_PERIOD' };
    }
    if (scheduledAt >= period.endsAt) {
      // Sus puntos ya no cambian: otra foto no aporta y confundiría. Falta cerrarlo en el panel.
      this.logger.warn(`Foto diaria ${country.code}: el periodo ${period.id} venció sin cerrarse`);
      return { skipped: 'PERIOD_ENDED_NOT_CLOSED', periodId: period.id };
    }
    const res = await this.rankings.takeDailySnapshot(country.id, period.id, scheduledAt);
    this.logger.log(`Foto diaria ${country.code} ${res.snapshotDay}: ${res.count} filas`);
    return res;
  }

  async onModuleDestroy(): Promise<void> {
    await closeBullmq([this.worker]);
  }
}
