import { Inject, Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { Queue, Worker, type ConnectionOptions } from 'bullmq';
import { ENV, type Env } from '../../config/env';
import { OtpDeliveryService, type OtpMessage } from './providers';

const QUEUE = 'otp';

function connection(url: string): ConnectionOptions {
  const u = new URL(url);
  return {
    host: u.hostname,
    port: Number(u.port || 6379),
    username: u.username || undefined,
    password: u.password ? decodeURIComponent(u.password) : undefined,
    db: u.pathname.length > 1 ? Number(u.pathname.slice(1)) : 0,
    tls: u.protocol === 'rediss:' ? {} : undefined,
    // Requerido por BullMQ para conexiones bloqueantes del worker.
    maxRetriesPerRequest: null,
  };
}

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
    const conn = connection(this.env.REDIS_URL);
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
