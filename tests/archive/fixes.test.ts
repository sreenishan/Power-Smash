// Fix wave: review findings S2-2, S2-6, S2-7, B2-7, B2-8, C2-1 and Tamil search.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { buildPublicArchive } from '../../src/lib/archive/model';
import type { RawArchive, RawMatch, RawPlayer, RawTournament } from '../../src/lib/archive/provider';
import { DEFAULT_ARCHIVE_SETTINGS } from '../../src/lib/archive/provider';
import { buildRedirects, GONE_PATH, REDIRECTS_MAX_LINES } from '../../src/lib/archive/redirects';
import { buildSearchIndex, filterMatches, includesAtBoundary, normaliseQuery, searchIndex, type MatchItem } from '../../src/lib/archive/search';
import { seedArchive } from '../../src/lib/archive/seed';

const T: RawTournament = { id: 't', name: 'Fake Cup 2026', editionYear: 2026, city: 'Madurai', visibility: 'public' };
const P = (id: string, name: string, ageStatus: RawPlayer['ageStatus'] = 'adult_confirmed', extra: Partial<RawPlayer> = {}): RawPlayer => ({ id, displayName: name, ageStatus, ...extra });
const M = (id: string, a: string[], b: string[], extra: Partial<RawMatch> = {}): RawMatch => ({
  id, videoId: `fake-x${id.padStart(5, '0')}`, rawTitle: `${a.join(' / ')} vs ${b.join(' / ')} | Fake Cup 2026`, publishedAt: '2026-01-02T03:04:05Z', tournamentId: 't', sideA: a, sideB: b, ...extra,
});
const raw = (over: Partial<RawArchive>): RawArchive => ({ players: [], tournaments: [T], matches: [], settings: DEFAULT_ARCHIVE_SETTINGS, generatedAt: '2026-10-20T00:00:00Z', ...over });

describe('B2-7 tournament order', () => {
  it('is newest first, undated last, ties by slug, whatever order the rows arrive in', () => {
    const dates = ['2025-01-01', '2026-01-01', '2024-01-01', '2026-06-01', null];
    // pageEligible: true = the source's D-013 flag (3 or more matches, or promoted), so one match each is enough to test the ORDER
    const ts: RawTournament[] = dates.map((d, i) => ({ id: `t${i}`, slug: `cup-${i}`, name: `Cup ${i}`, startDate: d, visibility: 'public', pageEligible: true }));
    const players = [P('a', 'Demo A'), P('b', 'Demo B')];
    const matches = ts.map((t, i) => M(String(i + 1), ['a'], ['b'], { tournamentId: t.id }));
    const build = (list: RawTournament[]) => buildPublicArchive(raw({ players, tournaments: list, matches })).tournaments.map((t) => t.startDate);
    const expected = ['2026-06-01', '2026-01-01', '2025-01-01', '2024-01-01', null];
    expect(build(ts)).toEqual(expected);
    expect(build([...ts].reverse())).toEqual(expected);
    const tie = buildPublicArchive(raw({ players, tournaments: [{ ...ts[0]!, id: 'x2', slug: 'b-cup' }, { ...ts[0]!, id: 'x1', slug: 'a-cup' }], matches: [M('1', ['a'], ['b'], { tournamentId: 'x1' }), M('2', ['a'], ['b'], { tournamentId: 'x2' })] }));
    expect(tie.tournaments.map((t) => t.slug)).toEqual(['a-cup', 'b-cup']);
  });
});

describe('B2-8 stored slugs never keep a protected name', () => {
  const players = [P('a', 'Arun Kumar'), P('r', 'Ravi Siva', 'unknown', { slug: 'ravi-siva' }), P('m', 'Mina Jr', 'minor_confirmed', { slug: 'mina-jr' })];
  const archive = buildPublicArchive(
    raw({
      players,
      matches: [
        M('1', ['a'], ['r'], { slug: 'arun-kumar-vs-ravi-siva-12345678' }),
        M('2', ['a'], ['m'], { slug: 'arun-kumar-vs-mina-jr-87654321' }),
      ],
    }),
  );
  it('a stored match slug is replaced by an opaque one when a participant became protected', () => {
    const minimal = archive.matches.find((m) => m.id === '1')!;
    expect(minimal.kind).toBe('minimal');
    expect(minimal.slug).toMatch(/^match-/);
    expect(minimal.slug).not.toMatch(/ravi|arun/);
  });
  it('a minimal player page is always opaque, whatever slug was stored', () => {
    expect(archive.minimalPlayers.map((p) => p.slug)).toEqual(['player-r']);
  });
  it('the old addresses are listed as superseded: redirect to the opaque page, or gone', () => {
    expect(archive.superseded).toContainEqual({ from: '/matches/arun-kumar-vs-ravi-siva-12345678/', to: `/matches/${archive.matches[0]!.slug}/` });
    expect(archive.superseded).toContainEqual({ from: '/matches/arun-kumar-vs-mina-jr-87654321/', to: null });
    expect(archive.superseded).toContainEqual({ from: '/players/ravi-siva/', to: '/players/player-r/' });
    expect(archive.superseded).toContainEqual({ from: '/players/mina-jr/', to: null });
  });
});

