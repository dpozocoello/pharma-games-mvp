/**
 * Semillas de desarrollo (idempotentes). Ejecutar con `pnpm db:seed`.
 * Todos los datos son ficticios. Ver criterios en PLAN.md (Iteración 0).
 */
import { createHmac } from 'node:crypto';
import { PrismaClient, type Prisma, type Role } from '@prisma/client';
import {
  COUNTRY_CODES,
  COUNTRY_DEFAULTS,
  DEFAULT_POINTS_RULES,
  normalizeDocument,
  questionSchema,
  rankingPeriodBounds,
  type CountryCode,
} from '@pharma/shared';
import { uuidv7 } from 'uuidv7';
import {
  CLERKS_PER_COUNTRY,
  DEFAULT_TERMS,
  SEED_BRANDS,
  consentText,
  fakeDocument,
  fakePhone,
  generateBrandQuestions,
  seedPharmacies,
} from './seed-data';

const prisma = new PrismaClient();

const secret = process.env.DOCUMENT_HASH_SECRET;
if (!secret) throw new Error('Falta DOCUMENT_HASH_SECRET (copia .env.example a .env)');
const hashDocument = (doc: string) =>
  createHmac('sha256', secret).update(normalizeDocument(doc)).digest('hex');

const PILOT: CountryCode = 'PE';

async function seedCountries() {
  const ids = {} as Record<CountryCode, string>;
  for (const code of COUNTRY_CODES) {
    const d = COUNTRY_DEFAULTS[code];
    const country = await prisma.country.upsert({
      where: { code },
      update: {},
      create: {
        id: uuidv7(),
        code,
        name: d.name,
        locale: d.locale,
        timezone: d.timezone,
        phonePrefix: d.phonePrefix,
      },
    });
    ids[code] = country.id;

    const consent = await prisma.consentVersion.upsert({
      where: { countryId_version: { countryId: country.id, version: 1 } },
      update: {},
      create: { id: uuidv7(), countryId: country.id, version: 1, text: consentText(code) },
    });

    await prisma.countryConfig.upsert({
      where: { countryId: country.id },
      update: {},
      create: {
        id: uuidv7(),
        countryId: country.id,
        terms: DEFAULT_TERMS[code],
        pointsRules: DEFAULT_POINTS_RULES as unknown as Prisma.InputJsonValue,
        rankingPeriodMonths: 1,
        consentVersionId: consent.id,
      },
    });

    const { startsAt, endsAt } = rankingPeriodBounds(new Date(), d.timezone, 1);
    const open = await prisma.rankingPeriod.findFirst({
      where: { countryId: country.id, status: 'OPEN' },
    });
    if (!open) {
      await prisma.rankingPeriod.create({
        data: { id: uuidv7(), countryId: country.id, startsAt, endsAt },
      });
    }
  }
  return ids;
}

async function seedBrands(countryIds: Record<CountryCode, string>) {
  for (const [index, b] of SEED_BRANDS.entries()) {
    const brand = await prisma.brand.upsert({
      where: { slug: b.slug },
      update: {},
      create: { id: uuidv7(), slug: b.slug, name: b.name, theme: b.theme },
    });

    for (const code of b.countries) {
      const countryId = countryIds[code];
      await prisma.brandCountry.upsert({
        where: { brandId_countryId: { brandId: brand.id, countryId } },
        update: {},
        create: { id: uuidv7(), brandId: brand.id, countryId },
      });
      for (const mechanic of ['MULTIPLE_CHOICE', 'TRUE_FALSE'] as const) {
        await prisma.game.upsert({
          where: { brandId_countryId_mechanic: { brandId: brand.id, countryId, mechanic } },
          update: {},
          create: { id: uuidv7(), brandId: brand.id, countryId, mechanic },
        });
      }
    }

    const existing = await prisma.question.count({ where: { brandId: brand.id } });
    if (existing === 0) {
      // Marcas multipaís: preguntas compartidas (countryId nulo, ADR-010).
      // Marcas de un solo país: preguntas de ese país.
      const countryId = b.countries.length === 1 ? countryIds[b.countries[0]!] : null;
      const questions = generateBrandQuestions(index, b.name).map((q) => questionSchema.parse(q));
      await prisma.question.createMany({
        data: questions.map((q) => ({
          id: uuidv7(),
          brandId: brand.id,
          countryId,
          type: q.type,
          prompt: q.prompt,
          options: q.options,
          correctAnswer: q.correctAnswer,
          locale: 'es',
          status: 'PUBLISHED' as const,
        })),
      });
    }

    const sampleQuestions = await prisma.question.findMany({
      where: { brandId: brand.id, status: 'PUBLISHED' },
      orderBy: { createdAt: 'asc' },
      take: 5,
      select: { id: true },
    });
    const testQuestionIds = sampleQuestions.map((q) => q.id);
    if (testQuestionIds.length > 0) {
      for (const code of b.countries) {
        const countryId = countryIds[code];
        await prisma.knowledgeTest.upsert({
          where: {
            brandId_countryId_kind: {
              brandId: brand.id,
              countryId,
              kind: 'INITIAL',
            },
          },
          update: {},
          create: {
            id: uuidv7(),
            brandId: brand.id,
            countryId,
            kind: 'INITIAL',
            questionIds: testQuestionIds,
            active: true,
          },
        });
      }
    }
  }
}

