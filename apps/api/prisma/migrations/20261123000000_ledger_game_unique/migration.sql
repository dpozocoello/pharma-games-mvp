-- Juego justo (CLAUDE.md §9): una partida acredita a lo sumo un movimiento GAME.
-- Índice único parcial: Prisma no lo expresa en schema.prisma, por eso va en SQL (ver ADR-021).
-- Si la base ya tuviera duplicados, este paso falla y obliga a revisarlos (no se borra nada del libro inmutable).
CREATE UNIQUE INDEX "PointsLedger_sessionId_game_key"
  ON "PointsLedger" ("sessionId")
  WHERE "reason" = 'GAME' AND "sessionId" IS NOT NULL;
