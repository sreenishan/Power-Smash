// Search and filter for the archive (D-010): two prebuilt JSON files and pure functions shared by the build and the tiny client scripts.
//
//  - search-index.json: ONLY adult_confirmed players (with a profile page) and tournaments. A protected or unknown-age player is never in it.
//    Entries are compact arrays to keep the file small: players [name, normalised, slug], tournaments [name, normalised, year, city, slug|null].
//  - matches/index.json: the list shown on /matches (full and listed matches only; a minimal match is not in it), for client-side filters.
//
// Pure functions, unit-tested in tests/archive/search.test.ts. No dependency: the matcher is a small prefix/substring scorer.

import { ageGroupLabel, categoryLabel, roundLabel } from './labels';
import type { ArchiveMatch, PublicArchive } from './model';
import { TOURNAMENT_PAGES_BUILT } from './provider';
import { slugify } from './slugs';

export const SEARCH_INDEX_VERSION = 1;

/**
 * Lowercase, accent-free, single spaces. Works for Latin AND Tamil script:
 *  - NFKD, then only the Latin combining accents (U+0300 to U+036F) are dropped, then NFC again, so two-part Tamil vowel signs compose
 *    the same way whether the text was typed, pasted or stored decomposed;
 *  - zero-width joiners are removed;
 *  - letters, combining marks (Tamil vowel signs and the virama are marks) and digits are kept; everything else becomes a space.
 */
export function normaliseQuery(text: string): string {
  return text
    .normalize('NFKD')
    .replace(/[\u0300-\u036f\u200b-\u200d\ufeff]/g, '')
    .normalize('NFC')
    .toLowerCase()
    .replace(/[^\p{L}\p{M}\p{N}]+/gu, ' ')
    .trim();
}

const MARK = /^\p{M}/u;

/** True when `index` is the start of a grapheme: not in the middle of a letter plus vowel sign or virama cluster. */
function atBoundary(text: string, index: number): boolean {
  if (index <= 0 || index >= text.length) return true;
  return !MARK.test(text.charAt(index));
}

/** Substring match that only starts at a grapheme boundary (so "ா" alone never matches inside "கா"). */
export function includesAtBoundary(haystack: string, needle: string): boolean {
  if (needle === '' || MARK.test(needle)) return false;
  let from = 0;
  for (;;) {
    const i = haystack.indexOf(needle, from);
    if (i === -1) return false;
    if (atBoundary(haystack, i)) return true;
    from = i + 1;
  }
}

export type PlayerEntry = [name: string, normalised: string, slug: string];
export type TournamentEntry = [name: string, normalised: string, year: number | null, city: string | null, slug: string | null];

export interface SearchIndex {
  v: typeof SEARCH_INDEX_VERSION;
  players: PlayerEntry[];
  tournaments: TournamentEntry[];
}

export function buildSearchIndex(archive: Pick<PublicArchive, 'players' | 'tournaments'>, tournamentPagesBuilt: boolean = TOURNAMENT_PAGES_BUILT): SearchIndex {
  return {
    v: SEARCH_INDEX_VERSION,
    // `archive.players` already holds adult_confirmed players with a profile page and nobody else (model.ts).
    players: archive.players.map((p): PlayerEntry => [p.name, normaliseQuery(p.name), p.slug]),
    tournaments: archive.tournaments.map((t): TournamentEntry => [t.name, normaliseQuery(t.name), t.year, t.city, tournamentPagesBuilt ? t.slug : null]),
  };
}

export interface SearchHit {
  kind: 'player' | 'tournament';
  name: string;
  /** Page address (with trailing slash) or null when the page does not exist. */
  href: string | null;
  detail: string | null;
}

function score(normalised: string, terms: readonly string[]): number {
  let total = 0;
  const words = normalised.split(' ');
  for (const term of terms) {
    if (words.some((w) => w.startsWith(term))) total += 2;
    else if (includesAtBoundary(normalised, term)) total += 1;
    else return 0; // every term must match somewhere
  }
  return total;
}

/** Players and tournaments matching every word of `query`, best first, at most `limit`. */
export function searchIndex(index: SearchIndex, query: string, limit = 8): SearchHit[] {
  const terms = normaliseQuery(query).split(' ').filter(Boolean);
  if (terms.length === 0) return [];
  const hits: { hit: SearchHit; score: number }[] = [];
  for (const [name, norm, slug] of index.players) {
    const s = score(norm, terms);
    if (s > 0) hits.push({ score: s, hit: { kind: 'player', name, href: `/players/${slug}/`, detail: null } });
  }
  for (const [name, norm, year, city, slug] of index.tournaments) {
    const s = score(norm, terms);
    if (s > 0) hits.push({ score: s, hit: { kind: 'tournament', name, href: slug ? `/tournaments/${slug}/` : null, detail: [city, year].filter(Boolean).join(', ') || null } });
  }
  return hits
    .sort((a, b) => b.score - a.score || (a.hit.name < b.hit.name ? -1 : a.hit.name > b.hit.name ? 1 : 0))
    .slice(0, limit)
    .map((h) => h.hit);
}

