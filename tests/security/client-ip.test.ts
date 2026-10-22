import { describe, expect, it } from 'vitest';
import { clientIpFromHeaders } from '../../src/lib/security/client-ip';
import { normaliseIp } from '../../src/lib/security/hash';

const h = (o: Record<string, string>) => new Headers(o);

describe('clientIpFromHeaders', () => {
  it('prefers the platform header', () => {
    expect(clientIpFromHeaders(h({ 'x-vercel-forwarded-for': '203.0.113.7', 'x-real-ip': '198.51.100.1', 'x-forwarded-for': '192.0.2.1' }))).toBe('203.0.113.7');
  });
  it('falls back to x-real-ip then x-forwarded-for (first entry)', () => {
    expect(clientIpFromHeaders(h({ 'x-real-ip': '198.51.100.1', 'x-forwarded-for': '192.0.2.1' }))).toBe('198.51.100.1');
    expect(clientIpFromHeaders(h({ 'x-forwarded-for': '192.0.2.1, 10.0.0.1' }))).toBe('192.0.2.1');
  });
  it('ignores the Cloudflare header (spoofable behind Vercel)', () => {
    expect(clientIpFromHeaders(h({ 'cf-connecting-ip': '203.0.113.99' }))).toBeNull();
    expect(clientIpFromHeaders(h({ 'cf-connecting-ip': '203.0.113.99', 'x-vercel-forwarded-for': '203.0.113.7' }))).toBe('203.0.113.7');
  });
  it('rejects non-addresses and falls through to the next trusted header', () => {
    expect(clientIpFromHeaders(h({ 'x-vercel-forwarded-for': 'not-an-ip', 'x-real-ip': '198.51.100.1' }))).toBe('198.51.100.1');
    for (const bad of ['999.1.1.1', '1.2.3', '1.2.3.4.5', "1.1.1.1'; drop table", '<script>', '', ' ', 'a'.repeat(60), ':::', '1::2::3']) {
      expect(clientIpFromHeaders(h({ 'x-vercel-forwarded-for': bad }))).toBeNull();
    }
  });
  it('a spoofed x-forwarded-for list cannot override the platform value', () => {
    expect(clientIpFromHeaders(h({ 'x-vercel-forwarded-for': '203.0.113.7', 'x-forwarded-for': '1.1.1.1, 203.0.113.7' }))).toBe('203.0.113.7');
  });
  it('accepts IPv6 and IPv4-mapped, which normaliseIp reduces to /64 or IPv4', () => {
    const v6 = clientIpFromHeaders(h({ 'x-vercel-forwarded-for': '2001:db8:1:2:aaaa:bbbb:cccc:dddd' }));
    expect(normaliseIp(v6)).toBe('v6:2001:db8:1:2');
    expect(normaliseIp(clientIpFromHeaders(h({ 'x-real-ip': '[2001:db8::1]' })))).toBe('v6:2001:db8:0:0');
    expect(normaliseIp(clientIpFromHeaders(h({ 'x-real-ip': '::ffff:203.0.113.5' })))).toBe('203.0.113.5');
  });
  it('returns null with no headers', () => {
    expect(clientIpFromHeaders(h({}))).toBeNull();
  });
});
