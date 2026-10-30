// The owner's edit of a tournament's details (name, level, place, dates, categories, featured, covered; D-102). PURE: one rule shared by
// the request schema (handler.ts), both stores and the Tournaments screen, so all of them agree with the SQL in admin_update_tournament (0014):
//  - the name is required (2 to 120 characters); city and district up to 60, the venue up to 160; text is trimmed, empty = not stated;
//    no control characters anywhere;
//  - the level is one of TOURNAMENT_LEVELS or not stated; categories are a subset of the nine codes, stored once each in a fixed order;
//  - dates are real YYYY-MM-DD dates (read as India time); the last day is not before the first;
//  - featured needs a "featured until" date; when the owner turns featuring on or changes the date it must be today or later (India
//    time). An unchanged, already-ended featuring does not block other edits. Not featured = no date (D-020: featuring is free and
//    owner-set; paid featuring is Phase 2).
// Not here on purpose: the region and visibility (Approve / Hide / Reject decide those, D-018), the edition year (part of the identity key,
// PC-11), the slug (addresses stay stable), the organizer's contact and registration link (consent rules, D-028, D-029).
import { TOURNAMENT_LEVELS, type TournamentLevel } from '../archive/types';
import { isIsoDate } from '../dates';
import { CATEGORIES, type Category } from '../parser/types';

export const TOURNAMENT_LIMITS = { name: 120, city: 60, district: 60, venue: 160 } as const;

export interface TournamentDetails {
  name: string;
  level: TournamentLevel | null;
  city: string | null;
  district: string | null;
  venue: string | null;
  startDate: string | null;
  endDate: string | null;
  categories: Category[];
  isFeatured: boolean;
  featuredUntil: string | null;
  coveredByPowerSmash: boolean;
}

export type TournamentDetailField = keyof TournamentDetails;
export const TOURNAMENT_DETAIL_FIELDS: readonly TournamentDetailField[] = [
  'name', 'level', 'city', 'district', 'venue', 'startDate', 'endDate', 'categories', 'isFeatured', 'featuredUntil', 'coveredByPowerSmash',
];

/** What the form sends: text as typed (empty = not stated), dates as typed. */
export interface TournamentEditInput {
  name: string;
  level: string | null;
  city: string | null;
  district: string | null;
  venue: string | null;
  startDate: string | null;
  endDate: string | null;
  categories: readonly string[];
  isFeatured: boolean;
  featuredUntil: string | null;
  coveredByPowerSmash: boolean;
}

export type TournamentEditValidation = { ok: true; value: TournamentDetails } | { ok: false; errors: Partial<Record<TournamentDetailField | 'form', string>> };

export const TOURNAMENT_MESSAGES = {
  name: `Type the tournament's name (2 to ${TOURNAMENT_LIMITS.name} characters, one line).`,
  level: 'Pick a level from the list, or "Not stated".',
  text: (max: number) => `Up to ${max} characters, one line.`,
  date: 'Write the date as YYYY-MM-DD, for example 2026-11-14, or leave it empty.',
  endBeforeStart: 'The last day cannot be before the first day.',
  categories: 'Pick categories from the list only.',
  featuredUntil: 'A featured tournament needs a "featured until" date, today or later.',
} as const;

// eslint-disable-next-line no-control-regex
const CONTROL = /[\u0000-\u001f\u007f-\u009f\u2028\u2029]/;
const charCount = (text: string): number => [...text].length;
const tidy = (v: string | null | undefined): string | null => {
  const t = (v ?? '').trim();
  return t === '' ? null : t;
};

/**
 * Checks and cleans the owner's edit. `today` is the India calendar date (YYYY-MM-DD) from an injected clock. `stored` is what is saved
 * now (null = unknown): an unchanged featuring that has already ended is accepted, so it never blocks an unrelated fix.
 */
export function validateTournamentEdit(input: TournamentEditInput, today: string, stored: TournamentDetails | null = null): TournamentEditValidation {
  const errors: Partial<Record<TournamentDetailField | 'form', string>> = {};
  const name = tidy(input.name) ?? '';
  if (charCount(name) < 2 || charCount(name) > TOURNAMENT_LIMITS.name || CONTROL.test(name)) errors.name = TOURNAMENT_MESSAGES.name;

  const levelText = tidy(input.level);
  const level = levelText === null ? null : (TOURNAMENT_LEVELS as readonly string[]).includes(levelText) ? (levelText as TournamentLevel) : undefined;
  if (level === undefined) errors.level = TOURNAMENT_MESSAGES.level;

  const text = (field: 'city' | 'district' | 'venue'): string | null => {
    const v = tidy(input[field]);
    if (v !== null && (charCount(v) > TOURNAMENT_LIMITS[field] || CONTROL.test(v))) errors[field] = TOURNAMENT_MESSAGES.text(TOURNAMENT_LIMITS[field]);
    return v;
  };
  const city = text('city');
  const district = text('district');
  const venue = text('venue');

  const date = (field: 'startDate' | 'endDate' | 'featuredUntil'): string | null => {
    const v = tidy(input[field]);
    if (v !== null && !isIsoDate(v)) errors[field] = TOURNAMENT_MESSAGES.date;
    return v;
  };
  const startDate = date('startDate');
  const endDate = date('endDate');
  if (startDate && endDate && !errors.startDate && !errors.endDate && endDate < startDate) errors.endDate = TOURNAMENT_MESSAGES.endBeforeStart;

  const wanted = new Set(input.categories);
  if ([...wanted].some((c) => !(CATEGORIES as readonly string[]).includes(c))) errors.categories = TOURNAMENT_MESSAGES.categories;
  const categories = CATEGORIES.filter((c) => wanted.has(c));

  const isFeatured = input.isFeatured === true;
  let featuredUntil = date('featuredUntil');
  if (!isFeatured) {
    featuredUntil = null;
    delete errors.featuredUntil;
  } else if (!errors.featuredUntil) {
    const unchanged = stored !== null && stored.isFeatured && stored.featuredUntil === featuredUntil;
    if (featuredUntil === null || (featuredUntil < today && !unchanged)) errors.featuredUntil = TOURNAMENT_MESSAGES.featuredUntil;
  }

  if (Object.keys(errors).length > 0) return { ok: false, errors };
  return {
    ok: true,
    value: { name, level: level ?? null, city, district, venue, startDate, endDate, categories, isFeatured, featuredUntil, coveredByPowerSmash: input.coveredByPowerSmash === true },
  };
}

/** Plain-English names of the fields, for the confirm step ("You are changing: venue, first day"). */
export const TOURNAMENT_FIELD_LABELS: Record<TournamentDetailField, string> = {
  name: 'name', level: 'level', city: 'city', district: 'district', venue: 'venue', startDate: 'first day', endDate: 'last day', categories: 'categories',
  isFeatured: 'featured', featuredUntil: 'featured until', coveredByPowerSmash: 'Power Smash films this',
};

/** True when two details are the same (categories compared as sets in the fixed order). */
export const sameTournamentDetails = (a: TournamentDetails, b: TournamentDetails): boolean => changedTournamentFields(a, b).length === 0;

/** The names of the fields that differ (what the audit records; never the text itself). */
export function changedTournamentFields(before: TournamentDetails, after: TournamentDetails): TournamentDetailField[] {
  return TOURNAMENT_DETAIL_FIELDS.filter((f) => {
    const a = before[f];
    const b = after[f];
    return Array.isArray(a) && Array.isArray(b) ? a.join(',') !== b.join(',') : a !== b;
  });
}
