import { describe, expect, it } from 'vitest';
import { localDay, rankingPeriodBounds, timeZoneOffsetMs, zonedMidnightUtc } from './time';

describe('zonas horarias de los países', () => {
  it('Lima, Bogotá y Guayaquil están en UTC−5', () => {
    const d = new Date('2026-06-15T12:00:00Z');
    for (const tz of ['America/Lima', 'America/Bogota', 'America/Guayaquil']) {
      expect(timeZoneOffsetMs(d, tz)).toBe(-5 * 3600 * 1000);
    }
  });

  it('el día local cambia a las 05:00 UTC', () => {
    expect(localDay(new Date('2026-03-02T04:59:59Z'), 'America/Lima')).toBe('2026-03-01');
    expect(localDay(new Date('2026-03-02T05:00:00Z'), 'America/Lima')).toBe('2026-03-02');
  });

  it('medianoche local en UTC', () => {
    expect(zonedMidnightUtc(2026, 1, 1, 'America/Bogota').toISOString()).toBe(
      '2026-01-01T05:00:00.000Z',
    );
  });
});

describe('rankingPeriodBounds', () => {
  it('periodo mensual', () => {
    const b = rankingPeriodBounds(new Date('2026-11-17T15:00:00Z'), 'America/Lima', 1);
    expect(b.startsAt.toISOString()).toBe('2026-11-01T05:00:00.000Z');
    expect(b.endsAt.toISOString()).toBe('2026-12-01T05:00:00.000Z');
  });

  it('periodo trimestral que cruza el año', () => {
    const b = rankingPeriodBounds(new Date('2026-11-17T15:00:00Z'), 'America/Lima', 3);
    expect(b.startsAt.toISOString()).toBe('2026-10-01T05:00:00.000Z');
    expect(b.endsAt.toISOString()).toBe('2027-01-01T05:00:00.000Z');
  });

  it('el primer instante de diciembre en hora local pertenece a diciembre', () => {
    const b = rankingPeriodBounds(new Date('2026-12-01T05:00:00Z'), 'America/Lima', 1);
    expect(b.startsAt.toISOString()).toBe('2026-12-01T05:00:00.000Z');
  });
});
