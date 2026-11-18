import { ForbiddenException, HttpStatus, Injectable, NotFoundException } from '@nestjs/common';
import type { Country, Prisma, QuestionStatus } from '@prisma/client';
import {
  QUESTION_CSV_HEADERS,
  brandThemeSchema,
  canTransitionQuestion,
  parseCsv,
  questionCsvRowSchema,
  questionSchema,
  toPublicQuestion,
  type BrandCreate,
  type BrandTheme,
  type CsvImportBody,
  type ImportJobView,
  type ImportRowError,
  type PublicQuestion,
  type QuestionOption,
  type QuestionStatusPatch,
} from '@pharma/shared';
import { uuidv7 } from 'uuidv7';
import { AuditService } from '../audit/audit.service';
import type { Principal } from '../auth/principal';
import { AppError } from '../common/errors';
import { CountryConfigService } from '../countries/country-config.service';
import { PrismaService } from '../infra/prisma.service';
import { AdminCountriesService } from './admin-countries.service';

export interface AdminBrandView {
  id: string;
  slug: string;
  name: string;
  theme: BrandTheme;
  countries: { code: string; name: string; active: boolean }[];
  publishedQuestionsCount: number;
  totalQuestionsCount: number;
}

export interface AdminQuestionView {
  id: string;
  brandId: string;
  brandSlug: string;
  brandName: string;
  countryCode: string | null;
  type: 'MULTIPLE_CHOICE' | 'TRUE_FALSE';
  prompt: string;
  options: QuestionOption[];
  correctAnswer: string;
  locale: string;
  status: QuestionStatus;
  version: number;
  updatedAt: string;
}

