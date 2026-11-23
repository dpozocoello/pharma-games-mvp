import { z } from 'zod';

export const rankingQueryScopeSchema = z.enum(['individual', 'pharmacy', 'country']);
export type RankingQueryScope = z.infer<typeof rankingQueryScopeSchema>;
/** `?limit=` de `GET /rankings`: 1 a 200, 50 por defecto. */
export const rankingLimitSchema = z.coerce.number().int().min(1).max(200).default(50);

export interface PharmacyRankingInput {
  pharmacyId: string;
  pharmacyName: string;
  city: string;
  /** Puntos elegibles en el periodo de cada dependiente asignado a esta farmacia. */
  clerkPoints: {
    userId: string;
    points: number;
    /** Dependiente activo = jugó al menos 1 partida terminada en ese periodo (CLAUDE.md §7). */
    isActiveInPeriod: boolean;
  }[];
}

export interface PharmacyRankingEntry {
  entityId: string;
  name: string;
  city: string;
  /** Promedio de puntos por dependiente activo (suma ÷ activos), redondeado a 2 decimales. */
  points: number;
  totalPoints: number;
  activeClerks: number;
  totalClerks: number;
  position: number;
}

/**
 * Calcula el ranking de farmacias (CLAUDE.md §3 módulo 9 y §7):
 * - Dependiente activo en un periodo = jugó al menos 1 partida terminada en ese periodo.
 * - Puntaje de la farmacia = suma de puntos del periodo de sus dependientes ÷ dependientes activos (NO suma).
 * - Con 0 dependientes activos la farmacia NO aparece en el ranking.
 */
export function computePharmacyRanking(pharmacies: PharmacyRankingInput[]): PharmacyRankingEntry[] {
  const entries: Omit<PharmacyRankingEntry, 'position'>[] = [];

  for (const ph of pharmacies) {
    const activeClerks = ph.clerkPoints.filter((c) => c.isActiveInPeriod).length;
    if (activeClerks === 0) continue; // Con 0 activos no aparece

    const totalPoints = ph.clerkPoints.reduce((acc, c) => acc + c.points, 0);
    const avgPoints = Math.round((totalPoints / activeClerks) * 100) / 100;

    entries.push({
      entityId: ph.pharmacyId,
      name: ph.pharmacyName,
      city: ph.city,
      points: avgPoints,
      totalPoints,
      activeClerks,
      totalClerks: ph.clerkPoints.length,
    });
  }

  entries.sort((a, b) => {
    if (b.points !== a.points) return b.points - a.points;
    if (b.totalPoints !== a.totalPoints) return b.totalPoints - a.totalPoints;
    return a.name.localeCompare(b.name);
  });

  return entries.map((e, idx) => ({
    ...e,
    position: idx + 1,
  }));
}

export interface AssignmentSpan {
  userId: string;
  pharmacyId: string;
  from: Date;
  /** Nulo = vigente. El instante `to` ya pertenece a la asignación siguiente. */
  to: Date | null;
}

/**
 * Atribuye a cada farmacia los puntos y la actividad del periodo según **dónde estaba asignado el
 * dependiente cuando jugó** (ADR-025): un traslado no se lleva los puntos ya ganados ni deja a la
 * farmacia nueva como "activa" hasta que juegue allí. Lo jugado sin farmacia asignada no cuenta
 * para ninguna farmacia (sí para el ranking individual).
 *
 * Devuelve `pharmacyId → (userId → { points, isActiveInPeriod })`.
 */
export function attributePharmacyPoints(input: {
  assignments: AssignmentSpan[];
  /** Movimientos elegibles del periodo, con el instante en que se acreditaron. */
  points: { userId: string; delta: number; at: Date }[];
  /** Partidas terminadas del periodo (definen al dependiente activo). */
  finishedSessions: { userId: string; at: Date }[];
}): Map<string, Map<string, { points: number; isActiveInPeriod: boolean }>> {
  const byUser = new Map<string, AssignmentSpan[]>();
  for (const a of input.assignments) {
    const list = byUser.get(a.userId) ?? [];
    list.push(a);
    byUser.set(a.userId, list);
  }
  const pharmacyAt = (userId: string, at: Date): string | null => {
    for (const a of byUser.get(userId) ?? []) {
      if (a.from <= at && (a.to === null || at < a.to)) return a.pharmacyId;
    }
    return null;
  };

  const out = new Map<string, Map<string, { points: number; isActiveInPeriod: boolean }>>();
  const cell = (pharmacyId: string, userId: string) => {
    let clerks = out.get(pharmacyId);
    if (!clerks) out.set(pharmacyId, (clerks = new Map()));
    let c = clerks.get(userId);
    if (!c) clerks.set(userId, (c = { points: 0, isActiveInPeriod: false }));
    return c;
  };

  for (const s of input.finishedSessions) {
    const ph = pharmacyAt(s.userId, s.at);
    if (ph) cell(ph, s.userId).isActiveInPeriod = true;
  }
  for (const e of input.points) {
    const ph = pharmacyAt(e.userId, e.at);
    if (ph) cell(ph, e.userId).points += e.delta;
  }
  return out;
}

export interface RankingRowView {
  position: number;
  entityId: string;
  displayName: string;
  subtitle?: string;
  points: number;
  activeClerks?: number;
}

export interface RankingsResponse {
  countryCode: string;
  period: {
    id: string;
    startsAt: string;
    endsAt: string;
    status: 'OPEN' | 'CLOSING' | 'CLOSED';
  };
  scope: RankingQueryScope;
  /** Las primeras `limit` filas (por defecto 50), no la clasificación completa. */
  rows: RankingRowView[];
  /** Total de filas del ámbito en el periodo. */
  totalRows: number;
  /** Fila de quien consulta (yo, mi farmacia o mi país), aunque no esté en `rows`. */
  me: RankingRowView | null;
  latestSnapshotDay: string | null;
}

export interface MyRankingAndProfileResponse {
  userId: string;
  displayName: string;
  countryCode: string;
  periodId: string;
  totalPoints: number;
  individualPosition: number | null;
  pharmacy: {
    id: string;
    name: string;
    averagePoints: number | null;
    position: number | null;
    activeClerks: number;
  } | null;
  sessionsPlayedInPeriod: number;
  recentSessions: {
    id: string;
    brandName: string;
    mechanic: 'MULTIPLE_CHOICE' | 'TRUE_FALSE';
    score: number;
    finishedAt: string;
  }[];
  pendingBrands: {
    brandId: string;
    brandSlug: string;
    brandName: string;
  }[];
}

export interface PharmacyManagerSummaryResponse {
  pharmacy: {
    id: string;
    name: string;
    city: string;
    externalCode: string | null;
  };
  periodId: string;
  teamTotalClerks: number;
  activeClerksCount: number;
  participationPercentage: number;
  pharmacyRankPosition: number | null;
  pharmacyAveragePoints: number | null;
  notEnteredMembers: {
    userId: string;
    displayName: string;
    phoneMasked: string;
    lastLoginAt: string | null;
    sessionsInPeriod: number;
  }[];
}
