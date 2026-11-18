import { Body, Controller, HttpCode, HttpStatus, Inject, Post, Req, Res } from '@nestjs/common';
import { ApiBody, ApiTags } from '@nestjs/swagger';
import {
  REFRESH_TOKEN_TTL_DAYS,
  appAudienceSchema,
  otpRequestSchema,
  otpVerifySchema,
  type AppAudience,
  type AuthTokenResponse,
  type OtpRequest,
  type OtpRequestResponse,
  type OtpVerify,
} from '@pharma/shared';
import type { CookieOptions, Request, Response } from 'express';
import { z } from 'zod';
import { AppError } from '../common/errors';
import { RateLimit } from '../common/rate-limit';
import { openApiSchema, ZodPipe } from '../common/zod';
import { ENV, type Env } from '../config/env';
import { AuthService, type LoginResult } from './auth.service';
import { Public } from './principal';

const appBodySchema = z.object({ app: appAudienceSchema }).strict();
type AppBody = z.infer<typeof appBodySchema>;

/** Una cookie por app: en localhost las apps comparten cookies aunque usen puertos distintos. */
export const refreshCookieName = (app: AppAudience) => `pharma_rt_${app}`;
const COOKIE_PATH = '/api/v1/auth';

@ApiTags('auth')
@Public()
@Controller('auth')
export class AuthController {
  constructor(
    private readonly auth: AuthService,
    @Inject(ENV) private readonly env: Env,
  ) {}

  @RateLimit({ name: 'otp-request', limit: 30, windowSeconds: 60 })
  @ApiBody({ schema: openApiSchema(otpRequestSchema) })
  @HttpCode(202)
  @Post('otp/request')
  request(@Body(new ZodPipe(otpRequestSchema)) body: OtpRequest): Promise<OtpRequestResponse> {
    return this.auth.requestOtp(body);
  }

  @RateLimit({ name: 'otp-verify', limit: 60, windowSeconds: 60 })
  @ApiBody({ schema: openApiSchema(otpVerifySchema) })
  @HttpCode(200)
  @Post('otp/verify')
  async verify(
    @Body(new ZodPipe(otpVerifySchema)) body: OtpVerify,
    @Res({ passthrough: true }) res: Response,
  ): Promise<AuthTokenResponse> {
    return this.withCookie(res, body.app, await this.auth.verifyOtp(body));
  }

  @RateLimit({ name: 'refresh', limit: 120, windowSeconds: 60 })
  @ApiBody({ schema: openApiSchema(appBodySchema) })
  @HttpCode(200)
  @Post('refresh')
  async refresh(
    @Body(new ZodPipe(appBodySchema)) body: AppBody,
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ): Promise<AuthTokenResponse> {
    const token = this.readCookie(req, body.app);
    if (!token) {
      throw new AppError(HttpStatus.UNAUTHORIZED, 'REFRESH_INVALID', 'No hay sesión activa.');
    }
    try {
      return this.withCookie(res, body.app, await this.auth.refresh(token, body.app));
    } catch (e) {
      // Si la sesión no sirve, se borra la cookie; en una carrera se conserva (el cliente reintenta).
      if (
        e instanceof AppError &&
        (e.getResponse() as { code?: string }).code === 'REFRESH_INVALID'
      ) {
        res.clearCookie(refreshCookieName(body.app), this.cookieOptions());
      }
      throw e;
    }
  }

  @ApiBody({ schema: openApiSchema(appBodySchema) })
  @HttpCode(204)
  @Post('logout')
  async logout(
    @Body(new ZodPipe(appBodySchema)) body: AppBody,
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ): Promise<void> {
    const token = this.readCookie(req, body.app);
    if (token) await this.auth.logout(token);
    res.clearCookie(refreshCookieName(body.app), this.cookieOptions());
  }

  private withCookie(res: Response, app: AppAudience, result: LoginResult): AuthTokenResponse {
    const { refresh, ...body } = result;
    res.cookie(refreshCookieName(app), refresh.token, {
      ...this.cookieOptions(),
      maxAge: REFRESH_TOKEN_TTL_DAYS * 24 * 60 * 60 * 1000,
    });
    res.setHeader('Cache-Control', 'no-store');
    return body;
  }

  private cookieOptions(): CookieOptions {
    return { httpOnly: true, secure: this.env.COOKIE_SECURE, sameSite: 'lax', path: COOKIE_PATH };
  }

  private readCookie(req: Request, app: AppAudience): string | undefined {
    const v = (req.cookies as Record<string, unknown> | undefined)?.[refreshCookieName(app)];
    return typeof v === 'string' && v.length > 0 ? v : undefined;
  }
}
