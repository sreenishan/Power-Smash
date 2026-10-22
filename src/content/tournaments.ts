// Owner-entered tournaments for /tournaments and /tournaments/[slug] (M1: a simple list; the admin and the database come in M3).
// Empty until the owner supplies real tournaments (never fabricate). Add one record per tournament.
//
// PRIVACY (D-029, D-035 row 4): organizer phone numbers and emails are NOT part of this type on purpose. Organizer
// contacts must never sit in static HTML; they come back through a click-to-reveal endpoint in M3. Until then a record can
// carry only the organizer's name, a public https registration link and a contact person's name, and all three are shown
// ONLY when `showContact` is true (the organizer agreed, see the CONSENT.tournamentPublicContact text).

import { formatDateRange, isIsoDate, isUpcoming } from '../lib/dates';
import { sportsEventJsonLd } from '../lib/jsonld';
import { absoluteUrl } from '../lib/urls';

export type TournamentStatus = 'scheduled' | 'cancelled' | 'postponed';

export interface TournamentRecord {
  /** Lowercase, hyphenated, stable: {name}-{year}-{city} (spec 6.3). */
  readonly slug: string;
  readonly name: string;
  /** Calendar dates in Asia/Kolkata, written YYYY-MM-DD. */
  readonly startDate: string;
  readonly endDate: string | null;
  readonly venue: string | null;
  readonly city: string | null;
  readonly district: string | null;
  /** District, state, open and so on, as the owner words it. */
  readonly level: string | null;
  readonly categories: readonly string[];
  readonly organizerName: string | null;
  readonly description: string | null;
  readonly status: TournamentStatus;
  /** "Covered by Power Smash" badge: only when the owner has really booked it. */
  readonly coveredByPowerSmash: boolean;
  /** The organizer agreed to show the details in `contact`. false = nothing of `contact` is rendered. */
  readonly showContact: boolean;
  readonly contact: {
    readonly name: string | null;
    /** Public https registration link. */
    readonly registrationUrl: string | null;
  } | null;
}

export const tournaments: readonly TournamentRecord[] = [];

const SLUG = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
/** /tournaments/submit is its own page; no tournament may take that address. */
const RESERVED_SLUGS = new Set(['submit']);

/** Problems with an owner-edited list, as readable sentences (empty = fine). Pages throw on them at build time. */
export function tournamentProblems(list: readonly TournamentRecord[]): string[] {
  const problems: string[] = [];
  const seen = new Set<string>();
  for (const t of list) {
    const label = `Tournament "${t.slug}"`;
    if (!SLUG.test(t.slug)) problems.push(`${label}: the slug must be lowercase letters, digits and hyphens.`);
    if (RESERVED_SLUGS.has(t.slug)) problems.push(`${label}: this slug is reserved for another page.`);
    if (seen.has(t.slug)) problems.push(`${label}: duplicate slug.`);
    seen.add(t.slug);
    if (t.name.trim() === '') problems.push(`${label}: name is empty.`);
    if (!isIsoDate(t.startDate)) problems.push(`${label}: startDate must be a real date written YYYY-MM-DD.`);
    if (t.endDate !== null) {
      if (!isIsoDate(t.endDate)) problems.push(`${label}: endDate must be a real date written YYYY-MM-DD.`);
      else if (isIsoDate(t.startDate) && t.endDate < t.startDate) problems.push(`${label}: endDate is before startDate.`);
    }
    const url = t.contact?.registrationUrl;
    if (url && !/^https:\/\/[^\s]+$/.test(url)) problems.push(`${label}: registrationUrl must start with https://.`);
  }
  return problems;
}

export function assertValidTournaments(list: readonly TournamentRecord[] = tournaments): void {
  const problems = tournamentProblems(list);
  if (problems.length > 0) throw new Error(`src/content/tournaments.ts has problems:\n- ${problems.join('\n- ')}`);
}

/** Upcoming (soonest first) and past (latest first), by the IST calendar date passed in (D-030). */
export function splitTournaments(
  list: readonly TournamentRecord[],
  today: string,
): { upcoming: TournamentRecord[]; past: TournamentRecord[] } {
  const upcoming = list
    .filter((t) => isUpcoming(t.startDate, t.endDate, today))
    .sort((a, b) => a.startDate.localeCompare(b.startDate) || a.name.localeCompare(b.name));
  const past = list
    .filter((t) => !isUpcoming(t.startDate, t.endDate, today))
    .sort((a, b) => b.startDate.localeCompare(a.startDate) || a.name.localeCompare(b.name));
  return { upcoming, past };
}

/** The contact block of a record, or null unless the organizer agreed (showContact) AND something is there to show. */
export function publicContact(t: TournamentRecord): { name: string | null; registrationUrl: string | null } | null {
  if (t.showContact !== true || !t.contact) return null;
  const name = t.contact.name?.trim() || null;
  const registrationUrl = t.contact.registrationUrl?.trim() || null;
  return name || registrationUrl ? { name, registrationUrl } : null;
}

/** "Venue, City, District" with the parts the record has. Empty string when it has none. */
export function tournamentPlace(t: Pick<TournamentRecord, 'venue' | 'city' | 'district'>): string {
  return [t.venue, t.city, t.district].filter((v): v is string => typeof v === 'string' && v.trim() !== '').join(', ');
}

/** The status badge text, or null for a scheduled tournament. */
export function tournamentStatusLabel(t: Pick<TournamentRecord, 'status'>): 'Cancelled' | 'Postponed' | null {
  return t.status === 'cancelled' ? 'Cancelled' : t.status === 'postponed' ? 'Postponed' : null;
}

/** Everything /tournaments/[slug] shows, computed in one pure function so a test can run the page's data path (review C-22). */
export interface TournamentPageModel {
  /** Upcoming until the last day (inclusive) has passed in IST. */
  upcoming: boolean;
  when: string;
  place: string;
  /** The meta description. */
  description: string;
  /** Absolute canonical URL, in the same trailing-slash form as the canonical link (R-LINKS). */
  url: string;
  statusLabel: 'Cancelled' | 'Postponed' | null;
  /** The registration block, or null unless the organizer agreed (showContact) and there is something to show. */
  contact: { name: string | null; registrationUrl: string | null } | null;
  /** SportsEvent structured data, only for an upcoming tournament; never any organizer contact. */
  jsonLd: Record<string, unknown> | undefined;
}

/** `today` is the IST calendar date (todayIst()); `origin` is the site origin (Astro.site). */
export function tournamentPageModel(t: TournamentRecord, options: { today: string; origin: string | URL }): TournamentPageModel {
  const upcoming = isUpcoming(t.startDate, t.endDate, options.today);
  const when = formatDateRange(t.startDate, t.endDate);
  const place = tournamentPlace(t);
  const url = absoluteUrl(`/tournaments/${t.slug}`, options.origin);
  return {
    upcoming,
    when,
    place,
    description: `${t.name}: ${when}${place ? `, ${place}` : ''}. Badminton tournament listed by Power Smash.`,
    url,
    statusLabel: tournamentStatusLabel(t),
    contact: publicContact(t),
    jsonLd: upcoming
      ? sportsEventJsonLd({
          name: t.name,
          startDate: t.startDate,
          endDate: t.endDate,
          url,
          venue: t.venue,
          city: t.city,
          organizerName: t.organizerName,
          status: t.status,
          description: t.description,
        })
      : undefined,
  };
}
