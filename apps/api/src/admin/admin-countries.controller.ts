import { Body, Controller, Get, Param, ParseUUIDPipe, Patch, Post, Put } from '@nestjs/common';
import { ApiBearerAuth, ApiBody, ApiTags } from '@nestjs/swagger';
import {
  brandActivationSchema,
  consentVersionCreateSchema,
  countryCodeSchema,
  countryConfigSchema,
  countryCreateSchema,
  countryPatchSchema,
  type AdminCountrySummary,
  type ConsentVersionCreate,
  type CountryConfigInput,
  type CountryConfigView,
  type CountryCreate,
  type CountryPatch,
} from '@pharma/shared';
import { CurrentUser, RequireApp, Roles, type Principal } from '../auth/principal';
import { openApiSchema, ZodPipe } from '../common/zod';
import { AdminCountriesService } from './admin-countries.service';

const code = new ZodPipe(countryCodeSchema);

@ApiTags('admin · países')
@ApiBearerAuth()
@RequireApp('admin')
@Controller('admin/countries')
export class AdminCountriesController {
  constructor(private readonly svc: AdminCountriesService) {}

  /** Países dentro del alcance del usuario. */
  @Roles('SUPER_ADMIN', 'COUNTRY_ADMIN', 'CONTENT_EDITOR')
  @Get()
  list(@CurrentUser() p: Principal): Promise<AdminCountrySummary[]> {
    return this.svc.list(p);
  }

  @Roles('SUPER_ADMIN')
  @ApiBody({ schema: openApiSchema(countryCreateSchema) })
  @Post()
  create(
    @CurrentUser() p: Principal,
    @Body(new ZodPipe(countryCreateSchema)) body: CountryCreate,
  ): Promise<CountryConfigView> {
    return this.svc.create(p, body);
  }

  @Roles('SUPER_ADMIN')
  @ApiBody({ schema: openApiSchema(countryPatchSchema) })
  @Patch(':code')
  patch(
    @CurrentUser() p: Principal,
    @Param('code', code) c: string,
    @Body(new ZodPipe(countryPatchSchema)) body: CountryPatch,
  ): Promise<CountryConfigView> {
    return this.svc.patch(p, c, body);
  }

  @Roles('SUPER_ADMIN', 'COUNTRY_ADMIN')
  @Get(':code/config')
  getConfig(
    @CurrentUser() p: Principal,
    @Param('code', code) c: string,
  ): Promise<CountryConfigView> {
    return this.svc.getConfig(p, c);
  }

  /** Términos locales, reglas de puntos y periodo de ranking: se aplican sin desplegar. */
  @Roles('SUPER_ADMIN', 'COUNTRY_ADMIN')
  @ApiBody({ schema: openApiSchema(countryConfigSchema) })
  @Put(':code/config')
  putConfig(
    @CurrentUser() p: Principal,
    @Param('code', code) c: string,
    @Body(new ZodPipe(countryConfigSchema)) body: CountryConfigInput,
  ): Promise<CountryConfigView> {
    return this.svc.updateConfig(p, c, body);
  }

  @Roles('SUPER_ADMIN', 'COUNTRY_ADMIN')
  @ApiBody({ schema: openApiSchema(consentVersionCreateSchema) })
  @Post(':code/consent-versions')
  publishConsent(
    @CurrentUser() p: Principal,
    @Param('code', code) c: string,
    @Body(new ZodPipe(consentVersionCreateSchema)) body: ConsentVersionCreate,
  ): Promise<CountryConfigView> {
    return this.svc.publishConsent(p, c, body.text);
  }

  @Roles('SUPER_ADMIN', 'COUNTRY_ADMIN')
  @ApiBody({ schema: openApiSchema(brandActivationSchema) })
  @Put(':code/brands/:brandId')
  setBrand(
    @CurrentUser() p: Principal,
    @Param('code', code) c: string,
    @Param('brandId', new ParseUUIDPipe()) brandId: string,
    @Body(new ZodPipe(brandActivationSchema)) body: { active: boolean },
  ): Promise<CountryConfigView> {
    return this.svc.setBrandActive(p, c, brandId, body.active);
  }
}
