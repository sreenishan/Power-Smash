/**
 * GREEN (M2b): edge cases and safety properties of parseTitle() beyond the 76 fixtures.
 * Fictional names only. The properties are the ones D-012 / D-013 / D-017 depend on:
 * never throw, never alter the raw title, never emit a confirmed age, never create rows from an
 * ambiguous or international title, never infer a category from names.
 */
import { describe, expect, it } from 'vitest';
import { parseTitle } from '../../src/lib/parser';

const ODD_INPUTS = [
  '',
  ' ',
  '||',
  'vs',
  'vs vs',
  'v',
  'ARUN vs',
  'vs KUMAR',
  'ARUN vs KUMAR vs RAJ',
  '(((( vs ))))',
  '[IND] vs [JPN]',
  '🏸🏸🏸',
  '#shorts',
  'ARUN vs KUMAR ...',
  '…',
  'A'.repeat(5000) + ' vs ' + 'B'.repeat(5000),
  'ARUN&amp;KUMAR &amp;lt; vs RAJ',
  'ARUN vs KUMAR || U-17 || Under-ABC || Kids Cup',
  '\u0000​️ ARUN vs KUMAR',
];

describe('parseTitle never throws and keeps the raw title', () => {
  it.each(ODD_INPUTS.map((t) => [t.length > 40 ? `${t.slice(0, 20)}...(${t.length})` : t, t] as const))('%j', (_label, title) => {
    const result = parseTitle(title);
    expect(result.rawTitle).toBe(title);
    expect(Number.isInteger(result.confidencePoints)).toBe(true);
    for (const p of [...result.sideA, ...result.sideB]) {
      expect(p.nameNormalized.length).toBeGreaterThan(0);
      expect(p.nameKey.length).toBeGreaterThan(0);
      expect(['minor_suspected', 'unknown']).toContain(p.ageStatus);
    }
  });
});

