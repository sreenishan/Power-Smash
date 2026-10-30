// Plain-English owner-facing text for admin errors and the hash router (pure, tested). No codes, no jargon.
import type { AdminErrorCode } from '../lib/admin/types';

const MESSAGES: Record<AdminErrorCode, string> = {
  NOT_FOUND: 'That item no longer exists. Refresh the list and try again.',
  SAME_PLAYER: 'Pick two different players.',
  ALREADY_MERGED: 'One of these players was already merged into someone else.',
  SUPPRESSED: 'This is hidden after a takedown, so it cannot be changed or merged.',
  MINOR_ADULT_MERGE_BLOCKED: 'One player may be under 18 and the other is confirmed adult. Merging them needs a written reason.',
  OVERRIDE_REASON_REQUIRED: 'Write a reason for the age override first.',
  EMPTY_NAME: 'Type a name with at least one letter.',
  ALIAS_NOT_OWNED: 'One of the chosen names does not belong to this player.',
  REDIRECT_LOOP: 'This change would make two web addresses point at each other, so it was stopped.',
  UNDO_UNAVAILABLE: 'This cannot be undone any more.',
  STALE: 'This changed since you opened it. Open it again and make your change once more.',
  INVALID: 'Something in the form is not valid. Check the fields and try again.',
  UNAUTHORIZED: 'Your sign-in has run out. Sign in again.',
  FORBIDDEN: 'This account is not allowed to do that.',
  BACKEND_ERROR: 'The server could not do that just now. Nothing was changed. Try again in a minute.',
};

export function messageFor(code: AdminErrorCode): string {
  return MESSAGES[code] ?? MESSAGES.BACKEND_ERROR;
}

/** STALE on the tournament-details form only: there the usual cause is new videos (a category is added by the video sync). */
export const STALE_TOURNAMENT_DETAILS = 'This tournament changed since you opened it (for example, new videos added a category). Close it, open it again and make your change once more.';

export const AGE_LABEL = {
  adult_confirmed: 'Adult (confirmed)',
  unknown: 'Age not known',
  minor_suspected: 'May be under 18',
  minor_confirmed: 'Under 18 (confirmed)',
} as const;

export const AGE_EXPLAIN = {
  adult_confirmed: 'Has a public profile page.',
  unknown: 'Protected: no profile page, no photo or bio.',
  minor_suspected: 'Protected: hidden from the public site.',
  minor_confirmed: 'Protected: hidden from the public site.',
} as const;

export const MODE_LABEL = {
  noindex_minimal: 'Minimal page (hidden from Google)',
  hidden: 'Hidden completely',
} as const;

// ----------------------------------------------------------------------------- hash router

export const ROUTES_ADMIN = ['dashboard', 'inbox', 'videos', 'players', 'tournaments', 'submissions', 'sponsors', 'prices', 'posters', 'live', 'competitions', 'scoring', 'registrations', 'international', 'notices', 'accounts', 'settings', 'more'] as const;
export type AdminRoute = (typeof ROUTES_ADMIN)[number];

export const ROUTE_TITLE: Record<AdminRoute, string> = {
  dashboard: 'Dashboard',
  inbox: 'Enquiries',
  videos: 'Videos to check',
  players: 'Players',
  tournaments: 'Tournaments',
  submissions: 'Video submissions',
  sponsors: 'Sponsor placements',
  prices: 'Prices',
  posters: 'QR posters',
  live: 'Live page',
  competitions: 'Competitions',
  scoring: 'Live scoring',
  registrations: 'Registrations',
  international: 'International events',
  notices: 'Notices and email',
  accounts: 'Accounts',
  settings: 'Settings',
  more: 'More',
};

export const ROUTE_NOTE: Record<AdminRoute, string> = {
  dashboard: 'Counts, publish, emergency hide.',
  inbox: 'Move enquiries along, add notes and follow-up dates.',
  videos: 'Check videos the reader was unsure about, and try a title before you post it.',
  players: 'Find, merge, split and protect players.',
  tournaments: 'Approve or reject tournaments, including organizer submissions.',
  submissions: 'Review videos people sent you: approve, reject, mark uploaded.',
  sponsors: 'Add a sponsor placement and switch it on or off.',
  prices: 'Type or change a price.',
  posters: 'Get the QR link for a printed poster.',
  live: 'Pin the stream on the Live page and list past streams.',
  competitions: 'Events, entries, draws, order of play, results and local rankings.',
  scoring: 'Score a match point by point from your phone, and choose whether the website shows live scores.',
  registrations: 'People who registered for events on the website: check payments, add them as entries.',
  international: 'List big international events with one link to the official page.',
  notices: 'Short notices on the website, and update emails to people who signed up.',
  accounts: 'Invite organizers and scorers, and choose their tournaments.',
  settings: 'What the public sees for players who are not confirmed adults.',
  more: 'All areas.',
};

/** The five tabs of the bottom bar, in order; the rest live under More. */
export const TAB_ROUTES: readonly AdminRoute[] = ['dashboard', 'inbox', 'videos', 'players', 'more'];
export const TAB_LABEL: Record<AdminRoute, string> = { dashboard: 'Home', inbox: 'Enquiries', videos: 'Videos', players: 'Players', more: 'More', tournaments: 'Tournaments', submissions: 'Submissions', sponsors: 'Sponsors', prices: 'Prices', posters: 'Posters', live: 'Live', competitions: 'Competitions', scoring: 'Scoring', registrations: 'Registrations', international: 'International', notices: 'Notices', accounts: 'Accounts', settings: 'Settings' };
/** Which tab to highlight for a route. */
export const tabFor = (r: AdminRoute): AdminRoute => (TAB_ROUTES.includes(r) ? r : 'more');

/** `#/players` -> 'players'. Anything unknown falls back to the dashboard. */
export function parseHash(hash: string): AdminRoute {
  const name = hash.replace(/^#\/?/, '').split(/[/?]/)[0] ?? '';
  return (ROUTES_ADMIN as readonly string[]).includes(name) ? (name as AdminRoute) : 'dashboard';
}

export const hashFor = (route: AdminRoute): string => `#/${route}`;
