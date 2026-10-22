import { describe, expect, it } from 'vitest';
import { assessBudget, assertPageBudget, estimatePageCount, FILE_FAIL_ABOVE, FILE_WARN_AT } from '../../src/lib/archive/budget';
import { profilePageJsonLd, videoObjectJsonLd } from '../../src/lib/archive/jsonld';
import { ageGroupLabel, categoryLabel, isoDuration, roundLabel } from '../../src/lib/archive/labels';
import { buildPublicArchive, type ArchiveMatch } from '../../src/lib/archive/model';
import { azLetter, buildMatchIndex, buildSearchIndex, filterMatches, filterOptions, normaliseQuery, searchIndex } from '../../src/lib/archive/search';
import { seedArchive } from '../../src/lib/archive/seed';
import { selectArchiveProvider } from '../../src/lib/archive/select';
import { pageSitemapUrls, sitemapIndexXml, tournamentSitemapUrls, urlsetXml, xmlEscape } from '../../src/lib/archive/sitemap';
import { safeJsonLd } from '../../src/lib/jsonld';

const archive = buildPublicArchive(seedArchive);
const ORIGIN = 'https://example.test';

describe('page budget guard (D-009)', () => {
  it('ok below 10,000, warn from 10,000, fail above 14,000', () => {
    expect(FILE_WARN_AT).toBe(10_000);
    expect(FILE_FAIL_ABOVE).toBe(14_000);
    expect(assessBudget(9_999).level).toBe('ok');
    expect(assessBudget(10_000).level).toBe('warn');
    expect(assessBudget(14_000).level).toBe('warn');
    expect(assessBudget(14_001).level).toBe('fail');
    expect(assessBudget(-1).level).toBe('fail');
    expect(assessBudget(Number.NaN).level).toBe('fail');
  });
  it('estimates pages and passes the seed; throws when the catalogue is far too big', () => {
    expect(estimatePageCount(archive)).toBeGreaterThan(archive.matches.length);
    expect(assertPageBudget(archive).level).toBe('ok');
    const big = { ...archive, matches: new Array(14_000).fill(archive.matches[0]) as ArchiveMatch[] };
    expect(() => assertPageBudget(big)).toThrow(/page budget/i);
  });
});

describe('JSON-LD (spec 7.3, 7.5, D-029)', () => {
  const full = archive.matches.find((m) => m.kind === 'full') as ArchiveMatch;
  it('VideoObject has the required fields and the privacy-enhanced embed', () => {
    const ld = videoObjectJsonLd(full, ORIGIN) as Record<string, unknown>;
    expect(ld['@type']).toBe('VideoObject');
    expect(ld.name).toBe(full.rawTitle);
    expect(String(ld.embedUrl).startsWith('https://www.youtube-nocookie.com/embed/')).toBe(true);
    expect(ld.uploadDate).toBe(full.publishedAt);
    expect(ld.duration).toMatch(/^PT/);
    expect(String(ld.url)).toBe(`https://example.test/matches/${full.slug}/`);
  });
  it('escapes a hostile title so it cannot close the script tag', () => {
    const evil: ArchiveMatch = { ...full, rawTitle: '</script><script>alert(1)</script> & \u2028 <b>' };
    const out = safeJsonLd(videoObjectJsonLd(evil, ORIGIN));
    expect(out).not.toContain('</script>');
    expect(out).not.toContain('<');
    expect(out).not.toContain('>');
    expect(out).not.toContain('&');
    expect(out).not.toContain('\u2028');
    expect(out).toContain('\\u003c/script\\u003e');
    expect(JSON.parse(out).name).toBe(evil.rawTitle);
  });
  it('ProfilePage names an adult and lists videos', () => {
    const p = archive.players[0]!;
    const ld = profilePageJsonLd(p, ORIGIN) as Record<string, any>;
    expect(ld['@type']).toBe('ProfilePage');
    expect(ld.mainEntity['@type']).toBe('Person');
    expect(ld.mainEntity.name).toBe(p.name);
    expect(ld.hasPart.itemListElement.length).toBeGreaterThan(0);
  });
  it('isoDuration', () => {
    expect(isoDuration(61)).toBe('PT1M1S');
    expect(isoDuration(3600)).toBe('PT1H');
    expect(isoDuration(3725)).toBe('PT1H2M5S');
    expect(isoDuration(0)).toBeNull();
    expect(isoDuration(null)).toBeNull();
  });
});

describe('labels', () => {
  it('maps codes to words and leaves unknown codes alone', () => {
    expect(categoryLabel('XD')).toBe('Mixed doubles');
    expect(categoryLabel('ZZ')).toBe('ZZ');
    expect(roundLabel('SF')).toBe('Semi-final');
    expect(ageGroupLabel('open')).toBe('Open');
    expect(ageGroupLabel('35+')).toBe('35+');
    expect(categoryLabel(null)).toBeNull();
  });
});

