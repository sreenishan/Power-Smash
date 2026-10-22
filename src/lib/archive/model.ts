// Turns the provider snapshot (RawArchive) into the PUBLIC model the pages render. This is the ONLY place that decides which player or
// match is public, and it applies protected.ts to everything (D-012). Pages and endpoints read nothing but a PublicArchive, so a
// protected player's name is simply not in the data they have.
//
// What a PublicArchive holds:
//  - `matches`: every match that gets a page (kind full, listed or minimal; `hidden` ones are dropped here and never leave this file);
//  - `grid`: the matches shown in lists, JSON and sitemaps (full and listed only, newest first);
//  - `players`: adult_confirmed players with at least one full match (a profile needs real content);
//  - `minimalPlayers`: unknown-age players when the setting asks for a minimal noindex page (name only);
//  - `tournaments`: public Tamil Nadu tournaments that have at least one public match.
// Pure and deterministic: `buildPublicArchive(raw)` has no clock and no network (the snapshot time is `raw.generatedAt`).

import { todayIst } from '../dates';
import {
  type ArchiveProvider,
  DEFAULT_ARCHIVE_SETTINGS,
  TOURNAMENT_PAGES_BUILT,
  type RawArchive,
  type RawMatch,
  type RawPlayer,
  type RawTournament,
} from './provider';
import { classifyMatch, effectiveAgeStatus, playerPageKind } from './protected';
import { includesAtBoundary, normaliseQuery } from './search';
import { assignMatchSlugs, assignPlayerSlugs, slugify } from './slugs';

export const PAGE_SIZE = 48;
export const RELATED_LIMIT = 6;

export interface PlayerRef {
  name: string;
  slug: string;
}

export interface MatchTournament {
  name: string;
  /** null = no tournament page to link to (see TOURNAMENT_PAGES_BUILT, or a non-Tamil-Nadu event). */
  slug: string | null;
  district: string | null;
  year: number | null;
}

export interface ArchiveMatch {
  kind: 'full' | 'listed' | 'minimal';
  id: string;
  slug: string;
  videoId: string;
  /** The title exactly as on YouTube (D-016). */
  rawTitle: string;
  publishedAt: string;
  /** IST calendar date, YYYY-MM-DD. */
  date: string;
  year: number;
  durationSeconds: number | null;
  views: number | null;
  /** null for a minimal match (nothing parsed is shown) and for a video with no tournament. */
  tournament: MatchTournament | null;
  /** Non-Tamil-Nadu event shown as "All India" (D-018). */
  allIndia: boolean;
  category: string | null;
  ageGroup: string | null;
  round: string | null;
  /** Adult players with a profile page, ONLY for a full match; always [] for listed and minimal. */
  sideA: PlayerRef[];
  sideB: PlayerRef[];
  /** YYYY-MM-DD for the sitemap. */
  lastmod: string;
  /** Slugs of related grid matches (full and listed only). */
  related: string[];
}

export interface ArchiveTournament {
  id: string;
  slug: string;
  name: string;
  year: number | null;
  city: string | null;
  district: string | null;
  level: string | null;
  startDate: string | null;
  matchCount: number;
  lastmod: string | null;
}

export interface PlayerLink extends PlayerRef {
  count: number;
}

export interface ArchivePlayer {
  id: string;
  slug: string;
  name: string;
  district: string | null;
  academy: string | null;
  matchCount: number;
  tournamentCount: number;
  firstDate: string;
  latestDate: string;
  categories: string[];
  years: number[];
  tournaments: { name: string; slug: string | null; count: number }[];
  /** Grid matches, newest first. */
  matches: ArchiveMatch[];
  /** Adult players with a page only. */
  partners: PlayerLink[];
  opponents: PlayerLink[];
  lastmod: string;
}

/** An unknown-age player's page. It deliberately carries NO name: the name is shown only where the raw YouTube title of a match shows it. */
export interface MinimalPlayer {
  id: string;
  /** Always opaque (`player-<id>`), whatever slug may have been stored. */
  slug: string;
}