describe('safety properties', () => {
  it('a missing side is never invented: it becomes an ambiguous VS with no players', () => {
    for (const title of ['ARUN vs', 'vs KUMAR']) {
      const r = parseTitle(title);
      expect(r.sideA).toEqual([]);
      expect(r.sideB).toEqual([]);
      expect(r.entityCreation).toBe('blocked');
      expect(r.hardFlags).toContain('AMBIGUOUS_VS');
      expect(r.needsReview).toBe(true);
    }
  });

  it('two VS tokens are ambiguous and never auto-split', () => {
    const r = parseTitle('ARUN vs KUMAR vs RAJ || MS Final - Test Cup 2026');
    expect(r.hardFlags).toContain('AMBIGUOUS_VS');
    expect(r.entityCreation).toBe('blocked');
    expect(r.entityBlockReason).toBe('AMBIGUOUS_VS');
    expect(r.sideA).toEqual([]);
  });

  it('an unmapped age-like word fails closed: UNKNOWN_AGE_TOKEN, review, no minor hold', () => {
    const r = parseTitle('ARUN vs KUMAR || Kids Cup 2026');
    expect(r.hardFlags).toContain('UNKNOWN_AGE_TOKEN');
    expect(r.needsReview).toBe(true);
    expect(r.ageSignals).toContain('unknown_age_word:kids');
    expect(r.minorHold).toBe(false);
  });

  it('an under-age token marks every player minor_suspected and holds the match', () => {
    const r = parseTitle('ARUN KUMAR vs RAJ VIJAY || MS Final - Under 17 Test Cup 2026');
    expect(r.ageGroup).toBe('U17');
    expect(r.minorHold).toBe(true);
    for (const p of [...r.sideA, ...r.sideB]) expect(p.ageStatus).toBe('minor_suspected');
  });

  it('U-21 and 35+ are age groups but not minor signals', () => {
    const young = parseTitle('ARUN KUMAR vs RAJ VIJAY || U-21 MS Final - Test Cup 2026');
    expect(young.ageGroup).toBe('U21');
    expect(young.ageSignals).toEqual([]);
    expect(young.minorHold).toBe(false);
    const vets = parseTitle('ARUN KUMAR vs RAJ VIJAY || 35+ MS Final - Test Cup 2026');
    expect(vets.ageGroup).toBe('35+');
    expect(vets.minorHold).toBe(false);
  });

  it('never infers a category or a format from names', () => {
    const r = parseTitle('PRIYA/KAVIN vs ANAND/MEERA || South Test Tournament 2026');
    expect(r.category).toBeNull();
    expect(r.format).toBe('doubles');
  });

  it('a slash-less doubles pair is split only with a doubles token and exactly two names per side (D-017)', () => {
    const withToken = parseTitle('NAVEEN GANESH vs KALAI SASI Men Doubles Final Test Cup 2026');
    expect(withToken.format).toBe('doubles');
    expect(withToken.sideA.map((p) => p.displayName)).toEqual(['Naveen', 'Ganesh']);
    const withoutToken = parseTitle('NAVEEN GANESH vs KALAI SASI || Test Cup 2026');
    expect(withoutToken.format).toBe('singles');
    expect(withoutToken.sideA.map((p) => p.displayName)).toEqual(['Naveen Ganesh']);
  });

  it('international titles create no rows even without a country code (known event)', () => {
    const r = parseTitle('ARUN KUMAR vs RAJ VIJAY || MS Final - All England 2026');
    expect(r.isInternational).toBe(true);
    expect(r.entityCreation).toBe('blocked');
    expect(r.entityBlockReason).toBe('INTERNATIONAL');
  });

  it('entities in the title are decoded for matching but the raw title is untouched', () => {
    const title = 'ARUN &amp; KUMAR vs RAJ &amp; VIJAY || MD Final - Test Cup 2026';
    const r = parseTitle(title);
    expect(r.rawTitle).toBe(title);
    expect(r.normalizedTitle).toContain('ARUN & KUMAR');
    expect(r.format).toBe('doubles');
  });

  it('a Tamil-script name never normalises to an empty key', () => {
    const r = parseTitle('கார்த்திக் vs அருண் || MS Final - Test Cup 2026');
    for (const p of [...r.sideA, ...r.sideB]) {
      expect(p.nameNormalized).not.toBe('');
      expect(p.latinKey).toBeNull();
    }
    expect(r.hardFlags).toContain('NO_LATIN_KEY');
  });

  it('the IST year of publishedAt is the fallback year but still costs NO_YEAR', () => {
    const r = parseTitle('ARUN vs KUMAR || MS Final - Test Cup', { publishedAt: '2025-12-31T20:00:00Z' });
    expect(r.year).toBe(2026);
    expect(r.yearSource).toBe('published_at_ist');
    expect(r.softFlags.map((f) => f.flag)).toContain('NO_YEAR');
  });

  it('classifies Shorts and completed live streams from context (D-033)', () => {
    expect(parseTitle('ARUN vs KUMAR || MS Final - Test Cup 2026', { playlist: 'UUSH' }).nonMatchReason).toBe('SHORT_FORM');
    expect(parseTitle('ARUN vs KUMAR || MS Final - Test Cup 2026', { rssLinkType: 'shorts' }).videoType).toBe('short');
    const live = parseTitle('ARUN vs KUMAR || MS Final - Test Cup 2026', { liveBroadcastContent: 'live' });
    expect(live.videoType).toBe('live');
    expect(live.liveStatus).toBe('live');
    const done = parseTitle('ARUN vs KUMAR || MS Final - Test Cup 2026', { hasLiveStreamingDetails: true, liveBroadcastContent: 'none' });
    expect(done.liveStatus).toBe('completed');
    expect(done.videoType).toBe('match');
  });

  it('the same match titled two ways gets the same match key, a different round does not', () => {
    const a = parseTitle('ARUN KUMAR vs RAJ VIJAY || MS Final - Test Cup 2026');
    const b = parseTitle('RAJ VIJAY vs ARUN KUMAR || Final | MS | Test Cup 2026');
    const c = parseTitle('ARUN KUMAR vs RAJ VIJAY || MS SF - Test Cup 2026');
    expect(a.matchKey).not.toBeNull();
    expect(a.matchKey).toBe(b.matchKey);
    expect(a.matchKey).not.toBe(c.matchKey);
  });

  it('the parser version is a non-empty string', () => {
    expect(parseTitle('ARUN vs KUMAR').parserVersion).toMatch(/^\d+\.\d+\.\d+/u);
  });
});
