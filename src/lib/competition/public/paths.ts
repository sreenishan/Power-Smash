// Addresses of the public competition pages (platform wave 3). Always in the one canonical slash form through path() (R-LINKS);
// pages never write these by hand.
//
//   /competitions/                              every tournament with a public event
//   /competitions/rankings/                     published local rankings (not official BWF rankings)
//   /competitions/<tournament-slug>/            the events of one tournament
//   /competitions/<tournament-slug>/<event>/    entries, draw or groups, order of play and results of one event
//
// Why a family of its own and not /tournaments/<slug>/<event>/: a /tournaments/<slug>/ page exists only for an owner-entered tournament
// (src/content/tournaments.ts) or an archive tournament, and archive pages are left out of the release build (D-107). Competition data
// is owner-entered (migration 0017) and must not depend on the archive being built, so its breadcrumbs never point at a page that may
// not exist, and its output can be pruned on its own (COMPETITION_OUTPUT_PATHS in ../in-build.ts).
import { COMPETITION_ROUTES, competitionEventPath, competitionTournamentPath } from '../../urls';
import type { Category } from '../types';

// The addresses themselves live in src/lib/urls.ts (COMPETITION_ROUTES and the two helpers, all in the one slash form through path(),
// R-LINKS); they are re-exported here so the competition code has one import for addresses, slugs and event codes.
export { COMPETITION_ROUTES, competitionEventPath, competitionTournamentPath };

/** Tournament slugs that cannot be used under /competitions/ (fixed pages and words kept for later). */
export const RESERVED_COMPETITION_SLUGS: ReadonlySet<string> = new Set(['rankings', 'page', 'index', 'live']);

/** The tournament slug rule (spec 6.3): lowercase letters, digits and single hyphens, at most 80 characters. */
const SLUG_RE = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

export function isCompetitionTournamentSlug(slug: unknown): slug is string {
  return typeof slug === 'string' && slug.length <= 80 && SLUG_RE.test(slug) && !RESERVED_COMPETITION_SLUGS.has(slug);
}

const AGE_GROUP_CODE: Readonly<Record<string, string>> = { sub_junior: 'sub-junior' };

/**
 * The address code of an event from its category and age group: "ms", "ms-u17", "xd-35plus", "bs-sub-junior". The database keeps
 * (tournament, category, age group) unique (tournament_events_unique_idx), so the code is unique within a tournament. Null for a
 * value outside the vocabulary (the event is then left out rather than given a guessed address).
 */
export function eventCode(category: Category | string, ageGroup: string | null): string | null {
  if (typeof category !== 'string' || !/^[A-Z]{2}$/.test(category)) return null;
  const base = category.toLowerCase();
  if (ageGroup === null) return base;
  if (typeof ageGroup !== 'string') return null;
  const mapped = AGE_GROUP_CODE[ageGroup] ?? ageGroup.toLowerCase().replace(/\+$/, 'plus');
  if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(mapped)) return null;
  return `${base}-${mapped}`;
}