async function upsertUser(data: {
  countryId: string | null;
  phoneE164: string;
  document: string;
  displayName: string;
  role: Role;
  pharmacyId?: string;
}) {
  const user = await prisma.user.upsert({
    where: { phoneE164: data.phoneE164 },
    update: {},
    create: {
      id: uuidv7(),
      countryId: data.countryId,
      phoneE164: data.phoneE164,
      documentHash: hashDocument(data.document),
      displayName: data.displayName,
      role: data.role,
    },
  });
  if (data.pharmacyId) {
    const current = await prisma.pharmacyAssignment.findFirst({
      where: { userId: user.id, to: null },
    });
    if (!current) {
      await prisma.pharmacyAssignment.create({
        data: { id: uuidv7(), userId: user.id, pharmacyId: data.pharmacyId },
      });
    }
  }
  return user;
}

async function seedPharmaciesAndUsers(countryIds: Record<CountryCode, string>) {
  for (const code of COUNTRY_CODES) {
    const countryId = countryIds[code];
    const pharmacyIds: string[] = [];
    for (const p of seedPharmacies(code)) {
      const ph = await prisma.pharmacy.upsert({
        where: { countryId_externalCode: { countryId, externalCode: p.externalCode } },
        update: {},
        create: { id: uuidv7(), countryId, ...p },
      });
      pharmacyIds.push(ph.id);
    }

    for (let n = 1; n <= CLERKS_PER_COUNTRY; n++) {
      await upsertUser({
        countryId,
        phoneE164: fakePhone(code, n),
        document: fakeDocument(code, n),
        displayName: `Dependiente ${code} ${String(n).padStart(2, '0')}`,
        role: 'CLERK',
        pharmacyId: pharmacyIds[(n - 1) % pharmacyIds.length]!,
      });
    }

    if (code === PILOT) {
      // Un usuario por rol de administración, en el país piloto.
      await upsertUser({
        countryId: null,
        phoneE164: fakePhone(code, 90),
        document: fakeDocument(code, 90),
        displayName: 'Super Admin Demo',
        role: 'SUPER_ADMIN',
      });
      await upsertUser({
        countryId,
        phoneE164: fakePhone(code, 91),
        document: fakeDocument(code, 91),
        displayName: `Admin ${code} Demo`,
        role: 'COUNTRY_ADMIN',
      });
      await upsertUser({
        countryId,
        phoneE164: fakePhone(code, 92),
        document: fakeDocument(code, 92),
        displayName: `Editor ${code} Demo`,
        role: 'CONTENT_EDITOR',
      });
      await upsertUser({
        countryId,
        phoneE164: fakePhone(code, 93),
        document: fakeDocument(code, 93),
        displayName: `Gerente ${code} Demo`,
        role: 'PHARMACY_MANAGER',
        pharmacyId: pharmacyIds[0]!,
      });
    }
  }
}

async function main() {
  const countryIds = await seedCountries();
  await seedBrands(countryIds);
  await seedPharmaciesAndUsers(countryIds);

  const counts = {
    countries: await prisma.country.count(),
    brands: await prisma.brand.count(),
    brandCountries: await prisma.brandCountry.count(),
    questions: await prisma.question.count(),
    games: await prisma.game.count(),
    pharmacies: await prisma.pharmacy.count(),
    users: await prisma.user.count(),
  };
  console.warn('Semillas aplicadas:', counts);
}

main()
  .catch((e) => {
    console.error(e);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