/** A stored address that no longer names a live page: redirect (`to`) or answer gone (`to` null). Feeds redirects.ts. */
export interface SupersededPath {
  from: string;
  to: string | null;
}

export interface PublicArchive {
  source: 'seed' | 'supabase';
  generatedAt: string;
  matches: ArchiveMatch[];
  grid: ArchiveMatch[];
  players: ArchivePlayer[];
  minimalPlayers: MinimalPlayer[];
  tournaments: ArchiveTournament[];
  /** Stored slugs that were replaced or removed (protected slugs are opaque, hidden items are gone). */
  superseded: SupersededPath[];
  /** Counts for the page-budget guard and the notes. */
  dropped: { hiddenMatches: number; protectedPlayers: number; thinPlayers: number };
}

function byNewest(a: ArchiveMatch, b: ArchiveMatch): number {
  if (a.publishedAt !== b.publishedAt) return a.publishedAt < b.publishedAt ? 1 : -1;
  return a.slug < b.slug ? -1 : a.slug > b.slug ? 1 : 0;
}

function dateOf(instant: string): string {
  return todayIst(new Date(instant));
}

function lastmodOf(...instants: (string | null | undefined)[]): string {
  const valid = instants.filter((i): i is string => typeof i === 'string' && i !== '' && !Number.isNaN(new Date(i).getTime()));
  const latest = valid.sort().at(-1);
  return dateOf(latest ?? new Date(0).toISOString());
}

function tournamentSlugs(tournaments: readonly RawTournament[]): Map<string, string> {
  const out = new Map<string, string>();
  const taken = new Set<string>(['submit', 'page', 'index']);
  for (const t of tournaments) {
    if (t.slug) {
      out.set(t.id, t.slug);
      taken.add(t.slug);
    }
  }
  const fresh = tournaments.filter((t) => !t.slug).sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  for (const t of fresh) {
    // {name}-{year}-{city} (spec 6.3). The name usually holds the year already; add it only when it does not.
    const year = t.editionYear ? String(t.editionYear) : '';
    const nameSlug = slugify(t.name);
    const parts = [nameSlug, year && !nameSlug.includes(year) ? year : '', t.city ? slugify(t.city) : ''].filter(Boolean);
    const base = parts.join('-').replace(/-+/g, '-').slice(0, 80).replace(/-+$/, '') || 'tournament';
    let slug = base;
    for (let n = 2; taken.has(slug); n += 1) slug = `${base}-${n}`;
    taken.add(slug);
    out.set(t.id, slug);
  }
  return out;
}

export interface BuildOptions {
  /** Default: TOURNAMENT_PAGES_BUILT. */
  tournamentPagesBuilt?: boolean;
  source?: 'seed' | 'supabase';
}

