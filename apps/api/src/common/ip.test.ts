import { describe, expect, it } from 'vitest';
import { truncateIp } from './ip';

describe('truncateIp', () => {
  it('trunca IPv4 a /24', () => expect(truncateIp('181.65.12.200')).toBe('181.65.12.0'));
  it('entiende IPv4 mapeada en IPv6', () => expect(truncateIp('::ffff:10.1.2.3')).toBe('10.1.2.0'));
  it('trunca IPv6 a /48', () =>
    expect(truncateIp('2800:200:e840:1234:5678::1')).toBe('2800:200:e840::'));
  it('ignora valores vacíos o inválidos', () => {
    expect(truncateIp(undefined)).toBeNull();
    expect(truncateIp('no-es-ip')).toBeNull();
  });
});
