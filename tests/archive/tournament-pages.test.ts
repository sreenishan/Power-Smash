// Archive tournament pages (M2c-3, D-098): which tournaments get a page (D-013), what a page lists (FULL matches only, D-012), how archive
// and owner-entered tournaments share /tournaments/<slug>/ without clashing, and the page helpers. FICTIONAL data only.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { buildPublicArchive, type ArchiveMatch } from '../../src/lib/archive/model';
import { DEFAULT_ARCHIVE_SETTINGS, type RawArchive, type RawMatch, type RawPlayer, type RawTournament } from '../../src/lib/archive/provider';
import { livePaths } from '../../src/lib/archive/redirects';
import { seedArchive } from '../../src/lib/archive/seed';
import { tournamentSitemapUrls } from '../../src/lib/archive/sitemap';
import { archiveTournamentDescription, archiveTournamentPlace, groupTournamentMatches, mostViewed, tournamentRoutes } from '../../src/lib/archive/tournament-page';

const P = (id: string, name: string, ageStatus: RawPlayer['ageStatus'] = 'adult_confirmed'): RawPlayer => ({ id, displayName: name, ageStatus });
const players = [P('a', 'Demo Arun'), P('b', 'Demo Bala'), P('u', 'Demo Unknown', 'unknown'), P('k', 'Demo Kid', 'minor_confirmed')];
let n = 0;
const M = (tournamentId: string, a = ['a'], b = ['b'], extra: Partial<RawMatch> = {}): RawMatch => {
  n += 1;
  return {
    id: `m${n}`,
    videoId: `fake-v${String(n).padStart(6, '0')}`,
    rawTitle: `Demo match ${n} | Fake Cup`,
    publishedAt: `2026-01-${String((n % 28) + 1).padStart(2, '0')}T06:00:00Z`,
    tournamentId,
    sideA: a,
    sideB: b,
    ...extra,
  };
};
const T = (id: string, extra: Partial<RawTournament> = {}): RawTournament => ({ id, name: `Fake Cup ${id}`, editionYear: 2026, city: 'Madurai', visibility: 'public', ...extra });
const raw = (tournaments: RawTournament[], matches: RawMatch[]): RawArchive => ({ players, tournaments, matches, settings: DEFAULT_ARCHIVE_SETTINGS, generatedAt: '2026-10-20T00:00:00Z' });
const build = (r: RawArchive, ownerTournamentSlugs: string[] = [], tournamentPagesBuilt = true) =>
  buildPublicArchive(r, { ownerTournamentSlugs, tournamentPagesBuilt });
const times = <X>(k: number, f: () => X): X[] => Array.from({ length: k }, f);

