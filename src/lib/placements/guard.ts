// Which sponsor slots a page may carry (D-031, D-016, D-012). PURE: the page component asks this at build time, and the beacon
// endpoint asks `slotAllowedOnPath` as a second line of defence.
//
// Rules, in order:
//  1. A protected page (a player who is not `adult_confirmed`, or any page that names one, and every noindex minimal page) carries
//     NO slot and therefore NO beacon (D-031 "Protected pages carry no placement and no beacon").
//  2. A page without real independent content carries no slot (D-016, YouTube III.G.1.d): the caller states it per page.
//  3. The match-page banner needs the owner's setting (off by default, D-035 row 2).
//  4. Pages that are not content pages (legal, error, form and admin pages) carry no slot.
//  5. At most ONE banner per page (spec 8.3 "at most one banner above the fold"); strips and the coverage title are not banners.
import { SLOTS } from './slots';
import type { SlotKey } from './slots';

export type PageKind = 'home' | 'players_index' | 'player' | 'matches_index' | 'match' | 'tournaments_index' | 'tournament' | 'gear' | 'other';

export interface PageContext {
  kind: PageKind;
  /** True when the page is, or names, a protected player, or is a noindex minimal page. Unknown = treat as protected. */
  isProtected: boolean;
  /** True when the page is noindex (a minimal page): treated exactly like a protected page. */
  isNoindex?: boolean;
  /** True when the page carries real independent content of its own (D-016). */
  hasIndependentContent: boolean;
  /** The owner has switched the match-page banner on (default false). */
  matchBannerEnabled?: boolean;
  /** Tournament pages only: the owner has marked the tournament as coverage with a coverage-sponsor slot. */
  coverageSponsorSlot?: boolean;
}

export type GuardReason = 'protected' | 'no_independent_content' | 'not_a_content_page' | 'setting_off' | 'slot_not_on_this_page' | 'unavailable_in_phase_1' | 'ok';

export interface GuardResult {
  allowed: boolean;
  reason: GuardReason;
}

const CONTENT_KINDS: readonly PageKind[] = ['home', 'players_index', 'player', 'matches_index', 'match', 'tournaments_index', 'tournament', 'gear'];

/** Can this slot appear on this page? */
export function checkSlotOnPage(page: PageContext, slot: SlotKey): GuardResult {
  // Fail closed: anything that is not exactly `false` counts as protected.
  if (page.isProtected !== false || page.isNoindex === true) return { allowed: false, reason: 'protected' };
  if (!CONTENT_KINDS.includes(page.kind)) return { allowed: false, reason: 'not_a_content_page' };
  const def = SLOTS[slot];
  if (!def) return { allowed: false, reason: 'slot_not_on_this_page' };
  if (!def.availableInM3) return { allowed: false, reason: 'unavailable_in_phase_1' };
  if (def.requiresIndependentContent && page.hasIndependentContent !== true) return { allowed: false, reason: 'no_independent_content' };
  if (def.page === 'any') return { allowed: true, reason: 'ok' };
  const pageOk =
    (def.page === 'home' && page.kind === 'home') ||
    (def.page === 'player' && page.kind === 'player') ||
    (def.page === 'match' && page.kind === 'match') ||
    (def.page === 'tournament' && page.kind === 'tournament') ||
    (def.page === 'gear' && page.kind === 'gear');
  if (!pageOk) return { allowed: false, reason: 'slot_not_on_this_page' };
  if (slot === 'match_page_banner' && page.matchBannerEnabled !== true) return { allowed: false, reason: 'setting_off' };
  if (slot === 'tournament_coverage_title' && page.coverageSponsorSlot !== true) return { allowed: false, reason: 'setting_off' };
  return { allowed: true, reason: 'ok' };
}

const SLOT_ORDER_BY_PAGE: Record<PageKind, readonly SlotKey[]> = {
  home: ['home_partner_strip', 'footer_partner_strip'],
  players_index: ['footer_partner_strip'],
  player: ['player_page_banner', 'footer_partner_strip'],
  matches_index: ['footer_partner_strip'],
  match: ['match_page_banner', 'footer_partner_strip'],
  tournaments_index: ['footer_partner_strip'],
  tournament: ['tournament_page_banner', 'tournament_coverage_title', 'footer_partner_strip'],
  gear: ['gear_page_banner', 'footer_partner_strip'],
  other: [],
};

/**
 * Every slot this page may carry. A protected page returns an EMPTY list (no slot, no beacon). The list never holds more than one
 * banner.
 */
export function slotsForPage(page: PageContext): SlotKey[] {
  const candidates = SLOT_ORDER_BY_PAGE[page.kind] ?? [];
  const allowed = candidates.filter((s) => checkSlotOnPage(page, s).allowed);
  let banners = 0;
  return allowed.filter((s) => {
    if (SLOTS[s].form !== 'banner') return true;
    banners += 1;
    return banners <= 1;
  });
}

// ---- server-side path check for the beacon -----------------------------------------------------------------------------

export type PathKind = PageKind;

/**
 * The page kind of a site path, from the route allow-list. `null` = not a route that may carry a slot. Shapes (all end with a slash,
 * see src/lib/urls.ts): `/`, `/players/`, `/players/<slug>/`, `/matches/`, `/matches/<slug>/`, `/tournaments/`, `/tournaments/<slug>/`,
 * `/gear/`. `/tournaments/submit/` is a form, not a tournament page.
 */
export function pathKind(path: string): PathKind | null {
  const slug = '[a-z0-9]+(?:-[a-z0-9]+)*';
  if (path === '/') return 'home';
  if (path === '/players/') return 'players_index';
  if (new RegExp(`^/players/${slug}/$`).test(path)) return 'player';
  if (path === '/matches/') return 'matches_index';
  if (new RegExp(`^/matches/${slug}/$`).test(path)) return 'match';
  if (path === '/tournaments/') return 'tournaments_index';
  if (path === '/tournaments/submit/') return null;
  if (new RegExp(`^/tournaments/${slug}/$`).test(path)) return 'tournament';
  if (path === '/gear/') return 'gear';
  return null;
}

/** Can a beacon for this slot come from this path at all? (It does not know whether the page is protected: see the endpoint's `isPathProtected`.) */
export function slotAllowedOnPath(slot: SlotKey, path: string): boolean {
  const kind = pathKind(path);
  if (!kind || !SLOTS[slot]?.availableInM3) return false;
  return (SLOT_ORDER_BY_PAGE[kind] as readonly SlotKey[]).includes(slot);
}

/** Tournament slug of a tournament path, else null. */
export function tournamentSlugOfPath(path: string): string | null {
  const m = /^\/tournaments\/([a-z0-9]+(?:-[a-z0-9]+)*)\/$/.exec(path);
  return m && m[1] !== 'submit' ? (m[1] as string) : null;
}
