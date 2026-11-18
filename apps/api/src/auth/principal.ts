import { createParamDecorator, type ExecutionContext, SetMetadata } from '@nestjs/common';
import type { AppAudience, Role } from '@pharma/shared';
import type { Request } from 'express';

/** Identidad extraída del token de acceso. */
export interface Principal {
  userId: string;
  role: Role;
  /** Nulo solo para SUPER_ADMIN. */
  countryId: string | null;
  countryCode: string | null;
  app: AppAudience;
}

export type AuthedRequest = Request & { principal?: Principal };

export const IS_PUBLIC = 'auth:public';
/** Ruta sin autenticación. Todo lo demás exige token (denegar por defecto). */
export const Public = () => SetMetadata(IS_PUBLIC, true);

export const ROLES_KEY = 'auth:roles';
/** Roles permitidos. Sin este decorador, cualquier usuario autenticado. */
export const Roles = (...roles: Role[]) => SetMetadata(ROLES_KEY, roles);

export const APP_KEY = 'auth:app';
/** Audiencia exigida: los endpoints de administración solo aceptan tokens del panel. */
export const RequireApp = (app: AppAudience) => SetMetadata(APP_KEY, app);

export const SKIP_CONSENT = 'auth:skip-consent';
/** La ruta funciona sin consentimiento aceptado (perfil y aceptación). */
export const AllowWithoutConsent = () => SetMetadata(SKIP_CONSENT, true);

export const CurrentUser = createParamDecorator((_: unknown, ctx: ExecutionContext): Principal => {
  const req = ctx.switchToHttp().getRequest<AuthedRequest>();
  if (!req.principal) throw new Error('CurrentUser usado en una ruta pública');
  return req.principal;
});