describe('which archive tournaments get a page (D-013, D-018)', () => {
  it('without a source flag: 3 or more FULL matches; 2 is not enough', () => {
    const a = build(raw([T('t3'), T('t2')], [...times(3, () => M('t3')), ...times(2, () => M('t2'))]));
    expect(a.tournaments.map((t) => t.id)).toEqual(['t3']);
    // a match of the 2-match tournament does not link to a page that does not exist
    expect(a.matches.filter((m) => m.tournament?.name === 'Fake Cup t2').every((m) => m.tournament?.slug === null)).toBe(true);
    expect(a.matches.filter((m) => m.tournament?.name === 'Fake Cup t3').every((m) => m.tournament?.slug === a.tournaments[0]?.slug)).toBe(true);
  });

  it('the source flag decides when present: true with one match qualifies, false never does', () => {
    const a = build(raw([T('yes', { pageEligible: true }), T('no', { pageEligible: false })], [M('yes'), ...times(5, () => M('no'))]));
    expect(a.tournaments.map((t) => t.id)).toEqual(['yes']);
  });

  it('non-Tamil-Nadu (listed) and hidden tournaments never get a page, however many matches', () => {
    const a = build(
      raw([T('listed', { visibility: 'listed_no_player_pages', pageEligible: true }), T('hidden', { visibility: 'hidden', pageEligible: true })], [
        ...times(5, () => M('listed')),
        ...times(5, () => M('hidden')),
      ]),
    );
    expect(a.tournaments).toEqual([]);
    expect(a.matches.every((m) => m.tournament?.slug == null)).toBe(true);
  });

  it('minimal and hidden matches never count towards the fallback and never appear on the page', () => {
    // 2 full + 2 with an unknown-age player (minimal) + 2 with a minor (hidden): only 2 full, so no page without the flag
    const r = raw([T('t')], [...times(2, () => M('t')), ...times(2, () => M('t', ['a'], ['u'])), ...times(2, () => M('t', ['a'], ['k']))]);
    expect(build(r).tournaments).toEqual([]);
    // with the flag (the database counted it eligible) the page lists the 2 FULL matches only
    const flagged = build({ ...r, tournaments: [T('t', { pageEligible: true })] });
    const page = flagged.tournaments[0]!;
    expect(page.matchCount).toBe(2);
    const bySlug = new Map(flagged.matches.map((m) => [m.slug, m]));
    expect(page.matchSlugs.map((s) => bySlug.get(s)?.kind)).toEqual(['full', 'full']);
    expect(page.matchSlugs.some((s) => s.startsWith('match-'))).toBe(false);
  });

  it('lists its full matches newest first and carries the end date', () => {
    const a = build(raw([T('t', { startDate: '2026-01-01', endDate: '2026-01-03' })], times(3, () => M('t'))));
    const t = a.tournaments[0]!;
    expect(t.endDate).toBe('2026-01-03');
    const dates = t.matchSlugs.map((s) => a.matches.find((m) => m.slug === s)!.publishedAt);
    expect([...dates].sort().reverse()).toEqual(dates);
  });
});

