// Owner-entered tournaments for /tournaments and /tournaments/[slug] (M1: a simple list; the admin and the database come in M3).
// Empty until the owner supplies real tournaments (never fabricate). Add one record per tournament.
//
// PRIVACY (D-029, D-035 row 4): organizer phone numbers and emails are NOT part of this type on purpose. Organizer
// contacts must never sit in static HTML; they come back through a click-to-reveal endpoint in M3. Until then a record can
// carry only the organizer's name, a public https registration link and a contact person's name, and all three are shown
// ONLY when `showContact` is true (the organizer agreed, see the CONSENT.tournamentPublicContact text).

import { addDays, formatDateRange, formatMonthYear, isIsoDate, isOngoing, isUpcoming } from '../lib/dates';
import { sportsEventJsonLd } from '../lib/jsonld';
import { absoluteUrl, M3_ROUTES, tournamentPath } from '../lib/urls';
import { RESERVED_TOURNAMENT_SLUGS, TOURNAMENT_SLUG_PATTERN } from '../lib/archive/slugs';
import { features } from './legal/status';
import type { TournamentFilterKeys } from '../lib/tournament-filters';

export { matchesTournamentFilters, type TournamentFilterKeys, type TournamentFilters } from '../lib/tournament-filters';

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
  /**
   * Pinned at the top of Upcoming with a "Featured" ribbon (spec 7.6), set by the owner. Free in Phase 1: a paid featured listing
   * is Phase 2 (D-020), so this is only ever the owner's own choice. Leave it out or false for a normal listing.
   */
  readonly featured?: boolean;
  /** Optional last day (IST, YYYY-MM-DD, inclusive) of the featured pin; null or absent = until the tournament is over. */
  readonly featuredUntil?: string | null;
  /** The organizer agreed to show the details in `contact`. false = nothing of `contact` is rendered. */
  readonly showContact: boolean;
  readonly contact: {
    readonly name: string | null;
    /** Public https registration link. */
    readonly registrationUrl: string | null;
  } | null;
}

export const tournaments: readonly TournamentRecord[] = [];

const SLUG = TOURNAMENT_SLUG_PATTERN;
/** /tournaments/submit/ is its own page and 'page'/'index' stay free: the one reserved set, shared with the archive model. */
const RESERVED_SLUGS = RESERVED_TOURNAMENT_SLUGS;

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
    if (t.featuredUntil !== undefined && t.featuredUntil !== null) {
      if (!isIsoDate(t.featuredUntil)) problems.push(`${label}: featuredUntil must be a real date written YYYY-MM-DD.`);
      else if (t.featured !== true) problems.push(`${label}: featuredUntil is set but featured is not true.`);
    }
  }
  return problems;
}

