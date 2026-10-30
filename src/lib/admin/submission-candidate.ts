// An organizer's tournament submission (lead kind tournament_submission, /tournaments/submit/) turned into a PENDING, HIDDEN tournament
// candidate for the admin's "Submitted by organizers" tab (D-103). PURE: shared by both admin stores; the SQL in
// admin_add_submitted_tournament (0015) checks the same record again.
//  - Only the tournament's own details are taken: name, dates, city, district, venue. NO contact detail is copied: the organizer's name,
//    phone and email stay on the lead (and its retention rules), so nothing here can surface them (D-029).
//  - A field the rules refuse (too long, control characters, not a real date, last day before the first) is left empty and named in
//    `dropped`, so the owner sees it; only an unusable name stops the candidate.
//  - Free-text categories, age groups, fees, links and the poster link are NOT taken (the categories column takes the nine codes only;
//    the owner ticks them with "Details", D-102; the poster stays a link, D-035; links need the D-015 checks).
//  - The region is tamil_nadu only when the district (or else the city) is a Tamil Nadu district; otherwise unknown. International is
//    never guessed (D-018): Approve decides what the public sees.
import { makeSeriesKey } from '../parser/parse';
import { tournamentSlug } from '../parser/slug';
import { canonicalPlace, DISTRICT_NAMES } from '../parser/vocab';
import { RESERVED_TOURNAMENT_SLUGS } from '../archive/slugs';
import { isIsoDate } from '../dates';
import { TOURNAMENT_LIMITS } from './tournament-edit';

/** The tournament fields of the lead's payload (camelCase, as /api/lead stores them; src/lib/contracts/lead.ts). */
export interface SubmissionPayload {
  tournamentName?: unknown;
  startDate?: unknown;
  endDate?: unknown;
  venue?: unknown;
  city?: unknown;
  district?: unknown;
}
export const SUBMISSION_PAYLOAD_KEYS = ['tournamentName', 'startDate', 'endDate', 'venue', 'city', 'district'] as const;

/** What admin_add_submitted_tournament stores (camelCase keys = the SQL's allowed list). */
export interface SubmittedTournamentRecord {
  slug: string;
  name: string;
  seriesKey: string;
  editionYear: number | null;
  region: 'tamil_nadu' | 'unknown';
  city: string | null;
  district: string | null;
  venue: string | null;
  startDate: string | null;
  endDate: string | null;
}

export type SubmissionField = 'startDate' | 'endDate' | 'venue' | 'city' | 'district';
export type CandidateResult =
  | { ok: true; record: SubmittedTournamentRecord; dropped: SubmissionField[] }
  | { ok: false; reason: 'NO_NAME' | 'NO_SLUG' | 'NO_FREE_SLUG' };

export const SUBMISSION_MESSAGES = {
  NO_NAME: 'The submission has no tournament name we can use (2 to 120 characters, Latin letters). Add the tournament yourself instead.',
  NO_SLUG: 'We could not make a web address from this name (it needs Latin letters). Add the tournament yourself instead.',
  NO_FREE_SLUG: 'Every web address we would give this tournament is already used. Add the tournament yourself instead.',
  added: 'This submission is already in the tournament list.',
  duplicate: 'A tournament with the same name and year is already in the list.',
} as const;

export const FIELD_WORDS: Record<SubmissionField, string> = { startDate: 'first day', endDate: 'last day', venue: 'venue', city: 'city', district: 'district' };

// eslint-disable-next-line no-control-regex
const CONTROL = /[\u0000-\u001f\u007f-\u009f\u2028\u2029]/;
const charCount = (text: string): number => [...text].length;
const str = (v: unknown): string | null => {
  if (typeof v !== 'string') return null;
  const t = v.trim();
  return t === '' ? null : t;
};

/** True when the place is a Tamil Nadu district (an informal spelling such as "Kovai" counts). */
export function isTamilNaduDistrict(place: string | null): boolean {
  if (place === null) return false;
  const canonical = canonicalPlace(place) ?? place.trim();
  return DISTRICT_NAMES.has(canonical);
}

/**
 * The addresses a submission may take, in order: base, base-2 .. base-9, never a reserved one. The base is the name, year and city; a city
 * that cannot be written in Latin letters, or one that makes the address too long, is left out; the base is clipped to 96 characters like
 * the sync's own addresses (src/lib/sync/identity.ts), so a long name still gets one. Empty only when the name has no Latin form.
 */
