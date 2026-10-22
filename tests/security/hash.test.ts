import { describe, expect, it } from 'vitest';
import { normaliseIp, parseHmacKey, pseudonym, randomHex } from '../../src/lib/security/hash';
import { FAKE, seqRandom } from '../leads/helpers';

const key = parseHmacKey(FAKE.hmacKey) as NonNullable<ReturnType<typeof parseHmacKey>>;

describe('HMAC key', () => {
  it('needs a key id and at least 32 characters of secret', () => {
    expect(parseHmacKey(FAKE.hmacKey)).toEqual({ kid: 'k1', secret: 'a1b2c3d4'.repeat(6) });
    for (const bad of [null, undefined, '', `nocolon${'x'.repeat(40)}`, 'k1:short', `:${'x'.repeat(40)}`, `bad id:${'x'.repeat(40)}`]) {
      expect(parseHmacKey(bad as string | null)).toBeNull();
    }
  });
});

describe('pseudonym', () => {
  it('is stable, truncated, key-id prefixed, and does not contain the value', async () => {
    const a = await pseudonym(key, 'phone', '919876543210');
    expect(a).toMatch(/^k1\.[0-9a-f]{32}$/);
    expect(await pseudonym(key, 'phone', '919876543210')).toBe(a);
    expect(a).not.toContain('9876543210');
  });

  it('separates purposes and values, and depends on the key', async () => {
    const phone = await pseudonym(key, 'phone', '919876543210');
    expect(await pseudonym(key, 'email', '919876543210')).not.toBe(phone);
    expect(await pseudonym(key, 'phone', '919876543211')).not.toBe(phone);
    const other = parseHmacKey(`k2:${'z9y8x7w6'.repeat(6)}`) as NonNullable<ReturnType<typeof parseHmacKey>>;
    const rotated = await pseudonym(other, 'phone', '919876543210');
    expect(rotated.startsWith('k2.')).toBe(true);
    expect(rotated.slice(3)).not.toBe(phone.slice(3));
  });
});

describe('normaliseIp', () => {
  it('keeps IPv4, reduces IPv6 to its /64, unwraps mapped addresses, handles missing', () => {
    expect(normaliseIp('203.0.113.7')).toBe('203.0.113.7');
    expect(normaliseIp('2001:db8:1:2:aaaa:bbbb:cccc:dddd')).toBe('v6:2001:db8:1:2');
    expect(normaliseIp('2001:DB8:1:2:1:1:1:1')).toBe(normaliseIp('2001:db8:1:2:9:9:9:9'));
    expect(normaliseIp('2001:db8::1')).toBe('v6:2001:db8:0:0');
    expect(normaliseIp('::ffff:203.0.113.7')).toBe('203.0.113.7');
    expect(normaliseIp('::1')).toBe('v6:0:0:0:0');
    expect(normaliseIp(null)).toBe('none');
    expect(normaliseIp('')).toBe('none');
  });
});

describe('randomHex', () => {
  it('formats injected bytes as hex', () => {
    expect(randomHex(() => new Uint8Array([0, 15, 255]), 3)).toBe('000fff');
    expect(randomHex(seqRandom(), 4)).toMatch(/^[0-9a-f]{8}$/);
  });
});
