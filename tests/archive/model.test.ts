import { describe, expect, it } from 'vitest';
import { buildPublicArchive, paginate, PAGE_SIZE } from '../../src/lib/archive/model';
import { classifyMatch, playerPageKind } from '../../src/lib/archive/protected';
import { DEFAULT_ARCHIVE_SETTINGS, type RawArchive, type RawMatch, type RawPlayer, type RawTournament } from '../../src/lib/archive/provider';
import { buildMatchIndex, buildSearchIndex } from '../../src/lib/archive/search';
import { matchSitemapUrls, playerSitemapUrls, sitemapIndexEntries, sitemapIndexXml, tournamentSitemapUrls, urlsetXml } from '../../src/lib/archive/sitemap';
import { protectedSeedNames, seedArchive, SEED_MATCHES } from '../../src/lib/archive/seed';

const ORIGIN = 'https://example.test';
const archive = buildPublicArchive(seedArchive);
const names = protectedSeedNames();

describe('seed shape', () => {
  it('is fictional and about the promised size', () => {
    expect(SEED_MATCHES.length).toBe(40);
    expect(seedArchive.players.length).toBe(12);
    expect(seedArchive.tournaments.length).toBe(5);
    expect(SEED_MATCHES.every((m) => m.videoId.startsWith('fake-') && m.videoId.length === 11)).toBe(true);
    const statuses = new Set(seedArchive.players.map((p) => p.ageStatus));
    expect(statuses).toEqual(new Set(['adult_confirmed', 'unknown', 'minor_confirmed', 'minor_suspected']));
  });
});

describe('classification (D-012, D-018)', () => {
  const players = new Map(seedArchive.players.map((p) => [p.id, p]));
  const tournaments = new Map(seedArchive.tournaments.map((t) => [t.id, t]));
  const kind = (m: Partial<RawMatch>, settings = DEFAULT_ARCHIVE_SETTINGS) =>
    classifyMatch({ sideA: [], sideB: [], ...m }, players, tournaments, settings);

  it('adult-only is full; unknown is minimal; minors are hidden', () => {
    expect(kind({ sideA: ['p-a1'], sideB: ['p-a3'], tournamentId: 't-1' })).toBe('full');
    expect(kind({ sideA: ['p-a1'], sideB: ['p-u1'], tournamentId: 't-1' })).toBe('minimal');
    expect(kind({ sideA: ['p-a1'], sideB: ['p-j1'], tournamentId: 't-1' })).toBe('hidden');
    expect(kind({ sideA: ['p-a1'], sideB: ['p-j2'], tournamentId: 't-1' })).toBe('hidden');
  });
  it('a minor beats an unknown in the same match', () => {
    expect(kind({ sideA: ['p-u1'], sideB: ['p-j1'], tournamentId: 't-1' })).toBe('hidden');
  });
  it('unknown_match_mode = hidden hides unknown matches', () => {
    expect(kind({ sideA: ['p-u1'], sideB: ['p-a1'], tournamentId: 't-1' }, { ...DEFAULT_ARCHIVE_SETTINGS, unknownMatchMode: 'hidden' })).toBe('hidden');
  });
  it('fails closed: a missing player is unknown, a dangling tournament is hidden', () => {
    expect(kind({ sideA: ['nobody'], sideB: ['p-a1'], tournamentId: 't-1' })).toBe('minimal');
    expect(kind({ tournamentId: 'nope' })).toBe('hidden');
  });
  it('a non-Tamil-Nadu event is listed, a hidden event is hidden, and protected players still win', () => {
    expect(kind({ tournamentId: 't-5' })).toBe('listed');
    expect(kind({ tournamentId: 't-5', sideA: ['p-j1'] })).toBe('hidden');
    expect(kind({ tournamentId: 't-5', sideA: ['p-u1'] })).toBe('minimal');
    const hiddenT: RawTournament = { id: 'h', name: 'Fake hidden', visibility: 'hidden' };
    expect(classifyMatch({ sideA: [], sideB: [], tournamentId: 'h' }, players, new Map([['h', hiddenT]]), DEFAULT_ARCHIVE_SETTINGS)).toBe('hidden');
  });
  it('a source that already says minimal is respected', () => {
    expect(kind({ pageMode: 'minimal' })).toBe('minimal');
  });
  it('player page kinds', () => {
    const p = (ageStatus: RawPlayer['ageStatus']) => ({ ageStatus });
    expect(playerPageKind(p('adult_confirmed'), DEFAULT_ARCHIVE_SETTINGS)).toBe('full');
    expect(playerPageKind(p('unknown'), DEFAULT_ARCHIVE_SETTINGS)).toBe('minimal');
    expect(playerPageKind(p('unknown'), { ...DEFAULT_ARCHIVE_SETTINGS, unknownMatchMode: 'hidden' })).toBe('none');
    expect(playerPageKind(p('minor_confirmed'), DEFAULT_ARCHIVE_SETTINGS)).toBe('none');
    expect(playerPageKind(p('minor_suspected'), DEFAULT_ARCHIVE_SETTINGS)).toBe('none');
    expect(playerPageKind({ ageStatus: 'adult_confirmed', hasProfile: false }, DEFAULT_ARCHIVE_SETTINGS)).toBe('none');
    expect(playerPageKind({ ageStatus: 'bogus' as never }, DEFAULT_ARCHIVE_SETTINGS)).toBe('minimal');
  });
});

