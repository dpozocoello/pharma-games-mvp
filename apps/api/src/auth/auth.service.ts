import { createHmac } from 'node:crypto';
import { HttpStatus, Inject, Injectable } from '@nestjs/common';
import type { User } from '@prisma/client';
import {
  ACCESS_TOKEN_TTL_SECONDS,
  OTP_RULES,
  canUseApp,
  normalizeDocument,
  normalizePhone,
  type AppAudience,
  type AuthTokenResponse,
  type Identifier,
  type OtpRequest,
  type OtpRequestResponse,
  type OtpVerify,
} from '@pharma/shared';
import { AppError } from '../common/errors';
import { ENV, type Env } from '../config/env';
import { CountryConfigService, type CountrySnapshot } from '../countries/country-config.service';
import { PrismaService } from '../infra/prisma.service';
import { MeService } from '../me/me.service';
import { OtpQueue } from './messaging/otp-queue';
import { OtpService } from './otp.service';
import type { Principal } from './principal';
import { TokenService, type IssuedRefresh } from './token.service';

interface Resolved {
  country: CountrySnapshot | null;
  user: User | null;
  /** Sujetos para el límite de envíos: el número y, si se usó, el documento. */
  sendSubjects: string[];
}

export interface LoginResult extends AuthTokenResponse {
  refresh: IssuedRefresh;
}