export function buildPublicArchive(raw: RawArchive, options: BuildOptions = {}): PublicArchive {
  const settings = raw.settings ?? DEFAULT_ARCHIVE_SETTINGS;
  const tournamentPagesBuilt = options.tournamentPagesBuilt ?? TOURNAMENT_PAGES_BUILT;
  // Suppression by NAME (D-014, review S2-7): a tombstoned name hides the player AND every video whose raw title holds the name,
  // even when no player row is linked to that video.
  const suppressed = new Set((raw.suppressedNames ?? []).map(normaliseQuery).filter((n) => n !== ''));
  const isSuppressedName = (name: string): boolean => suppressed.has(normaliseQuery(name));
  const rawPlayers: RawPlayer[] = raw.players.map((p) => (isSuppressedName(p.displayName) ? { ...p, ageStatus: 'minor_confirmed' as const } : p));
  const rawMatches: RawMatch[] = raw.matches.map((m) => {
    const title = normaliseQuery(m.rawTitle);
    const hit = [...suppressed].some((n) => includesAtBoundary(title, n));
    return hit ? { ...m, visibility: 'hidden' as const } : m;
  });
  const playersById = new Map<string, RawPlayer>(rawPlayers.map((p) => [p.id, p]));
  const tournamentsById = new Map<string, RawTournament>(raw.tournaments.map((t) => [t.id, t]));
  const tSlug = tournamentSlugs(raw.tournaments);

  // 1) classify every match; drop hidden ones for good.
  const kept: { match: RawMatch; kind: 'full' | 'listed' | 'minimal' }[] = [];
  let hiddenMatches = 0;
  for (const match of rawMatches) {
    const kind = classifyMatch(match, playersById, tournamentsById, settings);
    if (kind === 'hidden') hiddenMatches += 1;
    else kept.push({ match, kind });
  }

  // 2) player pages: adult players need at least one full match.
  const fullMatchCount = new Map<string, number>();
  for (const { match, kind } of kept) {
    if (kind !== 'full') continue;
    for (const id of [...match.sideA, ...match.sideB]) fullMatchCount.set(id, (fullMatchCount.get(id) ?? 0) + 1);
  }
  const adultPlayers = rawPlayers.filter((p) => playerPageKind(p, settings) === 'full' && (fullMatchCount.get(p.id) ?? 0) > 0);
  const playerSlug = assignPlayerSlugs(adultPlayers);
  const adultById = new Map(adultPlayers.map((p) => [p.id, p]));
  const protectedPlayers = rawPlayers.filter((p) => effectiveAgeStatus(p) !== 'adult_confirmed').length;
  const thinPlayers = rawPlayers.filter((p) => playerPageKind(p, settings) === 'full' && !adultById.has(p.id)).length;

  // 3) match slugs: a name in the slug only for a full match; everything else is opaque.
  const refsOf = (ids: readonly string[]): PlayerRef[] =>
    ids.flatMap((id) => {
      const p = adultById.get(id);
      const slug = playerSlug.get(id);
      return p && slug ? [{ name: p.displayName, slug }] : [];
    });
  const matchSlug = assignMatchSlugs(
    kept.map(({ match, kind }) => ({
      id: match.id,
      videoId: match.videoId,
      slug: match.slug,
      opaque: kind !== 'full' || match.sideA.length === 0 || match.sideB.length === 0,
      sideA: kind === 'full' ? refsOf(match.sideA).map((r) => r.name) : [],
      sideB: kind === 'full' ? refsOf(match.sideB).map((r) => r.name) : [],
    })),
  );

  const matches: ArchiveMatch[] = kept.map(({ match, kind }) => {
    const t = match.tournamentId ? tournamentsById.get(match.tournamentId) : undefined;
    const parsedShown = kind !== 'minimal';
    const allIndia = kind === 'listed' && t !== undefined;
    return {
      kind,
      id: match.id,
      slug: matchSlug.get(match.id) as string,
      videoId: match.videoId,
      rawTitle: match.rawTitle,
      publishedAt: match.publishedAt,
      date: dateOf(match.publishedAt),
      year: Number(dateOf(match.publishedAt).slice(0, 4)),
      durationSeconds: match.durationSeconds ?? null,
      views: match.views ?? null,
      tournament:
        parsedShown && t
          ? {
              name: t.name,
              slug: kind === 'full' && t.visibility === 'public' && tournamentPagesBuilt ? (tSlug.get(t.id) ?? null) : null,
              district: kind === 'full' ? (t.district ?? null) : null,
              year: t.editionYear ?? null,
            }
          : null,
      allIndia,
      category: parsedShown ? (match.category ?? null) : null,
      ageGroup: parsedShown ? (match.ageGroup ?? null) : null,
      round: parsedShown ? (match.round ?? null) : null,
      sideA: kind === 'full' ? refsOf(match.sideA) : [],
      sideB: kind === 'full' ? refsOf(match.sideB) : [],
      lastmod: lastmodOf(match.publishedAt, match.updatedAt),
      related: [],
    };
  });
  matches.sort(byNewest);
  const grid = matches.filter((m) => m.kind !== 'minimal');
  const rawById = new Map(rawMatches.map((m) => [m.id, m]));

  // 4) related matches: same tournament (1 point) and shared players (2 points each), grid matches only.
  const byTournament = new Map<string, ArchiveMatch[]>();
  const byPlayer = new Map<string, ArchiveMatch[]>();
  const push = (map: Map<string, ArchiveMatch[]>, key: string, m: ArchiveMatch) => {
    const list = map.get(key);
    if (list) list.push(m);
    else map.set(key, [m]);
  };
  for (const m of grid) {
    const r = rawById.get(m.id);
    if (r?.tournamentId) push(byTournament, r.tournamentId, m);
    if (m.kind === 'full') for (const ref of [...m.sideA, ...m.sideB]) push(byPlayer, ref.slug, m);
  }
  for (const m of grid) {
    const r = rawById.get(m.id);
    const score = new Map<string, number>();
    const bump = (other: ArchiveMatch, by: number) => {
      if (other.slug !== m.slug) score.set(other.slug, (score.get(other.slug) ?? 0) + by);
    };
    if (r?.tournamentId) for (const o of byTournament.get(r.tournamentId) ?? []) bump(o, 1);
    for (const ref of [...m.sideA, ...m.sideB]) for (const o of byPlayer.get(ref.slug) ?? []) bump(o, 2);
    const order = new Map(grid.map((g, i) => [g.slug, i]));
    m.related = [...score.entries()]
      .sort((a, b) => b[1] - a[1] || (order.get(a[0]) ?? 0) - (order.get(b[0]) ?? 0))
      .slice(0, RELATED_LIMIT)
      .map(([slug]) => slug);
  }

  // 5) player profiles (adult only).
  const players: ArchivePlayer[] = adultPlayers
    .map((p): ArchivePlayer => {
      const slug = playerSlug.get(p.id) as string;
      const mine = grid.filter((m) => m.kind === 'full' && [...m.sideA, ...m.sideB].some((r) => r.slug === slug));
      const tourCount = new Map<string, { name: string; slug: string | null; count: number }>();
      const partner = new Map<string, PlayerLink>();
      const opponent = new Map<string, PlayerLink>();
      const bumpLink = (map: Map<string, PlayerLink>, ref: PlayerRef) => {
        const cur = map.get(ref.slug);
        if (cur) cur.count += 1;
        else map.set(ref.slug, { ...ref, count: 1 });
      };
      for (const m of mine) {
        if (m.tournament) {
          const key = m.tournament.name;
          const cur = tourCount.get(key);
          if (cur) cur.count += 1;
          else tourCount.set(key, { name: m.tournament.name, slug: m.tournament.slug, count: 1 });
        }
        const inA = m.sideA.some((r) => r.slug === slug);
        for (const ref of inA ? m.sideA : m.sideB) if (ref.slug !== slug) bumpLink(partner, ref);
        for (const ref of inA ? m.sideB : m.sideA) bumpLink(opponent, ref);
      }
      const dates = mine.map((m) => m.date).sort();
      const linkSort = (a: PlayerLink, b: PlayerLink) => b.count - a.count || (a.slug < b.slug ? -1 : 1);
      return {
        id: p.id,
        slug,
        name: p.displayName,
        district: p.district ?? null,
        academy: p.academy ?? null,
        matchCount: mine.length,
        tournamentCount: tourCount.size,
        firstDate: dates[0] as string,
        latestDate: dates.at(-1) as string,
        categories: [...new Set(mine.map((m) => m.category).filter((c): c is string => !!c))].sort(),
        years: [...new Set(mine.map((m) => m.year))].sort((a, b) => b - a),
        tournaments: [...tourCount.values()].sort((a, b) => b.count - a.count || (a.name < b.name ? -1 : 1)),
        matches: mine,
        partners: [...partner.values()].sort(linkSort),
        opponents: [...opponent.values()].sort(linkSort),
        lastmod: mine[0]?.lastmod ?? dateOf(raw.generatedAt),
      };
    })
    .sort((a, b) => (a.name.toLowerCase() < b.name.toLowerCase() ? -1 : a.name.toLowerCase() > b.name.toLowerCase() ? 1 : a.slug < b.slug ? -1 : 1));

  // 6) minimal player pages (unknown age, only when the setting asks for them).
  const minimalPlayers: MinimalPlayer[] = rawPlayers
    .filter((p) => playerPageKind(p, settings) === 'minimal')
    .map((p) => ({ id: p.id, slug: `player-${slugify(p.id) || 'x'}` }))
    .sort((a, b) => (a.slug < b.slug ? -1 : 1));

  // 7) tournaments: public Tamil Nadu ones with at least one grid match.
  const counts = new Map<string, { n: number; last: string[] }>();
  for (const { match, kind } of kept) {
    if (kind !== 'full' || !match.tournamentId) continue;
    const c = counts.get(match.tournamentId) ?? { n: 0, last: [] };
    c.n += 1;
    c.last.push(match.publishedAt);
    counts.set(match.tournamentId, c);
  }
  const tournaments: ArchiveTournament[] = raw.tournaments
    .filter((t) => t.visibility === 'public' && t.pageEligible !== false && counts.has(t.id))
    .map((t) => ({
      id: t.id,
      slug: tSlug.get(t.id) as string,
      name: t.name,
      year: t.editionYear ?? null,
      city: t.city ?? null,
      district: t.district ?? null,
      level: t.level ?? null,
      startDate: t.startDate ?? null,
      matchCount: counts.get(t.id)?.n ?? 0,
      lastmod: lastmodOf(t.updatedAt, ...(counts.get(t.id)?.last ?? [])),
    }))
        .sort((a, b) => {
      const sa = a.startDate ?? '';
      const sb = b.startDate ?? '';
      if (sa !== sb) return sa < sb ? 1 : -1; // newest first; undated last
      return a.slug < b.slug ? -1 : a.slug > b.slug ? 1 : 0;
    });

  // 8) stored addresses that no longer name a live page (redirects.ts turns these into rules).
  const superseded: SupersededPath[] = [];
  const minimalById = new Map(minimalPlayers.map((p) => [p.id, p.slug]));
  for (const m of rawMatches) {
    if (!m.slug) continue;
    const live = matches.find((x) => x.id === m.id);
    if (!live) superseded.push({ from: `/matches/${m.slug}/`, to: null });
    else if (live.slug !== m.slug) superseded.push({ from: `/matches/${m.slug}/`, to: `/matches/${live.slug}/` });
  }
  for (const p of rawPlayers) {
    if (!p.slug) continue;
    const live = playerSlug.get(p.id) ?? minimalById.get(p.id);
    if (!live) superseded.push({ from: `/players/${p.slug}/`, to: null });
    else if (live !== p.slug) superseded.push({ from: `/players/${p.slug}/`, to: `/players/${live}/` });
  }

  return {
    source: options.source ?? 'seed',
    generatedAt: raw.generatedAt,
    matches,
    grid,
    players,
    minimalPlayers,
    tournaments,
    superseded,
    dropped: { hiddenMatches, protectedPlayers, thinPlayers },
  };
}

