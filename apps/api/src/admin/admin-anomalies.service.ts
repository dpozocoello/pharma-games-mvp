import { ForbiddenException, HttpStatus, Injectable, NotFoundException } from '@nestjs/common';
import type { AnomalyStatus, Prisma } from '@prisma/client';
import { localDay, type AnomalyAlertView, type AnomalyResolveInput } from '@pharma/shared';
import { uuidv7 } from 'uuidv7';
import { AuditService } from '../audit/audit.service';
import type { Principal } from '../auth/principal';
import { AppError } from '../common/errors';
import { CountryConfigService } from '../countries/country-config.service';
import { PrismaService } from '../infra/prisma.service';
import { AdminCountriesService } from './admin-countries.service';

@Injectable()
export class AdminAnomaliesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly countries: AdminCountriesService,
    private readonly countryCache: CountryConfigService,
    private readonly audit: AuditService,
  ) {}

  async listAnomalies(
    p: Principal,
    filters: { countryCode?: string; status?: AnomalyStatus } = {},
  ): Promise<AnomalyAlertView[]> {
    const where: Prisma.AnomalyAlertWhereInput = {};
    if (filters.status) {
      where.status = filters.status;
    }

    if (p.role === 'SUPER_ADMIN') {
      if (filters.countryCode) {
        const c = await this.countries.scoped(p, filters.countryCode);
        where.countryId = c.id;
      }
    } else {
      if (filters.countryCode) await this.countries.scoped(p, filters.countryCode);
      where.countryId = p.countryId ?? '__none__';
    }

    const alerts = await this.prisma.anomalyAlert.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      take: 200,
      include: {
        country: { select: { code: true } },
        session: {
          include: {
            user: { select: { id: true, displayName: true } },
            game: { include: { brand: { select: { name: true } } } },
          },
        },
      },
    });

    return alerts.map((a) => ({
      id: a.id,
      countryCode: a.country.code,
      sessionId: a.sessionId,
      userId: a.session.user.id,
      userDisplayName: a.session.user.displayName,
      brandName: a.session.game.brand.name,
      sessionScore: a.session.score ?? 0,
      rule: a.rule,
      details: (a.details ?? {}) as Record<string, unknown>,
      status: a.status,
      reviewedBy: a.reviewedBy,
      reviewedAt: a.reviewedAt ? a.reviewedAt.toISOString() : null,
      createdAt: a.createdAt.toISOString(),
    }));
  }

  /**
   * Resuelve una alerta de anomalía (`PATCH /api/v1/admin/anomalies/:id`).
   * - `PointsLedger` es 100 % inmutable (ADR-006): nunca se ejecuta UPDATE ni DELETE sobre él.
   * - Si `status === 'CONFIRMED'`: la anomalía se confirma y, si la sesión tenía un movimiento `GAME`
   *   que aún no ha sido revertido, se inserta un movimiento inverso `REVERSAL` (`delta = -original.delta`,
   *   `reversesId = original.id`) y queda auditado en `AdminAuditLog`.
   * - Si `status === 'DISMISSED'`: la alerta se descarta y queda auditada. Si todas las alertas de esa
   *   partida quedan `DISMISSED`, los puntos de la sesión cuentan normalmente para ganadores y rankings.
   */
  async resolveAnomaly(
    p: Principal,
    alertId: string,
    input: AnomalyResolveInput,
  ): Promise<AnomalyAlertView> {
    const alert = await this.prisma.anomalyAlert.findUnique({
      where: { id: alertId },
      include: {
        country: true,
        session: {
          include: {
            user: { select: { id: true, displayName: true } },
            game: { include: { brand: { select: { name: true } } } },
            ledger: true,
          },
        },
      },
    });
    if (!alert) throw new NotFoundException('Alerta de anomalía no encontrada');
    if (p.role !== 'SUPER_ADMIN' && alert.countryId !== p.countryId) {
      throw new ForbiddenException('La alerta está fuera de tu alcance');
    }
    if (alert.status !== 'OPEN') {
      throw new AppError(
        HttpStatus.CONFLICT,
        'ANOMALY_ALREADY_RESOLVED',
        `La alerta ya fue resuelta con estado ${alert.status}.`,
      );
    }

    const now = new Date();
    const countryCfg = await this.countryCache.getById(alert.countryId);
    const todayStr = localDay(now, countryCfg?.timezone ?? alert.country.timezone);

    await this.prisma.$transaction(async (tx) => {
      await tx.anomalyAlert.update({
        where: { id: alert.id },
        data: {
          status: input.status,
          reviewedBy: p.userId,
          reviewedAt: now,
        },
      });

      let reversalId: string | null = null;
      if (input.status === 'CONFIRMED') {
        const gameEntry = alert.session.ledger.find((l) => l.reason === 'GAME');
        const alreadyReversed =
          gameEntry && alert.session.ledger.some((l) => l.reversesId === gameEntry.id);

        if (gameEntry && !alreadyReversed && gameEntry.delta > 0) {
          reversalId = uuidv7();
          await tx.pointsLedger.create({
            data: {
              id: reversalId,
              userId: gameEntry.userId,
              countryId: gameEntry.countryId,
              brandId: gameEntry.brandId,
              sessionId: gameEntry.sessionId,
              delta: -gameEntry.delta,
              reason: 'REVERSAL',
              onHold: false,
              reversesId: gameEntry.id,
              createdBy: p.userId,
              localDay: todayStr,
            },
          });
        }
      }

      await this.audit.log(
        {
          actorId: p.userId,
          countryId: alert.countryId,
          action: input.status === 'CONFIRMED' ? 'ANOMALY_CONFIRM_REVERSAL' : 'ANOMALY_DISMISS',
          entity: 'AnomalyAlert',
          entityId: alert.id,
          before: { status: alert.status },
          after: {
            status: input.status,
            sessionId: alert.sessionId,
            reversalId,
          },
        },
        tx,
      );
    });

    const list = await this.listAnomalies(p, { countryCode: alert.country.code });
    return list.find((a) => a.id === alertId)!;
  }

  /**
   * Determina los puntos elegibles para ganadores y rankings de una lista de movimientos de
   * `PointsLedger`, excluyendo las sesiones que tengan alertas en estado `OPEN` o `CONFIRMED`
   * y aplicando cualquier movimiento `REVERSAL`.
   */
  async computeEligiblePointsByUser(
    countryId: string,
    periodRange?: { startsAt: Date; endsAt: Date },
  ): Promise<Map<string, number>> {
    const [entries, unresolvedAlerts] = await Promise.all([
      this.prisma.pointsLedger.findMany({
        where: {
          countryId,
          ...(periodRange
            ? { createdAt: { gte: periodRange.startsAt, lt: periodRange.endsAt } }
            : {}),
        },
        select: {
          id: true,
          userId: true,
          sessionId: true,
          delta: true,
          reason: true,
          onHold: true,
          reversesId: true,
        },
      }),
      this.prisma.anomalyAlert.findMany({
        where: {
          countryId,
          status: { in: ['OPEN', 'CONFIRMED'] },
        },
        select: { sessionId: true, status: true },
      }),
    ]);

    const blockedSessions = new Set(unresolvedAlerts.map((a) => a.sessionId));
    const reversedOriginalIds = new Set(
      entries.filter((e) => e.reversesId).map((e) => e.reversesId!),
    );

    const totals = new Map<string, number>();
    for (const e of entries) {
      if (e.reason === 'REVERSAL') continue; // Ya neutralizamos el movimiento original abajo
      if (reversedOriginalIds.has(e.id)) continue; // Anulado por un REVERSAL
      if (e.sessionId && blockedSessions.has(e.sessionId)) continue; // En revisión (OPEN) o confirmado
      totals.set(e.userId, (totals.get(e.userId) ?? 0) + e.delta);
    }

    return totals;
  }
}