describe('public model over the seed', () => {
  it('counts: 24 full, 8 listed, 4 minimal; 4 hidden minors dropped', () => {
    const count = (k: string) => archive.matches.filter((m) => m.kind === k).length;
    expect(count('full')).toBe(24);
    expect(count('listed')).toBe(8);
    expect(count('minimal')).toBe(4);
    expect(archive.matches.length).toBe(36);
    expect(archive.dropped.hiddenMatches).toBe(4);
    expect(archive.grid.length).toBe(32);
  });
  it('only adult players with a full match get a profile', () => {
    expect(archive.players.length).toBe(8);
    expect(archive.minimalPlayers.map((p) => p.slug)).toEqual(['player-p-u1', 'player-p-u2']);
    expect(JSON.stringify(archive.minimalPlayers)).not.toMatch(/Ilan|Tara/);
    expect(new Set(archive.players.map((p) => p.slug)).size).toBe(8);
  });
  it('listed (non-TN) matches have no tournament link, no sides, labelled All India', () => {
    const listed = archive.matches.filter((m) => m.kind === 'listed');
    expect(listed.every((m) => m.sideA.length === 0 && m.sideB.length === 0 && m.tournament?.slug === null && m.allIndia)).toBe(true);
  });
  it('a minimal match carries nothing parsed and an opaque slug', () => {
    for (const m of archive.matches.filter((x) => x.kind === 'minimal')) {
      expect(m.slug).toMatch(/^match-/);
      expect(m.tournament).toBeNull();
      expect(m.category).toBeNull();
      expect(m.ageGroup).toBeNull();
      expect(m.round).toBeNull();
      expect(m.sideA).toEqual([]);
      expect(m.related).toEqual([]);
    }
  });
  it('related lists never point at a minimal or missing match', () => {
    const grid = new Set(archive.grid.map((m) => m.slug));
    for (const m of archive.matches) for (const r of m.related) expect(grid.has(r)).toBe(true);
    expect(archive.grid.every((m) => m.related.length > 0)).toBe(true);
  });
  it('partner and opponent links name adult players with a page only', () => {
    const slugs = new Set(archive.players.map((p) => p.slug));
    for (const p of archive.players) for (const l of [...p.partners, ...p.opponents]) expect(slugs.has(l.slug)).toBe(true);
  });
  it('tournaments: only public Tamil Nadu ones', () => {
    expect(archive.tournaments.map((t) => t.name).sort()).toEqual([
      'Demo Corporate League 2026',
      'Fake District Open 2025',
      'Mock State Ranking 2025',
      'Sample Veterans Cup 2026',
    ]);
  });
  it('is deterministic', () => {
    expect(JSON.stringify(buildPublicArchive(seedArchive))).toBe(JSON.stringify(archive));
  });
});

