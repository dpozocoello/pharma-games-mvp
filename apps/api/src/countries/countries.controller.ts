import { Controller, Get } from '@nestjs/common';
import type { PublicCountry } from '@pharma/shared';
import { PrismaService } from '../infra/prisma.service';

@Controller('countries')
export class CountriesController {
  constructor(private readonly prisma: PrismaService) {}

  /** Público: países activos para la pantalla de selección. */
  @Get()
  async list(): Promise<PublicCountry[]> {
    const rows = await this.prisma.country.findMany({
      where: { active: true },
      select: { code: true, name: true, locale: true },
      orderBy: { name: 'asc' },
    });
    return rows as PublicCountry[];
  }
}
