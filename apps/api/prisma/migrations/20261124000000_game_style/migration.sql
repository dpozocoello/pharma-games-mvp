-- Estilos arcade y piloto A/B (ADR-034). Las partidas existentes quedan como CLASSIC sin grupo.
CREATE TYPE "GameStyle" AS ENUM ('CLASSIC', 'PLATFORM', 'LAUNCH');
CREATE TYPE "ExperimentGroup" AS ENUM ('CONTROL', 'ARCADE');

ALTER TABLE "GameSession"
  ADD COLUMN "style" "GameStyle" NOT NULL DEFAULT 'CLASSIC',
  ADD COLUMN "experimentGroup" "ExperimentGroup";

-- Indicadores del piloto por país, grupo y fecha.
CREATE INDEX "GameSession_countryId_experimentGroup_startedAt_idx"
  ON "GameSession" ("countryId", "experimentGroup", "startedAt");
