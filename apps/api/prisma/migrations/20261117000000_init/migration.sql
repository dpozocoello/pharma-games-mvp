-- CreateSchema
CREATE SCHEMA IF NOT EXISTS "public";

-- CreateEnum
CREATE TYPE "Role" AS ENUM ('SUPER_ADMIN', 'COUNTRY_ADMIN', 'CONTENT_EDITOR', 'PHARMACY_MANAGER', 'CLERK');

-- CreateEnum
CREATE TYPE "UserStatus" AS ENUM ('ACTIVE', 'INACTIVE');

-- CreateEnum
CREATE TYPE "QuestionType" AS ENUM ('MULTIPLE_CHOICE', 'TRUE_FALSE');

-- CreateEnum
CREATE TYPE "QuestionStatus" AS ENUM ('DRAFT', 'IN_REVIEW', 'PUBLISHED', 'ARCHIVED');

-- CreateEnum
CREATE TYPE "GameMechanic" AS ENUM ('MULTIPLE_CHOICE', 'TRUE_FALSE');

-- CreateEnum
CREATE TYPE "GameStatus" AS ENUM ('DRAFT', 'ACTIVE', 'INACTIVE');

-- CreateEnum
CREATE TYPE "SessionStatus" AS ENUM ('IN_PROGRESS', 'FINISHED', 'EXPIRED');

-- CreateEnum
CREATE TYPE "LedgerReason" AS ENUM ('GAME', 'BONUS', 'REVERSAL');

-- CreateEnum
CREATE TYPE "AnomalyStatus" AS ENUM ('OPEN', 'CONFIRMED', 'DISMISSED');

-- CreateEnum
CREATE TYPE "PeriodStatus" AS ENUM ('OPEN', 'CLOSING', 'CLOSED');

-- CreateEnum
CREATE TYPE "RankingScope" AS ENUM ('INDIVIDUAL', 'PHARMACY', 'COUNTRY');

-- CreateEnum
CREATE TYPE "TestKind" AS ENUM ('INITIAL', 'FINAL');

-- CreateEnum
CREATE TYPE "ImportKind" AS ENUM ('USERS', 'QUESTIONS');

-- CreateEnum
CREATE TYPE "ImportStatus" AS ENUM ('PENDING', 'PROCESSING', 'COMPLETED', 'FAILED');

