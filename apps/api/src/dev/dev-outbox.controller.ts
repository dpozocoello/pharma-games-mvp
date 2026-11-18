import { Body, Controller, HttpCode, Post } from '@nestjs/common';
import { ApiExcludeController } from '@nestjs/swagger';
import { phoneE164Schema } from '@pharma/shared';
import { z } from 'zod';
import { DEV_OUTBOX_PREFIX } from '../auth/messaging/providers';
import { Public } from '../auth/principal';
import { ZodPipe } from '../common/zod';
import { RedisService } from '../infra/redis.service';

const bodySchema = z.object({ phone: phoneE164Schema }).strict();

/**
 * SOLO DESARROLLO Y PRUEBAS. Devuelve el último código "enviado" por el ConsoleProvider.
 * El módulo solo registra este controlador fuera de producción y con MESSAGING_PROVIDER=console.
 * El teléfono va en el cuerpo, no en la URL, para no dejarlo en logs de acceso.
 */
@ApiExcludeController()
@Public()
@Controller('dev/outbox')
export class DevOutboxController {
  constructor(private readonly redis: RedisService) {}

  @HttpCode(200)
  @Post()
  async peek(
    @Body(new ZodPipe(bodySchema)) body: { phone: string },
  ): Promise<{ code: string | null }> {
    return { code: await this.redis.client.get(`${DEV_OUTBOX_PREFIX}${body.phone}`) };
  }
}
