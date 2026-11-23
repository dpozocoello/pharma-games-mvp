import { createHmac } from 'node:crypto';
import {
  ForbiddenException,
  HttpStatus,
  Inject,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import type { Prisma } from '@prisma/client';
import {
  USER_CSV_HEADERS,
  maskPhone,
  normalizeDocument,
  normalizePhone,
  parseCsv,
  userCsvRowSchema,
  type CsvImportBody,
  type ImportJobView,
  type ImportRowError,
  type PharmacyCreate,
  type PharmacyPatch,
  type UserStatusPatch,
  type UserTransfer,
} from '@pharma/shared';
import { uuidv7 } from 'uuidv7';
import { AuditService } from '../audit/audit.service';
import type { Principal } from '../auth/principal';
import { AppError } from '../common/errors';
import { ENV, type Env } from '../config/env';
import { PrismaService } from '../infra/prisma.service';
import { LiveRankingStore } from '../rankings/live-ranking.store';
import { AdminCountriesService } from './admin-countries.service';

export interface PharmacyView {
  id: string;
  countryCode: string;
  externalCode: string | null;
  name: string;
  city: string;
  active: boolean;
  activeClerksCount: number;
}

export interface AdminUserView {
  id: string;
  countryCode: string | null;
  displayName: string;
  phoneMasked: string;
  role: string;
  status: string;
  currentPharmacy: { id: string; name: string; externalCode: string | null } | null;
  assignmentHistory: {
    id: string;
    pharmacyId: string;
    pharmacyName: string;
    from: string;
    to: string | null;
  }[];
  totalPoints: number;
}

@Injectable()
export class AdminUsersPharmaciesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly countries: AdminCountriesService,
    private readonly audit: AuditService,
    @Inject(ENV) private readonly env: Env,
    private readonly liveRanking: LiveRankingStore,
  ) {}

  // ───────────────────────────── Farmacias ─────────────────────────────

  async listPharmacies(p: Principal, countryCode?: string): Promise<PharmacyView[]> {
    let where: Prisma.PharmacyWhereInput = {};
    if (p.role === 'SUPER_ADMIN') {
      if (countryCode) {
        const c = await this.countries.scoped(p, countryCode);
        where = { countryId: c.id };
      }
    } else {
      if (countryCode) await this.countries.scoped(p, countryCode);
      where = { countryId: p.countryId ?? '__none__' };
    }

    const rows = await this.prisma.pharmacy.findMany({
      where,
      include: {
        country: { select: { code: true } },
        _count: { select: { assignments: { where: { to: null } } } },
      },
      orderBy: [{ name: 'asc' }],
    });

    return rows.map((r) => ({
      id: r.id,
      countryCode: r.country.code,
      externalCode: r.externalCode,
      name: r.name,
      city: r.city,
      active: r.active,
      activeClerksCount: r._count.assignments,
    }));
  }

  async createPharmacy(p: Principal, input: PharmacyCreate): Promise<PharmacyView> {
    const country = await this.countries.scoped(p, input.countryCode);
    const existing = await this.prisma.pharmacy.findUnique({
      where: {
        countryId_externalCode: { countryId: country.id, externalCode: input.externalCode },
      },
    });
    if (existing) {
      throw new AppError(
        HttpStatus.CONFLICT,
        'PHARMACY_EXISTS',
        `Ya existe una farmacia con el código ${input.externalCode} en ${country.name}.`,
      );
    }

    let chainId: string | null = null;
    if (input.chainName) {
      const chain = await this.prisma.chain.upsert({
        where: { countryId_name: { countryId: country.id, name: input.chainName } },
        update: {},
        create: { id: uuidv7(), countryId: country.id, name: input.chainName },
      });
      chainId = chain.id;
    }

    const id = uuidv7();
    const created = await this.prisma.$transaction(async (tx) => {
      const ph = await tx.pharmacy.create({
        data: {
          id,
          countryId: country.id,
          chainId,
          externalCode: input.externalCode,
          name: input.name,
          city: input.city,
          active: true,
        },
      });
      await this.audit.log(
        {
          actorId: p.userId,
          countryId: country.id,
          action: 'PHARMACY_CREATE',
          entity: 'Pharmacy',
          entityId: ph.id,
          after: { externalCode: ph.externalCode, name: ph.name, city: ph.city, active: ph.active },
        },
        tx,
      );
      return ph;
    });

    return {
      id: created.id,
      countryCode: country.code,
      externalCode: created.externalCode,
      name: created.name,
      city: created.city,
      active: created.active,
      activeClerksCount: 0,
    };
  }

  async patchPharmacy(p: Principal, id: string, input: PharmacyPatch): Promise<PharmacyView> {
    const ph = await this.prisma.pharmacy.findUnique({
      where: { id },
      include: { country: true },
    });
    if (!ph) throw new NotFoundException('Farmacia no encontrada');
    if (p.role !== 'SUPER_ADMIN' && ph.countryId !== p.countryId) {
      throw new ForbiddenException('La farmacia está fuera de tu alcance');
    }

    const updated = await this.prisma.$transaction(async (tx) => {
      const after = await tx.pharmacy.update({
        where: { id },
        data: input,
        include: { _count: { select: { assignments: { where: { to: null } } } } },
      });
      await this.audit.log(
        {
          actorId: p.userId,
          countryId: ph.countryId,
          action: 'PHARMACY_UPDATE',
          entity: 'Pharmacy',
          entityId: ph.id,
          before: { name: ph.name, city: ph.city, active: ph.active },
          after: { name: after.name, city: after.city, active: after.active },
        },
        tx,
      );
      return after;
    });

    return {
      id: updated.id,
      countryCode: ph.country.code,
      externalCode: updated.externalCode,
      name: updated.name,
      city: updated.city,
      active: updated.active,
      activeClerksCount: updated._count.assignments,
    };
  }

  // ───────────────────────────── Usuarios y Traslados ─────────────────────────────

  async listUsers(p: Principal, countryCode?: string, limit = 100): Promise<AdminUserView[]> {
    let where: Prisma.UserWhereInput = {};
    if (p.role === 'SUPER_ADMIN') {
      if (countryCode) {
        const c = await this.countries.scoped(p, countryCode);
        where = { countryId: c.id };
      }
    } else {
      if (countryCode) await this.countries.scoped(p, countryCode);
      where = { countryId: p.countryId ?? '__none__' };
    }

    const users = await this.prisma.user.findMany({
      where,
      take: Math.min(limit, 250),
      orderBy: { createdAt: 'desc' },
      include: {
        country: { select: { code: true } },
        assignments: {
          include: { pharmacy: true },
          orderBy: { from: 'desc' },
        },
        ledger: { select: { delta: true, onHold: true } },
      },
    });

    return users.map((u) => {
      const current = u.assignments.find((a) => a.to === null);
      const totalPoints = u.ledger
        .filter((l) => !l.onHold)
        .reduce((acc, item) => acc + item.delta, 0);
      return {
        id: u.id,
        countryCode: u.country?.code ?? null,
        displayName: u.displayName,
        phoneMasked: maskPhone(u.phoneE164),
        role: u.role,
        status: u.status,
        currentPharmacy: current
          ? {
              id: current.pharmacy.id,
              name: current.pharmacy.name,
              externalCode: current.pharmacy.externalCode,
            }
          : null,
        assignmentHistory: u.assignments.map((a) => ({
          id: a.id,
          pharmacyId: a.pharmacyId,
          pharmacyName: a.pharmacy.name,
          from: a.from.toISOString(),
          to: a.to ? a.to.toISOString() : null,
        })),
        totalPoints,
      };
    });
  }

  async getUserView(p: Principal, userId: string): Promise<AdminUserView> {
    const u = await this.prisma.user.findUnique({
      where: { id: userId },
      include: {
        country: { select: { code: true } },
        assignments: {
          include: { pharmacy: true },
          orderBy: { from: 'desc' },
        },
        ledger: { select: { delta: true, onHold: true } },
      },
    });
    if (!u) throw new NotFoundException('Usuario no encontrado');
    if (p.role !== 'SUPER_ADMIN' && u.countryId !== p.countryId) {
      throw new ForbiddenException('El usuario está fuera de tu alcance');
    }

    const current = u.assignments.find((a) => a.to === null);
    const totalPoints = u.ledger
      .filter((l) => !l.onHold)
      .reduce((acc, item) => acc + item.delta, 0);

    return {
      id: u.id,
      countryCode: u.country?.code ?? null,
      displayName: u.displayName,
      phoneMasked: maskPhone(u.phoneE164),
      role: u.role,
      status: u.status,
      currentPharmacy: current
        ? {
            id: current.pharmacy.id,
            name: current.pharmacy.name,
            externalCode: current.pharmacy.externalCode,
          }
        : null,
      assignmentHistory: u.assignments.map((a) => ({
        id: a.id,
        pharmacyId: a.pharmacyId,
        pharmacyName: a.pharmacy.name,
        from: a.from.toISOString(),
        to: a.to ? a.to.toISOString() : null,
      })),
      totalPoints,
    };
  }

  /**
   * Traslado de farmacia (CLAUDE.md §3 módulo 4 y §7):
   * Cierra la asignación abierta (`to = now`) y abre una nueva (`from = now, to = null`).
   * Nunca toca ni borra `PointsLedger`, conservando intactos los puntos y el historial.
   */
  async transferUser(p: Principal, userId: string, body: UserTransfer): Promise<AdminUserView> {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      include: { assignments: { where: { to: null } } },
    });
    if (!user) throw new NotFoundException('Usuario no encontrado');
    if (p.role !== 'SUPER_ADMIN' && user.countryId !== p.countryId) {
      throw new ForbiddenException('El usuario está fuera de tu alcance');
    }

    const targetPharmacy = await this.prisma.pharmacy.findUnique({
      where: { id: body.pharmacyId },
    });
    if (!targetPharmacy) throw new NotFoundException('Farmacia destino no encontrada');
    if (targetPharmacy.countryId !== user.countryId) {
      throw new AppError(
        HttpStatus.BAD_REQUEST,
        'CROSS_COUNTRY_TRANSFER',
        'No se puede trasladar un dependiente a una farmacia de otro país.',
      );
    }

    const current = user.assignments[0] ?? null;
    if (current?.pharmacyId === targetPharmacy.id) {
      return this.getUserView(p, userId);
    }

    const now = new Date();
    await this.prisma.$transaction(async (tx) => {
      if (current) {
        await tx.pharmacyAssignment.update({
          where: { id: current.id },
          data: { to: now },
        });
      }
      const nextAssign = await tx.pharmacyAssignment.create({
        data: {
          id: uuidv7(),
          userId: user.id,
          pharmacyId: targetPharmacy.id,
          from: now,
          to: null,
        },
      });
      await this.audit.log(
        {
          actorId: p.userId,
          countryId: user.countryId,
          action: 'USER_TRANSFER_PHARMACY',
          entity: 'User',
          entityId: user.id,
          before: { pharmacyId: current?.pharmacyId ?? null },
          after: { pharmacyId: targetPharmacy.id, assignmentId: nextAssign.id },
        },
        tx,
      );
    });

    if (user.countryId) await this.liveRanking.markDirty(user.countryId);
    return this.getUserView(p, userId);
  }

  /**
   * Baja o reactivación de usuario (`ACTIVE` / `INACTIVE`). Al pasar a `INACTIVE`, revoca sus
   * sesiones activas (RefreshTokens) para impedir que siga operando.
   */
  async updateUserStatus(
    p: Principal,
    userId: string,
    body: UserStatusPatch,
  ): Promise<AdminUserView> {
    const user = await this.prisma.user.findUnique({ where: { id: userId } });
    if (!user) throw new NotFoundException('Usuario no encontrado');
    if (p.role !== 'SUPER_ADMIN' && user.countryId !== p.countryId) {
      throw new ForbiddenException('El usuario está fuera de tu alcance');
    }

    const now = new Date();
    await this.prisma.$transaction(async (tx) => {
      await tx.user.update({
        where: { id: userId },
        data: { status: body.status },
      });
      if (body.status === 'INACTIVE') {
        await tx.refreshToken.updateMany({
          where: { userId, revokedAt: null },
          data: { revokedAt: now },
        });
      }
      await this.audit.log(
        {
          actorId: p.userId,
          countryId: user.countryId,
          action: 'USER_STATUS_UPDATE',
          entity: 'User',
          entityId: user.id,
          before: { status: user.status },
          after: { status: body.status },
        },
        tx,
      );
    });

    if (user.countryId) await this.liveRanking.markDirty(user.countryId);
    return this.getUserView(p, userId);
  }

  // ───────────────────────────── Importación Masiva CSV (5.000 filas < 60 s) ─────────────────────────────

  async importUsersCsv(p: Principal, body: CsvImportBody): Promise<ImportJobView> {
    const country = await this.countries.scoped(p, body.countryCode);
    const parsed = parseCsv(body.csv);

    const missingHeaders = USER_CSV_HEADERS.filter((h) => !parsed.headers.includes(h));
    if (missingHeaders.length > 0) {
      throw new AppError(
        HttpStatus.BAD_REQUEST,
        'CSV_INVALID_HEADERS',
        `Faltan columnas obligatorias en el CSV: ${missingHeaders.join(', ')}`,
      );
    }

    const jobId = uuidv7();
    await this.prisma.importJob.create({
      data: {
        id: jobId,
        countryId: country.id,
        kind: 'USERS',
        fileName: body.fileName,
        status: 'PROCESSING',
        totalRows: parsed.rows.length,
        createdBy: p.userId,
      },
    });

    const errors: ImportRowError[] = [];
    interface ValidUserItem {
      rowNumber: number;
      pharmacyCode: string;
      pharmacyName: string;
      city: string;
      phoneE164: string;
      documentHash: string;
      displayName: string;
      role: 'CLERK' | 'PHARMACY_MANAGER';
    }
    const validItems: ValidUserItem[] = [];
    const seenPhonesInFile = new Set<string>();
    const seenDocsInFile = new Set<string>();

    for (const row of parsed.rows) {
      const check = userCsvRowSchema.safeParse(row.values);
      if (!check.success) {
        for (const issue of check.error.issues) {
          errors.push({
            row: row.rowNumber,
            field: issue.path.join('.') || 'row',
            message: issue.message,
          });
        }
        continue;
      }

      const data = check.data;
      if (data.countryCode !== country.code) {
        errors.push({
          row: row.rowNumber,
          field: 'countryCode',
          message: `El país de la fila (${data.countryCode}) no coincide con el país de importación (${country.code})`,
        });
        continue;
      }

      const phoneE164 = normalizePhone(data.phone, country.phonePrefix);
      if (!phoneE164) {
        errors.push({
          row: row.rowNumber,
          field: 'phone',
          message: `Número de teléfono inválido para ${country.code}`,
        });
        continue;
      }

      const normalizedDoc = normalizeDocument(data.document);
      if (normalizedDoc.length < 3) {
        errors.push({
          row: row.rowNumber,
          field: 'document',
          message: 'Documento de identidad inválido',
        });
        continue;
      }

      const docHash = createHmac('sha256', this.env.DOCUMENT_HASH_SECRET)
        .update(normalizedDoc)
        .digest('hex');

      if (seenPhonesInFile.has(phoneE164)) {
        errors.push({
          row: row.rowNumber,
          field: 'phone',
          message: 'Teléfono duplicado dentro del mismo archivo CSV',
        });
        continue;
      }
      if (seenDocsInFile.has(docHash)) {
        errors.push({
          row: row.rowNumber,
          field: 'document',
          message: 'Documento duplicado dentro del mismo archivo CSV',
        });
        continue;
      }

      seenPhonesInFile.add(phoneE164);
      seenDocsInFile.add(docHash);

      validItems.push({
        rowNumber: row.rowNumber,
        pharmacyCode: data.pharmacyCode,
        pharmacyName: data.pharmacyName,
        city: data.city,
        phoneE164,
        documentHash: docHash,
        displayName: data.displayName,
        role: data.role,
      });
    }

    // Procesamiento por lotes de alta velocidad (optimizado para >= 5.000 usuarios en segundos)
    let validCount = 0;
    if (validItems.length > 0) {
      // 1. Asegurar que todas las farmacias referenciadas existan en una sola pasada
      const existingPharmacies = await this.prisma.pharmacy.findMany({
        where: { countryId: country.id },
        select: { id: true, externalCode: true },
      });
      const pharmacyIdByCode = new Map<string, string>();
      for (const ph of existingPharmacies) {
        if (ph.externalCode) pharmacyIdByCode.set(ph.externalCode, ph.id);
      }

      const newPharmaciesMap = new Map<
        string,
        { id: string; countryId: string; externalCode: string; name: string; city: string }
      >();
      for (const item of validItems) {
        if (!pharmacyIdByCode.has(item.pharmacyCode) && !newPharmaciesMap.has(item.pharmacyCode)) {
          const phId = uuidv7();
          newPharmaciesMap.set(item.pharmacyCode, {
            id: phId,
            countryId: country.id,
            externalCode: item.pharmacyCode,
            name: item.pharmacyName,
            city: item.city,
          });
          pharmacyIdByCode.set(item.pharmacyCode, phId);
        }
      }

      if (newPharmaciesMap.size > 0) {
        await this.prisma.pharmacy.createMany({
          data: Array.from(newPharmaciesMap.values()),
          skipDuplicates: true,
        });
        // Refrescar por si alguna existía concurrentemente
        const refreshed = await this.prisma.pharmacy.findMany({
          where: {
            countryId: country.id,
            externalCode: { in: Array.from(newPharmaciesMap.keys()) },
          },
          select: { id: true, externalCode: true },
        });
        for (const ph of refreshed) {
          if (ph.externalCode) pharmacyIdByCode.set(ph.externalCode, ph.id);
        }
      }

      // 2. Consultar teléfonos o documentos que ya existen en la BD
      const phones = validItems.map((i) => i.phoneE164);
      const docHashes = validItems.map((i) => i.documentHash);

      const existingUsers = await this.prisma.user.findMany({
        where: {
          OR: [
            { phoneE164: { in: phones } },
            { countryId: country.id, documentHash: { in: docHashes } },
          ],
        },
        select: {
          id: true,
          countryId: true,
          phoneE164: true,
          documentHash: true,
          assignments: { where: { to: null }, select: { id: true, pharmacyId: true } },
        },
      });

      const userByPhone = new Map(existingUsers.map((u) => [u.phoneE164, u]));
      const userByDoc = new Map(
        existingUsers.filter((u) => u.documentHash).map((u) => [u.documentHash!, u]),
      );

      const usersToCreate: Prisma.UserCreateManyInput[] = [];
      const assignmentsToCreate: Prisma.PharmacyAssignmentCreateManyInput[] = [];
      const assignmentsToCloseIds: string[] = [];
      const now = new Date();

      for (const item of validItems) {
        const byPhone = userByPhone.get(item.phoneE164);
        const byDoc = userByDoc.get(item.documentHash);

        if (byPhone && byPhone.countryId && byPhone.countryId !== country.id) {
          errors.push({
            row: item.rowNumber,
            field: 'phone',
            message: 'Este número ya pertenece a un usuario registrado en otro país',
          });
          continue;
        }
        if (byPhone && byDoc && byPhone.id !== byDoc.id) {
          errors.push({
            row: item.rowNumber,
            field: 'document',
            message: 'Conflicto entre teléfono y documento con cuentas existentes distintas',
          });
          continue;
        }

        const targetPharmacyId = pharmacyIdByCode.get(item.pharmacyCode)!;
        const existingUser = byPhone ?? byDoc;

        if (!existingUser) {
          const newUserId = uuidv7();
          usersToCreate.push({
            id: newUserId,
            countryId: country.id,
            phoneE164: item.phoneE164,
            documentHash: item.documentHash,
            displayName: item.displayName,
            role: item.role,
            status: 'ACTIVE',
          });
          assignmentsToCreate.push({
            id: uuidv7(),
            userId: newUserId,
            pharmacyId: targetPharmacyId,
            from: now,
            to: null,
          });
          validCount++;
        } else {
          // Usuario existente: si cambió de farmacia, trasladar conservando historial
          const currentAssign = existingUser.assignments[0];
          if (!currentAssign) {
            assignmentsToCreate.push({
              id: uuidv7(),
              userId: existingUser.id,
              pharmacyId: targetPharmacyId,
              from: now,
              to: null,
            });
          } else if (currentAssign.pharmacyId !== targetPharmacyId) {
            assignmentsToCloseIds.push(currentAssign.id);
            assignmentsToCreate.push({
              id: uuidv7(),
              userId: existingUser.id,
              pharmacyId: targetPharmacyId,
              from: now,
              to: null,
            });
          }
          validCount++;
        }
      }

      // Ejecutar inserciones por lotes de 1.000 para máxima velocidad y baja memoria
      const CHUNK = 1000;
      for (let i = 0; i < usersToCreate.length; i += CHUNK) {
        await this.prisma.user.createMany({
          data: usersToCreate.slice(i, i + CHUNK),
          skipDuplicates: true,
        });
      }
      if (assignmentsToCloseIds.length > 0) {
        await this.prisma.pharmacyAssignment.updateMany({
          where: { id: { in: assignmentsToCloseIds } },
          data: { to: now },
        });
      }
      for (let i = 0; i < assignmentsToCreate.length; i += CHUNK) {
        await this.prisma.pharmacyAssignment.createMany({
          data: assignmentsToCreate.slice(i, i + CHUNK),
          skipDuplicates: true,
        });
      }
    }

    const finishedAt = new Date();
    const updatedJob = await this.prisma.importJob.update({
      where: { id: jobId },
      data: {
        status: 'COMPLETED',
        validRows: validCount,
        errors: errors as unknown as Prisma.InputJsonValue,
        finishedAt,
      },
      include: { country: { select: { code: true } } },
    });

    await this.audit.log({
      actorId: p.userId,
      countryId: country.id,
      action: 'IMPORT_USERS_CSV',
      entity: 'ImportJob',
      entityId: jobId,
      after: {
        fileName: body.fileName,
        totalRows: parsed.rows.length,
        validRows: validCount,
        errorCount: errors.length,
      },
    });

    return {
      id: updatedJob.id,
      countryCode: updatedJob.country.code,
      kind: updatedJob.kind,
      fileName: updatedJob.fileName,
      status: updatedJob.status,
      totalRows: updatedJob.totalRows,
      validRows: updatedJob.validRows,
      errors,
      createdAt: updatedJob.createdAt.toISOString(),
      finishedAt: updatedJob.finishedAt ? updatedJob.finishedAt.toISOString() : null,
    };
  }

  async getImportJob(p: Principal, id: string): Promise<ImportJobView> {
    const job = await this.prisma.importJob.findUnique({
      where: { id },
      include: { country: { select: { code: true } } },
    });
    if (!job) throw new NotFoundException('Trabajo de importación no encontrado');
    if (p.role !== 'SUPER_ADMIN' && job.countryId !== p.countryId) {
      throw new ForbiddenException('El trabajo de importación está fuera de tu alcance');
    }

    return {
      id: job.id,
      countryCode: job.country.code,
      kind: job.kind,
      fileName: job.fileName,
      status: job.status,
      totalRows: job.totalRows,
      validRows: job.validRows,
      errors: Array.isArray(job.errors) ? (job.errors as unknown as ImportRowError[]) : [],
      createdAt: job.createdAt.toISOString(),
      finishedAt: job.finishedAt ? job.finishedAt.toISOString() : null,
    };
  }
}
