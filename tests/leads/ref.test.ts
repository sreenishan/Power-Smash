import { describe, expect, it } from 'vitest';
import { istYear, makeRefCode, REF_ALPHABET } from '../../src/lib/leads/ref';
import { REF_CODE_PATTERN } from '../../src/lib/contracts/lead-constants';
import { seqRandom } from './helpers';

describe('reference codes', () => {
  it('alphabet is 32 unambiguous characters (no I, L, O, U)', () => {
    expect(REF_ALPHABET).toHaveLength(32);
    expect(new Set(REF_ALPHABET).size).toBe(32);
    for (const ch of 'ILOU') expect(REF_ALPHABET).not.toContain(ch);
  });

  it('format PS-YYYY-XXXXXX', () => {
    const ref = makeRefCode(new Date('2026-11-02T10:00:00Z'), seqRandom());
    expect(ref).toMatch(REF_CODE_PATTERN);
    expect(ref.startsWith('PS-2026-')).toBe(true);
  });

  it('uses the IST calendar year', () => {
    expect(istYear(new Date('2026-12-31T18:29:59Z'))).toBe(2026);
    expect(istYear(new Date('2026-12-31T18:30:00Z'))).toBe(2027);
    expect(istYear(new Date('2027-01-01T00:00:00Z'))).toBe(2027);
  });

  it('is random per call, not sequential and evenly spread over the alphabet', () => {
    const rnd = (n: number) => crypto.getRandomValues(new Uint8Array(n)); // the real source
    const refs = Array.from({ length: 2000 }, () => makeRefCode(new Date('2026-11-02T10:00:00Z'), rnd));
    expect(new Set(refs).size).toBeGreaterThanOrEqual(1999); // 30 bits: a chance collision is possible, and the database unique constraint retries it
    const counts = new Map<string, number>();
    for (const r of refs) for (const ch of r.slice(-6)) counts.set(ch, (counts.get(ch) ?? 0) + 1);
    expect(counts.size).toBe(32);
    const total = 2000 * 6;
    for (const [, n] of counts) expect(Math.abs(n / total - 1 / 32)).toBeLessThan(0.01);
    // consecutive references are not ordered
    const suffixes = refs.slice(0, 50).map((r) => r.slice(-6));
    expect(suffixes).not.toEqual([...suffixes].sort());
    expect(suffixes).not.toEqual([...suffixes].sort().reverse());
  });

  it('a masked byte never leaves the alphabet', () => {
    const all = (n: number) => new Uint8Array(n).fill(255);
    expect(makeRefCode(new Date('2026-11-02T10:00:00Z'), all)).toBe('PS-2026-ZZZZZZ');
    const zero = (n: number) => new Uint8Array(n);
    expect(makeRefCode(new Date('2026-11-02T10:00:00Z'), zero)).toBe('PS-2026-000000');
  });
});
