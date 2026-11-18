import { Controller, Get } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import type { PublicCountry } from '@pharma/shared';
import { Public } from '../auth/principal';
import { CountryConfigService } from './country-config.service';

@ApiTags('países')
@Controller('countries')
export class CountriesController {
  constructor(private readonly countries: CountryConfigService) {}

  /** Público: países activos para la pantalla de selección (con prefijo telefónico). */
  @Public()
  @Get()
  list(): Promise<PublicCountry[]> {
    return this.countries.listPublic();
  }
}
