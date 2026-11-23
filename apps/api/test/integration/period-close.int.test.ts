import { DEFAULT_POINTS_RULES, zonedMidnightUtc } from '@pharma/shared';
import type { Prisma } from '@prisma/client';
import { uuidv7 } from 'uuidv7';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { Principal } from '../../src/auth/principal';
import { RankingsService } from '../../src/rankings/rankings.service';
import { createHarness, type Harness } from './harness';

/**
 * Cierre de periodo (ADR-031), encontrado al emular el uso en staging: cerrar antes de la fecha de
 * fin abría el periodo siguiente en el mes próximo (lo jugado en el resto del mes no contaba), y se
 * declaraban ganadores con 0 puntos.
 */
let h: Harness;
let rankings: RankingsService;
const superAdmin: Principal = {
  userId: uuidv7(),
  role: 'SUPER_ADMIN',
  countryId: null,
  countryCode: null,
  app: 'admin',
};
const TZ = 'America/Lima';

beforeAll(async () => {
  h = await createHarness();
  rankings = h.app.get(RankingsService);
});
afterAll(async () => {
  await h.close();
});

/** País de prueba Z* (global-setup los borra en la siguiente ejecución) con un periodo dado. */
async function countryWithPeriod(startsAt: Date, endsAt: Date) {
  const used = new Set(
    (await h.prisma.country.findMany({ select: { code: true } })).map((c) => c.code),
  );
  const code = [...'ABCDEFGHIJKLMNOPQRSTUVWXYZ'].map((l) => `Z${l}`).find((c) => !used.has(c))!;
  const countryId = uuidv7();
  await h.prisma.country.create({
    data: {
      id: countryId,
      code,
      name: `Prueba ${code}`,
      locale: 'es-PE',
      timezone: TZ,
      phonePrefix: '+51',
      active: true,
    },
  });
  await h.prisma.countryConfig.create({
    data: {
      id: uuidv7(),
      countryId,
      terms: {},
      pointsRules: DEFAULT_POINTS_RULES as unknown as Prisma.InputJsonValue,
      rankingPeriodMonths: 1,
    },
  });
  const periodId = uuidv7();
  await h.prisma.rankingPeriod.create({
    data: { id: periodId, countryId, startsAt, endsAt, status: 'OPEN' },
  });
  return { countryId, periodId };
}

/** Primer instante del mes local actual y del anterior (los periodos son meses calendario). */
function monthBounds() {
  const [y, m] = new Intl.DateTimeFormat('en-CA', {
    timeZone: TZ,
    year: 'numeric',
    month: '2-digit',
  })
    .format(new Date())
    .split('-')
    .map(Number) as [number, number];
  const thisMonth = zonedMidnightUtc(y, m, 1, TZ);
  const prevMonth =
    m === 1 ? zonedMidnightUtc(y - 1, 12, 1, TZ) : zonedMidnightUtc(y, m - 1, 1, TZ);
  const nextMonth =
    m === 12 ? zonedMidnightUtc(y + 1, 1, 1, TZ) : zonedMidnightUtc(y, m + 1, 1, TZ);
  return { prevMonth, thisMonth, nextMonth };
}

describe('Cierre de periodo', () => {
  it('no permite cerrar un periodo que todavía no termina', async () => {
    const { thisMonth, nextMonth } = monthBounds();
    const { periodId } = await countryWithPeriod(thisMonth, nextMonth);

    await expect(rankings.closePeriod(superAdmin, periodId)).rejects.toMatchObject({
      response: { code: 'PERIOD_NOT_ENDED' },
    });
    const period = await h.prisma.rankingPeriod.findUniqueOrThrow({ where: { id: periodId } });
    expect(period.status).toBe('OPEN');
  });

  it('un periodo terminado se cierra, el siguiente cubre hoy y no hay ganadores con 0 puntos', async () => {
    const { prevMonth, thisMonth, nextMonth } = monthBounds();
    const { countryId, periodId } = await countryWithPeriod(prevMonth, thisMonth);

    const res = await rankings.closePeriod(superAdmin, periodId);
    expect(res.period.status).toBe('CLOSED');
    // Sin puntos en el periodo: nadie gana (ni siquiera el "país" con 0).
    expect(res.winnersCount).toBe(0);
    expect(await h.prisma.winner.count({ where: { periodId } })).toBe(0);

    const open = await h.prisma.rankingPeriod.findFirstOrThrow({
      where: { countryId, status: 'OPEN' },
    });
    expect(open.startsAt).toEqual(thisMonth);
    expect(open.endsAt).toEqual(nextMonth);
    const now = new Date();
    expect(open.startsAt <= now && now < open.endsAt).toBe(true);
  });
});
