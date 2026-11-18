import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  HttpStatus,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { CONSENT_REQUIRED_ROLES, type AppAudience, type Role } from '@pharma/shared';
import { AppError } from '../common/errors';
import { ConsentService } from '../me/consent.service';
import { APP_KEY, IS_PUBLIC, ROLES_KEY, SKIP_CONSENT, type AuthedRequest } from './principal';
import { TokenService } from './token.service';

function meta<T>(reflector: Reflector, key: string, ctx: ExecutionContext): T | undefined {
  return reflector.getAllAndOverride<T>(key, [ctx.getHandler(), ctx.getClass()]);
}

/** 1) Autenticación: exige `Authorization: Bearer` salvo en rutas @Public(). */
@Injectable()
export class AuthGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly tokens: TokenService,
  ) {}

  async canActivate(ctx: ExecutionContext): Promise<boolean> {
    if (meta<boolean>(this.reflector, IS_PUBLIC, ctx)) return true;
    const req = ctx.switchToHttp().getRequest<AuthedRequest>();
    const [scheme, token] = (req.headers.authorization ?? '').split(' ');
    if (scheme !== 'Bearer' || !token) throw new UnauthorizedException('Falta el token de acceso');
    req.principal = await this.tokens.verifyAccess(token);
    return true;
  }
}

/** 2) Audiencia (pwa/admin) y rol. */
@Injectable()
export class RolesGuard implements CanActivate {
  constructor(private readonly reflector: Reflector) {}

  canActivate(ctx: ExecutionContext): boolean {
    const p = ctx.switchToHttp().getRequest<AuthedRequest>().principal;
    if (!p) return true; // ruta pública
    const app = meta<AppAudience>(this.reflector, APP_KEY, ctx);
    if (app && p.app !== app) throw new ForbiddenException('Token no válido para esta aplicación');
    const roles = meta<Role[]>(this.reflector, ROLES_KEY, ctx);
    if (roles && !roles.includes(p.role)) throw new ForbiddenException('Rol sin permiso');
    return true;
  }
}

/**
 * 3) Consentimiento: quien juega (CLERK, PHARMACY_MANAGER) debe haber aceptado la versión vigente
 * del consentimiento de su país. Denegar por defecto: solo @AllowWithoutConsent() lo omite.
 */
@Injectable()
export class ConsentGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly consent: ConsentService,
  ) {}

  async canActivate(ctx: ExecutionContext): Promise<boolean> {
    const p = ctx.switchToHttp().getRequest<AuthedRequest>().principal;
    if (!p || !CONSENT_REQUIRED_ROLES.includes(p.role)) return true;
    if (meta<boolean>(this.reflector, SKIP_CONSENT, ctx)) return true;
    if (await this.consent.hasAcceptedCurrent(p)) return true;
    throw new AppError(
      HttpStatus.FORBIDDEN,
      'CONSENT_REQUIRED',
      'Debes aceptar el consentimiento de tratamiento de datos para continuar',
    );
  }
}
