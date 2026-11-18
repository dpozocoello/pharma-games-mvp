import {
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
  rankingQueryScopeSchema,
  type MyRankingAndProfileResponse,
  type PharmacyManagerSummaryResponse,
  type RankingQueryScope,
  type RankingsResponse,
} from '@pharma/shared';
import { CurrentUser, RequireApp, Roles, type Principal } from '../auth/principal';
import { ZodPipe } from '../common/zod';
import { RankingsService } from './rankings.service';

const scopePipe = new ZodPipe(rankingQueryScopeSchema.default('individual'));

@ApiTags('rankings y gerente')
@ApiBearerAuth()
@Controller()
export class RankingsController {
  constructor(private readonly rankings: RankingsService) {}

  @RequireApp('pwa')
  @Roles('CLERK', 'PHARMACY_MANAGER')
  @Get('rankings')
  getRankings(
    @CurrentUser() p: Principal,
    @Query('scope', scopePipe) scope: RankingQueryScope,
  ): Promise<RankingsResponse> {
    return this.rankings.getRankings(p, scope);
  }

  @RequireApp('pwa')
  @Roles('CLERK', 'PHARMACY_MANAGER')
  @Get('me/ranking')
  getMyRanking(@CurrentUser() p: Principal): Promise<MyRankingAndProfileResponse> {
    return this.rankings.getMyRankingAndProfile(p);
  }

  @RequireApp('pwa')
  @Roles('PHARMACY_MANAGER')
  @Get('manager/pharmacy/summary')
  getManagerSummary(@CurrentUser() p: Principal): Promise<PharmacyManagerSummaryResponse> {
    return this.rankings.getManagerPharmacySummary(p);
  }

  @RequireApp('admin')
  @Roles('SUPER_ADMIN', 'COUNTRY_ADMIN')
  @HttpCode(200)
  @Post('admin/periods/:id/close')
  closePeriod(@CurrentUser() p: Principal, @Param('id', new ParseUUIDPipe()) periodId: string) {
    return this.rankings.closePeriod(p, periodId);
  }

  @RequireApp('admin')
  @Roles('SUPER_ADMIN', 'COUNTRY_ADMIN')
  @Header('Content-Type', 'text/csv; charset=utf-8')
  @Get('admin/periods/:id/winners.csv')
  exportWinnersCsv(
    @CurrentUser() p: Principal,
    @Param('id', new ParseUUIDPipe()) periodId: string,
  ): Promise<string> {
    return this.rankings.exportWinnersCsv(p, periodId);
  }
}
