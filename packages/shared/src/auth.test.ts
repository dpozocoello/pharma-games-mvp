import { describe, expect, it } from 'vitest';
import {
  canUseApp,
  countryCreateSchema,
  maskPhone,
  normalizeDocument,
  normalizePhone,
  otpRequestSchema,
  otpVerifySchema,
} from './auth';
import { countryCodeSchema } from './schemas';

describe('normalizePhone', () => {
  it.each([
    ['900000001', '+51', '+51900000001'],
    ['900 000 001', '+51', '+51900000001'],
    ['+51 900-000-001', '+51', '+51900000001'],
    ['0051900000001', '+51', '+51900000001'],
    ['0991234567', '+593', '+593991234567'],
    ['300 000 0001', '+57', '+573000000001'],
  ])('%s con %s → %s', (input, prefix, expected) => {
    expect(normalizePhone(input, prefix)).toBe(expected);
  });

  it('rechaza números imposibles', () => {
    expect(normalizePhone('12', '+51')).toBeNull();
    expect(normalizePhone('abc', '+51')).toBeNull();
    expect(normalizePhone('+0123456789', '+51')).toBeNull();
  });
});

describe('normalizeDocument', () => {
  it('quita separadores y pasa a mayúsculas', () => {
    expect(normalizeDocument(' pe-test.000 001 ')).toBe('PETEST000001');
  });
});

describe('maskPhone', () => {
  it('oculta los dígitos centrales', () => {
    expect(maskPhone('+51900000123')).toBe('+51•••••123');
    expect(maskPhone('+51900000123')).not.toContain('900000');
  });
});

describe('canUseApp', () => {
  it('separa la PWA del panel de administración', () => {
    expect(canUseApp('CLERK', 'pwa')).toBe(true);
    expect(canUseApp('CLERK', 'admin')).toBe(false);
    expect(canUseApp('PHARMACY_MANAGER', 'pwa')).toBe(true);
    expect(canUseApp('COUNTRY_ADMIN', 'admin')).toBe(true);
    expect(canUseApp('COUNTRY_ADMIN', 'pwa')).toBe(false);
  });
});

describe('otpRequestSchema / otpVerifySchema', () => {
  it('exige país para ingresar con documento', () => {
    const r = otpRequestSchema.safeParse({
      app: 'pwa',
      identifier: { type: 'document', value: 'PETEST000001' },
    });
    expect(r.success).toBe(false);
  });

  it('acepta celular sin país (panel de administración)', () => {
    const r = otpRequestSchema.safeParse({
      app: 'admin',
      identifier: { type: 'phone', value: '+51900000091' },
    });
    expect(r.success).toBe(true);
  });

  it('el código tiene exactamente 6 dígitos', () => {
    const base = {
      app: 'pwa',
      countryCode: 'PE',
      identifier: { type: 'phone', value: '900000001' },
    };
    expect(otpVerifySchema.safeParse({ ...base, code: '123456' }).success).toBe(true);
    expect(otpVerifySchema.safeParse({ ...base, code: '12345' }).success).toBe(false);
    expect(otpVerifySchema.safeParse({ ...base, code: '12a456' }).success).toBe(false);
  });

  it('rechaza campos desconocidos', () => {
    const r = otpRequestSchema.safeParse({
      app: 'pwa',
      countryCode: 'PE',
      identifier: { type: 'phone', value: '900000001' },
      role: 'SUPER_ADMIN',
    });
    expect(r.success).toBe(false);
  });
});

describe('alta de país por configuración', () => {
  it('acepta cualquier código ISO de dos letras (no solo CO, EC, PE)', () => {
    expect(countryCodeSchema.safeParse('BO').success).toBe(true);
    expect(countryCodeSchema.safeParse('bo').success).toBe(false);
  });

  it('valida zona horaria, locale y prefijo', () => {
    const ok = {
      code: 'BO',
      name: 'Bolivia',
      locale: 'es-BO',
      timezone: 'America/La_Paz',
      phonePrefix: '+591',
    };
    expect(countryCreateSchema.safeParse(ok).success).toBe(true);
    expect(countryCreateSchema.safeParse({ ...ok, timezone: 'Marte/Olympus' }).success).toBe(false);
    expect(countryCreateSchema.safeParse({ ...ok, phonePrefix: '591' }).success).toBe(false);
  });
});
