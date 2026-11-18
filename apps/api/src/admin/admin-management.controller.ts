import {
  Body,
  Controller,
  Get,
  HttpCode,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
} from '@nestjs/common';
import { ApiBearerAuth, ApiBody, ApiTags } from '@nestjs/swagger';
import {
  anomalyResolveSchema,
  brandCreateSchema,
  csvImportBodySchema,
  pharmacyCreateSchema,
  pharmacyPatchSchema,
  questionStatusPatchSchema,
  userStatusPatchSchema,
  userTransferSchema,
  type AnomalyAlertView,
  type AnomalyResolveInput,
  type AnomalyStatus,
  type BrandCreate,
  type CsvImportBody,
  type ImportJobView,
  type PharmacyCreate,
  type PharmacyPatch,
  type QuestionStatus,
  type QuestionStatusPatch,
  type UserStatusPatch,
  type UserTransfer,
} from '@pharma/shared';
import { CurrentUser, RequireApp, Roles, type Principal } from '../auth/principal';
import { openApiSchema, ZodPipe } from '../common/zod';
import { AdminAnomaliesService } from './admin-anomalies.service';
import {
  AdminContentService,
  type AdminBrandView,
  type AdminQuestionView,
} from './admin-content.service';
import {
  AdminUsersPharmaciesService,
  type AdminUserView,
  type PharmacyView,
} from './admin-users-pharmacies.service';

@ApiTags('admin · usuarios, farmacias y contenido')
@ApiBearerAuth()
@RequireApp('admin')
@Controller('admin')
export class AdminManagementController {
  constructor(
    private readonly usersPharmacies: AdminUsersPharmaciesService,
    private readonly content: AdminContentService,
    private readonly anomalies: AdminAnomaliesService,
  ) {}

  // ───────────────────────────── Importaciones CSV ─────────────────────────────

  @Roles('SUPER_ADMIN', 'COUNTRY_ADMIN')
  @ApiBody({ schema: openApiSchema(csvImportBodySchema) })
  @HttpCode(201)
  @Post('imports/users')
  importUsers(
    @CurrentUser() p: Principal,
    @Body(new ZodPipe(csvImportBodySchema)) body: CsvImportBody,
  ): Promise<ImportJobView> {
    return this.usersPharmacies.importUsersCsv(p, body);
  }

  @Roles('SUPER_ADMIN', 'COUNTRY_ADMIN', 'CONTENT_EDITOR')
  @ApiBody({ schema: openApiSchema(csvImportBodySchema) })
  @HttpCode(201)
  @Post('imports/questions')
  importQuestions(
    @CurrentUser() p: Principal,
    @Body(new ZodPipe(csvImportBodySchema)) body: CsvImportBody,
  ): Promise<ImportJobView> {
    return this.content.importQuestionsCsv(p, body);
  }

  @Roles('SUPER_ADMIN', 'COUNTRY_ADMIN', 'CONTENT_EDITOR')
  @Get('imports/:id')
  getImportJob(
    @CurrentUser() p: Principal,
    @Param('id', new ParseUUIDPipe()) id: string,
  ): Promise<ImportJobView> {
    return this.usersPharmacies.getImportJob(p, id);
  }

  // ───────────────────────────── Farmacias ─────────────────────────────

  @Roles('SUPER_ADMIN', 'COUNTRY_ADMIN')
  @Get('pharmacies')
  listPharmacies(
    @CurrentUser() p: Principal,
    @Query('countryCode') countryCode?: string,
  ): Promise<PharmacyView[]> {
    return this.usersPharmacies.listPharmacies(p, countryCode);
  }

  @Roles('SUPER_ADMIN', 'COUNTRY_ADMIN')
  @ApiBody({ schema: openApiSchema(pharmacyCreateSchema) })
  @HttpCode(201)
  @Post('pharmacies')
  createPharmacy(
    @CurrentUser() p: Principal,
    @Body(new ZodPipe(pharmacyCreateSchema)) body: PharmacyCreate,
  ): Promise<PharmacyView> {
    return this.usersPharmacies.createPharmacy(p, body);
  }

