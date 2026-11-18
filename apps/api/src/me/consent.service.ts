import { HttpStatus, Injectable } from '@nestjs/common';
import { uuidv7 } from 'uuidv7';
import type { Principal } from '../auth/principal';
import { AppError } from '../common/errors';
import { truncateIp } from '../common/ip';
import { CountryConfigService } from '../countries/country-config.service';
import { PrismaService } from '../infra/prisma.service';
import { RedisService } from '../infra/redis.service';

const okKey = (userId: string, versionId: string) => `consent:ok:${userId}:${versionId}`;
const OK_TTL_SECONDS = 24 * 60 * 60;

/**
 * Consentimiento versionado por país (Ley 1581, LOPDP, Ley 29733). Publicar una versión nueva
 * obliga a aceptarla de nuevo: la aceptación se busca por versión vigente.
 */
@Injectable()
export class ConsentService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly redis: RedisService,
    private readonly countries: CountryConfigService,
  ) {}

  async currentVersionId(countryId: string | null): Promise<string | null> {
    if (!countryId) return null;
    const country = await this.countries.getById(countryId);
    return country?.consentVersionId ?? null;
  }

  async hasAccepted(userId: string, versionId: string): Promise<boolean> {
    const cached = await this.redis.client.get(okKey(userId, versionId)).catch(() => null);
    if (cached) return true;
    const row = await this.prisma.userConsent.findUnique({
      where: { userId_consentVersionId: { userId, consentVersionId: versionId } },
      select: { id: true },
    });
    if (row) {
      await this.redis.client
        .set(okKey(userId, versionId), '1', 'EX', OK_TTL_SECONDS)
        .catch(() => undefined);
    }
    return Boolean(row);
  }

  async hasAcceptedCurrent(p: Principal): Promise<boolean> {
    const versionId = await this.currentVersionId(p.countryId);
    // Sin versión vigente no hay base legal para tratar datos: se bloquea (opción conservadora).
    if (!versionId) return false;
    return this.hasAccepted(p.userId, versionId);
  }

  async accept(p: Principal, consentVersionId: string, ip: string | undefined): Promise<void> {
    const current = await this.currentVersionId(p.countryId);
    if (!current || current !== consentVersionId) {
      throw new AppError(
        HttpStatus.CONFLICT,
        'CONSENT_OUTDATED',
        'El texto de consentimiento cambió. Revisa la versión vigente.',
      );
    }
    await this.prisma.userConsent.upsert({
      where: { userId_consentVersionId: { userId: p.userId, consentVersionId } },
      update: {},
      create: { id: uuidv7(), userId: p.userId, consentVersionId, ipTruncated: truncateIp(ip) },
    });
    await this.redis.client
      .set(okKey(p.userId, consentVersionId), '1', 'EX', OK_TTL_SECONDS)
      .catch(() => undefined);
  }
}