describe('S2-6 the unknown-age page carries no name', () => {
  const a = buildPublicArchive(seedArchive);
  it('the minimal player record has no name field and the page source never prints one', () => {
    for (const p of a.minimalPlayers) expect(Object.keys(p).sort()).toEqual(['id', 'slug']);
    const src = readFileSync(join(process.cwd(), 'src/pages/players/[slug].astro'), 'utf8');
    expect(src).not.toMatch(/minimalName/);
  });
});

describe('S2-7 name suppression covers unlinked participants', () => {
  const players = [P('a', 'Arun Kumar'), P('b', 'Bala Murugan')];
  const matches = [
    M('1', ['a'], ['b']),
    // no player row is linked to this video: only the raw title names the person
    M('2', [], [], { rawTitle: 'Zed  Quin vs Arun Kumar | Fake Cup 2026' }),
    M('3', [], [], { rawTitle: 'Somebody Else vs Another | Fake Cup 2026' }),
  ];
  it('hides every video whose raw title holds a suppressed name (any case, spacing, accents)', () => {
    const out = buildPublicArchive(raw({ players, matches, suppressedNames: ['zed quin'] }));
    expect(out.matches.map((m) => m.id).sort()).toEqual(['1', '3']);
    expect(out.dropped.hiddenMatches).toBe(1);
    expect(out.superseded).toEqual([]);
  });
  it('a suppressed player disappears with all their matches, profile and slug', () => {
    const out = buildPublicArchive(raw({ players, matches, suppressedNames: ['Ａrun  KUMAR'] }));
    expect(out.players.find((p) => p.name === 'Arun Kumar')).toBeUndefined();
    expect(out.matches.some((m) => m.rawTitle.includes('Arun Kumar'))).toBe(false);
    expect(JSON.stringify(buildSearchIndex(out))).not.toContain('Arun');
  });
  it('does not hide on a partial word', () => {
    const out = buildPublicArchive(raw({ players, matches, suppressedNames: ['quinn'] }));
    expect(out.matches.length).toBe(3);
  });
});

describe('Tamil search', () => {
  const karthik = 'கார்த்திக்'; // கார்த்திக்
  const selvi = 'செல்வி'; // செல்வி
  const index = {
    v: 1 as const,
    players: [
      [karthik + ' ஆர்', normaliseQuery(karthik + ' ஆர்'), 'karthik-tamil'],
      [selvi, normaliseQuery(selvi), 'selvi-tamil'],
    ] as [string, string, string][],
    tournaments: [],
  };
  it('keeps Tamil letters and vowel signs (they are marks, not separators)', () => {
    expect(normaliseQuery(karthik)).toBe(karthik.normalize('NFC'));
    expect(normaliseQuery('  ' + selvi + '!  ')).toBe(selvi.normalize('NFC'));
  });
  it('composes the same whether typed decomposed or composed (NFC)', () => {
    const decomposed = 'ெ' + 'ா'; // two-part vowel sign pieces
    const composed = 'ொ';
    expect(normaliseQuery('க' + decomposed)).toBe(normaliseQuery('க' + composed));
    expect(normaliseQuery(karthik.normalize('NFD'))).toBe(normaliseQuery(karthik.normalize('NFC')));
  });
  it('finds a Tamil name by a prefix, a whole word and a second word', () => {
    expect(searchIndex(index, 'கார்').map((h) => h.href)).toEqual(['/players/karthik-tamil/']);
    expect(searchIndex(index, karthik)[0]?.href).toBe('/players/karthik-tamil/');
    expect(searchIndex(index, 'ஆர்')[0]?.href).toBe('/players/karthik-tamil/');
    expect(searchIndex(index, 'செல்')[0]?.href).toBe('/players/selvi-tamil/');
  });
  it('is grapheme-aware: a lone vowel sign or virama never matches mid-cluster', () => {
    expect(includesAtBoundary(normaliseQuery(karthik), 'ா')).toBe(false); // vowel sign AA alone
    expect(includesAtBoundary(normaliseQuery(karthik), '்')).toBe(false); // virama alone
    expect(includesAtBoundary('abc கார்த்திக்', 'கார்த்')).toBe(true);
    expect(searchIndex(index, 'ா')).toEqual([]);
  });
  it('filters match titles written in Tamil', () => {
    const items: MatchItem[] = [{ s: 's', t: karthik + ' vs ' + selvi, v: 'v', d: '2026-01-01', y: 2026, n: '', c: '', g: '', r: '', di: '', w: 0 }];
    expect(filterMatches(items, { q: 'செல்வி' }).length).toBe(1);
    expect(filterMatches(items, { q: 'ா' }).length).toBe(0);
  });
});

