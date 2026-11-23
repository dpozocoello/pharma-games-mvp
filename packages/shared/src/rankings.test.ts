import { describe, expect, it } from 'vitest';
import { attributePharmacyPoints, computePharmacyRanking } from './rankings';

describe('Ranking de farmacia: promedio por dependiente activo (Iteración 5)', () => {
  it('calcula el promedio por dependiente activo (no la suma) y excluye farmacias con 0 activos', () => {
    const ranked = computePharmacyRanking([
      {
        // Farmacia Grande: suma 300 pts entre 5 activos -> promedio 60 pts
        pharmacyId: 'ph-big',
        pharmacyName: 'Farmacia Grande (Suma Mayor)',
        city: 'Lima',
        clerkPoints: [
          { userId: 'u1', points: 60, isActiveInPeriod: true },
          { userId: 'u2', points: 60, isActiveInPeriod: true },
          { userId: 'u3', points: 60, isActiveInPeriod: true },
          { userId: 'u4', points: 60, isActiveInPeriod: true },
          { userId: 'u5', points: 60, isActiveInPeriod: true },
          { userId: 'u6', points: 0, isActiveInPeriod: false }, // Inactivo: no divide ni suma
        ],
      },
      {
        // Farmacia Pequeña: suma 200 pts entre 2 activos -> promedio 100 pts (GANA el #1)
        pharmacyId: 'ph-small',
        pharmacyName: 'Farmacia Pequeña (Mejor Promedio)',
        city: 'Arequipa',
        clerkPoints: [
          { userId: 'u7', points: 110, isActiveInPeriod: true },
          { userId: 'u8', points: 90, isActiveInPeriod: true },
          { userId: 'u9', points: 0, isActiveInPeriod: false },
        ],
      },
      {
        // Farmacia Sin Activos: 0 dependientes activos -> NO aparece en el ranking
        pharmacyId: 'ph-empty',
        pharmacyName: 'Farmacia Sin Participación',
        city: 'Trujillo',
        clerkPoints: [
          { userId: 'u10', points: 0, isActiveInPeriod: false },
          { userId: 'u11', points: 0, isActiveInPeriod: false },
        ],
      },
    ]);

    expect(ranked).toHaveLength(2);
    expect(ranked[0]?.entityId).toBe('ph-small');
    expect(ranked[0]?.position).toBe(1);
    expect(ranked[0]?.points).toBe(100);
    expect(ranked[0]?.activeClerks).toBe(2);

    expect(ranked[1]?.entityId).toBe('ph-big');
    expect(ranked[1]?.position).toBe(2);
    expect(ranked[1]?.points).toBe(60);
    expect(ranked[1]?.activeClerks).toBe(5);
  });
});

describe('Atribución por farmacia al momento de jugar (traslados, ADR-025)', () => {
  const d = (day: number) => new Date(Date.UTC(2026, 10, day, 15));
  // u1 estuvo en A del 1 al 10 y desde el 10 está en B.
  const assignments = [
    { userId: 'u1', pharmacyId: 'A', from: d(1), to: d(10) },
    { userId: 'u1', pharmacyId: 'B', from: d(10), to: null },
    { userId: 'u2', pharmacyId: 'A', from: d(1), to: null },
  ];

  it('los puntos se quedan en la farmacia donde se ganaron', () => {
    const res = attributePharmacyPoints({
      assignments,
      points: [
        { userId: 'u1', delta: 100, at: d(5) },
        { userId: 'u1', delta: 30, at: d(12) },
        { userId: 'u2', delta: 50, at: d(6) },
      ],
      finishedSessions: [
        { userId: 'u1', at: d(5) },
        { userId: 'u1', at: d(12) },
        { userId: 'u2', at: d(6) },
      ],
    });
    expect(res.get('A')).toEqual(
      new Map([
        ['u1', { points: 100, isActiveInPeriod: true }],
        ['u2', { points: 50, isActiveInPeriod: true }],
      ]),
    );
    expect(res.get('B')).toEqual(new Map([['u1', { points: 30, isActiveInPeriod: true }]]));
  });

  it('el día del traslado cuenta para la farmacia nueva (from incluido, to excluido)', () => {
    const res = attributePharmacyPoints({
      assignments,
      points: [{ userId: 'u1', delta: 10, at: d(10) }],
      finishedSessions: [{ userId: 'u1', at: d(10) }],
    });
    expect(res.get('A')?.has('u1') ?? false).toBe(false);
    expect(res.get('B')?.get('u1')).toEqual({ points: 10, isActiveInPeriod: true });
  });

  it('un traslado sin partidas en la farmacia nueva no la hace activa ni le lleva puntos', () => {
    const res = attributePharmacyPoints({
      assignments,
      points: [{ userId: 'u1', delta: 100, at: d(5) }],
      finishedSessions: [{ userId: 'u1', at: d(5) }],
    });
    expect(res.get('B')).toBeUndefined();
    const ranking = computePharmacyRanking(
      [...res.entries()].map(([pharmacyId, clerks]) => ({
        pharmacyId,
        pharmacyName: pharmacyId,
        city: 'Lima',
        clerkPoints: [...clerks.entries()].map(([userId, c]) => ({ userId, ...c })),
      })),
    );
    expect(ranking.map((r) => [r.entityId, r.points])).toEqual([['A', 100]]);
  });

  it('lo jugado sin farmacia asignada no cuenta para ninguna farmacia', () => {
    const res = attributePharmacyPoints({
      assignments: [{ userId: 'u3', pharmacyId: 'A', from: d(10), to: null }],
      points: [{ userId: 'u3', delta: 40, at: d(3) }],
      finishedSessions: [{ userId: 'u3', at: d(3) }],
    });
    expect(res.size).toBe(0);
  });
});