/** Page `page` (1-based) of `items`; an out-of-range page is clamped. */
export function paginate<T>(items: readonly T[], page: number, size: number = PAGE_SIZE): { items: T[]; page: number; pages: number; total: number } {
  const pages = Math.max(1, Math.ceil(items.length / size));
  const p = Math.min(Math.max(1, Math.floor(page) || 1), pages);
  return { items: items.slice((p - 1) * size, p * size), page: p, pages, total: items.length };
}

/** Number of static list pages for `/matches/` (page 1) and `/matches/page/N/` (N >= 2). */
export function matchListPageCount(total: number, size: number = PAGE_SIZE): number {
  return Math.max(1, Math.ceil(total / size));
}

// --- loading (one snapshot per build) ----------------------------------------------------------------------------------------------

let cached: Promise<PublicArchive> | null = null;

/** The one snapshot of the public archive for this build. Provider chosen in select.ts. */
export function loadPublicArchive(): Promise<PublicArchive> {
  if (!cached) {
    cached = (async () => {
      const { selectArchiveProvider } = await import('./select');
      const provider: ArchiveProvider = selectArchiveProvider();
      const archive = buildPublicArchive(await provider.load(), { source: provider.id });
      const { assertPageBudget } = await import('./budget');
      assertPageBudget(archive);
      return archive;
    })();
  }
  return cached;
}

/** For tests: forget the memoised snapshot. */
export function resetPublicArchiveCache(): void {
  cached = null;
}
