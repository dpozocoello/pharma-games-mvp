import { Inject, Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { Queue, Worker } from 'bullmq';
import { redisConnection } from '../../common/bullmq';
import { ENV, type Env } from '../../config/env';
import { OtpDeliveryService, type OtpMessage } from './providers';

const QUEUE = 'otp';

/**
 * Cola BullMQ de envío de OTP (CLAUDE.md §5). La solicitud HTTP solo encola; el worker envía con
 * reintentos y respaldo SMS. El trabajo contiene el código: se borra al completarse y los fallidos
 * se purgan en una hora.
 */
@Injectable()
export class OtpQueue implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(OtpQueue.name);
  private queue?: Queue<OtpMessage>;
  private worker?: Worker<OtpMessage>;

  constructor(
    @Inject(ENV) private readonly env: Env,
    private readonly delivery: OtpDeliveryService,
  ) {}

  onModuleInit(): void {
    const conn = redisConnection(this.env.REDIS_URL);
    this.queue = new Queue<OtpMessage>(QUEUE, { connection: conn });
    if (this.env.OTP_WORKER_ENABLED) {
      this.worker = new Worker<OtpMessage>(
        QUEUE,
        async (job) => {
          const channel = await this.delivery.deliver(job.data);
          return { channel };
        },
        { connection: conn, concurrency: 20 },
      );
      this.worker.on('failed', (job, err) => {
        this.logger.warn(`Envío OTP fallido (intento ${job?.attemptsMade ?? '?'}): ${err.message}`);
      });
    }
  }

  async enqueue(msg: OtpMessage): Promise<void> {
    if (!this.queue) throw new Error('Cola OTP no inicializada');
    await this.queue.add('send', msg, {
      attempts: 3,
      backoff: { type: 'exponential', delay: 2000 },
      removeOnComplete: true,
      removeOnFail: { age: 3600 },
    });
  }

  async onModuleDestroy(): Promise<void> {
    await this.worker?.close();
    await this.queue?.close();
  }
}
