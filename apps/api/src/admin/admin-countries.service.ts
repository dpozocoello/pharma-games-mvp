import {
  ForbiddenException,
  HttpStatus,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import type { Country, Prisma } from '@prisma/client';
import {
  DEFAULT_POINTS_RULES,
  pointsRulesSchema,
  rankingPeriodBounds,
  termsSchema,
  type AdminCountrySummary,
  type CountryConfigInput,
  type CountryConfigView,
  type CountryCreate,
  type CountryPatch,
} from '@pharma/shared';
import { uuidv7 } from 'uuidv7';
import { AuditService } from '../audit/audit.service';
import type { Principal } from '../auth/principal';
import { AppError } from '../common/errors';
import { CountryConfigService } from '../countries/country-config.service';
import { PrismaService } from '../infra/prisma.service';
import { DailySnapshotScheduler } from '../rankings/daily-snapshot.scheduler';

const summary = (c: Country): AdminCountrySummary => ({
  code: c.code,
  name: c.name,
  locale: c.locale,
  timezone: c.timezone,
  phonePrefix: c.phonePrefix,
  active: c.active,
});

/**
 * Administración de países (CLAUDE.md §3, módulo 3). Alcance: SUPER_ADMIN ve todos los países;
 * el resto, solo el suyo. Cada cambio queda en AdminAuditLog e invalida la caché de configuración.
 */
@Injectable()
export class AdminCountriesService {
  private readonly logger = new Logger(AdminCountriesService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly cache: CountryConfigService,
    private readonly snapshots: DailySnapshotScheduler,
  ) {}

  async list(p: Principal): Promise<AdminCountrySummary[]> {
    const where: Prisma.CountryWhereInput =
      p.role === 'SUPER_ADMIN' ? {} : { id: p.countryId ?? '__none__' };
    const rows = await this.prisma.country.findMany({ where, orderBy: { name: 'asc' } });
    return rows.map(summary);
  }

  /** Busca el país y verifica el alcance del usuario. */
  async scoped(p: Principal, code: string): Promise<Country> {
    const country = await this.prisma.country.findUnique({ where: { code } });
    if (!country) throw new NotFoundException('País no encontrado');
    if (p.role !== 'SUPER_ADMIN' && country.id !== p.countryId) {
      throw new ForbiddenException('El país está fuera de tu alcance');
    }
    return country;
  }

  async getConfig(p: Principal, code: string): Promise<CountryConfigView> {
    const country = await this.scoped(p, code);
    return this.view(country.id);
  }

  async updateConfig(p: Principal, code: string, input: CountryConfigInput) {
    const country = await this.scoped(p, code);
    await this.prisma.$transaction(async (tx) => {
      const before = await tx.countryConfig.findUniqueOrThrow({ where: { countryId: country.id } });
      const after = await tx.countryConfig.update({
        where: { countryId: country.id },
        data: {
          terms: input.terms,
          pointsRules: input.pointsRules as unknown as Prisma.InputJsonValue,
          rankingPeriodMonths: input.rankingPeriodMonths,
        },
      });
      await this.audit.log(
        {
          actorId: p.userId,
          countryId: country.id,
          action: 'COUNTRY_CONFIG_UPDATE',
          entity: 'CountryConfig',
          entityId: after.id,
          before: pick(before),
          after: pick(after),
        },
        tx,
      );
    });
    await this.cache.invalidate(code);
    return this.view(country.id);
  }

  /** Alta de país por configuración. Nace inactivo: se activa cuando tiene consentimiento. */
  async create(p: Principal, input: CountryCreate): Promise<CountryConfigView> {
    const exists = await this.prisma.country.findUnique({ where: { code: input.code } });
    if (exists) throw new AppError(HttpStatus.CONFLICT, 'COUNTRY_EXISTS', 'El país ya existe.');

    const id = uuidv7();
    const { startsAt, endsAt } = rankingPeriodBounds(new Date(), input.timezone, 1);
    await this.prisma.$transaction(async (tx) => {
      await tx.country.create({ data: { id, ...input, active: false } });
      await tx.countryConfig.create({
        data: {
          id: uuidv7(),
          countryId: id,
          terms: {},
          pointsRules: DEFAULT_POINTS_RULES as unknown as Prisma.InputJsonValue,
          rankingPeriodMonths: 1,
        },
      });
      await tx.rankingPeriod.create({ data: { id: uuidv7(), countryId: id, startsAt, endsAt } });
      await this.audit.log(
        {
          actorId: p.userId,
          countryId: id,
          action: 'COUNTRY_CREATE',
          entity: 'Country',
          entityId: id,
          after: { ...input, active: false },
        },
        tx,
      );
    });
    await this.cache.invalidate(input.code);
    return this.view(id);
  }

  async patch(p: Principal, code: string, input: CountryPatch): Promise<CountryConfigView> {
    const country = await this.scoped(p, code);
    if (input.active) {
      const cfg = await this.prisma.countryConfig.findUnique({ where: { countryId: country.id } });
      if (!cfg?.consentVersionId) {
        throw new AppError(
          HttpStatus.CONFLICT,
          'CONSENT_MISSING',
          'Publica un texto de consentimiento antes de activar el país.',
        );
      }
    }
    await this.prisma.$transaction(async (tx) => {
      const after = await tx.country.update({ where: { id: country.id }, data: input });
      await this.audit.log(
        {
          actorId: p.userId,
          countryId: country.id,
          action: 'COUNTRY_UPDATE',
          entity: 'Country',
          entityId: country.id,
          before: summary(country),
          after: summary(after),
        },
        tx,
      );
    });
    await this.cache.invalidate(code);
    // Activar, desactivar o cambiar la zona horaria cambia la foto diaria programada del país.
    const updated = await this.prisma.country.findUniqueOrThrow({ where: { id: country.id } });
    await this.snapshots.sync(updated).catch((e: unknown) => {
      // El país ya quedó guardado; cada instancia resincroniza la programación al arrancar.
      this.logger.warn(`No se pudo reprogramar la foto diaria de ${code}: ${String(e)}`);
    });
    return this.view(country.id);
  }

  /** Nueva versión del consentimiento: pasa a ser la vigente y todos deben aceptarla de nuevo. */
  async publishConsent(p: Principal, code: string, text: string): Promise<CountryConfigView> {
    const country = await this.scoped(p, code);
    await this.prisma.$transaction(async (tx) => {
      const last = await tx.consentVersion.findFirst({
        where: { countryId: country.id },
        orderBy: { version: 'desc' },
        select: { version: true },
      });
      const version = await tx.consentVersion.create({
        data: { id: uuidv7(), countryId: country.id, version: (last?.version ?? 0) + 1, text },
      });
      await tx.countryConfig.update({
        where: { countryId: country.id },
        data: { consentVersionId: version.id },
      });
      await this.audit.log(
        {
          actorId: p.userId,
          countryId: country.id,
          action: 'CONSENT_PUBLISH',
          entity: 'ConsentVersion',
          entityId: version.id,
          after: { version: version.version, text },
        },
        tx,
      );
    });
    await this.cache.invalidate(code);
    return this.view(country.id);
  }

  async setBrandActive(p: Principal, code: string, brandId: string, active: boolean) {
    const country = await this.scoped(p, code);
    const link = await this.prisma.brandCountry.findUnique({
      where: { brandId_countryId: { brandId, countryId: country.id } },
    });
    if (!link) throw new NotFoundException('La marca no está disponible en este país');
    await this.prisma.$transaction(async (tx) => {
      await tx.brandCountry.update({ where: { id: link.id }, data: { active } });
      await this.audit.log(
        {
          actorId: p.userId,
          countryId: country.id,
          action: 'BRAND_COUNTRY_UPDATE',
          entity: 'BrandCountry',
          entityId: link.id,
          before: { active: link.active },
          after: { active },
        },
        tx,
      );
    });
    await this.cache.invalidate(code);
    return this.view(country.id);
  }

  private async view(countryId: string): Promise<CountryConfigView> {
    const country = await this.prisma.country.findUniqueOrThrow({
      where: { id: countryId },
      include: {
        config: { include: { consentVersion: true } },
        brandCountries: { include: { brand: true }, orderBy: { brand: { name: 'asc' } } },
        periods: { where: { status: 'OPEN' }, orderBy: { startsAt: 'desc' }, take: 1 },
      },
    });
    const cfg = country.config;
    if (!cfg) throw new NotFoundException('País sin configuración');
    const consent = cfg.consentVersion;
    const period = country.periods[0];
    return {
      country: summary(country),
      terms: termsSchema.parse(cfg.terms),
      pointsRules: pointsRulesSchema.parse(cfg.pointsRules),
      rankingPeriodMonths: cfg.rankingPeriodMonths as 1 | 2 | 3,
      consent: consent
        ? {
            id: consent.id,
            version: consent.version,
            text: consent.text,
            publishedAt: consent.publishedAt.toISOString(),
          }
        : null,
      brands: country.brandCountries.map((bc) => ({
        brandId: bc.brandId,
        slug: bc.brand.slug,
        name: bc.brand.name,
        active: bc.active,
      })),
      currentPeriod: period
        ? {
            id: period.id,
            startsAt: period.startsAt.toISOString(),
            endsAt: period.endsAt.toISOString(),
          }
        : null,
      updatedAt: cfg.updatedAt.toISOString(),
    };
  }
}

function pick(c: { terms: unknown; pointsRules: unknown; rankingPeriodMonths: number }) {
  return { terms: c.terms, pointsRules: c.pointsRules, rankingPeriodMonths: c.rankingPeriodMonths };
}
