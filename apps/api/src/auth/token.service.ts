import { createHash, randomBytes } from 'node:crypto';
import { HttpStatus, Inject, Injectable, UnauthorizedException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import {
  ACCESS_TOKEN_TTL_SECONDS,
  APP_AUDIENCES,
  REFRESH_TOKEN_TTL_DAYS,
  ROLES,
  type AppAudience,
  type Role,
} from '@pharma/shared';
import { uuidv7 } from 'uuidv7';
import { AppError } from '../common/errors';
import { ENV, type Env } from '../config/env';
import { PrismaService } from '../infra/prisma.service';
import type { Principal } from './principal';

const ISSUER = 'pharma-api';
const DAY_MS = 24 * 60 * 60 * 1000;
/** Ventana en la que un token recién rotado se considera carrera (dos pestañas), no robo. */
export const REFRESH_RACE_GRACE_MS = 15_000;

interface AccessClaims {
  sub: string;
  role: Role;
  cid: string | null;
  cc: string | null;
}

export interface IssuedRefresh {
  token: string;
  expiresAt: Date;
}

const sha256 = (v: string) => createHash('sha256').update(v).digest('hex');

/**
 * Tokens de sesión (CLAUDE.md §10):
 * - acceso: JWT HS256 de 15 minutos con audiencia `pwa` o `admin`, se guarda solo en memoria del cliente;
 * - refresh: valor opaco aleatorio de 90 días en cookie HttpOnly; en base de datos solo su SHA-256.
 *   Cada uso lo rota. Presentar uno ya rotado revoca toda la familia (posible robo).
 */
@Injectable()
export class TokenService {
  constructor(
    private readonly jwt: JwtService,
    private readonly prisma: PrismaService,
    @Inject(ENV) private readonly env: Env,
  ) {}

  signAccess(p: Principal): string {
    const claims: AccessClaims = {
      sub: p.userId,
      role: p.role,
      cid: p.countryId,
      cc: p.countryCode,
    };
    return this.jwt.sign(claims, {
      secret: this.env.AUTH_TOKEN_SECRET,
      algorithm: 'HS256',
      expiresIn: ACCESS_TOKEN_TTL_SECONDS,
      audience: p.app,
      issuer: ISSUER,
    });
  }

  async verifyAccess(token: string): Promise<Principal> {
    try {
      const c = await this.jwt.verifyAsync<AccessClaims & { aud: string }>(token, {
        secret: this.env.AUTH_TOKEN_SECRET,
        algorithms: ['HS256'],
        issuer: ISSUER,
        audience: [...APP_AUDIENCES],
      });
      if (!(ROLES as readonly string[]).includes(c.role)) throw new Error('rol');
      return {
        userId: c.sub,
        role: c.role,
        countryId: c.cid,
        countryCode: c.cc,
        app: c.aud as AppAudience,
      };
    } catch {
      throw new UnauthorizedException('Token de acceso inválido o vencido');
    }
  }

  /** Inicio de sesión: nueva familia de refresh tokens. */
  issueRefresh(userId: string, app: AppAudience): Promise<IssuedRefresh> {
    return this.createRefresh(userId, app, uuidv7());
  }

  /**
   * Rota un refresh token. Devuelve el usuario dueño y el token nuevo de la misma familia.
   * Errores: 401 REFRESH_INVALID (inexistente, vencido, revocado o reutilizado) o
   * 401 REFRESH_RACE (rotado hace segundos por otra solicitud: el cliente reintenta).
   */
  async rotateRefresh(
    token: string,
    app: AppAudience,
  ): Promise<{ userId: string; refresh: IssuedRefresh }> {
    const row = await this.prisma.refreshToken.findUnique({ where: { tokenHash: sha256(token) } });
    const now = new Date();
    if (!row || row.audience !== app || row.revokedAt || row.expiresAt <= now) {
      throw invalidRefresh();
    }
    if (row.rotatedAt) {
      if (now.getTime() - row.rotatedAt.getTime() < REFRESH_RACE_GRACE_MS) {
        throw new AppError(HttpStatus.UNAUTHORIZED, 'REFRESH_RACE', 'Sesión renovada en paralelo');
      }
      await this.revokeFamily(row.familyId);
      throw invalidRefresh();
    }
    // Marca condicional: si dos solicitudes compiten, solo una rota.
    const { count } = await this.prisma.refreshToken.updateMany({
      where: { id: row.id, rotatedAt: null, revokedAt: null },
      data: { rotatedAt: now },
    });
    if (count !== 1) {
      throw new AppError(HttpStatus.UNAUTHORIZED, 'REFRESH_RACE', 'Sesión renovada en paralelo');
    }
    const refresh = await this.createRefresh(row.userId, app, row.familyId);
    return { userId: row.userId, refresh };
  }

  /** Cierre de sesión: revoca la familia del token presentado (si existe). */
  async revokeByToken(token: string): Promise<void> {
    const row = await this.prisma.refreshToken.findUnique({ where: { tokenHash: sha256(token) } });
    if (row) await this.revokeFamily(row.familyId);
  }

  async revokeAllForUser(userId: string): Promise<void> {
    await this.prisma.refreshToken.updateMany({
      where: { userId, revokedAt: null },
      data: { revokedAt: new Date() },
    });
  }

  private async revokeFamily(familyId: string): Promise<void> {
    await this.prisma.refreshToken.updateMany({
      where: { familyId, revokedAt: null },
      data: { revokedAt: new Date() },
    });
  }

  private async createRefresh(userId: string, app: AppAudience, familyId: string) {
    const token = randomBytes(32).toString('base64url');
    // Sesión deslizante: cada rotación extiende 90 días (quien juega seguido no vuelve a pedir OTP).
    const expiresAt = new Date(Date.now() + REFRESH_TOKEN_TTL_DAYS * DAY_MS);
    await this.prisma.refreshToken.create({
      data: { id: uuidv7(), userId, familyId, audience: app, tokenHash: sha256(token), expiresAt },
    });
    return { token, expiresAt };
  }
}

function invalidRefresh() {
  return new AppError(
    HttpStatus.UNAUTHORIZED,
    'REFRESH_INVALID',
    'Tu sesión terminó. Ingresa de nuevo.',
  );
}
