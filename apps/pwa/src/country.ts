import { COUNTRY_CODES, type CountryCode } from '@pharma/shared';

const KEY = 'pharma.country';

/**
 * País elegido antes de iniciar sesión. Es solo una preferencia local: tras el OTP el país
 * queda fijado en la cuenta en el servidor (Iteración 1) y esa es la fuente de verdad.
 */
export function readChosenCountry(
  storage: Pick<Storage, 'getItem'> | undefined,
): CountryCode | null {
  try {
    const v = storage?.getItem(KEY);
    return v && (COUNTRY_CODES as readonly string[]).includes(v) ? (v as CountryCode) : null;
  } catch {
    return null;
  }
}

export function saveChosenCountry(
  storage: Pick<Storage, 'setItem'> | undefined,
  code: CountryCode,
): void {
  try {
    storage?.setItem(KEY, code);
  } catch {
    // Almacenamiento no disponible (modo privado): se pedirá de nuevo.
  }
}
