import { Body, Controller, Get, HttpCode, Post, Req } from '@nestjs/common';
import { ApiBearerAuth, ApiBody, ApiTags } from '@nestjs/swagger';
import {
  CONSENT_REQUIRED_ROLES,
  consentAcceptSchema,
  type ConsentAccept,
  type MeResponse,
} from '@pharma/shared';
import type { Request } from 'express';
import { AllowWithoutConsent, CurrentUser, Roles, type Principal } from '../auth/principal';
import { openApiSchema, ZodPipe } from '../common/zod';
import { ConsentService } from './consent.service';
import { MeService } from './me.service';

@ApiTags('perfil')
@ApiBearerAuth()
@Controller('me')
export class MeController {
  constructor(
    private readonly me: MeService,
    private readonly consent: ConsentService,
  ) {}

  @AllowWithoutConsent()
  @Get()
  get(@CurrentUser() p: Principal): Promise<MeResponse> {
    return this.me.build(p.userId);
  }

  /** Acepta la versión vigente del consentimiento de su país. */
  @AllowWithoutConsent()
  @Roles(...CONSENT_REQUIRED_ROLES)
  @ApiBody({ schema: openApiSchema(consentAcceptSchema) })
  @HttpCode(200)
  @Post('consent')
  async accept(
    @CurrentUser() p: Principal,
    @Body(new ZodPipe(consentAcceptSchema)) body: ConsentAccept,
    @Req() req: Request,
  ): Promise<MeResponse> {
    await this.consent.accept(p, body.consentVersionId, req.ip);
    return this.me.build(p.userId);
  }
}
