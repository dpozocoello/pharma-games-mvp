import { localDay, zonedMidnightUtc } from '@pharma/shared';
import { Queue, QueueEvents, type Job } from 'bullmq';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { redisConnection } from '../../src/common/bullmq';
import {
  DAILY_SNAPSHOT_JOB,
  DailySnapshotScheduler,
  RANKINGS_QUEUE,
  type DailySnapshotData,
} from '../../src/rankings/daily-snapshot.scheduler';
import { RankingJobsWorker } from '../../src/rankings/daily-snapshot.worker';
import { createHarness, type Harness } from './harness';

/** Foto oficial diaria programada por país (CLAUDE.md §9 y §11) con BullMQ y Redis reales. */
let h: Harness;
let scheduler: DailySnapshotScheduler;
let worker: RankingJobsWorker;

beforeAll(async () => {
  h = await createHarness();
  scheduler = h.app.get(DailySnapshotScheduler);
  worker = h.app.get(RankingJobsWorker);
});
afterAll(async () => {
  await h.close();
});

/** Trabajo como lo crea el programador de BullMQ: `prevMillis` es la hora programada. */
function scheduledJob(countryCode: string, scheduledAt: Date): Job<DailySnapshotData> {
  return {
    name: DAILY_SNAPSHOT_JOB,
    data: { countryCode },
    opts: { prevMillis: scheduledAt.getTime() },
    timestamp: Date.now(),
  } as unknown as Job<DailySnapshotData>;
}

/** Hoy a las 23:55 en la zona del país (en UTC ya es el día siguiente). */
function todayAt2355(tz: string): { at: Date; day: string } {
  const day = localDay(new Date(), tz);
  const [y, m, d] = day.split('-').map(Number) as [number, number, number];
  return { at: new Date(zonedMidnightUtc(y, m, d, tz).getTime() + (23 * 60 + 55) * 60_000), day };
}

describe('Foto oficial diaria', () => {
  it('al arrancar programa un cron por país activo, a las 23:55 en su zona horaria', async () => {
    const countries = await h.prisma.country.findMany({ where: { active: true } });
    const schedulers = await scheduler.list();
    for (const c of countries) {
      const s = schedulers.find((x) => x.key === `${DAILY_SNAPSHOT_JOB}:${c.code}`);
      expect(s, c.code).toBeDefined();
      expect(s!.pattern).toBe('55 23 * * *');
      expect(s!.tz).toBe(c.timezone);
      expect(s!.template?.data).toEqual({ countryCode: c.code });
      // La próxima ejecución que calculó BullMQ es a las 23:55 en la hora local del país.
      const hhmm = new Intl.DateTimeFormat('en-GB', {
        timeZone: c.timezone,
        hour: '2-digit',
        minute: '2-digit',
        hourCycle: 'h23',
      }).format(new Date(s!.next!));
      expect(hhmm, c.code).toBe('23:55');
    }
    const tzs = Object.fromEntries(countries.map((c) => [c.code, c.timezone]));
    expect(tzs).toMatchObject({
      PE: 'America/Lima',
      CO: 'America/Bogota',
      EC: 'America/Guayaquil',
    });
  });

  it('desactivar un país quita su programación y reactivarlo la vuelve a crear', async () => {
    const zz = { code: 'ZQ', timezone: 'America/Lima', active: true };
    await scheduler.sync(zz);
    expect((await scheduler.list()).some((s) => s.key === `${DAILY_SNAPSHOT_JOB}:ZQ`)).toBe(true);
    await scheduler.sync({ ...zz, active: false });
    expect((await scheduler.list()).some((s) => s.key === `${DAILY_SNAPSHOT_JOB}:ZQ`)).toBe(false);
  });

  it('la foto usa el día local de la hora programada (23:55 Lima ya es mañana en UTC)', async () => {
    const pe = await h.prisma.country.findUniqueOrThrow({ where: { code: 'PE' } });
    const { at, day } = todayAt2355(pe.timezone);
    expect(at.toISOString().slice(0, 10)).not.toBe(day); // en UTC cae en otro día

    const res = (await worker.process(scheduledJob('PE', at))) as { snapshotDay: string };
    expect(res.snapshotDay).toBe(day);

    const period = await h.prisma.rankingPeriod.findFirstOrThrow({
      where: { countryId: pe.id, status: 'OPEN' },
    });
    const rows = await h.prisma.rankingSnapshot.findMany({
      where: { periodId: period.id, snapshotDay: day },
    });
    expect(rows.some((r) => r.scope === 'COUNTRY')).toBe(true);

    // Un reintento del mismo día no duplica filas.
    await worker.process(scheduledJob('PE', at));
    const again = await h.prisma.rankingSnapshot.count({
      where: { periodId: period.id, snapshotDay: day },
    });
    expect(again).toBe(rows.length);
  });

  it('no fotografía un periodo que venció sin cerrarse', async () => {
    const pe = await h.prisma.country.findUniqueOrThrow({ where: { code: 'PE' } });
    const period = await h.prisma.rankingPeriod.findFirstOrThrow({
      where: { countryId: pe.id, status: 'OPEN' },
    });
    const after = new Date(period.endsAt.getTime() + 60_000);
    const res = await worker.process(scheduledJob('PE', after));
    expect(res).toEqual({ skipped: 'PERIOD_ENDED_NOT_CLOSED', periodId: period.id });
    const day = localDay(after, pe.timezone);
    expect(
      await h.prisma.rankingSnapshot.count({ where: { periodId: period.id, snapshotDay: day } }),
    ).toBe(0);
  });

  it('de punta a punta: el worker de la API procesa un trabajo de la cola y guarda la foto', async () => {
    const connection = redisConnection(h.env.REDIS_URL);
    const queue = new Queue<DailySnapshotData>(RANKINGS_QUEUE, { connection });
    const events = new QueueEvents(RANKINGS_QUEUE, { connection });
    try {
      await events.waitUntilReady();
      const job = await queue.add(DAILY_SNAPSHOT_JOB, { countryCode: 'EC' });
      const result = (await job.waitUntilFinished(events, 15_000)) as { snapshotDay: string };

      const ec = await h.prisma.country.findUniqueOrThrow({ where: { code: 'EC' } });
      expect(result.snapshotDay).toBe(localDay(new Date(job.timestamp), ec.timezone));
      const period = await h.prisma.rankingPeriod.findFirstOrThrow({
        where: { countryId: ec.id, status: 'OPEN' },
      });
      expect(
        await h.prisma.rankingSnapshot.count({
          where: { periodId: period.id, snapshotDay: result.snapshotDay, scope: 'COUNTRY' },
        }),
      ).toBe(1);
    } finally {
      await events.close();
      await queue.close();
    }
  });
});