@Injectable()
export class AuthService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly countries: CountryConfigService,
    private readonly otp: OtpService,
    private readonly queue: OtpQueue,
    private readonly tokens: TokenService,
    private readonly me: MeService,
    @Inject(ENV) private readonly env: Env,
  ) {}

  /**
   * Paso 1. La respuesta es idéntica exista o no la cuenta, para no revelar qué números o
   * documentos están registrados. Solo se envía el código a cuentas activas y con acceso a la app.
   */
  async requestOtp(input: OtpRequest): Promise<OtpRequestResponse> {
    const { country, user, sendSubjects } = await this.resolve(input.countryCode, input.identifier);

    const wait = await this.otp.registerSend(sendSubjects);
    if (wait > 0) {
      throw new AppError(
        HttpStatus.TOO_MANY_REQUESTS,
        'OTP_RATE_LIMITED',
        `Ya pediste ${OTP_RULES.maxSends} códigos. Espera unos minutos para pedir otro.`,
        { retryAfterSeconds: wait },
      );
    }

    if (user && user.status === 'ACTIVE' && canUseApp(user.role, input.app)) {
      const code = this.otp.generateCode();
      await this.otp.store(input.app, user.id, code);
      const locale = country?.locale ?? (await this.userCountry(user))?.locale ?? 'es';
      await this.queue.enqueue({ toE164: user.phoneE164, code, locale });
    }
    return { status: 'SENT_IF_REGISTERED', expiresInSeconds: OTP_RULES.ttlSeconds };
  }

  /** Paso 2. Valida el código, fija el país de la cuenta y abre sesión. */
  async verifyOtp(input: OtpVerify): Promise<LoginResult> {
    const { country, user } = await this.resolve(input.countryCode, input.identifier);
    if (!user) throw otpExpired();

    const check = await this.otp.verify(input.app, user.id, input.code);
    if (!check.ok) {
      if (check.reason === 'LOCKED') {
        throw new AppError(
          HttpStatus.TOO_MANY_REQUESTS,
          'OTP_LOCKED',
          'Demasiados intentos. Solicita un código nuevo.',
        );
      }
      if (check.reason === 'INVALID') {
        throw new AppError(HttpStatus.BAD_REQUEST, 'OTP_INVALID', 'Código incorrecto.', {
          attemptsLeft: check.attemptsLeft,
        });
      }
      throw otpExpired();
    }

    if (user.status !== 'ACTIVE' || !canUseApp(user.role, input.app)) {
      throw new AppError(HttpStatus.FORBIDDEN, 'ACCOUNT_NOT_ALLOWED', 'Tu cuenta no tiene acceso.');
    }

    const countryId = await this.lockCountry(user, country);
    return this.openSession(user.id, input.app, countryId);
  }

  async refresh(token: string, app: AppAudience): Promise<LoginResult> {
    const { userId, refresh } = await this.tokens.rotateRefresh(token, app);
    const user = await this.prisma.user.findUnique({ where: { id: userId } });
    if (!user || user.status !== 'ACTIVE' || !canUseApp(user.role, app)) {
      await this.tokens.revokeAllForUser(userId);
      throw new AppError(HttpStatus.UNAUTHORIZED, 'REFRESH_INVALID', 'Tu sesión terminó.');
    }
    return this.buildLogin(user.id, user.role, user.countryId, app, refresh);
  }

  logout(token: string): Promise<void> {
    return this.tokens.revokeByToken(token);
  }

  /**
   * El país queda fijado en la cuenta (CLAUDE.md §3, módulo 1). Una cuenta precargada ya trae país;
   * si no lo trae, se fija con el que eligió la persona. Elegir otro país no está permitido.
   */
  private async lockCountry(user: User, chosen: CountrySnapshot | null): Promise<string | null> {
    const now = new Date();
    if (user.role === 'SUPER_ADMIN') {
      await this.prisma.user.update({ where: { id: user.id }, data: { lastLoginAt: now } });
      return null;
    }
    if (user.countryId && chosen && chosen.id !== user.countryId) {
      const locked = await this.countries.getById(user.countryId);
      throw new AppError(
        HttpStatus.CONFLICT,
        'COUNTRY_LOCKED',
        `Tu cuenta está registrada en ${locked?.name ?? 'otro país'} y no puede usarse en otro país.`,
        { lockedCountry: locked ? { code: locked.code, name: locked.name } : null },
      );
    }
    const countryId = user.countryId ?? chosen?.id;
    if (!countryId) {
      throw new AppError(
        HttpStatus.BAD_REQUEST,
        'COUNTRY_REQUIRED',
        'Elige tu país para ingresar.',
      );
    }
    // Condicional: si otra solicitud fijó un país distinto entre medio, no se sobrescribe.
    const { count } = await this.prisma.user.updateMany({
      where: { id: user.id, OR: [{ countryId: null }, { countryId }] },
      data: { countryId, countryLockedAt: user.countryLockedAt ?? now, lastLoginAt: now },
    });
    if (count !== 1) {
      throw new AppError(HttpStatus.CONFLICT, 'COUNTRY_LOCKED', 'Tu cuenta ya tiene país.');
    }
    return countryId;
  }

  private async openSession(userId: string, app: AppAudience, countryId: string | null) {
    const user = await this.prisma.user.findUniqueOrThrow({ where: { id: userId } });
    const refresh = await this.tokens.issueRefresh(userId, app);
    return this.buildLogin(user.id, user.role, countryId, app, refresh);
  }

  private async buildLogin(
    userId: string,
    role: User['role'],
    countryId: string | null,
    app: AppAudience,
    refresh: IssuedRefresh,
  ): Promise<LoginResult> {
    const country = countryId ? await this.countries.getById(countryId) : null;
    const principal: Principal = {
      userId,
      role,
      countryId,
      countryCode: country?.code ?? null,
      app,
    };
    return {
      accessToken: this.tokens.signAccess(principal),
      expiresInSeconds: ACCESS_TOKEN_TTL_SECONDS,
      me: await this.me.build(userId),
      refresh,
    };
  }

  private async resolve(countryCode: string | undefined, id: Identifier): Promise<Resolved> {
    let country: CountrySnapshot | null = null;
    if (countryCode) {
      country = await this.countries.getByCode(countryCode);
      if (!country || !country.active) {
        throw new AppError(HttpStatus.BAD_REQUEST, 'COUNTRY_UNAVAILABLE', 'País no disponible.');
      }
    }

    if (id.type === 'phone') {
      const e164 = normalizePhone(id.value, country?.phonePrefix ?? '');
      if (!e164) {
        throw new AppError(
          HttpStatus.BAD_REQUEST,
          'PHONE_INVALID',
          country
            ? 'Número de celular inválido.'
            : 'Escribe el número con su prefijo, por ejemplo +51.',
        );
      }
      const user = await this.prisma.user.findUnique({ where: { phoneE164: e164 } });
      return { country, user, sendSubjects: [`p:${e164}`] };
    }

    // Documento: siempre con país (validado por el esquema). Se busca por HMAC, nunca en claro.
    const doc = normalizeDocument(id.value);
    if (!country || doc.length < 3) {
      throw new AppError(HttpStatus.BAD_REQUEST, 'DOCUMENT_INVALID', 'Documento inválido.');
    }
    const documentHash = createHmac('sha256', this.env.DOCUMENT_HASH_SECRET)
      .update(doc)
      .digest('hex');
    const user = await this.prisma.user.findUnique({
      where: { countryId_documentHash: { countryId: country.id, documentHash } },
    });
    const subjects = [`d:${country.id}:${documentHash}`];
    if (user) subjects.push(`p:${user.phoneE164}`);
    return { country, user, sendSubjects: subjects };
  }

  private async userCountry(user: User) {
    return user.countryId ? this.countries.getById(user.countryId) : null;
  }
}

function otpExpired() {
  return new AppError(
    HttpStatus.BAD_REQUEST,
    'OTP_EXPIRED',
    'El código venció o no es válido. Solicita uno nuevo.',
  );
}
