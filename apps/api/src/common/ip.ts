import { isIPv4, isIPv6 } from 'node:net';

/**
 * IP truncada para registrar el consentimiento sin guardar la IP completa:
 * IPv4 → /24 (último octeto en 0), IPv6 → /48.
 */
export function truncateIp(ip: string | undefined): string | null {
  if (!ip) return null;
  const v4 = ip.startsWith('::ffff:') ? ip.slice(7) : ip;
  if (isIPv4(v4)) return v4.split('.').slice(0, 3).concat('0').join('.');
  if (isIPv6(ip)) {
    const [head = ''] = ip.split('::');
    const groups = head.split(':').filter(Boolean);
    while (groups.length < 3) groups.push('0');
    return `${groups.slice(0, 3).join(':')}::`;
  }
  return null;
}
