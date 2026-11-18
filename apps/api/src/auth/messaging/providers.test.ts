import { describe, expect, it, vi } from 'vitest';
import { OtpDeliveryService, type MessagingProvider } from './providers';

const msg = { toE164: '+51900000001', code: '123456', locale: 'es-PE' };

function provider(channel: MessagingProvider['channel'], fails = false): MessagingProvider {
  return {
    channel,
    sendOtp: vi.fn(async () => {
      if (fails) throw new Error('caído');
    }),
  };
}

describe('OtpDeliveryService (WhatsApp con respaldo SMS)', () => {
  it('usa WhatsApp cuando funciona', async () => {
    const wa = provider('whatsapp');
    const sms = provider('sms');
    expect(await new OtpDeliveryService(wa, sms).deliver(msg)).toBe('whatsapp');
    expect(sms.sendOtp).not.toHaveBeenCalled();
  });

  it('cae a SMS si WhatsApp falla', async () => {
    const wa = provider('whatsapp', true);
    const sms = provider('sms');
    expect(await new OtpDeliveryService(wa, sms).deliver(msg)).toBe('sms');
    expect(sms.sendOtp).toHaveBeenCalledWith(msg);
  });

  it('propaga el error si fallan ambos (BullMQ reintenta)', async () => {
    const svc = new OtpDeliveryService(provider('whatsapp', true), provider('sms', true));
    await expect(svc.deliver(msg)).rejects.toThrow('caído');
  });

  it('sin respaldo configurado, propaga el error del principal', async () => {
    const svc = new OtpDeliveryService(provider('console', true), null);
    await expect(svc.deliver(msg)).rejects.toThrow();
  });
});
