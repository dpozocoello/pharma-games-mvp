import { describe, expect, it } from 'vitest';
import { computePharmacyRanking } from './rankings';

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