describe('protected-player leakage matrix over the seed', () => {
  const hasName = (text: string) => names.filter((n) => text.includes(n));
  const slugBits = names.map((n) => n.toLowerCase().replace(/\s+/g, '-'));

  it('the protected names are real tokens to look for', () => {
    expect(names).toEqual(['Sample Ilan V', 'Sample Tara N', 'Trial Junior Mugil', 'Trial Junior Oviya']);
  });
  it('the search index never holds a protected name or slug', () => {
    const json = JSON.stringify(buildSearchIndex(archive));
    expect(hasName(json)).toEqual([]);
    for (const bit of slugBits) expect(json.toLowerCase()).not.toContain(bit);
    expect(buildSearchIndex(archive).players.length).toBe(8);
  });
  it('the match index (list JSON) holds no protected name: minimal matches are not in it', () => {
    const idx = buildMatchIndex(archive);
    expect(hasName(JSON.stringify(idx))).toEqual([]);
    expect(idx.items.length).toBe(32);
  });
  it('sitemaps hold no protected name, no minimal match and no hidden match', () => {
    const xml = [
      urlsetXml(matchSitemapUrls(archive, ORIGIN)),
      urlsetXml(playerSitemapUrls(archive, ORIGIN)),
      urlsetXml(tournamentSitemapUrls(archive, [], ORIGIN, true)),
      sitemapIndexXml(sitemapIndexEntries(archive, [], ORIGIN)),
    ].join('\n');
    expect(hasName(xml)).toEqual([]);
    for (const bit of slugBits) expect(xml.toLowerCase()).not.toContain(bit);
    for (const m of archive.matches.filter((x) => x.kind === 'minimal')) expect(xml).not.toContain(m.slug);
    expect(matchSitemapUrls(archive, ORIGIN).length).toBe(32);
    expect(playerSitemapUrls(archive, ORIGIN).length).toBe(8);
  });
  it('apart from the raw title of a minimal match, no part of the public model holds a protected name', () => {
    const stripped = {
      ...archive,
      matches: archive.matches.map((m) => (m.kind === 'minimal' ? { ...m, rawTitle: '' } : m)),
      superseded: [], // internal: holds OLD stored slugs as redirect sources, never rendered
    };
    expect(hasName(JSON.stringify(stripped))).toEqual([]);
  });
  it('every slug of a non-full match is name-free', () => {
    for (const m of archive.matches.filter((x) => x.kind !== 'full')) {
      for (const bit of slugBits) expect(m.slug).not.toContain(bit);
    }
  });
  it('with unknown_match_mode = hidden, no unknown player name appears even as a raw title', () => {
    const hidden = buildPublicArchive({ ...seedArchive, settings: { ...DEFAULT_ARCHIVE_SETTINGS, unknownMatchMode: 'hidden' } });
    expect(hasName(JSON.stringify(hidden))).toEqual([]);
    expect(hidden.minimalPlayers).toEqual([]);
    expect(hidden.matches.filter((m) => m.kind === 'minimal')).toEqual([]);
  });
  it('a player flipped to a minor status vanishes everywhere', () => {
    const flipped: RawArchive = {
      ...seedArchive,
      players: seedArchive.players.map((p) => (p.id === 'p-a3' ? { ...p, ageStatus: 'minor_suspected' as const } : p)),
    };
    const a = buildPublicArchive(flipped);
    const json = JSON.stringify([a.grid, a.players, a.tournaments, buildSearchIndex(a), buildMatchIndex(a)]);
    expect(json).not.toContain('Sample Arul T');
    expect(json).not.toContain('sample-arul-t');
    expect(a.matches.some((m) => m.rawTitle.includes('Sample Arul T'))).toBe(false);
    // the owner's profile text goes with the player (D-100)
    expect(JSON.stringify(a)).not.toMatch(/Sample Smash Academy|fictional left-handed/);
  });
  it('an adult profile carries the owner\'s academy and bio (D-100)', () => {
    const p = buildPublicArchive(seedArchive).players.find((x) => x.name === 'Sample Arul T');
    expect(p).toMatchObject({ academy: 'Sample Smash Academy', bio: 'A fictional left-handed doubles player.\nSample text for the preview only.' });
  });
});

describe('pagination', () => {
  const items = Array.from({ length: 100 }, (_, i) => i);
  it('splits into pages of 48 and clamps', () => {
    expect(PAGE_SIZE).toBe(48);
    expect(paginate(items, 1).items.length).toBe(48);
    expect(paginate(items, 3).items.length).toBe(4);
    expect(paginate(items, 3).pages).toBe(3);
    expect(paginate(items, 99).page).toBe(3);
    expect(paginate(items, 0).page).toBe(1);
    expect(paginate([], 1)).toEqual({ items: [], page: 1, pages: 1, total: 0 });
  });
});
