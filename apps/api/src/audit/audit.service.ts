import { Injectable } from '@nestjs/common';
import type { Prisma } from '@prisma/client';
import { uuidv7 } from 'uuidv7';
import { PrismaService } from '../infra/prisma.service';

export interface AuditEntry {
  actorId: string;
  countryId: string | null;
  action: string;
  entity: string;
  entityId?: string | null;
  before?: unknown;
  after?: unknown;
}

type Tx = Prisma.TransactionClient;

/** Registro inmutable de acciones de administración (la tabla rechaza UPDATE y DELETE). */
@Injectable()
export class AuditService {
  constructor(private readonly prisma: PrismaService) {}

  async log(entry: AuditEntry, tx: Tx = this.prisma): Promise<void> {
    await tx.adminAuditLog.create({
      data: {
        id: uuidv7(),
        actorId: entry.actorId,
        countryId: entry.countryId,
        action: entry.action,
        entity: entry.entity,
        entityId: entry.entityId ?? null,
        before: toJson(entry.before),
        after: toJson(entry.after),
      },
    });
  }
}

function toJson(v: unknown): Prisma.InputJsonValue | undefined {
  return v === undefined || v === null
    ? undefined
    : (JSON.parse(JSON.stringify(v)) as Prisma.InputJsonValue);
}
