-- Iteración 1: ingreso OTP, refresh tokens con rotación y prefijo telefónico por país.

-- AlterTable (en tres pasos para no fallar con países ya existentes)
ALTER TABLE "Country" ADD COLUMN "phonePrefix" VARCHAR(5);
UPDATE "Country" SET "phonePrefix" = CASE "code"
  WHEN 'CO' THEN '+57' WHEN 'EC' THEN '+593' WHEN 'PE' THEN '+51' ELSE NULL END; -- un país desconocido hace fallar la migración a propósito
ALTER TABLE "Country" ALTER COLUMN "phonePrefix" SET NOT NULL;
ALTER TABLE "Country" ADD CONSTRAINT "Country_phonePrefix_check" CHECK ("phonePrefix" ~ '^\+[1-9][0-9]{0,3}$');

-- AlterTable
ALTER TABLE "User" ADD COLUMN     "lastLoginAt" TIMESTAMP(3);

-- CreateTable
CREATE TABLE "RefreshToken" (
    "id" UUID NOT NULL,
    "userId" UUID NOT NULL,
    "familyId" UUID NOT NULL,
    "audience" VARCHAR(8) NOT NULL,
    "tokenHash" VARCHAR(64) NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "rotatedAt" TIMESTAMP(3),
    "revokedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "RefreshToken_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "RefreshToken_tokenHash_key" ON "RefreshToken"("tokenHash");

-- CreateIndex
CREATE INDEX "RefreshToken_familyId_idx" ON "RefreshToken"("familyId");

-- CreateIndex
CREATE INDEX "RefreshToken_userId_revokedAt_idx" ON "RefreshToken"("userId", "revokedAt");

-- AddForeignKey
ALTER TABLE "RefreshToken" ADD CONSTRAINT "RefreshToken_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

