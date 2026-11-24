import {
  Body,
  Controller,
  Get,
  Header,
  HttpCode,
  Param,
  ParseUUIDPipe,
  Post,
  Query,
} from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import {
  submitKnowledgeTestRequestSchema,
  usageEventInputSchema,
  type PendingKnowledgeTest,
  type SubmitKnowledgeTestRequest,
  type SubmitKnowledgeTestResponse,
  type UsageEventInput,
} from '@pharma/shared';
import { CurrentUser, RequireApp, Roles, type Principal } from '../auth/principal';
import { ZodPipe } from '../common/zod';
import { ArcadePilotService, type ArcadePilotReport } from './arcade-pilot.service';
import { MeasurementService } from './measurement.service';

const submitTestPipe = new ZodPipe(submitKnowledgeTestRequestSchema);
const usageEventPipe = new ZodPipe(usageEventInputSchema);

@ApiTags('medición y eventos')
@ApiBearerAuth()
@Controller()
export class MeasurementController {
  constructor(
    private readonly measurement: MeasurementService,
    private readonly pilot: ArcadePilotService,
  ) {}

  @RequireApp('pwa')
  @Roles('CLERK', 'PHARMACY_MANAGER')
  @Get('tests/pending')
  getPendingTests(@CurrentUser() p: Principal): Promise<{ tests: PendingKnowledgeTest[] }> {
    return this.measurement.getPendingTests(p);
  }

  @RequireApp('pwa')
  @Roles('CLERK', 'PHARMACY_MANAGER')
  @HttpCode(200)
  @Post('tests/:id/submit')
  submitTest(
    @CurrentUser() p: Principal,
    @Param('id', new ParseUUIDPipe()) testId: string,
    @Body(submitTestPipe) body: SubmitKnowledgeTestRequest,
  ): Promise<SubmitKnowledgeTestResponse> {
    return this.measurement.submitTest(p, testId, body);
  }

  @RequireApp('pwa')
  @Roles('CLERK', 'PHARMACY_MANAGER')
  @HttpCode(201)
  @Post('events')
  recordUsageEvent(
    @CurrentUser() p: Principal,
    @Body(usageEventPipe) body: UsageEventInput,
  ): Promise<{ id: string; occurredAt: string }> {
    return this.measurement.recordUsageEvent(p, body);
  }

  @RequireApp('admin')
  @Roles('SUPER_ADMIN', 'COUNTRY_ADMIN')
  @Header('Content-Type', 'text/csv; charset=utf-8')
  @Get('admin/reports/participation.csv')
  exportParticipationCsv(
    @CurrentUser() p: Principal,
    @Query('countryId') countryId?: string,
    @Query('countryCode') countryCode?: string,
  ): Promise<string> {
    return this.measurement.exportParticipationCsv(p, countryId, countryCode);
  }

  @RequireApp('admin')
  @Roles('SUPER_ADMIN', 'COUNTRY_ADMIN')
  @Get('admin/reports/arcade-pilot')
  arcadePilot(
    @CurrentUser() p: Principal,
    @Query('countryCode') countryCode?: string,
    @Query('from') from?: string,
    @Query('to') to?: string,
  ): Promise<ArcadePilotReport> {
    return this.pilot.report(p, { countryCode, from, to });
  }

  @RequireApp('admin')
  @Roles('SUPER_ADMIN', 'COUNTRY_ADMIN')
  @Header('Content-Type', 'text/csv; charset=utf-8')
  @Get('admin/reports/arcade-pilot.csv')
  arcadePilotCsv(
    @CurrentUser() p: Principal,
    @Query('countryCode') countryCode?: string,
    @Query('from') from?: string,
    @Query('to') to?: string,
  ): Promise<string> {
    return this.pilot.reportCsv(p, { countryCode, from, to });
  }
}