  @Roles('SUPER_ADMIN', 'COUNTRY_ADMIN')
  @ApiBody({ schema: openApiSchema(pharmacyPatchSchema) })
  @Patch('pharmacies/:id')
  patchPharmacy(
    @CurrentUser() p: Principal,
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body(new ZodPipe(pharmacyPatchSchema)) body: PharmacyPatch,
  ): Promise<PharmacyView> {
    return this.usersPharmacies.patchPharmacy(p, id, body);
  }

  // ───────────────────────────── Usuarios y Traslados ─────────────────────────────

  @Roles('SUPER_ADMIN', 'COUNTRY_ADMIN')
  @Get('users')
  listUsers(
    @CurrentUser() p: Principal,
    @Query('countryCode') countryCode?: string,
  ): Promise<AdminUserView[]> {
    return this.usersPharmacies.listUsers(p, countryCode);
  }

  @Roles('SUPER_ADMIN', 'COUNTRY_ADMIN')
  @ApiBody({ schema: openApiSchema(userTransferSchema) })
  @HttpCode(200)
  @Post('users/:id/transfer')
  transferUser(
    @CurrentUser() p: Principal,
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body(new ZodPipe(userTransferSchema)) body: UserTransfer,
  ): Promise<AdminUserView> {
    return this.usersPharmacies.transferUser(p, id, body);
  }

  @Roles('SUPER_ADMIN', 'COUNTRY_ADMIN')
  @ApiBody({ schema: openApiSchema(userStatusPatchSchema) })
  @Patch('users/:id/status')
  updateUserStatus(
    @CurrentUser() p: Principal,
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body(new ZodPipe(userStatusPatchSchema)) body: UserStatusPatch,
  ): Promise<AdminUserView> {
    return this.usersPharmacies.updateUserStatus(p, id, body);
  }

  // ───────────────────────────── Marcas y Preguntas ─────────────────────────────

  @Roles('SUPER_ADMIN', 'COUNTRY_ADMIN', 'CONTENT_EDITOR')
  @Get('brands')
  listBrands(@CurrentUser() p: Principal): Promise<AdminBrandView[]> {
    return this.content.listBrands(p);
  }

  @Roles('SUPER_ADMIN', 'COUNTRY_ADMIN')
  @ApiBody({ schema: openApiSchema(brandCreateSchema) })
  @HttpCode(201)
  @Post('brands')
  createBrand(
    @CurrentUser() p: Principal,
    @Body(new ZodPipe(brandCreateSchema)) body: BrandCreate,
  ): Promise<AdminBrandView> {
    return this.content.createBrand(p, body);
  }

  @Roles('SUPER_ADMIN', 'COUNTRY_ADMIN', 'CONTENT_EDITOR')
  @Get('questions')
  listQuestions(
    @CurrentUser() p: Principal,
    @Query('brandSlug') brandSlug?: string,
    @Query('status') status?: QuestionStatus,
  ): Promise<AdminQuestionView[]> {
    return this.content.listQuestions(p, { brandSlug, status });
  }

  @Roles('SUPER_ADMIN', 'COUNTRY_ADMIN', 'CONTENT_EDITOR')
  @ApiBody({ schema: openApiSchema(questionStatusPatchSchema) })
  @Patch('questions/:id/status')
  updateQuestionStatus(
    @CurrentUser() p: Principal,
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body(new ZodPipe(questionStatusPatchSchema)) body: QuestionStatusPatch,
  ): Promise<AdminQuestionView> {
    return this.content.updateQuestionStatus(p, id, body);
  }

  // ───────────────────────────── Anomalías y Juego Justo (Iteración 4) ─────────────────────────────

  @Roles('SUPER_ADMIN', 'COUNTRY_ADMIN')
  @Get('anomalies')
  listAnomalies(
    @CurrentUser() p: Principal,
    @Query('countryCode') countryCode?: string,
    @Query('status') status?: AnomalyStatus,
  ): Promise<AnomalyAlertView[]> {
    return this.anomalies.listAnomalies(p, { countryCode, status });
  }

  @Roles('SUPER_ADMIN', 'COUNTRY_ADMIN')
  @ApiBody({ schema: openApiSchema(anomalyResolveSchema) })
  @Patch('anomalies/:id')
  resolveAnomaly(
    @CurrentUser() p: Principal,
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body(new ZodPipe(anomalyResolveSchema)) body: AnomalyResolveInput,
  ): Promise<AnomalyAlertView> {
    return this.anomalies.resolveAnomaly(p, id, body);
  }
}
