import { Inject, Injectable, Logger } from '@nestjs/common';
import { maskPhone } from '@pharma/shared';
import { ENV, type Env } from '../../config/env';
import { RedisService } from '../../infra/redis.service';

export type Channel = 'whatsapp' | 'sms' | 'console';

export interface OtpMessage {
  toE164: string;
  code: string;
  /** Locale del país (es-PE…), para plantillas por idioma. */
  locale: string;
}

/** Interfaz de envío (CLAUDE.md §10). Cualquier proveedor es reemplazable sin tocar la lógica de OTP. */
export interface MessagingProvider {
  readonly channel: Channel;
  sendOtp(msg: OtpMessage): Promise<void>;
}

const TIMEOUT_MS = 8000;

async function postJson(url: string, token: string, body: unknown): Promise<void> {
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: `Bearer ${token}` },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });
  // No se registra el cuerpo de la respuesta: puede repetir el número de destino.
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
}

/** WhatsApp Cloud API (Meta) con una plantilla de autenticación aprobada. */
@Injectable()
export class WhatsAppCloudProvider implements MessagingProvider {
  readonly channel = 'whatsapp' as const;
  constructor(@Inject(ENV) private readonly env: Env) {}

  async sendOtp({ toE164, code }: OtpMessage): Promise<void> {
    const {
      WHATSAPP_API_URL,
      WHATSAPP_PHONE_NUMBER_ID,
      WHATSAPP_TOKEN,
      WHATSAPP_TEMPLATE,
      WHATSAPP_TEMPLATE_LANG,
    } = this.env;
    if (!WHATSAPP_PHONE_NUMBER_ID || !WHATSAPP_TOKEN) throw new Error('WhatsApp no configurado');
    await postJson(`${WHATSAPP_API_URL}/${WHATSAPP_PHONE_NUMBER_ID}/messages`, WHATSAPP_TOKEN, {
      messaging_product: 'whatsapp',
      to: toE164.slice(1),
      type: 'template',
      template: {
        name: WHATSAPP_TEMPLATE,
        language: { code: WHATSAPP_TEMPLATE_LANG },
        components: [
          { type: 'body', parameters: [{ type: 'text', text: code }] },
          {
            type: 'button',
            sub_type: 'url',
            index: '0',
            parameters: [{ type: 'text', text: code }],
          },
        ],
      },
    });
  }
}

/**
 * Proveedor SMS genérico: `POST SMS_API_URL` con `{ to, message }` y token Bearer.
 * Cualquier agregador (o un adaptador propio) puede cumplir este contrato (ADR-018).
 */
@Injectable()
export class HttpSmsProvider implements MessagingProvider {
  readonly channel = 'sms' as const;
  constructor(@Inject(ENV) private readonly env: Env) {}

  async sendOtp({ toE164, code }: OtpMessage): Promise<void> {
    if (!this.env.SMS_API_URL || !this.env.SMS_API_TOKEN) throw new Error('SMS no configurado');
    await postJson(this.env.SMS_API_URL, this.env.SMS_API_TOKEN, {
      to: toE164,
      message: `Tu código de ingreso es ${code}. Vence en 5 minutos. No lo compartas.`,
    });
  }
}

export const DEV_OUTBOX_PREFIX = 'dev:outbox:';

/**
 * Desarrollo y pruebas: no envía nada. Deja el código en una bandeja de Redis (5 min) para
 * leerlo desde `POST /api/v1/dev/outbox` y lo escribe en el log con el teléfono enmascarado.
 * Prohibido en producción (validación de entorno).
 */
@Injectable()
export class ConsoleProvider implements MessagingProvider {
  readonly channel = 'console' as const;
  private readonly logger = new Logger('OTP');
  constructor(private readonly redis: RedisService) {}

  async sendOtp({ toE164, code }: OtpMessage): Promise<void> {
    await this.redis.client.set(`${DEV_OUTBOX_PREFIX}${toE164}`, code, 'EX', 300);
    this.logger.log(`Código de desarrollo para ${maskPhone(toE164)}: ${code}`);
  }
}

export const PRIMARY_PROVIDER = Symbol('PRIMARY_PROVIDER');
export const FALLBACK_PROVIDER = Symbol('FALLBACK_PROVIDER');

/** Envía por el canal principal (WhatsApp) y, si falla, por el de respaldo (SMS). */
@Injectable()
export class OtpDeliveryService {
  private readonly logger = new Logger(OtpDeliveryService.name);

  constructor(
    @Inject(PRIMARY_PROVIDER) private readonly primary: MessagingProvider,
    @Inject(FALLBACK_PROVIDER) private readonly fallback: MessagingProvider | null,
  ) {}

  async deliver(msg: OtpMessage): Promise<Channel> {
    try {
      await this.primary.sendOtp(msg);
      return this.primary.channel;
    } catch (e) {
      if (!this.fallback) throw e;
      this.logger.warn(
        `Falló ${this.primary.channel} (${errorText(e)}); respaldo por ${this.fallback.channel}`,
      );
      await this.fallback.sendOtp(msg);
      return this.fallback.channel;
    }
  }
}

function errorText(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}