export function slugOptions(name: string, year: number | null, city: string | null): string[] {
  const withCity = tournamentSlug({ name, year, city });
  const without = tournamentSlug({ name, year });
  const pick = withCity.ok && withCity.slug.length <= 96 ? withCity.slug : without.ok ? without.slug : null;
  if (pick === null) return [];
  const base = pick.slice(0, 96).replace(/-+$/u, '');
  if (base === '') return [];
  return [base, ...Array.from({ length: 8 }, (_, i) => `${base}-${i + 2}`)].filter((x) => /^[a-z0-9][a-z0-9-]{0,100}$/.test(x) && !RESERVED_TOURNAMENT_SLUGS.has(x));
}

/**
 * The candidate for a submission. `slugTaken` says whether an address is already used (the store asks the database); the first free one
 * of base, base-2 .. base-9 is taken.
 */
export function candidateFromSubmission(payload: SubmissionPayload, slugTaken: (slug: string) => boolean): CandidateResult {
  const name = str(payload.tournamentName);
  if (name === null || charCount(name) < 2 || charCount(name) > TOURNAMENT_LIMITS.name || CONTROL.test(name)) return { ok: false, reason: 'NO_NAME' };
  const seriesKey = makeSeriesKey(name);
  if (seriesKey === null) return { ok: false, reason: 'NO_NAME' };

  const dropped: SubmissionField[] = [];
  const text = (field: 'venue' | 'city' | 'district'): string | null => {
    const v = str(payload[field]);
    if (v !== null && (charCount(v) > TOURNAMENT_LIMITS[field] || CONTROL.test(v))) {
      dropped.push(field);
      return null;
    }
    return v;
  };
  const date = (field: 'startDate' | 'endDate'): string | null => {
    const v = str(payload[field]);
    if (v !== null && !isIsoDate(v)) {
      dropped.push(field);
      return null;
    }
    return v;
  };
  const venue = text('venue');
  const city = text('city');
  const district = text('district');
  const startDate = date('startDate');
  let endDate = date('endDate');
  if (startDate !== null && endDate !== null && endDate < startDate) {
    dropped.push('endDate');
    endDate = null;
  }
  const editionYear = startDate === null ? null : Number(startDate.slice(0, 4));

  const options = slugOptions(name, editionYear, city);
  if (options.length === 0) return { ok: false, reason: 'NO_SLUG' };
  const slug = options.find((x) => !slugTaken(x));
  if (slug === undefined) return { ok: false, reason: 'NO_FREE_SLUG' };

  const region = isTamilNaduDistrict(district) || (district === null && isTamilNaduDistrict(city)) ? 'tamil_nadu' : 'unknown';
  return { ok: true, record: { slug, name, seriesKey, editionYear, region, city, district, venue, startDate, endDate }, dropped };
}

/** Exactly the addresses candidateFromSubmission will try, so a store can ask the database about all of them in one read. */
export function slugOptionsFor(payload: SubmissionPayload): string[] {
  const r = candidateFromSubmission(payload, () => false);
  return r.ok ? slugOptions(r.record.name, r.record.editionYear, r.record.city) : [];
}

/** What the owner sees before adding a submission (no contact detail: only the tournament's own fields). */
export interface SubmissionPreview {
  leadId: string;
  refCode: string;
  /** The candidate to add, or null when it cannot be made (see problem). */
  record: SubmittedTournamentRecord | null;
  /** Fields the organizer filled in that the rules refused (left empty; the owner can add them with "Details" later). */
  dropped: SubmissionField[];
  /** A plain-English reason the button is off, or null. */
  problem: string | null;
  /** Set once the submission is in the tournament list. */
  addedAs: { tournamentId: string } | null;
}

/** The preview from what a store read. `isDuplicate` says whether a tournament with the record's series key and year exists. */
export function submissionPreview(
  lead: { id: string; refCode: string; payload: SubmissionPayload },
  ctx: { addedAs: { tournamentId: string } | null; slugTaken: (slug: string) => boolean; isDuplicate: (seriesKey: string, year: number | null) => boolean },
): SubmissionPreview {
  const base = { leadId: lead.id, refCode: lead.refCode, addedAs: ctx.addedAs };
  if (ctx.addedAs) return { ...base, record: null, dropped: [], problem: SUBMISSION_MESSAGES.added };
  const c = candidateFromSubmission(lead.payload, ctx.slugTaken);
  if (!c.ok) return { ...base, record: null, dropped: [], problem: SUBMISSION_MESSAGES[c.reason] };
  if (ctx.isDuplicate(c.record.seriesKey, c.record.editionYear)) return { ...base, record: c.record, dropped: c.dropped, problem: SUBMISSION_MESSAGES.duplicate };
  return { ...base, record: c.record, dropped: c.dropped, problem: null };
}
