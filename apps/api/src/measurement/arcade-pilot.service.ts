import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import {
  experimentGroupFor,
  pilotVerdict,
  sanitizeCsvCell,
  summarizeArcadePilot,
  type ExperimentGroup,
  type PilotSummaryRow,
} from '@pharma/shared';
import { AuditService } from '../audit/audit.service';
import type { Principal } from '../auth/principal';
import { CountryConfigService } from '../countries/country-config.service';
import { PrismaService } from '../infra/prisma.service';

export interface ArcadePilotReport {
  countryCode: string;
  from: string;
  to: string;
  abTest: { enabled: boolean; arcadeSharePct: number } | null;
  /**
   * Tamaño actual de cada grupo. `participationPct` = dependientes asignados hoy al grupo que
   * jugaron en la ventana ÷ asignados (no cuenta a quien jugó en el grupo y luego fue trasladado).
   */
  groups: Record<
    ExperimentGroup,
    { pharmacies: number; clerksAssigned: number; participationPct: number | null }
  >;
  rows: PilotSummaryRow[];
  verdict: ReturnType<typeof pilotVerdict>;
}

/**
 * Indicadores del piloto arcade por grupo y estilo (ADR-034). Ventana por defecto: el periodo de
 * ranking abierto hasta ahora. Un `COUNTRY_ADMIN` solo ve su país; `SUPER_ADMIN` elige el país.
 */
