/**
 * Utilidades de zona horaria por país. Los topes diarios y las fotos de ranking usan el
 * "día local" del país, no el día UTC.
 */

function partsInZone(date: Date, timeZone: string): Record<string, number> {
  const fmt = new Intl.DateTimeFormat('en-US', {
    timeZone,
    hourCycle: 'h23',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  });
  const out: Record<string, number> = {};
  for (const p of fmt.formatToParts(date)) {
    if (p.type !== 'literal') out[p.type] = Number(p.value);
  }
  return out;
}

/** Diferencia (ms) entre la hora local de la zona y UTC en un instante dado. */
export function timeZoneOffsetMs(date: Date, timeZone: string): number {
  const p = partsInZone(date, timeZone);
  const asUtc = Date.UTC(p.year!, p.month! - 1, p.day!, p.hour!, p.minute!, p.second!);
  return asUtc - Math.floor(date.getTime() / 1000) * 1000;
}

/** Día local del país en formato YYYY-MM-DD. */
export function localDay(date: Date, timeZone: string): string {
  const p = partsInZone(date, timeZone);
  const mm = String(p.month).padStart(2, '0');
  const dd = String(p.day).padStart(2, '0');
  return `${p.year}-${mm}-${dd}`;
}

/** Instante UTC de la medianoche local de una fecha (mes 1–12) en la zona dada. */
export function zonedMidnightUtc(year: number, month: number, day: number, timeZone: string): Date {
  const guess = Date.UTC(year, month - 1, day);
  const offset = timeZoneOffsetMs(new Date(guess), timeZone);
  return new Date(guess - offset);
}

/** Inicio y fin (exclusivo) del periodo de ranking de `months` meses que contiene `date`. */
export function rankingPeriodBounds(
  date: Date,
  timeZone: string,
  months: number,
): { startsAt: Date; endsAt: Date } {
  const p = partsInZone(date, timeZone);
  const monthIndex = p.month! - 1;
  const startMonth = monthIndex - (monthIndex % months);
  const startsAt = zonedMidnightUtc(p.year!, startMonth + 1, 1, timeZone);
  const endY = p.year! + Math.floor((startMonth + months) / 12);
  const endM = ((startMonth + months) % 12) + 1;
  const endsAt = zonedMidnightUtc(endY, endM, 1, timeZone);
  return { startsAt, endsAt };
}