/** The addresses the owner's list takes: the archive model treats them as taken (an archive tournament never shadows one). */
export function ownerTournamentSlugs(): string[] {
  return tournaments.map((t) => t.slug);
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
  const url = absoluteUrl(tournamentPath(t.slug), options.origin);
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

// ----------------------------------------------------------------------------- list extras (spec 7.6) and page extras (spec 7.7)

export type TournamentPhase = 'ongoing' | 'upcoming' | 'past';

/** Where a tournament stands on an IST calendar date: running today, still to come, or over. */
export function tournamentPhase(t: Pick<TournamentRecord, 'startDate' | 'endDate'>, today: string): TournamentPhase {
  if (isOngoing(t.startDate, t.endDate, today)) return 'ongoing';
  return isUpcoming(t.startDate, t.endDate, today) ? 'upcoming' : 'past';
}

/** Pinned with a ribbon: the owner set `featured`, the tournament is not over, and `featuredUntil` (if any) has not passed. */
export function isFeatured(t: Pick<TournamentRecord, 'startDate' | 'endDate' | 'featured' | 'featuredUntil'>, today: string): boolean {
  if (t.featured !== true || !isUpcoming(t.startDate, t.endDate, today)) return false;
  return !t.featuredUntil || t.featuredUntil >= today;
}

/**
 * The Upcoming tab as sections: running today, then featured (pinned), then the rest grouped by month (soonest first).
 * Every upcoming tournament appears exactly once.
 */
export function upcomingSections(
  list: readonly TournamentRecord[],
  today: string,
): { now: TournamentRecord[]; featured: TournamentRecord[]; months: { label: string; items: TournamentRecord[] }[] } {
  const { upcoming } = splitTournaments(list, today);
  const now = upcoming.filter((t) => tournamentPhase(t, today) === 'ongoing');
  const featured = upcoming.filter((t) => !now.includes(t) && isFeatured(t, today));
  const months: { label: string; items: TournamentRecord[] }[] = [];
  for (const t of upcoming) {
    if (now.includes(t) || featured.includes(t)) continue;
    const label = formatMonthYear(t.startDate);
    const last = months[months.length - 1];
    if (last && last.label === label) last.items.push(t);
    else months.push({ label, items: [t] });
  }
  return { now, featured, months };
}

/** The values a card can be filtered on (spec 7.6). Text is trimmed; empty means "not stated". */
export function tournamentFilterKeys(t: TournamentRecord): TournamentFilterKeys {
  return {
    district: t.district?.trim() ?? '',
    level: t.level?.trim() ?? '',
    month: t.startDate.slice(0, 7),
    categories: [...new Set(t.categories.map((c) => c.trim()).filter((c) => c !== ''))],
  };
}

/** The choices for each filter, from the listed tournaments only (sorted; months soonest first, labelled "October 2026"). */
export function tournamentFilterOptions(list: readonly TournamentRecord[]): {
  district: string[];
  level: string[];
  month: { value: string; label: string }[];
  category: string[];
} {
  const keys = list.map(tournamentFilterKeys);
  const sorted = (values: string[]) => [...new Set(values.filter((v) => v !== ''))].sort((a, b) => a.localeCompare(b, 'en-IN'));
  const months = [...new Set(keys.map((k) => k.month))].sort();
  return {
    district: sorted(keys.map((k) => k.district)),
    level: sorted(keys.map((k) => k.level)),
    month: months.map((value) => ({ value, label: formatMonthYear(`${value}-01`) })),
    category: sorted(keys.flatMap((k) => k.categories)),
  };
}

/** A map search for the venue text (no coordinates are stored), or null when the record has no place. */
export function tournamentMapUrl(t: Pick<TournamentRecord, 'venue' | 'city' | 'district'>): string | null {
  const place = tournamentPlace(t);
  return place ? `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(`${place}, Tamil Nadu`)}` : null;
}

/** The WhatsApp share text: public fields only (never an organizer contact, D-029). */
export function tournamentShareText(t: TournamentRecord, url: string): string {
  const place = tournamentPlace(t);
  return `${t.name}: ${formatDateRange(t.startDate, t.endDate)}${place ? `, ${place}` : ''}. ${url}`;
}

/** Calendar files exist only for tournaments that are still to come and not cancelled. */
export function hasCalendarFile(t: TournamentRecord, today: string): boolean {
  return t.status !== 'cancelled' && isUpcoming(t.startDate, t.endDate, today);
}

/** RFC 5545 text value: backslash, semicolon, comma and line breaks escaped. */
function icsText(value: string): string {
  return value.replace(/\\/g, '\\\\').replace(/;/g, '\\;').replace(/,/g, '\\,').replace(/\r?\n/g, '\\n');
}

/** RFC 5545 line folding: lines longer than 75 octets continue on the next line after a CRLF and one space. */
function icsFold(line: string): string {
  const bytes = new TextEncoder().encode(line);
  if (bytes.length <= 75) return line;
  const out: string[] = [];
  let current = '';
  let size = 0;
  for (const ch of line) {
    const n = new TextEncoder().encode(ch).length;
    if (size + n > (out.length === 0 ? 75 : 74)) {
      out.push(current);
      current = '';
      size = 0;
    }
    current += ch;
    size += n;
  }
  out.push(current);
  return out.join('\r\n ');
}

/**
 * The add-to-calendar file (spec 7.7): one all-day event over the tournament's IST dates. Public fields only: name, place and the
 * page address; never an organizer contact (D-029). `now` stamps DTSTAMP (injected so tests are stable).
 */
export function tournamentIcs(t: TournamentRecord, options: { origin: string | URL; now: Date }): string {
  const url = absoluteUrl(`/tournaments/${t.slug}`, options.origin);
  const host = new URL(url).hostname;
  const date = (iso: string) => iso.replace(/-/g, '');
  const stamp = options.now.toISOString().replace(/[-:]/g, '').replace(/\.\d{3}Z$/, 'Z');
  const place = tournamentPlace(t);
  const lines = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//Power Smash//Tournaments//EN',
    'CALSCALE:GREGORIAN',
    'METHOD:PUBLISH',
    'BEGIN:VEVENT',
    `UID:${t.slug}@${host}`,
    `DTSTAMP:${stamp}`,
    `DTSTART;VALUE=DATE:${date(t.startDate)}`,
    // DTEND of an all-day event is the day AFTER the last day (exclusive)
    `DTEND;VALUE=DATE:${date(addDays(t.endDate ?? t.startDate, 1))}`,
    `SUMMARY:${icsText(t.name)}`,
    ...(place ? [`LOCATION:${icsText(place)}`] : []),
    `DESCRIPTION:${icsText(`Badminton tournament listed by Power Smash: ${url}`)}`,
    `URL:${url}`,
    `STATUS:${t.status === 'postponed' ? 'TENTATIVE' : 'CONFIRMED'}`,
    'END:VEVENT',
    'END:VCALENDAR',
  ];
  return `${lines.map(icsFold).join('\r\n')}\r\n`;
}

/**
 * Where "Get alerts" points, or null while the alerts sign-up cannot send anything yet (features.emailAlerts is off until the
 * domain, the sending service and the lawyer's wording are in place). The page shows the button only for a non-null value, so it is
 * never a control that does nothing.
 */
export function tournamentAlertsHref(): string | null {
  return features.emailAlerts ? M3_ROUTES.alerts : null;
}