describe('search index and filters (D-010)', () => {
  const index = buildSearchIndex(archive);
  it('finds adult players by any part of the name, prefix first', () => {
    expect(searchIndex(index, 'selvi').map((h) => h.name)).toEqual(['Demo Selvi M']);
    expect(searchIndex(index, 'karthik').length).toBe(2);
    expect(searchIndex(index, 'demo karthik')[0]?.href).toMatch(/^\/players\/demo-karthik-r/);
    expect(searchIndex(index, '')).toEqual([]);
    expect(searchIndex(index, 'zzzz')).toEqual([]);
  });
  it('never finds a protected player', () => {
    for (const q of ['ilan', 'tara', 'mugil', 'oviya', 'trial junior', 'sample ilan v']) expect(searchIndex(index, q)).toEqual([]);
  });
  it('tournaments have no link until their pages exist', () => {
    const hit = searchIndex(index, 'district open').find((h) => h.kind === 'tournament');
    expect(hit?.href).toBeNull();
    const linked = searchIndex(buildSearchIndex(archive, true), 'district open').find((h) => h.kind === 'tournament');
    expect(linked?.href).toMatch(/^\/tournaments\/.+\/$/);
  });
  it('normalises accents and punctuation', () => {
    expect(normaliseQuery('  Ñandi-K. ')).toBe('nandi k');
  });
  const items = buildMatchIndex(archive).items;
  it('filters by year, category, round, tournament and text; sorts', () => {
    expect(filterMatches(items, { year: '2025' }).every((i) => i.y === 2025)).toBe(true);
    expect(filterMatches(items, { category: 'XD' }).every((i) => i.c === 'XD')).toBe(true);
    expect(filterMatches(items, { round: 'F' }).every((i) => i.r === 'F')).toBe(true);
    expect(filterMatches(items, { tournament: 'Fake District Open 2025' }).length).toBeGreaterThan(0);
    expect(filterMatches(items, { q: 'zzz-none' })).toEqual([]);
    const newest = filterMatches(items, {});
    expect(newest.map((i) => i.d)).toEqual([...newest.map((i) => i.d)].sort().reverse());
    const views = filterMatches(items, {}, 'views');
    expect(views[0]!.w).toBeGreaterThanOrEqual(views.at(-1)!.w);
    expect(filterMatches(items, {}).length).toBe(32);
  });
  it('builds option lists from the data', () => {
    const o = filterOptions(items);
    expect(o.years.map((y) => y.value)).toEqual(['2026', '2025']);
    expect(o.categories.some((c) => c.label === 'Mixed doubles')).toBe(true);
    expect(o.rounds[0]?.value).toBe('F');
  });
  it('A to Z letters', () => {
    expect(azLetter('Mock Bala S')).toBe('M');
    expect(azLetter('கார்த்திக்')).toBe('#');
  });
});

describe('sitemap builders', () => {
  it('escapes XML and stays valid when empty', () => {
    expect(xmlEscape('a&b<c>"d\'')).toBe('a&amp;b&lt;c&gt;&quot;d&apos;');
    expect(urlsetXml([])).toContain('<urlset');
    expect(sitemapIndexXml([{ loc: 'https://x.test/a.xml', lastmod: '2026-01-02' }])).toContain('<lastmod>2026-01-02</lastmod>');
  });
  it('refuses more than 50,000 URLs', () => {
    expect(() => urlsetXml(new Array(50_001).fill({ loc: 'https://x.test/' }))).toThrow(/50000/);
  });
  it('pages sitemap lists canonical slash URLs only', () => {
    for (const u of pageSitemapUrls(ORIGIN)) expect(u.loc.endsWith('/')).toBe(true);
    expect(pageSitemapUrls(ORIGIN).some((u) => u.loc === 'https://example.test/matches/')).toBe(true);
  });
  it('tournament sitemap holds owner tournaments and archive ones only when their pages are built', () => {
    const owner = [{ slug: 'owner-cup-2026-x', startDate: '2026-01-01', endDate: null }];
    expect(tournamentSitemapUrls(archive, owner, ORIGIN, false).length).toBe(1);
    expect(tournamentSitemapUrls(archive, owner, ORIGIN, true).length).toBe(1 + archive.tournaments.length);
  });
});

describe('provider selection', () => {
  it('defaults to the fictional seed and never calls fetch', () => {
    const boom = (() => {
      throw new Error('no network');
    }) as unknown as typeof fetch;
    expect(selectArchiveProvider({}, boom).id).toBe('seed');
    expect(selectArchiveProvider({ PS_ARCHIVE_SOURCE: 'supabase' }, boom).id).toBe('seed');
    expect(selectArchiveProvider({ PS_ARCHIVE_SOURCE: 'Supabase', PUBLIC_SUPABASE_URL: 'https://abc.supabase.co', PUBLIC_SUPABASE_PUBLISHABLE_KEY: 'k' }, boom).id).toBe('seed');
  });
  it('uses supabase only when asked and configured', () => {
    const fake = (() => Promise.resolve(new Response('[]'))) as unknown as typeof fetch;
    const p = selectArchiveProvider({ PS_ARCHIVE_SOURCE: 'supabase', PUBLIC_SUPABASE_URL: 'https://abc.supabase.co', PUBLIC_SUPABASE_PUBLISHABLE_KEY: 'pk-test' }, fake);
    expect(p.id).toBe('supabase');
  });
});
