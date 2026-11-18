import { ForbiddenException, HttpStatus, Injectable } from '@nestjs/common';
import { type Prisma } from '@prisma/client';
import {
  sanitizeCsvCell,
  sanitizeUsagePayload,
  toPublicQuestion,
  type PendingKnowledgeTest,
  type PublicQuestion,
  type SubmitKnowledgeTestRequest,
  type SubmitKnowledgeTestResponse,
  type UsageEventInput,
} from '@pharma/shared';
import { uuidv7 } from 'uuidv7';
import { AuditService } from '../audit/audit.service';
import { type Principal } from '../auth/principal';
import { AppError } from '../common/errors';
import { PrismaService } from '../infra/prisma.service';

@Injectable()
export class MeasurementService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  private requireCountryId(actor: Principal): string {
    if (!actor.countryId) {
      throw new AppError(
        HttpStatus.BAD_REQUEST,
        'COUNTRY_REQUIRED',
        'El usuario no tiene país asignado',
      );
    }
    return actor.countryId;
  }

  /**
   * Obtiene los tests iniciales de conocimiento pendientes por marca activa en el país del usuario.
   * Si una combinación marca-país activa aún no tiene registro KnowledgeTest INITIAL, lo aprovisiona
   * con hasta 5 preguntas PUBLISHED de esa marca.
   * NUNCA expone `correctAnswer`.
   */
  async getPendingTests(actor: Principal): Promise<{ tests: PendingKnowledgeTest[] }> {
    const countryId = this.requireCountryId(actor);

    const activeBrandCountries = await this.prisma.brandCountry.findMany({
      where: { countryId, active: true },
      include: { brand: true },
      orderBy: { brand: { slug: 'asc' } },
    });

    for (const bc of activeBrandCountries) {
      const existing = await this.prisma.knowledgeTest.findUnique({
        where: {
          brandId_countryId_kind: {
            brandId: bc.brandId,
            countryId,
            kind: 'INITIAL',
          },
        },
      });
      if (!existing) {
        const sampleQuestions = await this.prisma.question.findMany({
          where: {
            brandId: bc.brandId,
            status: 'PUBLISHED',
            OR: [{ countryId: null }, { countryId }],
          },
          orderBy: { createdAt: 'asc' },
          take: 5,
          select: { id: true },
        });
        if (sampleQuestions.length > 0) {
          await this.prisma.knowledgeTest.create({
            data: {
              id: uuidv7(),
              brandId: bc.brandId,
              countryId,
              kind: 'INITIAL',
              questionIds: sampleQuestions.map((q) => q.id),
              active: true,
            },
          });
        }
      }
    }

    const allTests = await this.prisma.knowledgeTest.findMany({
      where: {
        countryId,
        kind: 'INITIAL',
        active: true,
      },
      include: {
        brand: true,
        results: {
          where: { userId: actor.userId },
          select: { id: true },
        },
      },
      orderBy: { brand: { slug: 'asc' } },
    });

    const pendingTests = allTests.filter((t) => t.results.length === 0);
    const allQuestionIds = Array.from(new Set(pendingTests.flatMap((t) => t.questionIds)));

    const questions =
      allQuestionIds.length > 0
        ? await this.prisma.question.findMany({
            where: { id: { in: allQuestionIds } },
            include: {
              termOverrides: {
                where: { countryId },
              },
            },
          })
        : [];
    const questionById = new Map(questions.map((q) => [q.id, q]));

    const result: PendingKnowledgeTest[] = [];
    for (const test of pendingTests) {
      const publicQuestions: PublicQuestion[] = [];
      for (const qId of test.questionIds) {
        const q = questionById.get(qId);
        if (!q) continue;
        const override = q.termOverrides[0];
        publicQuestions.push(
          toPublicQuestion({
            id: q.id,
            type: q.type,
            prompt: override?.prompt ?? q.prompt,
            options: (override?.options ?? q.options) as { id: string; text: string }[],
          }),
        );
      }
      if (publicQuestions.length > 0) {
        result.push({
          id: test.id,
          brandId: test.brandId,
          brandName: test.brand.name,
          brandSlug: test.brand.slug,
          countryId: test.countryId,
          kind: test.kind,
          questions: publicQuestions,
        });
      }
    }

    return { tests: result };
  }

  /**
   * Evalúa el test de conocimiento inicial en el servidor y registra TestResult y UsageEvent.
   * Idempotente: si el usuario ya completó el test, devuelve el resultado existente.
   */
  async submitTest(
    actor: Principal,
    testId: string,
    body: SubmitKnowledgeTestRequest,
  ): Promise<SubmitKnowledgeTestResponse> {
    const countryId = this.requireCountryId(actor);

    const test = await this.prisma.knowledgeTest.findUnique({
      where: { id: testId },
    });
    if (!test || !test.active || test.countryId !== countryId) {
      throw new AppError(
        HttpStatus.NOT_FOUND,
        'TEST_NOT_FOUND',
        'El test de conocimiento no existe o no pertenece a tu país',
      );
    }

    const existingResult = await this.prisma.testResult.findUnique({
      where: {
        testId_userId: {
          testId: test.id,
          userId: actor.userId,
        },
      },
    });
    if (existingResult) {
      return {
        resultId: existingResult.id,
        testId: existingResult.testId,
        brandId: test.brandId,
        score: existingResult.score,
        total: existingResult.total,
        completedAt: existingResult.completedAt.toISOString(),
      };
    }

    const questions = await this.prisma.question.findMany({
      where: { id: { in: test.questionIds } },
      select: { id: true, correctAnswer: true },
    });
    const correctByQuestionId = new Map(questions.map((q) => [q.id, q.correctAnswer]));
    const submittedByQuestionId = new Map(body.answers.map((a) => [a.questionId, a.answer]));

    let score = 0;
    for (const qId of test.questionIds) {
      const expected = correctByQuestionId.get(qId);
      const given = submittedByQuestionId.get(qId);
      if (expected !== undefined && given !== undefined && expected === given) {
        score++;
      }
    }

    const total = test.questionIds.length;
    const now = new Date();
    const created = await this.prisma.testResult.create({
      data: {
        id: uuidv7(),
        testId: test.id,
        userId: actor.userId,
        score,
        total,
        completedAt: now,
      },
    });

    await this.prisma.usageEvent.create({
      data: {
        id: uuidv7(),
        type: 'knowledge_test.submitted',
        userId: actor.userId,
        countryId,
        brandId: test.brandId,
        payload: {
          testId: test.id,
          kind: test.kind,
          score,
          total,
        },
        occurredAt: now,
      },
    });

    return {
      resultId: created.id,
      testId: created.testId,
      brandId: test.brandId,
      score: created.score,
      total: created.total,
      completedAt: created.completedAt.toISOString(),
    };
  }

  /**
   * Registra un evento de uso eliminando cualquier posible campo con datos personales.
   */
  async recordUsageEvent(
    actor: Principal,
    input: UsageEventInput,
  ): Promise<{ id: string; occurredAt: string }> {
    const countryId = this.requireCountryId(actor);
    const cleanPayload = sanitizeUsagePayload(input.payload);
    const now = new Date();

    const ev = await this.prisma.usageEvent.create({
      data: {
        id: uuidv7(),
        type: input.type,
        userId: actor.userId,
        countryId,
        brandId: input.brandId ?? null,
        payload: (cleanPayload ?? undefined) as Prisma.InputJsonValue | undefined,
        occurredAt: now,
      },
    });

    return {
      id: ev.id,
      occurredAt: ev.occurredAt.toISOString(),
    };
  }

  /**
   * Exporta el reporte de participación básico en CSV por país, farmacia y marca,
   * registrando la operación en AdminAuditLog.
   */
  async exportParticipationCsv(
    actor: Principal,
    queryCountryId?: string,
    queryCountryCode?: string,
  ): Promise<string> {
    let resolvedCountryId = queryCountryId;
    if (!resolvedCountryId && queryCountryCode) {
      const byCode = await this.prisma.country.findUnique({
        where: { code: queryCountryCode },
      });
      if (byCode) resolvedCountryId = byCode.id;
    }

    let targetCountryIds: string[] = [];

    if (actor.role === 'SUPER_ADMIN') {
      if (resolvedCountryId) {
        targetCountryIds = [resolvedCountryId];
      } else {
        const allCountries = await this.prisma.country.findMany({
          where: { active: true },
          orderBy: { code: 'asc' },
          select: { id: true },
        });
        targetCountryIds = allCountries.map((c) => c.id);
      }
    } else {
      const cid = resolvedCountryId ?? this.requireCountryId(actor);
      if (cid !== actor.countryId) {
        throw new ForbiddenException('El país está fuera de tu alcance');
      }
      targetCountryIds = [cid];
    }

    const countries = await this.prisma.country.findMany({
      where: { id: { in: targetCountryIds } },
      orderBy: { code: 'asc' },
    });

    const header =
      'countryCode,pharmacyCode,pharmacyName,city,brandSlug,brandName,activeClerks,clerksWithLogin,clerksPlayedBrand,sessionsFinished,initialTestsCompleted,avgInitialTestScorePct,totalPointsAwarded';
    const lines: string[] = [header];

    for (const country of countries) {
      const [pharmacies, brandCountries, sessions, ledgerEntries, testResults] = await Promise.all([
        this.prisma.pharmacy.findMany({
          where: { countryId: country.id, active: true },
          orderBy: { externalCode: 'asc' },
          include: {
            assignments: {
              where: { to: null },
              include: {
                user: {
                  select: {
                    id: true,
                    role: true,
                    status: true,
                    lastLoginAt: true,
                  },
                },
              },
            },
          },
        }),
        this.prisma.brandCountry.findMany({
          where: { countryId: country.id, active: true },
          include: { brand: true },
          orderBy: { brand: { slug: 'asc' } },
        }),
        this.prisma.gameSession.findMany({
          where: { countryId: country.id, status: 'FINISHED' },
          select: { userId: true, brandId: true },
        }),
        this.prisma.pointsLedger.findMany({
          where: { countryId: country.id, onHold: false },
          select: { userId: true, brandId: true, delta: true },
        }),
        this.prisma.testResult.findMany({
          where: {
            test: { countryId: country.id, kind: 'INITIAL' },
          },
          include: {
            test: { select: { brandId: true } },
          },
        }),
      ]);

      for (const ph of pharmacies) {
        const activeClerkUsers = ph.assignments
          .map((a) => a.user)
          .filter((u) => u.role === 'CLERK' && u.status === 'ACTIVE');
        const activeClerkIds = new Set(activeClerkUsers.map((u) => u.id));
        const activeClerksCount = activeClerkUsers.length;
        const clerksWithLoginCount = activeClerkUsers.filter((u) => u.lastLoginAt !== null).length;

        for (const bc of brandCountries) {
          const brandSessions = sessions.filter(
            (s) => s.brandId === bc.brandId && activeClerkIds.has(s.userId),
          );
          const clerksPlayedBrandCount = new Set(brandSessions.map((s) => s.userId)).size;
          const sessionsFinishedCount = brandSessions.length;

          const brandTests = testResults.filter(
            (tr) => tr.test.brandId === bc.brandId && activeClerkIds.has(tr.userId),
          );
          const initialTestsCompletedCount = brandTests.length;
          const avgInitialTestScorePct =
            initialTestsCompletedCount > 0
              ? Math.round(
                  (brandTests.reduce(
                    (acc, tr) => acc + (tr.total > 0 ? (tr.score / tr.total) * 100 : 0),
                    0,
                  ) /
                    initialTestsCompletedCount) *
                    100,
                ) / 100
              : 0;

          const totalPointsAwarded = ledgerEntries
            .filter((l) => l.brandId === bc.brandId && activeClerkIds.has(l.userId))
            .reduce((acc, l) => acc + l.delta, 0);

          lines.push(
            [
              sanitizeCsvCell(country.code),
              sanitizeCsvCell(ph.externalCode ?? ph.id),
              sanitizeCsvCell(ph.name),
              sanitizeCsvCell(ph.city),
              sanitizeCsvCell(bc.brand.slug),
              sanitizeCsvCell(bc.brand.name),
              String(activeClerksCount),
              String(clerksWithLoginCount),
              String(clerksPlayedBrandCount),
              String(sessionsFinishedCount),
              String(initialTestsCompletedCount),
              String(avgInitialTestScorePct),
              String(totalPointsAwarded),
            ].join(','),
          );
        }
      }
    }

    await this.audit.log({
      actorId: actor.userId,
      countryId: targetCountryIds.length === 1 ? targetCountryIds[0]! : actor.countryId,
      action: 'participation.export_csv',
      entity: 'UsageEvent',
      entityId: targetCountryIds.join(','),
      after: { rows: lines.length - 1, countries: countries.map((c) => c.code) },
    });

    return lines.join('\n') + '\n';
  }
}