describe('C2-1 redirects (_redirects)', () => {
  const players = [P('a', 'Arun Kumar'), P('b', 'Bala Murugan'), P('r', 'Ravi Siva', 'unknown', { slug: 'ravi-siva' })];
  const base = (over: Partial<RawArchive> = {}) => raw({ players, matches: [M('1', ['a'], ['b']), M('2', ['a'], ['r'], { slug: 'old-named-slug-0000' })], ...over });
  const aSlug = (a: ReturnType<typeof buildPublicArchive>) => a.players.find((p) => p.name === 'Arun Kumar')!.slug;

  it('writes 301 rules for provider redirects, flattened to the live page', () => {
    const r = base({ redirects: [{ from: '/players/old-arun/', to: '/players/older-arun/' }, { from: '/players/older-arun/', to: '/players/arun-kumar/' }] });
    const a = buildPublicArchive(r);
    expect(aSlug(a)).toBe('arun-kumar');
    const out = buildRedirects(a, r);
    expect(out.text).toContain('/players/old-arun/ /players/arun-kumar/ 301');
    expect(out.text).toContain('/players/older-arun/ /players/arun-kumar/ 301');
  });
  it('sends a protected player or match old slug to the opaque page and a removed one to the gone page', () => {
    const r = base({ gonePaths: ['/matches/removed-by-request-1234/'] });
    const a = buildPublicArchive(r);
    const out = buildRedirects(a, r);
    expect(out.text).toContain('/players/ravi-siva/ /players/player-r/ 301');
    expect(out.text).toMatch(/\/matches\/old-named-slug-0000\/ \/matches\/match-[a-z0-9]+\/ 301/);
    expect(out.text).toContain(`/matches/removed-by-request-1234/ ${GONE_PATH} 301`);
    // no rule target ever names a protected player
    for (const rule of out.rules) expect(rule.to).not.toMatch(/ravi/);
  });
  it('drops loops, invalid paths and rules that would take a live page down; dead targets become gone', () => {
    const r = base({
      redirects: [
        { from: '/players/x/', to: '/players/y/' },
        { from: '/players/y/', to: '/players/x/' },
        { from: '/players/arun-kumar/', to: '/players/bala-murugan/' },
        { from: '/Bad Path/', to: '/players/arun-kumar/' },
        { from: '/players/dead-target-owner/', to: '/players/never-built/' },
      ],
    });
    const out = buildRedirects(buildPublicArchive(r), r);
    expect(out.text).toContain(`/players/x/ ${GONE_PATH} 301`);
    expect(out.text).toContain(`/players/y/ ${GONE_PATH} 301`);
    expect(out.text).not.toContain('/players/arun-kumar/ ');
    expect(out.text).not.toContain('Bad Path');
    expect(out.text).toContain(`/players/dead-target-owner/ ${GONE_PATH} 301`);
    expect(out.skipped.length).toBeGreaterThan(0);
  });
  it('fails the build over the line limit (1,800) and says so', () => {
    const many = Array.from({ length: REDIRECTS_MAX_LINES + 1 }, (_, i) => ({ from: `/players/old-${i}/`, to: '/players/arun-kumar/' }));
    const r = base({ redirects: many });
    const out = buildRedirects(buildPublicArchive(r), r);
    expect(out.errors.join(' ')).toMatch(/1800/);
    expect(buildRedirects(buildPublicArchive(base()), base()).errors).toEqual([]);
  });
  it('the seed produces a valid file with the fictional rename and the opaque protected slugs', () => {
    const a = buildPublicArchive(seedArchive);
    const out = buildRedirects(a, seedArchive);
    expect(out.errors).toEqual([]);
    expect(out.text).toContain('/players/demo-selvi-old/ /players/demo-selvi-m/ 301');
    expect(out.text).toContain('/players/sample-ilan-v/ /players/player-p-u1/ 301');
    expect(out.text).toContain(`/players/trial-junior-mugil/ ${GONE_PATH} 301`);
    for (const line of out.text.split('\n').filter((l) => l && !l.startsWith('#'))) expect(line).toMatch(/^\/\S+ \/\S* 301$/);
  });
});

describe('S2-2 sponsor strip on protected pages', () => {
  const src = readFileSync(join(process.cwd(), 'src/components/site/SponsorStrip.astro'), 'utf8');
  const m = /const onArchivePage = (\/.*\/)\.test/.exec(src);
  it('the strip is not rendered under /players/ or /matches/ (minimal pages live there)', () => {
    expect(m).not.toBeNull();
    expect(src).toMatch(/\{!onArchivePage && \(/);
    const re = new RegExp(m![1]!.slice(1, -1));
    for (const p of ['/players/', '/players/player-p-u1/', '/matches/', '/matches/match-kem00006/', '/matches/gone/', '/players']) expect(re.test(p)).toBe(true);
    for (const p of ['/', '/services/', '/tournaments/', '/playersx/', '/about/']) expect(re.test(p)).toBe(false);
  });
});
