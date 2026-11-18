import { Injectable, Logger } from '@nestjs/common';
import {
  pointsRulesSchema,
  termsSchema,
  type PointsRules,
  type PublicCountry,
} from '@pharma/shared';
import { PrismaService } from '../infra/prisma.service';
import { RedisService } from '../infra/redis.service';

/** País con su configuración vigente, tal como se guarda en caché. */
export interface CountrySnapshot {
  id: string;
  code: string;
  name: string;
  locale: string;
  timezone: string;
  phonePrefix: string;
  active: boolean;
  terms: Record<string, string>;
  pointsRules: PointsRules;
  rankingPeriodMonths: 1 | 2 | 3;
  consentVersionId: string | null;
}

const TTL_SECONDS = 600;
const keyByCode = (code: string) => `cfg:country:${code}`;
const PUBLIC_LIST_KEY = 'cfg:countries:public';

/**
 * Configuración de país con caché en Redis (CLAUDE.md §11) e invalidación explícita al guardar.
 * Así un cambio hecho en el panel se aplica en todas las instancias sin desplegar.
 */
@Injectable()
export class CountryConfigService {
  private readonly logger = new Logger(CountryConfigService.name);
  /** id → código. El código de un país no cambia, así que este mapa no se invalida. */
  private readonly codeById = new Map<string, string>();

  constructor(
    private readonly prisma: PrismaService,
    private readonly redis: RedisService,
  ) {}

  async getByCode(code: string): Promise<CountrySnapshot | null> {
    const cached = await this.cacheGet<CountrySnapshot>(keyByCode(code));
    if (cached) return cached;
    const snap = await this.load(code);
    if (snap) await this.cacheSet(keyByCode(code), snap);
    return snap;
  }

  async getById(id: string): Promise<CountrySnapshot | null> {
    let code = this.codeById.get(id);
    if (!code) {
      const row = await this.prisma.country.findUnique({ where: { id }, select: { code: true } });
      if (!row) return null;
      code = row.code;
      this.codeById.set(id, code);
    }
    return this.getByCode(code);
  }

  async listPublic(): Promise<PublicCountry[]> {
    const cached = await this.cacheGet<PublicCountry[]>(PUBLIC_LIST_KEY);
    if (cached) return cached;
    const rows = await this.prisma.country.findMany({
      where: { active: true },
      select: { code: true, name: true, locale: true, phonePrefix: true },
      orderBy: { name: 'asc' },
    });
    await this.cacheSet(PUBLIC_LIST_KEY, rows);
    return rows;
  }

  async invalidate(code: string): Promise<void> {
    try {
      await this.redis.client.del(keyByCode(code), PUBLIC_LIST_KEY);
    } catch (e) {
      // Sin invalidación, el valor viejo vive como máximo TTL_SECONDS.
      this.logger.warn(`No se pudo invalidar la caché de ${code}: ${String(e)}`);
    }
  }

  private async load(code: string): Promise<CountrySnapshot | null> {
    const c = await this.prisma.country.findUnique({ where: { code }, include: { config: true } });
    if (!c || !c.config) return null;
    this.codeById.set(c.id, c.code);
    return {
      id: c.id,
      code: c.code,
      name: c.name,
      locale: c.locale,
      timezone: c.timezone,
      phonePrefix: c.phonePrefix,
      active: c.active,
      terms: termsSchema.parse(c.config.terms),
      pointsRules: pointsRulesSchema.parse(c.config.pointsRules),
      rankingPeriodMonths: c.config.rankingPeriodMonths as 1 | 2 | 3,
      consentVersionId: c.config.consentVersionId,
    };
  }

  // Si Redis falla, se sirve desde PostgreSQL: la caché nunca es la fuente de verdad.
  private async cacheGet<T>(key: string): Promise<T | null> {
    try {
      const raw = await this.redis.client.get(key);
      return raw ? (JSON.parse(raw) as T) : null;
    } catch {
      return null;
    }
  }

  private async cacheSet(key: string, value: unknown): Promise<void> {
    try {
      await this.redis.client.set(key, JSON.stringify(value), 'EX', TTL_SECONDS);
    } catch {
      // La caché es opcional.
    }
  }
}
