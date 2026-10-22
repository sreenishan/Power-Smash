/**
 * GREEN (M0): the fixture files are well-formed and consistent with each other. These tests do not
 * touch the parser; they keep the red tests honest (76 fixtures, one expectation each, 3 real
 * spec titles, no synthetic title passed off as real).
 */
import { describe, expect, it } from 'vitest';
import { normalizeTitle } from '../../src/lib/parser/normalize';
import { expectedFile, proposedFixtures, readFixtureJson, readFixtureText, realTitles } from './helpers/fixtures';

describe('fixture files are valid JSON', () => {
  for (const name of ['titles.proposed.json', 'expected.proposed.json', 'real-titles.raw.json', 'real-titles.unconfirmed.json', 'gold-seed.real70.json']) {
    it(name, () => {
      expect(() => JSON.parse(readFixtureText(name))).not.toThrow();
    });
  }
});

describe('titles.proposed.json', () => {
  const fixtures = proposedFixtures();

  it('has exactly 76 entries', () => {
    expect(fixtures).toHaveLength(76);
  });

  it('has unique ids PF-001..PF-076 in order', () => {
    const ids = fixtures.map((f) => f.id);
    expect(new Set(ids).size).toBe(76);
    expect(ids).toEqual(Array.from({ length: 76 }, (_, i) => `PF-${String(i + 1).padStart(3, '0')}`));
  });

  it('has exactly 3 real-from-spec origins (PF-001..PF-003) and 73 synthetic', () => {
    const real = fixtures.filter((f) => f.origin === 'real-from-spec').map((f) => f.id);
    expect(real).toEqual(['PF-001', 'PF-002', 'PF-003']);
    expect(fixtures.filter((f) => f.origin === 'synthetic')).toHaveLength(73);
    expect(fixtures.every((f) => f.origin === 'real-from-spec' || f.origin === 'synthetic')).toBe(true);
  });

  it('every fixture has a non-empty input, compact expected text and reason', () => {
    for (const f of fixtures) {
      expect(typeof f.input, f.id).toBe('string');
      expect(f.input.length, f.id).toBeGreaterThan(0);
      expect(f.expected.length, f.id).toBeGreaterThan(0);
      expect(f.why.length, f.id).toBeGreaterThan(0);
    }
  });
});

describe('expected.proposed.json', () => {
  const fixtures = proposedFixtures();
  const file = expectedFile();

  it('has 76 entries with unique ids', () => {
    expect(file.entries).toHaveLength(76);
    expect(new Set(file.entries.map((e) => e.id)).size).toBe(76);
  });

  it('has an expected entry for every fixture, aligned by id, index, origin and input', () => {
    fixtures.forEach((fixture, index) => {
      const entry = file.entries.find((e) => e.id === fixture.id);
      expect(entry, `${fixture.id} has no expected entry`).toBeDefined();
      expect(entry?.index, fixture.id).toBe(index);
      expect(entry?.origin, fixture.id).toBe(fixture.origin);
      expect(entry?.input, fixture.id).toBe(fixture.input);
      expect(typeof entry?.expected, fixture.id).toBe('object');
      expect(entry?.expected, fixture.id).not.toBeNull();
    });
  });

  it('keeps the same 3 real-from-spec origins', () => {
    expect(file.entries.filter((e) => e.origin === 'real-from-spec').map((e) => e.id)).toEqual(['PF-001', 'PF-002', 'PF-003']);
  });

  it('every pending entry names a decision (or is a pure judgement call) and its pending fields', () => {
    for (const entry of file.entries) {
      if (entry.decision_pending !== undefined) {
        expect(entry.decision_pending, entry.id).toMatch(/^D-\d{3}$/u);
        expect(entry.pending_fields?.length ?? 0, entry.id).toBeGreaterThan(0);
      }
    }
  });
});

describe('real-titles.raw.json', () => {
  const real = realTitles();
  const fixtures = proposedFixtures();

  it('is a bare array of 70 non-empty strings', () => {
    expect(Array.isArray(real)).toBe(true);
    expect(real).toHaveLength(70);
    expect(real.every((t) => typeof t === 'string' && t.length > 0)).toBe(true);
  });

  it('has 70 distinct titles (the gold seed maps by position)', () => {
    expect(new Set(real).size).toBe(70);
  });

  it('contains no synthetic fixture title (exact or normalised, case-insensitive)', () => {
    const exact = new Set(real);
    const loose = new Set(real.map((t) => normalizeTitle(t).toLowerCase()));
    for (const f of fixtures.filter((x) => x.origin === 'synthetic')) {
      expect(exact.has(f.input), `${f.id} appears verbatim in real-titles.raw.json`).toBe(false);
      expect(loose.has(normalizeTitle(f.input).toLowerCase()), `${f.id} appears (normalised) in real-titles.raw.json`).toBe(false);
    }
  });

  it('PF-003 is verbatim in the real titles; PF-001/PF-002 are the truncated forms of two real titles', () => {
    const byId = new Map(fixtures.map((f) => [f.id, f]));
    expect(real).toContain((byId.get('PF-003') as { input: string }).input);
    for (const id of ['PF-001', 'PF-002']) {
      const prefix = (byId.get(id) as { input: string }).input.replace(/\s*…\s*$/u, '');
      expect(real.some((t) => t.startsWith(prefix)), `${id} should be a prefix of a real title`).toBe(true);
    }
  });
});

describe('real-titles.unconfirmed.json is not used as an expectation', () => {
  it('is an array of 19 records and none of its titles is a fixture or gold-seed title', () => {
    const unconfirmed = readFixtureJson<{ title_as_recorded_by_researcher?: string; title_reported_raw_by_skeptic?: string }[]>('real-titles.unconfirmed.json');
    expect(unconfirmed).toHaveLength(19);
    const unconfirmedTitles = new Set<string>();
    for (const record of unconfirmed) {
      for (const title of [record.title_as_recorded_by_researcher, record.title_reported_raw_by_skeptic]) {
        if (typeof title === 'string') unconfirmedTitles.add(normalizeTitle(title));
      }
    }
    for (const t of realTitles()) expect(unconfirmedTitles.has(normalizeTitle(t)), 'a raw title is also listed as unconfirmed').toBe(false);
    for (const f of proposedFixtures()) expect(unconfirmedTitles.has(normalizeTitle(f.input)), `${f.id} duplicates an unconfirmed title`).toBe(false);
  });
});