describe('addresses: archive and owner-entered tournaments never clash (D-098)', () => {
  it('a fresh archive slug steps aside for an owner slug', () => {
    const a = build(raw([T('t', { name: 'Fake Open 2026' })], times(3, () => M('t'))), ['fake-open-2026-madurai']);
    expect(a.tournaments[0]?.slug).toBe('fake-open-2026-madurai-2');
    expect(a.dropped.tournamentSlugConflicts).toBe(0);
  });

  it('a stored archive slug that is an owner slug, reserved or malformed is replaced and counted', () => {
    const ts = [T('o', { slug: 'owner-cup' }), T('r', { slug: 'submit' }), T('x', { slug: 'Bad Slug!' }), T('k', { slug: 'kept-cup' })];
    const a = build(raw(ts, ts.flatMap((t) => times(3, () => M(t.id)))), ['owner-cup']);
    // nothing is dropped: all four still have a page, the three conflicting ones under a new, valid, unreserved, unique address
    expect(a.tournaments.map((t) => t.id).sort()).toEqual(['k', 'o', 'r', 'x']);
    const slugs = new Map(a.tournaments.map((t) => [t.id, t.slug]));
    expect(slugs.get('k')).toBe('kept-cup');
    for (const id of ['o', 'r', 'x']) {
      const s = slugs.get(id);
      expect(s).toMatch(/^[a-z0-9]+(?:-[a-z0-9]+)*$/);
      expect(['owner-cup', 'submit', 'page', 'index', 'Bad Slug!', 'kept-cup']).not.toContain(s);
    }
    expect(new Set(slugs.values()).size).toBe(4);
    expect(() => tournamentRoutes([{ slug: 'owner-cup' }], a.tournaments, true)).not.toThrow();
    expect(a.dropped.tournamentSlugConflicts).toBe(3);
  });

  it('a player profile lists each tournament EDITION once, even when two editions share a name', () => {
    const ts = [
      T('ed2025', { name: 'Fake District Open', editionYear: 2025, city: 'Madurai' }),
      T('ed2026', { name: 'Fake District Open', editionYear: 2026, city: 'Salem' }),
    ];
    const a = build(raw(ts, [...times(3, () => M('ed2025')), ...times(3, () => M('ed2026'))]));
    const pages = new Map(a.tournaments.map((t) => [t.id, t.slug]));
    expect(pages.size).toBe(2);
    const arun = a.players.find((p) => p.name === 'Demo Arun')!;
    expect(arun.tournamentCount).toBe(2);
    expect(arun.tournaments.map((t) => [t.slug, t.count]).sort()).toEqual([
      [pages.get('ed2025'), 3],
      [pages.get('ed2026'), 3],
    ].sort());
  });

  it('tournamentRoutes joins the lists and stops the build on any clash', () => {
    expect(tournamentRoutes([{ slug: 'owner-cup' }], [{ slug: 'video-cup' }], true)).toEqual([
      { kind: 'owner', slug: 'owner-cup', index: 0 },
      { kind: 'archive', slug: 'video-cup', index: 0 },
    ]);
    expect(tournamentRoutes([{ slug: 'owner-cup' }], [{ slug: 'video-cup' }], false)).toEqual([{ kind: 'owner', slug: 'owner-cup', index: 0 }]);
    expect(() => tournamentRoutes([{ slug: 'same-cup' }], [{ slug: 'same-cup' }], true)).toThrow(/both an owner-entered tournament and an archive tournament/);
    expect(() => tournamentRoutes([{ slug: 'a-cup' }, { slug: 'a-cup' }], [], true)).toThrow(/used twice/);
    expect(() => tournamentRoutes([], [{ slug: 'submit' }], true)).toThrow(/reserved/);
    expect(() => tournamentRoutes([], [{ slug: 'Not OK' }], true)).toThrow(/not a valid slug/);
  });

  it('the sitemap fails on a duplicate address instead of dropping a page', () => {
    const owner = [{ slug: 'cup-a', startDate: '2026-01-01', endDate: null }];
    expect(() => tournamentSitemapUrls({ tournaments: [{ slug: 'cup-a', lastmod: null } as never] }, owner, 'https://example.test', true)).toThrow(/duplicate/);
    expect(tournamentSitemapUrls({ tournaments: [{ slug: 'cup-b', lastmod: '2026-02-01' } as never] }, owner, 'https://example.test', true).map((u) => u.loc)).toEqual([
      'https://example.test/tournaments/cup-a/',
      'https://example.test/tournaments/cup-b/',
    ]);
  });

  it('redirects may point at archive tournament pages (when built) and at owner tournament pages', () => {
    const a = build(raw([T('t', { slug: 'video-cup' })], times(3, () => M('t'))));
    const live = livePaths(a, true, ['owner-cup']);
    expect(live.has('/tournaments/video-cup/')).toBe(true);
    expect(live.has('/tournaments/owner-cup/')).toBe(true);
    expect(livePaths(a, false, []).has('/tournaments/video-cup/')).toBe(false);
  });
});

