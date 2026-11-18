import { ForbiddenException, HttpStatus, Injectable, NotFoundException } from '@nestjs/common';
import {
  computePharmacyRanking,
  localDay,
  maskPhone,
  rankingPeriodBounds,
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
import { CountryConfigService } from '../countries/country-config.service';
import { PrismaService } from '../infra/prisma.service';
import { RedisService } from '../infra/redis.service';

@Injectable()
export class RankingsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly redis: RedisService,
    private readonly countries: CountryConfigService,
    private readonly adminCountries: AdminCountriesService,
    private readonly anomalies: AdminAnomaliesService,
    private readonly audit: AuditService,
  ) {}

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
   * Calcula las tablas de ranking en vivo (`INDIVIDUAL`, `PHARMACY`, `COUNTRY`) de un país y periodo,
   * sincronizando los sorted sets de Redis (`ZADD`) cuando Redis está conectado.
   */
  async computePeriodStandings(countryId: string, periodId: string) {
    const period = await this.prisma.rankingPeriod.findUnique({ where: { id: periodId } });
    if (!period || period.countryId !== countryId) {
      throw new NotFoundException('Periodo de ranking no encontrado');
    }

    const [eligibleByUser, finishedSessions, clerks, pharmacies, country] = await Promise.all([
      this.anomalies.computeEligiblePointsByUser(countryId, {
        startsAt: period.startsAt,
        endsAt: period.endsAt,
      }),
      this.prisma.gameSession.findMany({
        where: {
          countryId,
          status: 'FINISHED',
          startedAt: { gte: period.startsAt, lt: period.endsAt },
        },
        select: { userId: true },
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

    // 2. Ranking por Farmacia (promedio por dependiente activo, NO suma; con 0 activos no aparece)
    const clerksByPharmacy = new Map<
      string,
      { userId: string; points: number; isActiveInPeriod: boolean }[]
    >();
    for (const u of clerks) {
      const phId = u.assignments[0]?.pharmacy.id;
      if (!phId) continue;
      const list = clerksByPharmacy.get(phId) ?? [];
      list.push({
        userId: u.id,
        points: eligibleByUser.get(u.id) ?? 0,
        isActiveInPeriod: activeUserIds.has(u.id),
      });
      clerksByPharmacy.set(phId, list);
    }

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

    // Sincronizar en Redis Sorted Sets (ZADD) para lecturas en vivo (§11)
    try {
      const zKeyInd = `rank:${period.id}:INDIVIDUAL`;
      const zKeyPh = `rank:${period.id}:PHARMACY`;
      const redisZadd = this.redis.client as unknown as {
        zadd?: (key: string, score: number, member: string) => Promise<unknown>;
      };
      for (const r of individualRows) {
        await redisZadd.zadd?.(zKeyInd, r.points, r.entityId);
      }
      for (const r of pharmacyRows) {
        await redisZadd.zadd?.(zKeyPh, r.points, r.entityId);
      }
    } catch {
      // Si el mock de Redis no implementa zadd, continúa sin interrupción.
    }

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

  async getRankings(p: Principal, scope: RankingQueryScope): Promise<RankingsResponse> {
    if (!p.countryId) {
      throw new ForbiddenException('Se requiere un país en la cuenta para consultar rankings');
    }
    const period = await this.getCurrentOrLatestPeriod(p.countryId);
    const standings = await this.computePeriodStandings(p.countryId, period.id);

    const latestSnap = await this.prisma.rankingSnapshot.findFirst({
      where: { periodId: period.id },
      orderBy: { snapshotDay: 'desc' },
      select: { snapshotDay: true },
    });

    const rows =
      scope === 'individual'
        ? standings.individualRows
        : scope === 'pharmacy'
          ? standings.pharmacyRows
          : standings.countryRows;

    return {
      countryCode: standings.country?.code ?? p.countryCode ?? 'PE',
      period: {
        id: period.id,
        startsAt: period.startsAt.toISOString(),
        endsAt: period.endsAt.toISOString(),
        status: period.status,
      },
      scope,
      rows,
      latestSnapshotDay: latestSnap?.snapshotDay ?? null,
    };
  }

  // ───────────────────────────── Foto Diaria Oficial (RankingSnapshot) ─────────────────────────────

  async takeDailySnapshot(
    countryId: string,
    periodId?: string,
  ): Promise<{ count: number; snapshotDay: string }> {
    const period = periodId
      ? await this.prisma.rankingPeriod.findUniqueOrThrow({ where: { id: periodId } })
      : await this.getCurrentOrLatestPeriod(countryId);

    const standings = await this.computePeriodStandings(countryId, period.id);
    const tz = standings.country?.timezone ?? 'America/Lima';
    const dayStr = localDay(new Date(), tz);

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
    const standings = await this.computePeriodStandings(p.countryId, period.id);

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

    const sessionsInPeriod = recentSessions.filter((s) => s.startedAt >= period.startsAt);
    const playedBrandIds = new Set(sessionsInPeriod.map((s) => s.brandId));
    const pendingBrands = activeBrands
      .filter((bc) => !playedBrandIds.has(bc.brandId))
      .map((bc) => ({
        brandId: bc.brand.id,
        brandSlug: bc.brand.slug,
        brandName: bc.brand.name,
      }));

    const myIndRow = standings.individualRows.find((r) => r.entityId === p.userId);
    const currentPharmacy = user.assignments[0]?.pharmacy ?? null;
    const myPhRow = currentPharmacy
      ? standings.pharmacyRows.find((r) => r.entityId === currentPharmacy.id)
      : undefined;

    return {
      userId: user.id,
      displayName: user.displayName,
      countryCode: standings.country?.code ?? p.countryCode ?? 'PE',
      periodId: period.id,
      totalPoints: standings.eligibleByUser.get(user.id) ?? 0,
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
      sessionsPlayedInPeriod: sessionsInPeriod.length,
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
    const standings = await this.computePeriodStandings(p.countryId, period.id);

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

    const phRankRow = standings.pharmacyRows.find((r) => r.entityId === pharmacy.id);

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

    // 1. Tomar foto oficial final antes de cerrar
    await this.takeDailySnapshot(period.countryId, period.id);
    const standings = await this.computePeriodStandings(period.countryId, period.id);

    const topIndividuals = standings.individualRows.slice(0, 10);
    const topPharmacies = standings.pharmacyRows.slice(0, 10);
    const topCountry = standings.countryRows.slice(0, 1);

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
      const safeName = (match?.displayName ?? w.entityId).replace(/"/g, '""');
      const pts = match?.points ?? 0;
      lines.push(
        `${period.id},${period.country.code},${w.scope},${w.position},${w.entityId},"${safeName}",${pts}`,
      );
    }

    return lines.join('\n') + '\n';
  }
}