@Injectable()
export class AdminContentService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly countries: AdminCountriesService,
    private readonly countryCache: CountryConfigService,
    private readonly audit: AuditService,
  ) {}

  // ───────────────────────────── Marcas ─────────────────────────────

  async listBrands(p: Principal): Promise<AdminBrandView[]> {
    const where: Prisma.BrandWhereInput =
      p.role === 'SUPER_ADMIN'
        ? {}
        : { countries: { some: { countryId: p.countryId ?? '__none__' } } };

    const brands = await this.prisma.brand.findMany({
      where,
      orderBy: { name: 'asc' },
      include: {
        countries: {
          include: { country: { select: { id: true, code: true, name: true } } },
          orderBy: { country: { code: 'asc' } },
        },
        questions: {
          where:
            p.role === 'SUPER_ADMIN'
              ? {}
              : { OR: [{ countryId: null }, { countryId: p.countryId ?? '__none__' }] },
          select: { status: true },
        },
      },
    });

    return brands.map((b) => {
      const visibleCountries =
        p.role === 'SUPER_ADMIN'
          ? b.countries
          : b.countries.filter((bc) => bc.countryId === p.countryId);
      const published = b.questions.filter((q) => q.status === 'PUBLISHED').length;

      return {
        id: b.id,
        slug: b.slug,
        name: b.name,
        theme: brandThemeSchema.parse(b.theme),
        countries: visibleCountries.map((bc) => ({
          code: bc.country.code,
          name: bc.country.name,
          active: bc.active,
        })),
        publishedQuestionsCount: published,
        totalQuestionsCount: b.questions.length,
      };
    });
  }

  async createBrand(p: Principal, input: BrandCreate): Promise<AdminBrandView> {
    if (p.role !== 'SUPER_ADMIN' && p.role !== 'COUNTRY_ADMIN') {
      throw new ForbiddenException('Rol sin permiso para crear marcas');
    }

    const existing = await this.prisma.brand.findUnique({ where: { slug: input.slug } });
    if (existing) {
      throw new AppError(HttpStatus.CONFLICT, 'BRAND_EXISTS', 'Ya existe una marca con ese slug.');
    }

    const targetCountries: Country[] = [];
    for (const code of new Set(input.countryCodes)) {
      const c = await this.countries.scoped(p, code);
      targetCountries.push(c);
    }

    const brandId = uuidv7();
    await this.prisma.$transaction(async (tx) => {
      await tx.brand.create({
        data: {
          id: brandId,
          slug: input.slug,
          name: input.name,
          theme: input.theme as unknown as Prisma.InputJsonValue,
        },
      });

      for (const c of targetCountries) {
        await tx.brandCountry.create({
          data: {
            id: uuidv7(),
            brandId,
            countryId: c.id,
            active: true,
          },
        });
        for (const mechanic of ['MULTIPLE_CHOICE', 'TRUE_FALSE'] as const) {
          await tx.game.create({
            data: {
              id: uuidv7(),
              brandId,
              countryId: c.id,
              mechanic,
              version: '1.0.0',
              status: 'ACTIVE',
            },
          });
        }
      }

      await this.audit.log(
        {
          actorId: p.userId,
          countryId: p.countryId,
          action: 'BRAND_CREATE',
          entity: 'Brand',
          entityId: brandId,
          after: {
            slug: input.slug,
            name: input.name,
            countryCodes: targetCountries.map((c) => c.code),
          },
        },
        tx,
      );
    });

    for (const c of targetCountries) {
      await this.countryCache.invalidate(c.code);
    }

    const all = await this.listBrands(p);
    return all.find((b) => b.id === brandId)!;
  }

  // ───────────────────────────── Preguntas y Flujo Editorial ─────────────────────────────

  async listQuestions(
    p: Principal,
    filters: { brandSlug?: string; status?: QuestionStatus; limit?: number } = {},
  ): Promise<AdminQuestionView[]> {
    const where: Prisma.QuestionWhereInput = {};
    if (filters.brandSlug) {
      where.brand = { slug: filters.brandSlug };
    }
    if (filters.status) {
      where.status = filters.status;
    }
    if (p.role !== 'SUPER_ADMIN') {
      const cId = p.countryId ?? '__none__';
      where.AND = [
        { brand: { countries: { some: { countryId: cId } } } },
        { OR: [{ countryId: null }, { countryId: cId }] },
      ];
    }

    const rows = await this.prisma.question.findMany({
      where,
      take: Math.min(filters.limit ?? 100, 250),
      orderBy: [{ updatedAt: 'desc' }],
      include: {
        brand: { select: { slug: true, name: true } },
        country: { select: { code: true } },
      },
    });

    return rows.map((q) => ({
      id: q.id,
      brandId: q.brandId,
      brandSlug: q.brand.slug,
      brandName: q.brand.name,
      countryCode: q.country?.code ?? null,
      type: q.type,
      prompt: q.prompt,
      options: q.options as unknown as QuestionOption[],
      correctAnswer: q.correctAnswer,
      locale: q.locale,
      status: q.status,
      version: q.version,
      updatedAt: q.updatedAt.toISOString(),
    }));
  }

  /**
   * Transición de estado editorial (`DRAFT → IN_REVIEW → PUBLISHED`, `ARCHIVED`).
   * Valida la máquina de estados (`canTransitionQuestion`), verifica alcance de país y audita.
   */
  async updateQuestionStatus(
    p: Principal,
    questionId: string,
    body: QuestionStatusPatch,
  ): Promise<AdminQuestionView> {
    const q = await this.prisma.question.findUnique({
      where: { id: questionId },
      include: {
        brand: { include: { countries: true } },
        country: { select: { code: true } },
      },
    });
    if (!q) throw new NotFoundException('Pregunta no encontrada');

    if (p.role !== 'SUPER_ADMIN') {
      if (!q.countryId) {
        throw new ForbiddenException(
          'Las preguntas compartidas multipaís solo pueden ser modificadas por SUPER_ADMIN',
        );
      }
      if (q.countryId !== p.countryId) {
        throw new ForbiddenException('La pregunta está fuera de tu alcance');
      }
    }

    if (!canTransitionQuestion(q.status, body.status)) {
      throw new AppError(
        HttpStatus.CONFLICT,
        'INVALID_QUESTION_TRANSITION',
        `No se permite pasar una pregunta de ${q.status} a ${body.status}.`,
        { from: q.status, to: body.status },
      );
    }

    const updated = await this.prisma.$transaction(async (tx) => {
      const after = await tx.question.update({
        where: { id: q.id },
        data: { status: body.status },
        include: {
          brand: { select: { slug: true, name: true } },
          country: { select: { code: true } },
        },
      });
      await this.audit.log(
        {
          actorId: p.userId,
          countryId: q.countryId ?? p.countryId,
          action: 'QUESTION_STATUS_UPDATE',
          entity: 'Question',
          entityId: q.id,
          before: { status: q.status },
          after: { status: after.status },
        },
        tx,
      );
      return after;
    });

    return {
      id: updated.id,
      brandId: updated.brandId,
      brandSlug: updated.brand.slug,
      brandName: updated.brand.name,
      countryCode: updated.country?.code ?? null,
      type: updated.type,
      prompt: updated.prompt,
      options: updated.options as unknown as QuestionOption[],
      correctAnswer: updated.correctAnswer,
      locale: updated.locale,
      status: updated.status,
      version: updated.version,
      updatedAt: updated.updatedAt.toISOString(),
    };
  }

  /**
   * Devuelve únicamente las preguntas elegibles para una partida de una marca en un país:
   * - Estado estrictamente `PUBLISHED` (las `DRAFT`, `IN_REVIEW` y `ARCHIVED` nunca entran).
   * - Preguntas del país (`countryId = country.id`) o compartidas (`countryId = null`).
   * - Proyectadas con `toPublicQuestion` (nunca expone `correctAnswer`).
   */
  async getPlayableQuestionsForBrand(
    countryId: string,
    brandId: string,
    mechanic?: 'MULTIPLE_CHOICE' | 'TRUE_FALSE',
  ): Promise<PublicQuestion[]> {
    const rows = await this.prisma.question.findMany({
      where: {
        brandId,
        status: 'PUBLISHED',
        ...(mechanic ? { type: mechanic } : {}),
        OR: [{ countryId: null }, { countryId }],
      },
      include: {
        termOverrides: { where: { countryId }, take: 1 },
      },
      orderBy: { id: 'asc' },
    });

    return rows.map((q) => {
      const override = q.termOverrides[0];
      const prompt = override?.prompt ?? q.prompt;
      const options = (override?.options ?? q.options) as unknown as QuestionOption[];
      return toPublicQuestion({
        id: q.id,
        type: q.type,
        prompt,
        options,
      });
    });
  }

  // ───────────────────────────── Importación CSV de Preguntas ─────────────────────────────

  async importQuestionsCsv(p: Principal, body: CsvImportBody): Promise<ImportJobView> {
    const scopeCountry = await this.countries.scoped(p, body.countryCode);
    const parsed = parseCsv(body.csv);

    const missingHeaders = QUESTION_CSV_HEADERS.filter((h) => !parsed.headers.includes(h));
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
        countryId: scopeCountry.id,
        kind: 'QUESTIONS',
        fileName: body.fileName,
        status: 'PROCESSING',
        totalRows: parsed.rows.length,
        createdBy: p.userId,
      },
    });

    const allBrands = await this.prisma.brand.findMany({
      include: { countries: { include: { country: { select: { id: true, code: true } } } } },
    });
    const brandBySlug = new Map(allBrands.map((b) => [b.slug, b]));

    const allCountries = await this.prisma.country.findMany({
      select: { id: true, code: true },
    });
    const countryIdByCode = new Map(allCountries.map((c) => [c.code, c.id]));

    const errors: ImportRowError[] = [];
    const questionsToCreate: Prisma.QuestionCreateManyInput[] = [];

    for (const row of parsed.rows) {
      const rawCheck = questionCsvRowSchema.safeParse(row.values);
      if (!rawCheck.success) {
        for (const issue of rawCheck.error.issues) {
          errors.push({
            row: row.rowNumber,
            field: issue.path.join('.') || 'row',
            message: issue.message,
          });
        }
        continue;
      }

      const data = rawCheck.data;
      const brand = brandBySlug.get(data.brandSlug);
      if (!brand) {
        errors.push({
          row: row.rowNumber,
          field: 'brandSlug',
          message: `La marca '${data.brandSlug}' no existe`,
        });
        continue;
      }

      let targetCountryId: string | null = null;
      if (data.countryCode) {
        if (p.role !== 'SUPER_ADMIN' && data.countryCode !== scopeCountry.code) {
          errors.push({
            row: row.rowNumber,
            field: 'countryCode',
            message: `No tienes permiso para cargar preguntas en ${data.countryCode}`,
          });
          continue;
        }
        const cId = countryIdByCode.get(data.countryCode);
        if (!cId) {
          errors.push({
            row: row.rowNumber,
            field: 'countryCode',
            message: `El país '${data.countryCode}' no existe`,
          });
          continue;
        }
        const availableInCountry = brand.countries.some((bc) => bc.countryId === cId);
        if (!availableInCountry) {
          errors.push({
            row: row.rowNumber,
            field: 'brandSlug',
            message: `La marca '${data.brandSlug}' no está disponible en ${data.countryCode}`,
          });
          continue;
        }
        targetCountryId = cId;
      } else {
        // Pregunta compartida (countryId = null): ADR-010 solo permite a SUPER_ADMIN
        if (p.role !== 'SUPER_ADMIN') {
          errors.push({
            row: row.rowNumber,
            field: 'countryCode',
            message: 'Solo SUPER_ADMIN puede importar preguntas compartidas sin countryCode',
          });
          continue;
        }
      }

      // Parsear opciones `id:texto|id:texto`
      const rawOptions = data.options
        .split('|')
        .map((item) => item.trim())
        .filter(Boolean);
      const parsedOptions: QuestionOption[] = [];
      let optionFormatErr: string | null = null;

      for (const optStr of rawOptions) {
        const colonIdx = optStr.indexOf(':');
        if (colonIdx <= 0 || colonIdx === optStr.length - 1) {
          optionFormatErr = `Opción '${optStr}' inválida (usa formato id:texto separado por |)`;
          break;
        }
        parsedOptions.push({
          id: optStr.slice(0, colonIdx).trim(),
          text: optStr.slice(colonIdx + 1).trim(),
        });
      }

      if (optionFormatErr) {
        errors.push({
          row: row.rowNumber,
          field: 'options',
          message: optionFormatErr,
        });
        continue;
      }

      const qCheck = questionSchema.safeParse({
        type: data.type,
        prompt: data.prompt,
        options: parsedOptions,
        correctAnswer: data.correctAnswer,
      });

      if (!qCheck.success) {
        for (const issue of qCheck.error.issues) {
          errors.push({
            row: row.rowNumber,
            field: issue.path.join('.') || 'options',
            message: issue.message,
          });
        }
        continue;
      }

      questionsToCreate.push({
        id: uuidv7(),
        brandId: brand.id,
        countryId: targetCountryId,
        type: qCheck.data.type,
        prompt: qCheck.data.prompt,
        options: qCheck.data.options as unknown as Prisma.InputJsonValue,
        correctAnswer: qCheck.data.correctAnswer,
        locale: data.locale,
        status: 'DRAFT',
        version: 1,
      });
    }

    if (questionsToCreate.length > 0) {
      const CHUNK = 500;
      for (let i = 0; i < questionsToCreate.length; i += CHUNK) {
        await this.prisma.question.createMany({
          data: questionsToCreate.slice(i, i + CHUNK),
        });
      }
    }

    const finishedAt = new Date();
    const updatedJob = await this.prisma.importJob.update({
      where: { id: jobId },
      data: {
        status: 'COMPLETED',
        validRows: questionsToCreate.length,
        errors: errors as unknown as Prisma.InputJsonValue,
        finishedAt,
      },
      include: { country: { select: { code: true } } },
    });

    await this.audit.log({
      actorId: p.userId,
      countryId: scopeCountry.id,
      action: 'IMPORT_QUESTIONS_CSV',
      entity: 'ImportJob',
      entityId: jobId,
      after: {
        fileName: body.fileName,
        totalRows: parsed.rows.length,
        validRows: questionsToCreate.length,
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
}
