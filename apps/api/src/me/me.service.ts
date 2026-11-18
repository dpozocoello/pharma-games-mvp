import { Injectable, NotFoundException } from '@nestjs/common';
import { CONSENT_REQUIRED_ROLES, maskPhone, type MeResponse } from '@pharma/shared';
import { CountryConfigService } from '../countries/country-config.service';
import { PrismaService } from '../infra/prisma.service';
import { ConsentService } from './consent.service';

@Injectable()
export class MeService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly countries: CountryConfigService,
    private readonly consent: ConsentService,
  ) {}

  async build(userId: string): Promise<MeResponse> {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      include: {
        assignments: { where: { to: null }, include: { pharmacy: true }, take: 1 },
      },
    });
    if (!user) throw new NotFoundException('Usuario no encontrado');

    const country = user.countryId ? await this.countries.getById(user.countryId) : null;
    const required = CONSENT_REQUIRED_ROLES.includes(user.role);
    const versionId = country?.consentVersionId ?? null;
    const version = versionId
      ? await this.prisma.consentVersion.findUnique({
          where: { id: versionId },
          select: { id: true, version: true, text: true },
        })
      : null;
    const accepted = version ? await this.consent.hasAccepted(user.id, version.id) : false;
    const pharmacy = user.assignments[0]?.pharmacy;

    return {
      id: user.id,
      displayName: user.displayName,
      role: user.role,
      phoneMasked: maskPhone(user.phoneE164),
      country: country
        ? { code: country.code, name: country.name, locale: country.locale, terms: country.terms }
        : null,
      countryLocked: Boolean(user.countryLockedAt),
      pharmacy: pharmacy ? { id: pharmacy.id, name: pharmacy.name } : null,
      consent: { required, accepted, current: version },
    };
  }
}
