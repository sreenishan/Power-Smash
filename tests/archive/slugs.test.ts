import { describe, expect, it } from 'vitest';
import { assignMatchSlugs, assignPlayerSlugs, shortVideoId, SLUG_PATTERN, slugify } from '../../src/lib/archive/slugs';

describe('slugify', () => {
  it('lowercases, strips accents and hyphenates', () => {
    expect(slugify('  Demo Karthik R. ')).toBe('demo-karthik-r');
    expect(slugify('Mock Ñandi & Co')).toBe('mock-nandi-and-co');
  });
  it('returns an empty string for a name with no Latin letters', () => {
    expect(slugify('கார்த்திக்')).toBe('');
  });
});

describe('player slugs', () => {
  const two = [
    { id: 'p-1', displayName: 'Demo Karthik R', district: 'Madurai' },
    { id: 'p-2', displayName: 'Demo Karthik R', district: 'Chennai' },
  ];
  it('disambiguates a collision with the district, then a counter', () => {
    const slugs = assignPlayerSlugs([...two, { id: 'p-3', displayName: 'Demo Karthik R', district: 'Chennai' }]);
    expect(slugs.get('p-1')).toBe('demo-karthik-r');
    expect(slugs.get('p-2')).toBe('demo-karthik-r-chennai');
    expect(slugs.get('p-3')).toBe('demo-karthik-r-2');
  });
  it('does not depend on the order the rows arrive in', () => {
    const a = assignPlayerSlugs(two);
    const b = assignPlayerSlugs([...two].reverse());
    expect([...a.entries()].sort()).toEqual([...b.entries()].sort());
  });
  it('keeps stored slugs and never renames an existing player when a new one arrives (stability)', () => {
    const before = assignPlayerSlugs(two);
    const stored = two.map((p) => ({ ...p, slug: before.get(p.id) }));
    const after = assignPlayerSlugs([{ id: 'p-0', displayName: 'Demo Karthik R', district: 'Madurai' }, ...stored]);
    expect(after.get('p-1')).toBe(before.get('p-1'));
    expect(after.get('p-2')).toBe(before.get('p-2'));
    expect(new Set(after.values()).size).toBe(3);
  });
  it('falls back to a word for Tamil-only names and avoids reserved words', () => {
    const s = assignPlayerSlugs([{ id: 'a', displayName: 'கார்த்திக்' }, { id: 'b', displayName: 'Page' }]);
    expect(s.get('a')).toBe('player');
    expect(s.get('b')).toBe('page-2');
  });
  it('only produces valid slugs', () => {
    for (const slug of assignPlayerSlugs(two).values()) expect(SLUG_PATTERN.test(slug)).toBe(true);
  });
});

describe('match slugs', () => {
  it('uses {a}-vs-{b}-{short id} for a full match and an opaque slug otherwise', () => {
    const s = assignMatchSlugs([
      { id: 'm1', videoId: 'fake-m00001', sideA: ['Demo A'], sideB: ['Demo B'], opaque: false },
      { id: 'm2', videoId: 'fake-m00002', sideA: ['Demo A'], sideB: ['Sample Secret'], opaque: true },
    ]);
    expect(s.get('m1')).toBe('demo-a-vs-demo-b-kem00001');
    expect(s.get('m2')).toBe('match-kem00002');
    expect(s.get('m2')).not.toContain('secret');
  });
  it('resolves a short-id collision by growing the id, then by a counter', () => {
    const s = assignMatchSlugs([
      { id: 'a', videoId: 'AAA12345678', sideA: [], sideB: [], opaque: true },
      { id: 'b', videoId: 'BBB12345678', sideA: [], sideB: [], opaque: true },
      { id: 'c', videoId: 'BBB12345678', sideA: [], sideB: [], opaque: true },
    ]);
    expect(new Set(s.values()).size).toBe(3);
    expect(s.get('a')).toBe('match-12345678');
    expect(s.get('b')).toBe('match-bbb12345678');
  });
  it('keeps a stored match slug', () => {
    const s = assignMatchSlugs([{ id: 'a', videoId: 'x1234567890', slug: 'kept-slug', sideA: ['A'], sideB: ['B'], opaque: false }]);
    expect(s.get('a')).toBe('kept-slug');
  });
  it('IGNORES a stored slug for an opaque (protected) match so a stored name cannot survive', () => {
    const s = assignMatchSlugs([{ id: 'a', videoId: 'x1234567890', slug: 'arun-kumar-vs-ravi-siva-12345678', sideA: [], sideB: [], opaque: true }]);
    expect(s.get('a')).toBe('match-34567890');
    expect(s.get('a')).not.toContain('arun');
  });
  it('a video whose short id would be a reserved word still gets a name-free slug', () => {
    const s = assignMatchSlugs([{ id: 'b', videoId: 'gone', sideA: [], sideB: [], opaque: true }]);
    expect(s.get('b')).toBe('match-gone');
  });
  it('resolves a short-id collision by growing the id, then by a counter', () => {
    const s = assignMatchSlugs([
      { id: 'a', videoId: 'AAA12345678', sideA: [], sideB: [], opaque: true },
      { id: 'b', videoId: 'BBB12345678', sideA: [], sideB: [], opaque: true },
      { id: 'c', videoId: 'BBB12345678', sideA: [], sideB: [], opaque: true },
    ]);
    expect(new Set(s.values()).size).toBe(3);
    expect(s.get('a')).toBe('match-12345678');
    expect(s.get('b')).toBe('match-bbb12345678');
  });
  it('keeps a stored match slug', () => {
    const s = assignMatchSlugs([{ id: 'a', videoId: 'x1234567890', slug: 'kept-slug', sideA: ['A'], sideB: ['B'], opaque: false }]);
    expect(s.get('a')).toBe('kept-slug');
  });
  it('IGNORES a stored slug for an opaque (protected) match so a stored name cannot survive', () => {
    const s = assignMatchSlugs([{ id: 'a', videoId: 'x1234567890', slug: 'arun-kumar-vs-ravi-siva-12345678', sideA: [], sideB: [], opaque: true }]);
    expect(s.get('a')).toBe('match-34567890');
    expect(s.get('a')).not.toContain('arun');
  });
  it('never hands out the reserved gone page address', () => {
    expect(assignMatchSlugs([{ id: 'a', videoId: 'x', slug: 'gone', sideA: [], sideB: [], opaque: false }]).get('a')).toBe('gone');
  });
  it('(reserved word kept only because it was stored; new slugs never equal it)', () => {
    const s = assignMatchSlugs([{ id: 'b', videoId: 'gone', sideA: [], sideB: [], opaque: true }]);
    expect(s.get('b')).toBe('match-gone');
  });
  it('shortVideoId drops punctuation', () => {
    expect(shortVideoId('fake-m00001')).toBe('kem00001');
  });
});
