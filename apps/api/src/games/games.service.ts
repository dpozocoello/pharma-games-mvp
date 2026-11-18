import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto';
import {
  ForbiddenException,
  HttpStatus,
  Inject,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import type { Prisma } from '@prisma/client';
import {
  applyDailyCaps,
  brandThemeSchema,
  calculateAnswerPoints,
  evaluateSessionAnomalies,
  localDay,
  toPublicQuestion,
  zonedMidnightUtc,
  type CatalogGameItem,
  type FinishSessionInput,
  type GameFinishResponse,
  type GamesCatalogResponse,
  type PublicQuestion,
  type QuestionOption,
  type StartedGameSessionResponse,
  type SubmitSessionAnswersInput,
} from '@pharma/shared';
import { uuidv7 } from 'uuidv7';
import type { Principal } from '../auth/principal';
import { AppError } from '../common/errors';
import { ENV, type Env } from '../config/env';
import { CountryConfigService } from '../countries/country-config.service';
import { PrismaService } from '../infra/prisma.service';
import { RedisService } from '../infra/redis.service';

interface SessionTokenPayload {
  sessionId: string;
  userId: string;
  questionIds: string[];
  expiresAtMs: number;
}

/** PRNG determinista con semilla para barajar preguntas de una partida. */
function seededShuffle<T>(items: readonly T[], seedStr: string): T[] {
  let h = 2166136261 >>> 0;
  for (let i = 0; i < seedStr.length; i++) {
    h ^= seedStr.charCodeAt(i);
    h = Math.imul(h, 16777619) >>> 0;
  }
  const rnd = () => {
    h = (h + 0x6d2b79f5) >>> 0;
    let t = Math.imul(h ^ (h >>> 15), h | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  const copy = [...items];
  for (let i = copy.length - 1; i > 0; i--) {
    const j = Math.floor(rnd() * (i + 1));
    [copy[i], copy[j]] = [copy[j]!, copy[i]!];
  }
  return copy;
}

@Injectable()
export class GamesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly redis: RedisService,
    private readonly countries: CountryConfigService,
    @Inject(ENV) private readonly env: Env,
  ) {}

  // ───────────────────────────── Token HMAC de Partida (§9) ─────────────────────────────

  signSessionToken(payload: SessionTokenPayload): string {
    const data = Buffer.from(JSON.stringify(payload), 'utf8').toString('base64url');
    const sig = createHmac('sha256', this.env.SESSION_TOKEN_SECRET)
      .update(data)
      .digest('base64url');
    return `${data}.${sig}`;
  }

  verifySessionToken(
    token: string,
    expectedSessionId: string,
    expectedUserId: string,
  ): SessionTokenPayload {
    const parts = token.split('.');
    if (parts.length !== 2) {
      throw new AppError(
        HttpStatus.UNAUTHORIZED,
        'SESSION_TOKEN_INVALID',
        'Token de partida inválido.',
      );
    }
    const [data, sig] = parts as [string, string];
    const expectedSig = createHmac('sha256', this.env.SESSION_TOKEN_SECRET)
      .update(data)
      .digest('base64url');

    const a = Buffer.from(sig);
    const b = Buffer.from(expectedSig);
    if (a.length !== b.length || !timingSafeEqual(a, b)) {
      throw new AppError(
        HttpStatus.UNAUTHORIZED,
        'SESSION_TOKEN_INVALID',
        'Firma de partida inválida.',
      );
    }

    let payload: SessionTokenPayload;
    try {
      payload = JSON.parse(Buffer.from(data, 'base64url').toString('utf8')) as SessionTokenPayload;
    } catch {
      throw new AppError(
        HttpStatus.UNAUTHORIZED,
        'SESSION_TOKEN_INVALID',
        'Token de partida corrupto.',
      );
    }

    if (payload.sessionId !== expectedSessionId) {
      throw new AppError(
        HttpStatus.FORBIDDEN,
        'SESSION_MISMATCH',
        'El token no corresponde a esta partida.',
      );
    }
    if (payload.userId !== expectedUserId) {
      throw new AppError(
        HttpStatus.FORBIDDEN,
        'SESSION_WRONG_USER',
        'Esta partida pertenece a otro usuario.',
      );
    }
    return payload;
  }

  // ───────────────────────────── Catálogo de Juegos por País (GET /games) ─────────────────────────────

  async listGamesForUser(p: Principal): Promise<GamesCatalogResponse> {
    if (!p.countryId) {
      throw new ForbiddenException('Se requiere un país fijado en la cuenta para listar juegos');
    }
    const country = await this.countries.getById(p.countryId);
    if (!country) throw new NotFoundException('País no encontrado');

    const now = new Date();
    const todayStr = localDay(now, country.timezone);
    const [y, m, d] = todayStr.split('-').map(Number) as [number, number, number];
    const localDayStart = zonedMidnightUtc(y, m, d, country.timezone);

    const openPeriod = await this.prisma.rankingPeriod.findFirst({
      where: { countryId: country.id, status: 'OPEN' },
      orderBy: { startsAt: 'desc' },
    });

    const [games, recentSessions] = await Promise.all([
      this.prisma.game.findMany({
        where: {
          countryId: country.id,
          status: 'ACTIVE',
          brand: {
            countries: {
              some: { countryId: country.id, active: true },
            },
          },
        },
        include: {
          brand: {
            include: {
              countries: { where: { countryId: country.id }, take: 1 },
            },
          },
        },
        orderBy: [{ brand: { name: 'asc' } }, { mechanic: 'asc' }],
      }),
      this.prisma.gameSession.findMany({
        where: {
          userId: p.userId,
          countryId: country.id,
          startedAt: {
            gte:
              openPeriod && openPeriod.startsAt < localDayStart
                ? openPeriod.startsAt
                : localDayStart,
          },
        },
        select: {
          gameId: true,
          brandId: true,
          status: true,
          startedAt: true,
        },
      }),
    ]);

    const playedBrandsInPeriod = new Set<string>();
    const sessionsTodayByGame = new Map<string, number>();

    for (const s of recentSessions) {
      if (s.status === 'FINISHED') {
        if (!openPeriod || s.startedAt >= openPeriod.startsAt) {
          playedBrandsInPeriod.add(s.brandId);
        }
      }
      if (s.startedAt >= localDayStart) {
        sessionsTodayByGame.set(s.gameId, (sessionsTodayByGame.get(s.gameId) ?? 0) + 1);
      }
    }

    const brandsSeen = new Map<string, { brandId: string; brandSlug: string; brandName: string }>();
    const catalogItems: CatalogGameItem[] = games.map((g) => {
      const bcTheme = g.brand.countries[0]?.theme;
      const theme = brandThemeSchema.parse(bcTheme ?? g.brand.theme);
      brandsSeen.set(g.brandId, {
        brandId: g.brandId,
        brandSlug: g.brand.slug,
        brandName: g.brand.name,
      });

      return {
        id: g.id,
        brandId: g.brandId,
        brandSlug: g.brand.slug,
        brandName: g.brand.name,
        mechanic: g.mechanic,
        version: g.version,
        theme,
        playedInCurrentPeriod: playedBrandsInPeriod.has(g.brandId),
        sessionsToday: sessionsTodayByGame.get(g.id) ?? 0,
        maxSessionsPerDay: country.pointsRules.maxSessionsPerGamePerDay,
      };
    });

    const pendingBrands = Array.from(brandsSeen.values()).filter(
      (b) => !playedBrandsInPeriod.has(b.brandId),
    );

    return {
      countryCode: country.code,
      locale: country.locale,
      terms: country.terms,
      pendingBrands,
      games: catalogItems,
    };
  }

  // ───────────────────────────── Iniciar Partida (POST /games/:id/sessions) ─────────────────────────────

  async startSession(p: Principal, gameId: string): Promise<StartedGameSessionResponse> {
    if (!p.countryId) {
      throw new ForbiddenException('Tu cuenta no tiene un país asociado');
    }
    const country = await this.countries.getById(p.countryId);
    if (!country) throw new NotFoundException('País no encontrado');

    const game = await this.prisma.game.findUnique({
      where: { id: gameId },
      include: {
        brand: {
          include: {
            countries: { where: { countryId: country.id }, take: 1 },
          },
        },
      },
    });

    if (!game || game.countryId !== country.id || game.status !== 'ACTIVE') {
      throw new NotFoundException('Juego no disponible en tu país');
    }
    const brandCountry = game.brand.countries[0];
    if (!brandCountry || !brandCountry.active) {
      throw new AppError(
        HttpStatus.FORBIDDEN,
        'BRAND_INACTIVE',
        'La marca no está activa en tu país.',
      );
    }

    // Verificar límite de reintentos diarios por juego (maxSessionsPerGamePerDay)
    const now = new Date();
    const todayStr = localDay(now, country.timezone);
    const [y, m, d] = todayStr.split('-').map(Number) as [number, number, number];
    const localDayStart = zonedMidnightUtc(y, m, d, country.timezone);

    const sessionsTodayCount = await this.prisma.gameSession.count({
      where: {
        userId: p.userId,
        gameId: game.id,
        startedAt: { gte: localDayStart },
      },
    });

    if (sessionsTodayCount >= country.pointsRules.maxSessionsPerGamePerDay) {
      throw new AppError(
        HttpStatus.TOO_MANY_REQUESTS,
        'MAX_DAILY_SESSIONS_REACHED',
        `Ya jugaste el máximo de ${country.pointsRules.maxSessionsPerGamePerDay} partidas hoy en este juego.`,
      );
    }

    // Seleccionar únicamente preguntas PUBLISHED de la marca y mecánica
    const publishedQuestions = await this.prisma.question.findMany({
      where: {
        brandId: game.brandId,
        type: game.mechanic,
        status: 'PUBLISHED',
        OR: [{ countryId: null }, { countryId: country.id }],
      },
      include: {
        termOverrides: { where: { countryId: country.id }, take: 1 },
      },
    });

    if (publishedQuestions.length === 0) {
      throw new AppError(
        HttpStatus.CONFLICT,
        'NO_PUBLISHED_QUESTIONS',
        'No hay preguntas publicadas disponibles para este juego.',
      );
    }

    const seed = randomBytes(8).toString('hex');
    const shuffled = seededShuffle(publishedQuestions, seed);
    const chosen = shuffled.slice(0, country.pointsRules.questionsPerSession);
    const questionIds = chosen.map((q) => q.id);

    // Proyectar estrictamente a PublicQuestion (JAMÁS incluye correctAnswer)
    const publicQuestions: PublicQuestion[] = chosen.map((q) => {
      const ov = q.termOverrides[0];
      const prompt = ov?.prompt ?? q.prompt;
      const options = (ov?.options ?? q.options) as unknown as QuestionOption[];
      return toPublicQuestion({
        id: q.id,
        type: q.type,
        prompt,
        options,
      });
    });

    const totalSeconds =
      country.pointsRules.questionsPerSession * country.pointsRules.secondsPerQuestion;
    // Margen extra de 3 minutos para permitir reconexión si se corta la red entre preguntas (§4.6 y §8)
    const expiresAt = new Date(now.getTime() + (totalSeconds + 180) * 1000);
    const sessionId = uuidv7();

    await this.prisma.gameSession.create({
      data: {
        id: sessionId,
        userId: p.userId,
        gameId: game.id,
        countryId: country.id,
        brandId: game.brandId,
        questionIds,
        seed,
        startedAt: now,
        expiresAt,
        status: 'IN_PROGRESS',
      },
    });

    const token = this.signSessionToken({
      sessionId,
      userId: p.userId,
      questionIds,
      expiresAtMs: expiresAt.getTime(),
    });

    const rawTheme = brandThemeSchema.parse(brandCountry.theme ?? game.brand.theme);

    return {
      session: {
        id: sessionId,
        token,
        expiresAt: expiresAt.toISOString(),
      },
      game: {
        id: game.id,
        mechanic: game.mechanic,
        version: game.version,
      },
      questions: publicQuestions,
      theme: {
        ...rawTheme,
        brandName: game.brand.name,
      },
      locale: country.locale,
      terms: country.terms,
      limits: {
        secondsPerQuestion: country.pointsRules.secondsPerQuestion,
        totalSeconds,
      },
    };
  }

  // ───────────────────────────── Recibir Respuestas en Lote (POST /sessions/:id/answers) ─────────────────────────────

  async submitAnswers(
    p: Principal,
    sessionId: string,
    input: SubmitSessionAnswersInput,
  ): Promise<{ accepted: number }> {
    const tokenPayload = this.verifySessionToken(input.token, sessionId, p.userId);
    const now = new Date();
    if (now.getTime() > tokenPayload.expiresAtMs) {
      throw new AppError(HttpStatus.GONE, 'SESSION_EXPIRED', 'La sesión de juego venció.');
    }

    const session = await this.prisma.gameSession.findUnique({
      where: { id: sessionId },
      include: { answers: { orderBy: { receivedAt: 'desc' }, take: 1 } },
    });
    if (!session) throw new NotFoundException('Sesión no encontrada');
    if (session.userId !== p.userId) {
      throw new ForbiddenException('Esta partida pertenece a otro usuario');
    }
    if (session.status === 'FINISHED') {
      // Idempotente si el cliente reenvía un lote cuando la sesión ya cerró
      return { accepted: 0 };
    }
    if (now > session.expiresAt || session.status === 'EXPIRED') {
      throw new AppError(HttpStatus.GONE, 'SESSION_EXPIRED', 'La sesión de juego venció.');
    }

    const country = await this.countries.getById(session.countryId);
    if (!country) throw new NotFoundException('País no encontrado');
    const rules = country.pointsRules;

    const allowedQuestionIds = new Set(session.questionIds);
    for (const a of input.answers) {
      if (!allowedQuestionIds.has(a.questionId)) {
        throw new AppError(
          HttpStatus.BAD_REQUEST,
          'INVALID_SESSION_QUESTION',
          `La pregunta ${a.questionId} no pertenece a esta partida.`,
        );
      }
    }

    const questions = await this.prisma.question.findMany({
      where: { id: { in: session.questionIds } },
      select: { id: true, correctAnswer: true },
    });
    const correctById = new Map(questions.map((q) => [q.id, q.correctAnswer]));

    let lastTimestamp = session.answers[0]?.receivedAt ?? session.startedAt;
    let accepted = 0;

    for (const item of input.answers) {
      const correctAns = correctById.get(item.questionId);
      const isCorrect = correctAns !== undefined && item.answer === correctAns;
      const serverElapsedMs =
        input.answers.length === 1 ? Math.max(1, now.getTime() - lastTimestamp.getTime()) : null;

      const points = calculateAnswerPoints(isCorrect, serverElapsedMs, rules);

      await this.prisma.sessionAnswer.upsert({
        where: {
          sessionId_questionId: {
            sessionId: session.id,
            questionId: item.questionId,
          },
        },
        update: {}, // Idempotente: si la respuesta ya estaba registrada, no la sobrescribe
        create: {
          id: uuidv7(),
          sessionId: session.id,
          questionId: item.questionId,
          answer: item.answer,
          clientElapsedMs: item.clientElapsedMs,
          serverElapsedMs,
          correct: isCorrect,
          points,
          receivedAt: now,
        },
      });
      lastTimestamp = now;
      accepted += 1;
    }

    return { accepted };
  }

  // ───────────────────────────── Finalizar Partida (POST /sessions/:id/finish) ─────────────────────────────

  async finishSession(
    p: Principal,
    sessionId: string,
    input: FinishSessionInput,
  ): Promise<GameFinishResponse> {
    const tokenPayload = this.verifySessionToken(input.token, sessionId, p.userId);
    const session = await this.prisma.gameSession.findUnique({
      where: { id: sessionId },
      include: { answers: true },
    });
    if (!session) throw new NotFoundException('Sesión no encontrada');
    if (session.userId !== p.userId) {
      throw new ForbiddenException('Esta partida pertenece a otro usuario');
    }

    // Respuesta idempotente al reenviar finish sobre una sesión ya terminada (§9)
    if (session.status === 'FINISHED') {
      const correctCount = session.answers.filter((a) => a.correct).length;
      return {
        score: session.score ?? 0,
        correct: correctCount,
        total: session.questionIds.length,
        dailyCapReached: session.flags.includes('DAILY_CAP_REACHED'),
      };
    }

    const now = new Date();
    if (now.getTime() > tokenPayload.expiresAtMs || now > session.expiresAt) {
      await this.prisma.gameSession.update({
        where: { id: session.id },
        data: { status: 'EXPIRED' },
      });
      throw new AppError(HttpStatus.GONE, 'SESSION_EXPIRED', 'La sesión de juego venció.');
    }

    const country = await this.countries.getById(session.countryId);
    if (!country) throw new NotFoundException('País no encontrado');
    const rules = country.pointsRules;

    const rawScore = session.answers.reduce((acc, a) => acc + a.points, 0);
    const correctCount = session.answers.filter((a) => a.correct).length;
    const todayStr = localDay(now, country.timezone);

    // Calcular puntos ya acreditados hoy en el libro de puntos (respetando zona horaria local)
    const todayEntries = await this.prisma.pointsLedger.findMany({
      where: {
        userId: p.userId,
        countryId: country.id,
        localDay: todayStr,
      },
      select: { brandId: true, delta: true },
    });

    const userTodayPoints = todayEntries.reduce((acc, e) => acc + e.delta, 0);
    const brandTodayPoints = todayEntries
      .filter((e) => e.brandId === session.brandId)
      .reduce((acc, e) => acc + e.delta, 0);

    const { creditedPoints: allowedPoints, dailyCapReached } = applyDailyCaps(
      rawScore,
      userTodayPoints,
      brandTodayPoints,
      rules,
    );

    // Evaluar anomalías de juego justo (§9)
    const oneHourAgo = new Date(now.getTime() - 3600_000);
    const [sessionsInLastHour, recentFinishedSessions] = await Promise.all([
      this.prisma.gameSession.count({
        where: {
          userId: p.userId,
          startedAt: { gte: oneHourAgo },
        },
      }),
      this.prisma.gameSession.findMany({
        where: {
          userId: p.userId,
          status: 'FINISHED',
          id: { not: session.id },
        },
        orderBy: { finishedAt: 'desc' },
        take: rules.anomaly.perfectStreakSessions,
        include: { answers: { select: { correct: true } } },
      }),
    ]);

    let priorConsecutivePerfect = 0;
    for (const prev of recentFinishedSessions) {
      const wasPerfect =
        prev.questionIds.length > 0 &&
        Array.isArray(prev.answers) &&
        prev.answers.length === prev.questionIds.length &&
        prev.answers.every((a: { correct: boolean }) => a.correct);
      if (wasPerfect) priorConsecutivePerfect += 1;
      else break;
    }

    const totalClientElapsedMs = session.answers.reduce((acc, a) => acc + a.clientElapsedMs, 0);
    const serverWallMs = Math.max(0, now.getTime() - session.startedAt.getTime());
    const sessionDurationMs =
      totalClientElapsedMs > 0
        ? Math.min(totalClientElapsedMs, serverWallMs || totalClientElapsedMs)
        : serverWallMs;

    const detectedAnomalies = evaluateSessionAnomalies({
      rules,
      questionCount: session.questionIds.length,
      answers: session.answers.map((a) => ({
        questionId: a.questionId,
        clientElapsedMs: a.clientElapsedMs,
        correct: a.correct,
      })),
      sessionDurationMs,
      priorConsecutivePerfectSessions: priorConsecutivePerfect,
      sessionsInLastHour: Math.max(1, sessionsInLastHour),
    });

    const onHold = detectedAnomalies.length > 0;
    const flags: string[] = [...session.flags];
    if (dailyCapReached && !flags.includes('DAILY_CAP_REACHED')) {
      flags.push('DAILY_CAP_REACHED');
    }
    for (const anom of detectedAnomalies) {
      const flagName = `ANOMALY_${anom.rule}`;
      if (!flags.includes(flagName)) flags.push(flagName);
    }

    await this.prisma.$transaction(async (tx) => {
      await tx.gameSession.update({
        where: { id: session.id },
        data: {
          status: 'FINISHED',
          finishedAt: now,
          score: allowedPoints,
          flags,
        },
      });

      if (allowedPoints > 0) {
        await tx.pointsLedger.create({
          data: {
            id: uuidv7(),
            userId: p.userId,
            countryId: country.id,
            brandId: session.brandId,
            sessionId: session.id,
            delta: allowedPoints,
            reason: 'GAME',
            onHold,
            createdBy: p.userId,
            localDay: todayStr,
          },
        });
      }

      for (const anom of detectedAnomalies) {
        await tx.anomalyAlert.create({
          data: {
            id: uuidv7(),
            sessionId: session.id,
            countryId: country.id,
            rule: anom.rule,
            details: anom.details as unknown as Prisma.InputJsonValue,
            status: 'OPEN',
          },
        });
      }

      await tx.usageEvent?.create?.({
        data: {
          id: uuidv7(),
          type: 'game.session_finished',
          userId: p.userId,
          countryId: country.id,
          brandId: session.brandId,
          payload: {
            sessionId: session.id,
            gameId: session.gameId,
            score: allowedPoints,
            correct: correctCount,
            total: session.questionIds.length,
            onHold,
          },
          occurredAt: now,
        },
      });
    });

    if (allowedPoints > 0) {
      const userCapKey = `cap:user:${country.code}:${todayStr}:${p.userId}`;
      const brandCapKey = `cap:brand:${country.code}:${todayStr}:${p.userId}:${session.brandId}`;
      try {
        await this.redis.client.incrby?.(userCapKey, allowedPoints);
        await this.redis.client.expire?.(userCapKey, 172_800);
        await this.redis.client.incrby?.(brandCapKey, allowedPoints);
        await this.redis.client.expire?.(brandCapKey, 172_800);
      } catch {
        // Fallback a PostgreSQL como fuente de verdad.
      }
    }

    return {
      score: allowedPoints,
      correct: correctCount,
      total: session.questionIds.length,
      dailyCapReached,
    };
  }
}