// --- the match list index -----------------------------------------------------------------------------------------------------------

/** One list entry. Short keys keep the JSON small (about 1,900 videos is well under 300 KB). */
export interface MatchItem {
  /** slug */ s: string;
  /** raw title, exactly as YouTube has it */ t: string;
  /** video id (a thumbnail is shown only when the legal switch for YouTube images is on) */ v: string;
  /** IST date YYYY-MM-DD */ d: string;
  /** year */ y: number;
  /** tournament name or "" */ n: string;
  /** category code or "" */ c: string;
  /** age group code or "" */ g: string;
  /** round code or "" */ r: string;
  /** district or "" */ di: string;
  /** stored view count or 0 (a plain number; never turned into a score) */ w: number;
}

export interface MatchIndex {
  v: typeof SEARCH_INDEX_VERSION;
  items: MatchItem[];
}

export function matchItem(m: ArchiveMatch): MatchItem {
  return {
    s: m.slug,
    t: m.rawTitle,
    v: m.videoId,
    d: m.date,
    y: m.year,
    n: m.tournament?.name ?? '',
    c: m.category ?? '',
    g: m.ageGroup ?? '',
    r: m.round ?? '',
    di: m.tournament?.district ?? '',
    w: m.views ?? 0,
  };
}

/** Only grid matches (full and listed). `archive.grid` never holds a minimal match. */
export function buildMatchIndex(archive: Pick<PublicArchive, 'grid'>): MatchIndex {
  return { v: SEARCH_INDEX_VERSION, items: archive.grid.filter((m) => m.kind !== 'minimal').map(matchItem) };
}

export interface MatchFilters {
  year?: string;
  tournament?: string;
  category?: string;
  ageGroup?: string;
  round?: string;
  district?: string;
  /** free text over the raw title */
  q?: string;
}
export type MatchSort = 'newest' | 'views';

export function filterMatches(items: readonly MatchItem[], filters: MatchFilters, sort: MatchSort = 'newest'): MatchItem[] {
  const terms = normaliseQuery(filters.q ?? '').split(' ').filter(Boolean);
  const out = items.filter(
    (i) =>
      (!filters.year || String(i.y) === filters.year) &&
      (!filters.tournament || i.n === filters.tournament) &&
      (!filters.category || i.c === filters.category) &&
      (!filters.ageGroup || i.g === filters.ageGroup) &&
      (!filters.round || i.r === filters.round) &&
      (!filters.district || i.di === filters.district) &&
      (terms.length === 0 || terms.every((term) => includesAtBoundary(normaliseQuery(i.t), term))),
  );
  return out.sort((a, b) => (sort === 'views' ? b.w - a.w : 0) || (a.d < b.d ? 1 : a.d > b.d ? -1 : a.s < b.s ? -1 : 1));
}

export interface FilterOption {
  value: string;
  label: string;
}
export interface FilterOptions {
  years: FilterOption[];
  tournaments: FilterOption[];
  categories: FilterOption[];
  ageGroups: FilterOption[];
  rounds: FilterOption[];
  districts: FilterOption[];
}

const ROUND_ORDER = ['F', 'SF', 'QF', 'R16', 'R32', 'R64', 'R128', '3P', 'group', 'league'];
const roundRank = (v: string): number => {
  const i = ROUND_ORDER.indexOf(v);
  return i < 0 ? 99 : i;
};

/** The values present in `items`, as option lists for the filter form. */
export function filterOptions(items: readonly MatchItem[]): FilterOptions {
  const uniq = (pick: (i: MatchItem) => string) => [...new Set(items.map(pick).filter((v) => v !== ''))];
  const opts = (values: string[], label: (v: string) => string): FilterOption[] => values.map((value) => ({ value, label: label(value) }));
  const sortText = (a: FilterOption, b: FilterOption) => (a.label < b.label ? -1 : a.label > b.label ? 1 : 0);
  return {
    years: opts(uniq((i) => String(i.y)).sort().reverse(), (v) => v),
    tournaments: opts(uniq((i) => i.n), (v) => v).sort(sortText),
    categories: opts(uniq((i) => i.c), (v) => categoryLabel(v) ?? v).sort(sortText),
    ageGroups: opts(uniq((i) => i.g), (v) => ageGroupLabel(v) ?? v).sort(sortText),
    rounds: opts(uniq((i) => i.r).sort((a, b) => roundRank(a) - roundRank(b)), (v) => roundLabel(v) ?? v),
    districts: opts(uniq((i) => i.di), (v) => v).sort(sortText),
  };
}

/** Grouping letter of a name for the A-Z directory: A-Z for Latin names, "#" for everything else (Tamil, digits). */
export function azLetter(name: string): string {
  const first = slugify(name).charAt(0).toUpperCase();
  return /^[A-Z]$/.test(first) ? first : '#';
}