describe('page helpers', () => {
  const card = (over: Partial<ArchiveMatch>): ArchiveMatch => ({
    kind: 'full',
    id: 'x',
    slug: 'x',
    videoId: 'fake-v000000',
    rawTitle: 'Demo',
    publishedAt: '2026-01-01T00:00:00Z',
    date: '2026-01-01',
    year: 2026,
    durationSeconds: null,
    views: null,
    tournament: null,
    allIndia: false,
    category: null,
    ageGroup: null,
    round: null,
    sideA: [],
    sideB: [],
    lastmod: '2026-01-01',
    related: [],
    ...over,
  });

  it('groups by category (label order, unknown codes, none last), then round (Final first), newest first', () => {
    const ms = [
      card({ slug: 'ws-f', category: 'WS', round: 'F' }),
      card({ slug: 'ms-qf', category: 'MS', round: 'QF' }),
      card({ slug: 'ms-f-old', category: 'MS', round: 'F', publishedAt: '2026-01-01T00:00:00Z' }),
      card({ slug: 'ms-f-new', category: 'MS', round: 'F', publishedAt: '2026-01-02T00:00:00Z' }),
      card({ slug: 'none', category: null, round: null }),
      card({ slug: 'odd', category: 'ZZ', round: 'R9' }),
      card({ slug: 'hidden-kind', kind: 'minimal', category: 'MS', round: 'F' }),
    ];
    const groups = groupTournamentMatches(ms);
    expect(groups.map((g) => g.label)).toEqual(["Men's singles", "Women's singles", 'ZZ', 'Other matches']);
    expect(groups[0]!.rounds.map((r) => [r.label, r.matches.map((m) => m.slug)])).toEqual([
      ['Final', ['ms-f-new', 'ms-f-old']],
      ['Quarter-final', ['ms-qf']],
    ]);
    expect(groups.at(-1)!.rounds[0]!.label).toBe('Round not known');
    expect(groups.flatMap((g) => g.rounds.flatMap((r) => r.matches.map((m) => m.slug)))).not.toContain('hidden-kind');
  });

  it('"Most viewed" is a plain sort by the video\'s own count, only with at least two counted', () => {
    expect(mostViewed([card({ slug: 'a', views: 500 }), card({ slug: 'b', views: null }), card({ slug: 'c', views: 0 })])).toEqual([]);
    const top = mostViewed([1, 9, 5, 7].map((v, i) => card({ slug: `m${i}`, views: v })));
    expect(top.map((m) => m.views)).toEqual([9, 7, 5]);
    expect(mostViewed([card({ slug: 'p', views: 10, kind: 'listed' }), card({ slug: 'q', views: 20, kind: 'listed' })])).toEqual([]);
  });

  it('names the place once when the district repeats the city', () => {
    expect(archiveTournamentPlace({ city: 'Madurai', district: 'Madurai' })).toBe('Madurai');
    expect(archiveTournamentPlace({ city: 'Hosur', district: ' krishnagiri ' })).toBe('Hosur, krishnagiri');
    expect(archiveTournamentPlace({ city: null, district: 'Salem' })).toBe('Salem');
    expect(archiveTournamentPlace({ city: null, district: null })).toBe('');
  });

  it('describes the page with facts only', () => {
    expect(archiveTournamentDescription({ name: 'Fake Cup', startDate: '2026-03-01', endDate: '2026-03-02', city: 'Madurai', district: null, matchCount: 1 })).toBe(
      'Fake Cup, 1–2 March 2026, Madurai: 1 match video on Power Smash. Match details by Power Smash.',
    );
    expect(archiveTournamentDescription({ name: 'Fake Cup', startDate: null, endDate: null, city: null, district: null, matchCount: 4 })).toBe(
      'Fake Cup: 4 match videos on Power Smash. Match details by Power Smash.',
    );
  });
});

describe('the fictional seed', () => {
  it('builds exactly the four public Tamil Nadu tournaments, each with its full matches only', () => {
    const a = buildPublicArchive(seedArchive, { ownerTournamentSlugs: [], tournamentPagesBuilt: true });
    const got = Object.fromEntries(a.tournaments.map((t) => [t.slug, t.matchCount]));
    expect(got).toEqual({
      'fake-district-open-2025-madurai': 8,
      'mock-state-ranking-2025-chennai': 4,
      'sample-veterans-cup-2026-coimbatore': 8,
      'demo-corporate-league-2026-salem': 4,
    });
    const bySlug = new Map(a.matches.map((m) => [m.slug, m]));
    for (const t of a.tournaments) for (const s of t.matchSlugs) expect(bySlug.get(s)?.kind).toBe('full');
  });
});

describe('ArchiveTournamentPage.astro (source guard, like the owner page)', () => {
  const src = readFileSync(join(process.cwd(), 'src/components/archive/ArchiveTournamentPage.astro'), 'utf8');
  const code = src
    .split(/\r?\n/)
    .filter((line) => !line.trimStart().startsWith('//'))
    .join('\n');

  it('lists matches only through groupTournamentMatches and mostViewed (full matches only) and keeps the sample notice', () => {
    expect(code).toContain('groupTournamentMatches(matches)');
    expect(code).toContain('mostViewed(matches)');
    expect(code).toContain('<ArchiveSeedNotice source={source} />');
    expect(code).toContain('by Power Smash');
  });

  it('injects no raw HTML and builds no address by hand', () => {
    expect(code).not.toMatch(/set:html|innerHTML|dangerouslySetInnerHTML/);
    expect(code).not.toMatch(/['"`]\/tournaments\/\$\{|['"`]\/matches\/\$\{|['"`]\/players\/\$\{/);
  });
});