@Injectable()
export class ArcadePilotService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly countries: CountryConfigService,
    private readonly audit: AuditService,
  ) {}

  async report(
    actor: Principal,
    q: { countryCode?: string; from?: string; to?: string },
  ): Promise<ArcadePilotReport> {
    const countryId = await this.resolveCountry(actor, q.countryCode);
    const country = await this.countries.getById(countryId);
    if (!country) throw new NotFoundException('País no encontrado');

    const now = new Date();
    const period = await this.prisma.rankingPeriod.findFirst({
      where: { countryId, status: 'OPEN' },
      orderBy: { startsAt: 'desc' },
    });
    const from = q.from
      ? parseDate(q.from, 'from')
      : (period?.startsAt ?? new Date(now.getTime() - 28 * 86_400_000));
    const to = q.to ? parseDate(q.to, 'to') : now;
    if (from >= to) throw new BadRequestException('`from` debe ser anterior a `to`');

    const sessions = await this.prisma.gameSession.findMany({
      where: { countryId, experimentGroup: { not: null }, startedAt: { gte: from, lt: to } },
      select: {
        id: true,
        userId: true,
        style: true,
        experimentGroup: true,
        status: true,
        startedAt: true,
        finishedAt: true,
        expiresAt: true,
        questionIds: true,
        score: true,
      },
    });
    const correct = await this.prisma.sessionAnswer.groupBy({
      by: ['sessionId'],
      where: { sessionId: { in: sessions.map((s) => s.id) }, correct: true },
      _count: { _all: true },
    });
    const correctBySession = new Map(correct.map((c) => [c.sessionId, c._count._all]));

    const rows = summarizeArcadePilot(
      sessions.map((s) => ({
        userId: s.userId,
        style: s.style,
        experimentGroup: s.experimentGroup!,
        status: s.status,
        startedAt: s.startedAt,
        finishedAt: s.finishedAt,
        expiresAt: s.expiresAt,
        questionCount: s.questionIds.length,
        correctCount: correctBySession.get(s.id) ?? 0,
        score: s.score,
      })),
      { from, to },
      country.timezone,
      now,
    );

    // Tamaño de cada grupo hoy: farmacias activas y dependientes activos asignados a ellas.
    const groups: ArcadePilotReport['groups'] = {
      CONTROL: { pharmacies: 0, clerksAssigned: 0, participationPct: null },
      ARCADE: { pharmacies: 0, clerksAssigned: 0, participationPct: null },
    };
    const ab = country.pointsRules.arcade?.enabled ? country.pointsRules.arcade.abTest : null;
    if (ab?.enabled) {
      const pharmacies = await this.prisma.pharmacy.findMany({
        where: { countryId, active: true },
        select: {
          id: true,
          assignments: {
            where: { to: null, user: { role: 'CLERK', status: 'ACTIVE' } },
            select: { userId: true },
          },
        },
      });
      const playedBy: Record<ExperimentGroup, Set<string>> = {
        CONTROL: new Set(),
        ARCADE: new Set(),
      };
      for (const s of sessions) {
        if (s.status === 'FINISHED' && s.experimentGroup) playedBy[s.experimentGroup].add(s.userId);
      }
      const played: Record<ExperimentGroup, number> = { CONTROL: 0, ARCADE: 0 };
      for (const ph of pharmacies) {
        const key = experimentGroupFor(ph.id, ab);
        groups[key].pharmacies += 1;
        groups[key].clerksAssigned += ph.assignments.length;
        played[key] += ph.assignments.filter((a) => playedBy[key].has(a.userId)).length;
      }
      for (const key of ['CONTROL', 'ARCADE'] as const) {
        const g = groups[key];
        g.participationPct = g.clerksAssigned
          ? Math.round((played[key] / g.clerksAssigned) * 10_000) / 100
          : null;
      }
    }

    return {
      countryCode: country.code,
      from: from.toISOString(),
      to: to.toISOString(),
      abTest: ab ? { enabled: ab.enabled, arcadeSharePct: ab.arcadeSharePct } : null,
      groups,
      rows,
      verdict: pilotVerdict(rows),
    };
  }

  async reportCsv(
    actor: Principal,
    q: { countryCode?: string; from?: string; to?: string },
  ): Promise<string> {
    const r = await this.report(actor, q);
    const header =
      'countryCode,from,to,group,style,pharmacies,clerksAssigned,activeClerks,participationPct,sessionsStarted,sessionsFinished,abandonPct,sessionsPerActivePerWeek,accuracyPct,return7dPct,avgSessionSeconds,pointsAwarded';
    const lines = [header];
    for (const row of r.rows) {
      const g = r.groups[row.group];
      const total = row.style === 'ALL';
      const participation =
        total && g.clerksAssigned
          ? Math.round((row.activeClerks / g.clerksAssigned) * 10_000) / 100
          : '';
      lines.push(
        [
          sanitizeCsvCell(r.countryCode),
          r.from,
          r.to,
          row.group,
          row.style,
          total ? g.pharmacies : '',
          total ? g.clerksAssigned : '',
          row.activeClerks,
          participation,
          row.sessionsStarted,
          row.sessionsFinished,
          row.abandonPct,
          row.sessionsPerActivePerWeek,
          row.accuracyPct,
          row.return7dPct,
          row.avgSessionSeconds,
          row.pointsAwarded,
        ].join(','),
      );
    }
    await this.audit.log({
      actorId: actor.userId,
      countryId: (await this.resolveCountry(actor, q.countryCode)) ?? actor.countryId,
      action: 'arcade_pilot.export_csv',
      entity: 'GameSession',
      entityId: r.countryCode,
      after: { rows: r.rows.length, from: r.from, to: r.to },
    });
    return lines.join('\n') + '\n';
  }

  private async resolveCountry(actor: Principal, countryCode?: string): Promise<string> {
    if (actor.role === 'SUPER_ADMIN') {
      if (!countryCode) throw new BadRequestException('Indica `countryCode` (p. ej. PE)');
      const c = await this.prisma.country.findUnique({ where: { code: countryCode } });
      if (!c) throw new NotFoundException('País no encontrado');
      return c.id;
    }
    if (!actor.countryId) throw new ForbiddenException('Tu cuenta no tiene un país asociado');
    if (countryCode) {
      const c = await this.prisma.country.findUnique({ where: { code: countryCode } });
      if (!c || c.id !== actor.countryId)
        throw new ForbiddenException('El país está fuera de tu alcance');
    }
    return actor.countryId;
  }
}

function parseDate(v: string, name: string): Date {
  const d = new Date(v);
  if (Number.isNaN(d.getTime()))
    throw new BadRequestException(`\`${name}\` no es una fecha válida`);
  return d;
}
