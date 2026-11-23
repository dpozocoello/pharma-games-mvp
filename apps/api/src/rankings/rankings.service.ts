import {
  ForbiddenException,
  HttpStatus,
  Inject,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import type { RankingPeriod } from '@prisma/client';
import {
  attributePharmacyPoints,
  computePharmacyRanking,
  localDay,
  maskPhone,
  rankingPeriodBounds,
  sanitizeCsvCell,
  type MyRankingAndProfileResponse,
  type PharmacyManagerSummaryResponse,
  type RankingQueryScope,
  type RankingRowView,
  type RankingsResponse,
} from '@pharma/shared';
import { uuidv7 } from 'uuidv7';
import { AdminAnomaliesService } from '../admin/admin-anomalies.service';
import { AdminCountriesService } from '../admin/admin-countries.service';
import { AuditService } from '../audit/audit.service';
import type { Principal } from '../auth/principal';
import { AppError } from '../common/errors';
import { ENV, type Env } from '../config/env';
import { CountryConfigService } from '../countries/country-config.service';
import { PrismaService } from '../infra/prisma.service';
import { LiveRankingStore, type LiveScope } from './live-ranking.store';

/** Filas por defecto y máximas de `GET /rankings` (la lista completa no viaja al celular). */
export const RANKING_DEFAULT_LIMIT = 50;
export const RANKING_MAX_LIMIT = 200;
/** Si otra instancia está calculando la primera generación, se espera hasta esto antes de calcular. */
const COLD_WAIT_MS = 3_000;

type Standings = Awaited<ReturnType<RankingsService['computePeriodStandings']>>;

/** Lecturas de una clasificación ya calculada (desde Redis o, si Redis falla, desde memoria). */
interface StandingsView {
  top(scope: LiveScope, limit: number): Promise<{ rows: RankingRowView[]; total: number }>;
  row(scope: LiveScope, entityId: string): Promise<RankingRowView | null>;
  userPoints(userId: string): Promise<number>;
}

function scopeRows(s: Standings, scope: LiveScope): RankingRowView[] {
  return scope === 'individual'
    ? s.individualRows
    : scope === 'pharmacy'
      ? s.pharmacyRows
      : s.countryRows;
}

function memoryView(s: Standings): StandingsView {
  return {
    top: async (scope, limit) => {
      const rows = scopeRows(s, scope);
      return { rows: rows.slice(0, limit), total: rows.length };
    },
    row: async (scope, id) => scopeRows(s, scope).find((r) => r.entityId === id) ?? null,
    userPoints: async (id) => s.eligibleByUser.get(id) ?? 0,
  };
}

@Injectable()
export class RankingsService {
  private readonly logger = new Logger(RankingsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly live: LiveRankingStore,
    private readonly countries: CountryConfigService,
    private readonly adminCountries: AdminCountriesService,
    private readonly anomalies: AdminAnomaliesService,
    private readonly audit: AuditService,
    @Inject(ENV) private readonly env: Env,
  ) {}

  // ───────────────────────────── Ranking en vivo (ADR-023) ─────────────────────────────

  /**
   * Vista de la clasificación de un periodo para lecturas de la PWA.
   * - Sirve la generación vigente de Redis; si está vieja (cambió algo y pasó el intervalo mínimo,
   *   o superó la edad máxima), **una** instancia la reconstruye en segundo plano y mientras tanto
   *   todas siguen sirviendo la anterior.
   * - Sin generación (arranque en frío) espera a quien la calcula o la calcula ella misma.
   * - Si Redis falla, calcula desde PostgreSQL (lento pero correcto).
   */
  private async standingsView(countryId: string, period: RankingPeriod): Promise<StandingsView> {
    try {
      let cur = await this.live.current(period.id);
      const age = cur ? Date.now() - cur.generatedAtMs : Number.POSITIVE_INFINITY;
      const stale =
        !cur ||
        age >= this.env.RANKING_LIVE_MAX_AGE_MS ||
        (age >= this.env.RANKING_LIVE_MIN_REBUILD_MS && (await this.live.isDirty(countryId)));

      if (stale) {
        const token = await this.live.tryLock(period.id);
        if (token) {
          const job = this.rebuildLive(countryId, period, token);
          if (!cur) return memoryView(await job);
          job.catch((e: unknown) =>
            this.logger.warn(`No se pudo reconstruir el ranking en vivo: ${String(e)}`),
          );
          // Quien dispara la reconstrucción espera un poco: casi siempre es quien acaba de jugar y
          // espera verse. Si tarda más, recibe la versión anterior (las demás nunca esperan).
          const fresh = await Promise.race([
            job.catch(() => null),
            new Promise<null>((r) => setTimeout(() => r(null), this.env.RANKING_LIVE_WAIT_MS)),
          ]);
          if (fresh) return memoryView(fresh);
        } else if (!cur) {
          cur = await this.waitForGeneration(period.id);
          if (!cur) return memoryView(await this.computePeriodStandings(countryId, period.id));
        }
      }

      const gen = cur!.gen;
      return {
        top: (scope, limit) => this.live.top(period.id, gen, scope, limit),
        row: (scope, id) => this.live.row(period.id, gen, scope, id),
        userPoints: (id) => this.live.userPoints(period.id, gen, id),
      };
    } catch (e) {
      this.logger.warn(`Ranking en vivo no disponible, se calcula desde PostgreSQL: ${String(e)}`);
      return memoryView(await this.computePeriodStandings(countryId, period.id));
    }
  }

  private async rebuildLive(
    countryId: string,
    period: RankingPeriod,
    lockToken: string,
  ): Promise<Standings> {
    try {
      // Se limpia ANTES de leer: un cambio durante el cálculo vuelve a marcar el país.
      await this.live.clearDirty(countryId);
      const startedAt = Date.now();
      const standings = await this.computePeriodStandings(countryId, period.id);
      await this.live.publish(
        period.id,
        {
          rows: {
            individual: standings.individualRows,
            pharmacy: standings.pharmacyRows,
            country: standings.countryRows,
          },
          pointsByUser: standings.eligibleByUser,
        },
        startedAt,
      );
      return standings;
    } finally {
      await this.live.unlock(period.id, lockToken).catch(() => undefined);
    }
  }

  private async waitForGeneration(periodId: string) {
    const deadline = Date.now() + COLD_WAIT_MS;
    while (Date.now() < deadline) {
      await new Promise((r) => setTimeout(r, 100));
      const cur = await this.live.current(periodId);
      if (cur) return cur;
    }
    return null;
  }

  private async getCurrentOrLatestPeriod(countryId: string) {
    const open = await this.prisma.rankingPeriod.findFirst({
      where: { countryId, status: 'OPEN' },
      orderBy: { startsAt: 'desc' },
    });
    if (open) return open;

    const latest = await this.prisma.rankingPeriod.findFirst({
      where: { countryId },
      orderBy: { startsAt: 'desc' },
    });
    if (!latest) throw new NotFoundException('No hay periodo de ranking configurado en este país');
    return latest;
  }

  /**
   * Calcula desde PostgreSQL (fuente de verdad) las tablas `INDIVIDUAL`, `PHARMACY` y `COUNTRY` de un
   * país y periodo. Es costoso (lee todo el periodo): las lecturas de la PWA usan `standingsView`;
   * esto queda para reconstruir la vista en vivo, la foto diaria, el cierre y la exportación.
   */
  async computePeriodStandings(countryId: string, periodId: string) {
    const period = await this.prisma.rankingPeriod.findUnique({ where: { id: periodId } });
    if (!period || period.countryId !== countryId) {
      throw new NotFoundException('Periodo de ranking no encontrado');
    }

    const range = { startsAt: period.startsAt, endsAt: period.endsAt };
    const [eligibleEntries, finishedSessions, assignments, clerks, pharmacies, country] =
      await Promise.all([
        this.anomalies.computeEligibleEntries(countryId, range),
        this.prisma.gameSession.findMany({
          where: {
            countryId,
            status: 'FINISHED',
            startedAt: { gte: period.startsAt, lt: period.endsAt },
          },
          select: { userId: true, startedAt: true },
        }),
        // Historial de asignaciones que se cruza con el periodo (para atribuir por farmacia).
        this.prisma.pharmacyAssignment.findMany({
          where: {
            pharmacy: { countryId },
            from: { lt: period.endsAt },
            OR: [{ to: null }, { to: { gt: period.startsAt } }],
          },
          select: { userId: true, pharmacyId: true, from: true, to: true },
        }),
        this.prisma.user.findMany({
          where: { countryId, role: 'CLERK', status: 'ACTIVE' },
          select: {
            id: true,
            displayName: true,
            assignments: {
              where: { to: null },
              include: { pharmacy: { select: { id: true, name: true, city: true } } },
              take: 1,
            },
          },
        }),
        this.prisma.pharmacy.findMany({
          where: { countryId, active: true },
          select: { id: true, name: true, city: true },
        }),
        this.countries.getById(countryId),
      ]);

    const eligibleByUser = new Map<string, number>();
    for (const e of eligibleEntries) {
      eligibleByUser.set(e.userId, (eligibleByUser.get(e.userId) ?? 0) + e.delta);
    }

    // Dependiente activo en el periodo = jugó al menos 1 partida terminada en ese periodo (§7)
    const activeUserIds = new Set(finishedSessions.map((s) => s.userId));
    for (const [uid, pts] of eligibleByUser.entries()) {
      if (pts > 0) activeUserIds.add(uid);
    }

    // 1. Ranking Individual (solo dependientes con > 0 puntos o activos)
    const individualRows: RankingRowView[] = clerks
      .filter((u) => activeUserIds.has(u.id) || (eligibleByUser.get(u.id) ?? 0) > 0)
      .map((u) => ({
        position: 0,
        entityId: u.id,
        displayName: u.displayName,
        subtitle: u.assignments[0]?.pharmacy.name,
        points: eligibleByUser.get(u.id) ?? 0,
      }))
      .sort((a, b) => {
        if (b.points !== a.points) return b.points - a.points;
        return a.displayName.localeCompare(b.displayName);
      })
      .map((item, idx) => ({ ...item, position: idx + 1 }));

    // 2. Ranking por Farmacia (promedio por dependiente activo, NO suma; con 0 activos no aparece).
    // Cada punto y cada partida cuentan para la farmacia donde estaba el dependiente al jugar
    // (ADR-025): un traslado no se lleva los puntos ya ganados.
    const clerkIds = new Set(clerks.map((u) => u.id));
    const attributed = attributePharmacyPoints({
      assignments,
      points: eligibleEntries.filter((e) => clerkIds.has(e.userId)),
      finishedSessions: finishedSessions
        .filter((fs) => clerkIds.has(fs.userId))
        .map((fs) => ({ userId: fs.userId, at: fs.startedAt })),
    });
    const clerksByPharmacy = new Map(
      [...attributed.entries()].map(([phId, byClerk]) => [
        phId,
        [...byClerk.entries()].map(([userId, c]) => ({ userId, ...c })),
      ]),
    );

    const pharmacyRanked = computePharmacyRanking(
      pharmacies.map((ph) => ({
        pharmacyId: ph.id,
        pharmacyName: ph.name,
        city: ph.city,
        clerkPoints: clerksByPharmacy.get(ph.id) ?? [],
      })),
    );

    const pharmacyRows: RankingRowView[] = pharmacyRanked.map((ph) => ({
      position: ph.position,
      entityId: ph.entityId,
      displayName: ph.name,
      subtitle: ph.city,
      points: ph.points,
      activeClerks: ph.activeClerks,
    }));

    // 3. Ranking / Consolidado por País
    const totalCountryPoints = Array.from(eligibleByUser.values()).reduce((a, b) => a + b, 0);
    const countryRows: RankingRowView[] = [
      {
        position: 1,
        entityId: countryId,
        displayName: country?.name ?? 'País',
        subtitle: `${activeUserIds.size} participantes activos`,
        points: totalCountryPoints,
        activeClerks: activeUserIds.size,
      },
    ];

    return {
      period,
      country,
      activeUserIds,
      eligibleByUser,
      individualRows,
      pharmacyRows,
      countryRows,
    };
  }

  // ───────────────────────────── GET /rankings ─────────────────────────────

  async getRankings(
    p: Principal,
    scope: RankingQueryScope,
    limit = RANKING_DEFAULT_LIMIT,
  ): Promise<RankingsResponse> {
    if (!p.countryId) {
      throw new ForbiddenException('Se requiere un país en la cuenta para consultar rankings');
    }
    const countryId = p.countryId;
    const period = await this.getCurrentOrLatestPeriod(countryId);

    // "Mi fila" del ámbito pedido: yo, mi farmacia actual o mi país.
    const meEntityId =
      scope === 'individual'
        ? p.userId
        : scope === 'country'
          ? countryId
          : ((
              await this.prisma.pharmacyAssignment.findFirst({
                where: { userId: p.userId, to: null },
                select: { pharmacyId: true },
              })
            )?.pharmacyId ?? null);

    const [view, latestSnap, country] = await Promise.all([
      this.standingsView(countryId, period),
      this.prisma.rankingSnapshot.findFirst({
        where: { periodId: period.id },
        orderBy: { snapshotDay: 'desc' },
        select: { snapshotDay: true },
      }),
      this.countries.getById(countryId),
    ]);
    const [{ rows, total }, me] = await Promise.all([
      view.top(scope, Math.min(Math.max(1, limit), RANKING_MAX_LIMIT)),
      meEntityId ? view.row(scope, meEntityId) : Promise.resolve(null),
    ]);

    return {
      countryCode: country?.code ?? p.countryCode ?? 'PE',
      period: {
        id: period.id,
        startsAt: period.startsAt.toISOString(),
        endsAt: period.endsAt.toISOString(),
        status: period.status,
      },
      scope,
      rows,
      totalRows: total,
      me,
      latestSnapshotDay: latestSnap?.snapshotDay ?? null,
    };
  }

  // ───────────────────────────── Foto Diaria Oficial (RankingSnapshot) ─────────────────────────────

  /**
   * Foto oficial del ranking (`RankingSnapshot`), calculada desde PostgreSQL. `at` fija el día local
   * de la foto (el trabajo programado pasa su hora programada). Idempotente por día: si ya existe
   * la foto de ese día, se conserva la primera.
   */
  async takeDailySnapshot(
    countryId: string,
    periodId?: string,
    at: Date = new Date(),
  ): Promise<{ count: number; snapshotDay: string }> {
    const period = periodId
      ? await this.prisma.rankingPeriod.findUniqueOrThrow({ where: { id: periodId } })
      : await this.getCurrentOrLatestPeriod(countryId);

    const standings = await this.computePeriodStandings(countryId, period.id);
    const tz = standings.country?.timezone ?? 'America/Lima';
    const dayStr = localDay(at, tz);

    const rowsToPersist = [
      ...standings.individualRows.map((r) => ({
        id: uuidv7(),
        periodId: period.id,
        scope: 'INDIVIDUAL' as const,
        entityId: r.entityId,
        snapshotDay: dayStr,
        points: r.points,
        position: r.position,
        activeClerks: null,
      })),
      ...standings.pharmacyRows.map((r) => ({
        id: uuidv7(),
        periodId: period.id,
        scope: 'PHARMACY' as const,
        entityId: r.entityId,
        snapshotDay: dayStr,
        points: r.points,
        position: r.position,
        activeClerks: r.activeClerks ?? 1,
      })),
      ...standings.countryRows.map((r) => ({
        id: uuidv7(),
        periodId: period.id,
        scope: 'COUNTRY' as const,
        entityId: r.entityId,
        snapshotDay: dayStr,
        points: r.points,
        position: r.position,
        activeClerks: r.activeClerks ?? 0,
      })),
    ];

    if (rowsToPersist.length > 0) {
      await this.prisma.rankingSnapshot.createMany({
        data: rowsToPersist,
        skipDuplicates: true,
      });
    }

    return { count: rowsToPersist.length, snapshotDay: dayStr };
  }

  // ───────────────────────────── GET /me/ranking (Perfil + Posiciones) ─────────────────────────────

  async getMyRankingAndProfile(p: Principal): Promise<MyRankingAndProfileResponse> {
    if (!p.countryId) {
      throw new ForbiddenException('Se requiere país asociado');
    }
    const period = await this.getCurrentOrLatestPeriod(p.countryId);
    const view = await this.standingsView(p.countryId, period);

    const user = await this.prisma.user.findUniqueOrThrow({
      where: { id: p.userId },
      include: {
        assignments: {
          where: { to: null },
          include: { pharmacy: true },
          take: 1,
        },
      },
    });

    const recentSessions = await this.prisma.gameSession.findMany({
      where: {
        userId: p.userId,
        countryId: p.countryId,
        status: 'FINISHED',
      },
      orderBy: { finishedAt: 'desc' },
      take: 20,
      include: {
        game: { include: { brand: { select: { id: true, slug: true, name: true } } } },
      },
    });

    const activeBrands = await this.prisma.brandCountry.findMany({
      where: { countryId: p.countryId, active: true },
      include: { brand: { select: { id: true, slug: true, name: true } } },
      orderBy: { brand: { name: 'asc' } },
    });

    // Partidas y marcas del periodo completo (no solo de las últimas 20 que se muestran).
    const inPeriod = {
      userId: p.userId,
      countryId: p.countryId,
      status: 'FINISHED' as const,
      startedAt: { gte: period.startsAt, lt: period.endsAt },
    };
    const [sessionsPlayedInPeriod, brandsPlayed] = await Promise.all([
      this.prisma.gameSession.count({ where: inPeriod }),
      this.prisma.gameSession.groupBy({ by: ['brandId'], where: inPeriod }),
    ]);
    const playedBrandIds = new Set(brandsPlayed.map((b) => b.brandId));
    const pendingBrands = activeBrands
      .filter((bc) => !playedBrandIds.has(bc.brandId))
      .map((bc) => ({
        brandId: bc.brand.id,
        brandSlug: bc.brand.slug,
        brandName: bc.brand.name,
      }));

    const currentPharmacy = user.assignments[0]?.pharmacy ?? null;
    const [myIndRow, myPhRow, totalPoints, country] = await Promise.all([
      view.row('individual', p.userId),
      currentPharmacy ? view.row('pharmacy', currentPharmacy.id) : Promise.resolve(null),
      view.userPoints(user.id),
      this.countries.getById(p.countryId),
    ]);

    return {
      userId: user.id,
      displayName: user.displayName,
      countryCode: country?.code ?? p.countryCode ?? 'PE',
      periodId: period.id,
      totalPoints,
      individualPosition: myIndRow?.position ?? null,
      pharmacy: currentPharmacy
        ? {
            id: currentPharmacy.id,
            name: currentPharmacy.name,
            averagePoints: myPhRow?.points ?? null,
            position: myPhRow?.position ?? null,
            activeClerks: myPhRow?.activeClerks ?? 0,
          }
        : null,
      sessionsPlayedInPeriod,
      recentSessions: recentSessions.map((s) => ({
        id: s.id,
        brandName: s.game.brand.name,
        mechanic: s.game.mechanic,
        score: s.score ?? 0,
        finishedAt: (s.finishedAt ?? s.startedAt).toISOString(),
      })),
      pendingBrands,
    };
  }

  // ───────────────────────────── GET /manager/pharmacy/summary (Módulo 10) ─────────────────────────────

  async getManagerPharmacySummary(p: Principal): Promise<PharmacyManagerSummaryResponse> {
    if (!p.countryId) {
      throw new ForbiddenException('Se requiere país asociado');
    }
    const managerAssign = await this.prisma.pharmacyAssignment.findFirst({
      where: { userId: p.userId, to: null },
      include: { pharmacy: true },
    });
    if (!managerAssign) {
      throw new AppError(
        HttpStatus.NOT_FOUND,
        'MANAGER_WITHOUT_PHARMACY',
        'Tu cuenta de gerente no tiene una farmacia activa asignada.',
      );
    }

    const pharmacy = managerAssign.pharmacy;
    const period = await this.getCurrentOrLatestPeriod(p.countryId);
    const view = await this.standingsView(p.countryId, period);

    const teamAssignments = await this.prisma.pharmacyAssignment.findMany({
      where: { pharmacyId: pharmacy.id, to: null },
      include: {
        user: {
          select: {
            id: true,
            displayName: true,
            phoneE164: true,
            role: true,
            status: true,
            lastLoginAt: true,
          },
        },
      },
    });

    const clerks = teamAssignments
      .map((a) => a.user)
      .filter((u) => u.role === 'CLERK' && u.status === 'ACTIVE');

    const clerkSessions = await this.prisma.gameSession.findMany({
      where: {
        userId: { in: clerks.map((c) => c.id) },
        status: 'FINISHED',
        startedAt: { gte: period.startsAt, lt: period.endsAt },
      },
      select: { userId: true },
    });

    const sessionCountByClerk = new Map<string, number>();
    for (const s of clerkSessions) {
      sessionCountByClerk.set(s.userId, (sessionCountByClerk.get(s.userId) ?? 0) + 1);
    }

    const activeClerksCount = clerks.filter((c) => (sessionCountByClerk.get(c.id) ?? 0) > 0).length;
    const participationPercentage =
      clerks.length > 0 ? Math.round((activeClerksCount / clerks.length) * 1000) / 10 : 0;

    // Quién no ha entrado o no ha participado en el periodo
    const notEnteredMembers = clerks
      .filter((c) => (sessionCountByClerk.get(c.id) ?? 0) === 0 || !c.lastLoginAt)
      .map((c) => ({
        userId: c.id,
        displayName: c.displayName,
        phoneMasked: maskPhone(c.phoneE164),
        lastLoginAt: c.lastLoginAt ? c.lastLoginAt.toISOString() : null,
        sessionsInPeriod: sessionCountByClerk.get(c.id) ?? 0,
      }));

    const phRankRow = await view.row('pharmacy', pharmacy.id);

    return {
      pharmacy: {
        id: pharmacy.id,
        name: pharmacy.name,
        city: pharmacy.city,
        externalCode: pharmacy.externalCode,
      },
      periodId: period.id,
      teamTotalClerks: clerks.length,
      activeClerksCount,
      participationPercentage,
      pharmacyRankPosition: phRankRow?.position ?? null,
      pharmacyAveragePoints: phRankRow?.points ?? null,
      notEnteredMembers,
    };
  }

  // ───────────────────────────── Cierre de Periodo y Ganadores CSV ─────────────────────────────

  async closePeriod(p: Principal, periodId: string) {
    const period = await this.prisma.rankingPeriod.findUnique({
      where: { id: periodId },
      include: { country: true },
    });
    if (!period) throw new NotFoundException('Periodo de ranking no encontrado');
    await this.adminCountries.scoped(p, period.country.code);

    if (period.status === 'CLOSED') {
      const existingWinners = await this.prisma.winner.findMany({
        where: { periodId: period.id },
        orderBy: [{ scope: 'asc' }, { position: 'asc' }],
      });
      return { period, winnersCount: existingWinners.length };
    }

    // Un periodo solo se cierra cuando terminó (ADR-031). Cerrarlo antes abría el siguiente en el
    // mes próximo y lo jugado en el resto del mes no contaba para ningún periodo.
    if (new Date() < period.endsAt) {
      const endsLocal = new Intl.DateTimeFormat('es', {
        timeZone: period.country.timezone,
        dateStyle: 'long',
        timeStyle: 'short',
      }).format(period.endsAt);
      throw new AppError(
        HttpStatus.CONFLICT,
        'PERIOD_NOT_ENDED',
        `El periodo termina el ${endsLocal}; se puede cerrar desde ese momento.`,
        { endsAt: period.endsAt.toISOString() },
      );
    }

    // 1. Tomar foto oficial final antes de cerrar
    await this.takeDailySnapshot(period.countryId, period.id);
    const standings = await this.computePeriodStandings(period.countryId, period.id);

    // Solo gana quien tiene puntos que cuentan (los que están en revisión no suman).
    const withPoints = (r: RankingRowView) => r.points > 0;
    const topIndividuals = standings.individualRows.filter(withPoints).slice(0, 10);
    const topPharmacies = standings.pharmacyRows.filter(withPoints).slice(0, 10);
    const topCountry = standings.countryRows.filter(withPoints).slice(0, 1);

    const winnersData = [
      ...topIndividuals.map((r) => ({
        id: uuidv7(),
        periodId: period.id,
        scope: 'INDIVIDUAL' as const,
        entityId: r.entityId,
        position: r.position,
      })),
      ...topPharmacies.map((r) => ({
        id: uuidv7(),
        periodId: period.id,
        scope: 'PHARMACY' as const,
        entityId: r.entityId,
        position: r.position,
      })),
      ...topCountry.map((r) => ({
        id: uuidv7(),
        periodId: period.id,
        scope: 'COUNTRY' as const,
        entityId: r.entityId,
        position: r.position,
      })),
    ];

    const cfg = await this.countries.getById(period.countryId);
    const months = cfg?.rankingPeriodMonths ?? 1;
    const nextBounds = rankingPeriodBounds(
      new Date(period.endsAt.getTime() + 60_000),
      period.country.timezone,
      months,
    );

    await this.prisma.$transaction(async (tx) => {
      await tx.rankingPeriod.update({
        where: { id: period.id },
        data: { status: 'CLOSED' },
      });

      if (winnersData.length > 0) {
        await tx.winner.createMany({
          data: winnersData,
          skipDuplicates: true,
        });
      }

      // Abrir automáticamente el siguiente periodo del país si no hay otro OPEN
      const hasOpen = await tx.rankingPeriod.findFirst({
        where: { countryId: period.countryId, status: 'OPEN', id: { not: period.id } },
      });
      if (!hasOpen) {
        await tx.rankingPeriod.create({
          data: {
            id: uuidv7(),
            countryId: period.countryId,
            startsAt: nextBounds.startsAt,
            endsAt: nextBounds.endsAt,
            status: 'OPEN',
          },
        });
      }

      await this.audit.log(
        {
          actorId: p.userId,
          countryId: period.countryId,
          action: 'RANKING_PERIOD_CLOSE',
          entity: 'RankingPeriod',
          entityId: period.id,
          before: { status: period.status },
          after: { status: 'CLOSED', winnersCount: winnersData.length },
        },
        tx,
      );
    });

    await this.live.markDirty(period.countryId);
    const updatedPeriod = await this.prisma.rankingPeriod.findUniqueOrThrow({
      where: { id: period.id },
    });
    return { period: updatedPeriod, winnersCount: winnersData.length };
  }

  async exportWinnersCsv(p: Principal, periodId: string): Promise<string> {
    const period = await this.prisma.rankingPeriod.findUnique({
      where: { id: periodId },
      include: { country: true },
    });
    if (!period) throw new NotFoundException('Periodo de ranking no encontrado');
    await this.adminCountries.scoped(p, period.country.code);

    const [winners, standings] = await Promise.all([
      this.prisma.winner.findMany({
        where: { periodId: period.id },
        orderBy: [{ scope: 'asc' }, { position: 'asc' }],
      }),
      this.computePeriodStandings(period.countryId, period.id),
    ]);

    const now = new Date();
    await this.prisma.$transaction(async (tx) => {
      await tx.winner.updateMany({
        where: { periodId: period.id },
        data: { exportedAt: now },
      });
      await this.audit.log(
        {
          actorId: p.userId,
          countryId: period.countryId,
          action: 'EXPORT_WINNERS_CSV',
          entity: 'RankingPeriod',
          entityId: period.id,
          after: { winnersCount: winners.length },
        },
        tx,
      );
    });

    const lines = ['periodId,countryCode,scope,position,entityId,displayName,points'];
    for (const w of winners) {
      const list =
        w.scope === 'INDIVIDUAL'
          ? standings.individualRows
          : w.scope === 'PHARMACY'
            ? standings.pharmacyRows
            : standings.countryRows;
      const match = list.find((r) => r.entityId === w.entityId);
      const safeName = sanitizeCsvCell(match?.displayName ?? w.entityId);
      const pts = match?.points ?? 0;
      lines.push(
        `${period.id},${period.country.code},${w.scope},${w.position},${w.entityId},${safeName},${pts}`,
      );
    }

    return lines.join('\n') + '\n';
  }
}
