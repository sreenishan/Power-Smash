// Pure helpers for /tournaments/[slug] (M2c-3, spec 7.7 "Past" view, D-098). One route serves two kinds of tournament: the owner-entered
// list (src/content/tournaments.ts) and the archive (tournaments read from YouTube titles, PublicArchive.tournaments). No Astro imports, so
// tests/archive/tournament-pages.test.ts runs them directly with fictional data.
import { formatDateRange } from '../dates';
import { categoryLabel, categoryRank, roundLabel, roundRank } from './labels';
import type { ArchiveMatch, ArchiveTournament } from './model';
import { RESERVED_TOURNAMENT_SLUGS, TOURNAMENT_SLUG_PATTERN } from './slugs';

export type TournamentRoute = { kind: 'owner'; slug: string; index: number } | { kind: 'archive'; slug: string; index: number };

/**
 * Every /tournaments/<slug>/ page of this build. Archive tournaments take part only when their pages are built. The archive model already
 * keeps archive slugs clear of owner slugs and reserved words, so any clash here is a bug: the build stops with a plain sentence instead of
 * one page silently replacing another.
 */
export function tournamentRoutes(
  owner: readonly { slug: string }[],
  archive: readonly Pick<ArchiveTournament, 'slug'>[],
  built: boolean,
): TournamentRoute[] {
  const routes: TournamentRoute[] = [
    ...owner.map((t, index) => ({ kind: 'owner' as const, slug: t.slug, index })),
    ...(built ? archive.map((t, index) => ({ kind: 'archive' as const, slug: t.slug, index })) : []),
  ];
  const seen = new Map<string, TournamentRoute['kind']>();
  for (const r of routes) {
    if (!TOURNAMENT_SLUG_PATTERN.test(r.slug)) throw new Error(`Tournament address "${r.slug}" is not a valid slug (lowercase letters, digits and hyphens).`);
    if (RESERVED_TOURNAMENT_SLUGS.has(r.slug)) throw new Error(`Tournament address "${r.slug}" is reserved for another page.`);
    const other = seen.get(r.slug);
    if (other) {
      throw new Error(
        other === r.kind
          ? `Tournament address clash: "${r.slug}" is used twice by ${r.kind === 'owner' ? 'the owner-entered list' : 'the archive'}.`
          : `Tournament address clash: "${r.slug}" is used by both an owner-entered tournament and an archive tournament. Rename one.`,
      );
    }
    seen.set(r.slug, r.kind);
  }
  return routes;
}

export interface MatchGroup {
  category: string | null;
  label: string;
  rounds: { round: string | null; label: string; matches: ArchiveMatch[] }[];
}

/**
 * A tournament page's matches grouped by category (CATEGORY_LABELS order, unknown codes next, no category last), then by round (Final
 * first, ROUND_ORDER), newest first inside a round. Only FULL matches ever appear: anything else is dropped here as a second line of
 * defence (the model already passes full matches only, D-012).
 */
export function groupTournamentMatches(matches: readonly ArchiveMatch[]): MatchGroup[] {
  const full = matches
    .filter((m) => m.kind === 'full')
    .sort(
      (a, b) =>
        categoryRank(a.category) - categoryRank(b.category) ||
        (a.category ?? '').localeCompare(b.category ?? '') ||
        roundRank(a.round) - roundRank(b.round) ||
        (a.round ?? '').localeCompare(b.round ?? '') ||
        (a.publishedAt < b.publishedAt ? 1 : a.publishedAt > b.publishedAt ? -1 : 0) ||
        (a.slug < b.slug ? -1 : a.slug > b.slug ? 1 : 0),
    );
  const groups: MatchGroup[] = [];
  for (const m of full) {
    let group = groups.at(-1);
    if (!group || group.category !== m.category) {
      group = { category: m.category, label: categoryLabel(m.category) ?? 'Other matches', rounds: [] };
      groups.push(group);
    }
    let round = group.rounds.at(-1);
    if (!round || round.round !== m.round) {
      round = { round: m.round, label: roundLabel(m.round) ?? 'Round not known', matches: [] };
      group.rounds.push(round);
    }
    round.matches.push(m);
  }
  return groups;
}

/**
 * "Most viewed on YouTube" (spec 7.7, D-077): a PLAIN sort by the video's own view count, nothing derived (D-016: no composite or
 * view-based scores, no totals). Matches without a count are left out; nothing is returned unless at least two matches have one.
 */
export function mostViewed(matches: readonly ArchiveMatch[], limit = 3): ArchiveMatch[] {
  const counted = matches.filter((m) => m.kind === 'full' && typeof m.views === 'number' && m.views > 0);
  if (counted.length < 2) return [];
  return [...counted].sort((a, b) => (b.views as number) - (a.views as number) || (a.slug < b.slug ? -1 : 1)).slice(0, limit);
}

/** "City, District" with the parts that exist, the district left out when it repeats the city (Madurai, Madurai). */
export function archiveTournamentPlace(t: Pick<ArchiveTournament, 'city' | 'district'>): string {
  const city = t.city?.trim() ?? '';
  const district = t.district?.trim() ?? '';
  return [city, district.toLowerCase() === city.toLowerCase() ? '' : district].filter((v) => v !== '').join(', ');
}

/** The meta description: facts only (name, dates, place, number of match videos). */
export function archiveTournamentDescription(t: Pick<ArchiveTournament, 'name' | 'startDate' | 'endDate' | 'city' | 'district' | 'matchCount'>): string {
  const when = t.startDate ? formatDateRange(t.startDate, t.endDate) : null;
  const place = archiveTournamentPlace(t);
  const videos = `${t.matchCount} match video${t.matchCount === 1 ? '' : 's'}`;
  return `${t.name}${when ? `, ${when}` : ''}${place ? `, ${place}` : ''}: ${videos} on Power Smash. Match details by Power Smash.`;
}