-- CreateTable
CREATE TABLE "Country" (
    "id" UUID NOT NULL,
    "code" VARCHAR(2) NOT NULL,
    "name" TEXT NOT NULL,
    "locale" TEXT NOT NULL,
    "timezone" TEXT NOT NULL,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Country_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CountryConfig" (
    "id" UUID NOT NULL,
    "countryId" UUID NOT NULL,
    "terms" JSONB NOT NULL,
    "pointsRules" JSONB NOT NULL,
    "rankingPeriodMonths" INTEGER NOT NULL DEFAULT 1,
    "consentVersionId" UUID,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CountryConfig_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ConsentVersion" (
    "id" UUID NOT NULL,
    "countryId" UUID NOT NULL,
    "version" INTEGER NOT NULL,
    "text" TEXT NOT NULL,
    "publishedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ConsentVersion_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "UserConsent" (
    "id" UUID NOT NULL,
    "userId" UUID NOT NULL,
    "consentVersionId" UUID NOT NULL,
    "acceptedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "ipTruncated" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "UserConsent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Chain" (
    "id" UUID NOT NULL,
    "countryId" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Chain_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Pharmacy" (
    "id" UUID NOT NULL,
    "countryId" UUID NOT NULL,
    "chainId" UUID,
    "externalCode" TEXT,
    "name" TEXT NOT NULL,
    "city" TEXT NOT NULL,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Pharmacy_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "User" (
    "id" UUID NOT NULL,
    "countryId" UUID,
    "phoneE164" TEXT NOT NULL,
    "documentHash" TEXT,
    "displayName" TEXT NOT NULL,
    "role" "Role" NOT NULL DEFAULT 'CLERK',
    "status" "UserStatus" NOT NULL DEFAULT 'ACTIVE',
    "countryLockedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "User_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PharmacyAssignment" (
    "id" UUID NOT NULL,
    "userId" UUID NOT NULL,
    "pharmacyId" UUID NOT NULL,
    "from" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "to" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PharmacyAssignment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Brand" (
    "id" UUID NOT NULL,
    "slug" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "theme" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Brand_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "BrandCountry" (
    "id" UUID NOT NULL,
    "brandId" UUID NOT NULL,
    "countryId" UUID NOT NULL,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "theme" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "BrandCountry_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Question" (
    "id" UUID NOT NULL,
    "brandId" UUID NOT NULL,
    "countryId" UUID,
    "type" "QuestionType" NOT NULL,
    "prompt" TEXT NOT NULL,
    "options" JSONB NOT NULL,
    "correctAnswer" TEXT NOT NULL,
    "locale" TEXT NOT NULL,
    "status" "QuestionStatus" NOT NULL DEFAULT 'DRAFT',
    "version" INTEGER NOT NULL DEFAULT 1,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Question_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CountryTermOverride" (
    "id" UUID NOT NULL,
    "questionId" UUID NOT NULL,
    "countryId" UUID NOT NULL,
    "prompt" TEXT,
    "options" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CountryTermOverride_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Game" (
    "id" UUID NOT NULL,
    "brandId" UUID NOT NULL,
    "countryId" UUID NOT NULL,
    "mechanic" "GameMechanic" NOT NULL,
    "version" TEXT NOT NULL DEFAULT '1.0.0',
    "status" "GameStatus" NOT NULL DEFAULT 'ACTIVE',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Game_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "GameSession" (
    "id" UUID NOT NULL,
    "userId" UUID NOT NULL,
    "gameId" UUID NOT NULL,
    "countryId" UUID NOT NULL,
    "brandId" UUID NOT NULL,
    "questionIds" UUID[],
    "seed" TEXT NOT NULL,
    "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "finishedAt" TIMESTAMP(3),
    "score" INTEGER,
    "status" "SessionStatus" NOT NULL DEFAULT 'IN_PROGRESS',
    "flags" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "GameSession_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SessionAnswer" (
    "id" UUID NOT NULL,
    "sessionId" UUID NOT NULL,
    "questionId" UUID NOT NULL,
    "answer" TEXT NOT NULL,
    "clientElapsedMs" INTEGER NOT NULL,
    "serverElapsedMs" INTEGER,
    "correct" BOOLEAN NOT NULL,
    "points" INTEGER NOT NULL,
    "receivedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SessionAnswer_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PointsLedger" (
    "id" UUID NOT NULL,
    "userId" UUID NOT NULL,
    "countryId" UUID NOT NULL,
    "brandId" UUID NOT NULL,
    "sessionId" UUID,
    "delta" INTEGER NOT NULL,
    "reason" "LedgerReason" NOT NULL,
    "onHold" BOOLEAN NOT NULL DEFAULT false,
    "reversesId" UUID,
    "createdBy" TEXT NOT NULL,
    "localDay" VARCHAR(10) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PointsLedger_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AnomalyAlert" (
    "id" UUID NOT NULL,
    "sessionId" UUID NOT NULL,
    "countryId" UUID NOT NULL,
    "rule" TEXT NOT NULL,
    "details" JSONB NOT NULL,
    "status" "AnomalyStatus" NOT NULL DEFAULT 'OPEN',
    "reviewedBy" UUID,
    "reviewedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AnomalyAlert_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RankingPeriod" (
    "id" UUID NOT NULL,
    "countryId" UUID NOT NULL,
    "startsAt" TIMESTAMP(3) NOT NULL,
    "endsAt" TIMESTAMP(3) NOT NULL,
    "status" "PeriodStatus" NOT NULL DEFAULT 'OPEN',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "RankingPeriod_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RankingSnapshot" (
    "id" UUID NOT NULL,
    "periodId" UUID NOT NULL,
    "scope" "RankingScope" NOT NULL,
    "entityId" UUID NOT NULL,
    "snapshotDay" VARCHAR(10) NOT NULL,
    "points" DOUBLE PRECISION NOT NULL,
    "position" INTEGER NOT NULL,
    "activeClerks" INTEGER,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "RankingSnapshot_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Winner" (
    "id" UUID NOT NULL,
    "periodId" UUID NOT NULL,
    "scope" "RankingScope" NOT NULL,
    "entityId" UUID NOT NULL,
    "position" INTEGER NOT NULL,
    "exportedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Winner_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "KnowledgeTest" (
    "id" UUID NOT NULL,
    "brandId" UUID NOT NULL,
    "countryId" UUID NOT NULL,
    "kind" "TestKind" NOT NULL,
    "questionIds" UUID[],
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "KnowledgeTest_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TestResult" (
    "id" UUID NOT NULL,
    "testId" UUID NOT NULL,
    "userId" UUID NOT NULL,
    "score" INTEGER NOT NULL,
    "total" INTEGER NOT NULL,
    "completedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "TestResult_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "UsageEvent" (
    "id" UUID NOT NULL,
    "type" TEXT NOT NULL,
    "userId" UUID,
    "countryId" UUID NOT NULL,
    "brandId" UUID,
    "payload" JSONB,
    "occurredAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "UsageEvent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AdminAuditLog" (
    "id" UUID NOT NULL,
    "actorId" UUID NOT NULL,
    "countryId" UUID,
    "action" TEXT NOT NULL,
    "entity" TEXT NOT NULL,
    "entityId" TEXT,
    "before" JSONB,
    "after" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AdminAuditLog_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ImportJob" (
    "id" UUID NOT NULL,
    "countryId" UUID NOT NULL,
    "kind" "ImportKind" NOT NULL,
    "fileName" TEXT NOT NULL,
    "status" "ImportStatus" NOT NULL DEFAULT 'PENDING',
    "totalRows" INTEGER NOT NULL DEFAULT 0,
    "validRows" INTEGER NOT NULL DEFAULT 0,
    "errors" JSONB NOT NULL DEFAULT '[]',
    "createdBy" UUID NOT NULL,
    "finishedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ImportJob_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Country_code_key" ON "Country"("code");

-- CreateIndex
CREATE UNIQUE INDEX "CountryConfig_countryId_key" ON "CountryConfig"("countryId");

-- CreateIndex
CREATE UNIQUE INDEX "CountryConfig_consentVersionId_key" ON "CountryConfig"("consentVersionId");

-- CreateIndex
CREATE UNIQUE INDEX "ConsentVersion_countryId_version_key" ON "ConsentVersion"("countryId", "version");

-- CreateIndex
CREATE UNIQUE INDEX "UserConsent_userId_consentVersionId_key" ON "UserConsent"("userId", "consentVersionId");

-- CreateIndex
CREATE UNIQUE INDEX "Chain_countryId_name_key" ON "Chain"("countryId", "name");

-- CreateIndex
CREATE INDEX "Pharmacy_countryId_active_idx" ON "Pharmacy"("countryId", "active");

-- CreateIndex
CREATE UNIQUE INDEX "Pharmacy_countryId_externalCode_key" ON "Pharmacy"("countryId", "externalCode");

-- CreateIndex
CREATE UNIQUE INDEX "User_phoneE164_key" ON "User"("phoneE164");

-- CreateIndex
CREATE INDEX "User_countryId_role_status_idx" ON "User"("countryId", "role", "status");

-- CreateIndex
CREATE UNIQUE INDEX "User_countryId_documentHash_key" ON "User"("countryId", "documentHash");

-- CreateIndex
CREATE INDEX "PharmacyAssignment_userId_to_idx" ON "PharmacyAssignment"("userId", "to");

-- CreateIndex
CREATE INDEX "PharmacyAssignment_pharmacyId_to_idx" ON "PharmacyAssignment"("pharmacyId", "to");

-- CreateIndex
CREATE UNIQUE INDEX "Brand_slug_key" ON "Brand"("slug");

-- CreateIndex
CREATE INDEX "BrandCountry_countryId_active_idx" ON "BrandCountry"("countryId", "active");

-- CreateIndex
CREATE UNIQUE INDEX "BrandCountry_brandId_countryId_key" ON "BrandCountry"("brandId", "countryId");

-- CreateIndex
CREATE INDEX "Question_brandId_countryId_status_idx" ON "Question"("brandId", "countryId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "CountryTermOverride_questionId_countryId_key" ON "CountryTermOverride"("questionId", "countryId");

-- CreateIndex
CREATE INDEX "Game_countryId_status_idx" ON "Game"("countryId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "Game_brandId_countryId_mechanic_key" ON "Game"("brandId", "countryId", "mechanic");

-- CreateIndex
CREATE INDEX "GameSession_userId_startedAt_idx" ON "GameSession"("userId", "startedAt");

-- CreateIndex
CREATE INDEX "GameSession_countryId_startedAt_idx" ON "GameSession"("countryId", "startedAt");

-- CreateIndex
CREATE UNIQUE INDEX "SessionAnswer_sessionId_questionId_key" ON "SessionAnswer"("sessionId", "questionId");

-- CreateIndex
CREATE UNIQUE INDEX "PointsLedger_reversesId_key" ON "PointsLedger"("reversesId");

-- CreateIndex
CREATE INDEX "PointsLedger_countryId_createdAt_idx" ON "PointsLedger"("countryId", "createdAt");

-- CreateIndex
CREATE INDEX "PointsLedger_userId_localDay_idx" ON "PointsLedger"("userId", "localDay");

-- CreateIndex
CREATE INDEX "PointsLedger_userId_brandId_localDay_idx" ON "PointsLedger"("userId", "brandId", "localDay");

-- CreateIndex
CREATE INDEX "AnomalyAlert_countryId_status_idx" ON "AnomalyAlert"("countryId", "status");

-- CreateIndex
CREATE INDEX "RankingPeriod_countryId_status_idx" ON "RankingPeriod"("countryId", "status");

-- CreateIndex
CREATE INDEX "RankingPeriod_countryId_startsAt_idx" ON "RankingPeriod"("countryId", "startsAt");

-- CreateIndex
CREATE INDEX "RankingSnapshot_periodId_scope_snapshotDay_position_idx" ON "RankingSnapshot"("periodId", "scope", "snapshotDay", "position");

-- CreateIndex
CREATE UNIQUE INDEX "RankingSnapshot_periodId_scope_snapshotDay_entityId_key" ON "RankingSnapshot"("periodId", "scope", "snapshotDay", "entityId");

-- CreateIndex
CREATE UNIQUE INDEX "Winner_periodId_scope_position_key" ON "Winner"("periodId", "scope", "position");

-- CreateIndex
CREATE UNIQUE INDEX "KnowledgeTest_brandId_countryId_kind_key" ON "KnowledgeTest"("brandId", "countryId", "kind");

-- CreateIndex
CREATE UNIQUE INDEX "TestResult_testId_userId_key" ON "TestResult"("testId", "userId");

-- CreateIndex
CREATE INDEX "UsageEvent_countryId_type_occurredAt_idx" ON "UsageEvent"("countryId", "type", "occurredAt");

-- CreateIndex
CREATE INDEX "AdminAuditLog_countryId_createdAt_idx" ON "AdminAuditLog"("countryId", "createdAt");

-- CreateIndex
CREATE INDEX "AdminAuditLog_entity_entityId_idx" ON "AdminAuditLog"("entity", "entityId");

-- CreateIndex
CREATE INDEX "ImportJob_countryId_createdAt_idx" ON "ImportJob"("countryId", "createdAt");

-- AddForeignKey
ALTER TABLE "CountryConfig" ADD CONSTRAINT "CountryConfig_countryId_fkey" FOREIGN KEY ("countryId") REFERENCES "Country"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CountryConfig" ADD CONSTRAINT "CountryConfig_consentVersionId_fkey" FOREIGN KEY ("consentVersionId") REFERENCES "ConsentVersion"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ConsentVersion" ADD CONSTRAINT "ConsentVersion_countryId_fkey" FOREIGN KEY ("countryId") REFERENCES "Country"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "UserConsent" ADD CONSTRAINT "UserConsent_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "UserConsent" ADD CONSTRAINT "UserConsent_consentVersionId_fkey" FOREIGN KEY ("consentVersionId") REFERENCES "ConsentVersion"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Chain" ADD CONSTRAINT "Chain_countryId_fkey" FOREIGN KEY ("countryId") REFERENCES "Country"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Pharmacy" ADD CONSTRAINT "Pharmacy_countryId_fkey" FOREIGN KEY ("countryId") REFERENCES "Country"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Pharmacy" ADD CONSTRAINT "Pharmacy_chainId_fkey" FOREIGN KEY ("chainId") REFERENCES "Chain"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "User" ADD CONSTRAINT "User_countryId_fkey" FOREIGN KEY ("countryId") REFERENCES "Country"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PharmacyAssignment" ADD CONSTRAINT "PharmacyAssignment_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PharmacyAssignment" ADD CONSTRAINT "PharmacyAssignment_pharmacyId_fkey" FOREIGN KEY ("pharmacyId") REFERENCES "Pharmacy"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BrandCountry" ADD CONSTRAINT "BrandCountry_brandId_fkey" FOREIGN KEY ("brandId") REFERENCES "Brand"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BrandCountry" ADD CONSTRAINT "BrandCountry_countryId_fkey" FOREIGN KEY ("countryId") REFERENCES "Country"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Question" ADD CONSTRAINT "Question_brandId_fkey" FOREIGN KEY ("brandId") REFERENCES "Brand"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Question" ADD CONSTRAINT "Question_countryId_fkey" FOREIGN KEY ("countryId") REFERENCES "Country"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CountryTermOverride" ADD CONSTRAINT "CountryTermOverride_questionId_fkey" FOREIGN KEY ("questionId") REFERENCES "Question"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CountryTermOverride" ADD CONSTRAINT "CountryTermOverride_countryId_fkey" FOREIGN KEY ("countryId") REFERENCES "Country"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Game" ADD CONSTRAINT "Game_brandId_fkey" FOREIGN KEY ("brandId") REFERENCES "Brand"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Game" ADD CONSTRAINT "Game_countryId_fkey" FOREIGN KEY ("countryId") REFERENCES "Country"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "GameSession" ADD CONSTRAINT "GameSession_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "GameSession" ADD CONSTRAINT "GameSession_gameId_fkey" FOREIGN KEY ("gameId") REFERENCES "Game"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "GameSession" ADD CONSTRAINT "GameSession_countryId_fkey" FOREIGN KEY ("countryId") REFERENCES "Country"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SessionAnswer" ADD CONSTRAINT "SessionAnswer_sessionId_fkey" FOREIGN KEY ("sessionId") REFERENCES "GameSession"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SessionAnswer" ADD CONSTRAINT "SessionAnswer_questionId_fkey" FOREIGN KEY ("questionId") REFERENCES "Question"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PointsLedger" ADD CONSTRAINT "PointsLedger_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PointsLedger" ADD CONSTRAINT "PointsLedger_countryId_fkey" FOREIGN KEY ("countryId") REFERENCES "Country"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PointsLedger" ADD CONSTRAINT "PointsLedger_brandId_fkey" FOREIGN KEY ("brandId") REFERENCES "Brand"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PointsLedger" ADD CONSTRAINT "PointsLedger_sessionId_fkey" FOREIGN KEY ("sessionId") REFERENCES "GameSession"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PointsLedger" ADD CONSTRAINT "PointsLedger_reversesId_fkey" FOREIGN KEY ("reversesId") REFERENCES "PointsLedger"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AnomalyAlert" ADD CONSTRAINT "AnomalyAlert_sessionId_fkey" FOREIGN KEY ("sessionId") REFERENCES "GameSession"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AnomalyAlert" ADD CONSTRAINT "AnomalyAlert_countryId_fkey" FOREIGN KEY ("countryId") REFERENCES "Country"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RankingPeriod" ADD CONSTRAINT "RankingPeriod_countryId_fkey" FOREIGN KEY ("countryId") REFERENCES "Country"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RankingSnapshot" ADD CONSTRAINT "RankingSnapshot_periodId_fkey" FOREIGN KEY ("periodId") REFERENCES "RankingPeriod"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Winner" ADD CONSTRAINT "Winner_periodId_fkey" FOREIGN KEY ("periodId") REFERENCES "RankingPeriod"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "KnowledgeTest" ADD CONSTRAINT "KnowledgeTest_brandId_fkey" FOREIGN KEY ("brandId") REFERENCES "Brand"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "KnowledgeTest" ADD CONSTRAINT "KnowledgeTest_countryId_fkey" FOREIGN KEY ("countryId") REFERENCES "Country"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TestResult" ADD CONSTRAINT "TestResult_testId_fkey" FOREIGN KEY ("testId") REFERENCES "KnowledgeTest"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TestResult" ADD CONSTRAINT "TestResult_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "UsageEvent" ADD CONSTRAINT "UsageEvent_countryId_fkey" FOREIGN KEY ("countryId") REFERENCES "Country"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ImportJob" ADD CONSTRAINT "ImportJob_countryId_fkey" FOREIGN KEY ("countryId") REFERENCES "Country"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- ───────────── Inmutabilidad (ADR-006) ─────────────
-- PointsLedger y AdminAuditLog solo admiten INSERT. Las anulaciones de puntos son
-- movimientos REVERSAL nuevos; nunca se edita ni se borra un movimiento.
CREATE OR REPLACE FUNCTION forbid_mutation() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'La tabla % es inmutable: % no permitido', TG_TABLE_NAME, TG_OP
    USING ERRCODE = 'insufficient_privilege';
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "PointsLedger_immutable"
  BEFORE UPDATE OR DELETE ON "PointsLedger"
  FOR EACH ROW EXECUTE FUNCTION forbid_mutation();

CREATE TRIGGER "PointsLedger_no_truncate"
  BEFORE TRUNCATE ON "PointsLedger"
  FOR EACH STATEMENT EXECUTE FUNCTION forbid_mutation();

CREATE TRIGGER "AdminAuditLog_immutable"
  BEFORE UPDATE OR DELETE ON "AdminAuditLog"
  FOR EACH ROW EXECUTE FUNCTION forbid_mutation();

CREATE TRIGGER "AdminAuditLog_no_truncate"
  BEFORE TRUNCATE ON "AdminAuditLog"
  FOR EACH STATEMENT EXECUTE FUNCTION forbid_mutation();
