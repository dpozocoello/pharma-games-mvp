import { Body, Controller, Get, HttpCode, Param, ParseUUIDPipe, Post } from '@nestjs/common';
import { ApiBearerAuth, ApiBody, ApiTags } from '@nestjs/swagger';
import {
  finishSessionSchema,
  startSessionBodySchema,
  startSessionSchema,
  submitSessionAnswersSchema,
  type FinishSessionInput,
  type GameFinishResponse,
  type GamesCatalogResponse,
  type StartSessionInput,
  type StartedGameSessionResponse,
  type SubmitSessionAnswersInput,
} from '@pharma/shared';
import { CurrentUser, RequireApp, Roles, type Principal } from '../auth/principal';
import { openApiSchema, ZodPipe } from '../common/zod';
import { GamesService } from './games.service';

@ApiTags('juego')
@ApiBearerAuth()
@RequireApp('pwa')
@Roles('CLERK', 'PHARMACY_MANAGER')
@Controller()
export class GamesController {
  constructor(private readonly games: GamesService) {}

  @Get('games')
  listGames(@CurrentUser() p: Principal): Promise<GamesCatalogResponse> {
    return this.games.listGamesForUser(p);
  }

  @ApiBody({ schema: openApiSchema(startSessionSchema), required: false })
  @HttpCode(201)
  @Post('games/:id/sessions')
  startSession(
    @CurrentUser() p: Principal,
    @Param('id', new ParseUUIDPipe()) gameId: string,
    @Body(new ZodPipe(startSessionBodySchema)) body: StartSessionInput,
  ): Promise<StartedGameSessionResponse> {
    return this.games.startSession(p, gameId, body);
  }

  @ApiBody({ schema: openApiSchema(submitSessionAnswersSchema) })
  @HttpCode(200)
  @Post('sessions/:id/answers')
  submitAnswers(
    @CurrentUser() p: Principal,
    @Param('id', new ParseUUIDPipe()) sessionId: string,
    @Body(new ZodPipe(submitSessionAnswersSchema)) body: SubmitSessionAnswersInput,
  ): Promise<{ accepted: number }> {
    return this.games.submitAnswers(p, sessionId, body);
  }

  @ApiBody({ schema: openApiSchema(finishSessionSchema) })
  @HttpCode(200)
  @Post('sessions/:id/finish')
  finishSession(
    @CurrentUser() p: Principal,
    @Param('id', new ParseUUIDPipe()) sessionId: string,
    @Body(new ZodPipe(finishSessionSchema)) body: FinishSessionInput,
  ): Promise<GameFinishResponse> {
    return this.games.finishSession(p, sessionId, body);
  }
}
