// Constants shared by the lead endpoint and the forms (no zod here, so client code can import this file without
// shipping the validation library). The zod contract lives in ./lead.ts. Owner: Lead-backend worker (M1).

export const LEAD_ENDPOINT = '/api/lead';
export const EVENT_ENDPOINT = '/api/event';

/** Every kind of lead the endpoint accepts. Add a kind only additively (new member, new schema). */
export const LEAD_KINDS = ['coverage', 'sponsorship', 'general', 'player_product', 'tournament_submission', 'video_submission', 'alerts_signup', 'profile_request', 'content_removal'] as const;
export type LeadKind = (typeof LEAD_KINDS)[number];

/** Stable machine codes in `{ ok: false, code }`. The HTTP status is shown in brackets. */
export const LEAD_ERROR_CODES = [
  'validation', // [400 bad JSON or wrong content type, 413 body over the cap, 422 a field failed validation] see fieldErrors
  'turnstile', // [403] the spam check failed, expired or was missing: ask the visitor to retry the check
  'rate_limited', // [429] too many tries from this connection or for this phone/email, or the form was submitted too fast
  'duplicate', // [409] the same idempotencyKey was already used for a different submission
  'degraded', // [503] we could not store the enquiry: show the WhatsApp fallback link now
  'server', // [500] unexpected error: show the correlation id and the WhatsApp fallback link
] as const;
export type LeadErrorCode = (typeof LEAD_ERROR_CODES)[number];

export const LEAD_ERROR_STATUS: Record<LeadErrorCode, number> = {
  validation: 422,
  turnstile: 403,
  rate_limited: 429,
  duplicate: 409,
  degraded: 503,
  server: 500,
};

/** Per-field error codes in `fieldErrors` (key = field path such as `name` or `source.path`). */
export const FIELD_ERROR_CODES = [
  'required',
  'too_short',
  'too_long',
  'invalid',
  'control_chars',
  'url_not_allowed',
  'formula_not_allowed',
  'html_not_allowed',
  'too_many_digits',
  'invalid_phone',
  'invalid_email',
  'invalid_date',
  'date_out_of_range', // R-DATE: a real date, but outside "from yesterday up to three years ahead" (IST)
  'invalid_url',
  'contact_required',
  'consent_required',
] as const;
export type FieldErrorCode = (typeof FIELD_ERROR_CODES)[number];

/** Plain-English default texts for each field error code (owner-facing tone). Forms may override per field. */
export const FIELD_ERROR_MESSAGES: Record<FieldErrorCode, string> = {
  required: 'Please fill this in.',
  too_short: 'This is too short.',
  too_long: 'This is too long. Please shorten it.',
  invalid: 'This does not look right. Please check it.',
  control_chars: 'Please remove special or hidden characters and line breaks.',
  url_not_allowed: 'Please do not put links, email addresses or handles in this box.',
  formula_not_allowed: 'This cannot start with = + - or @.',
  html_not_allowed: 'Please remove the < and > characters.',
  too_many_digits: 'Please remove phone numbers or long numbers from this box.',
  invalid_phone: 'Please enter a valid mobile number with 10 digits.',
  invalid_email: 'Please enter a valid email address.',
  invalid_date: 'Please pick a valid date.',
  date_out_of_range: 'Please check the date: it should be from yesterday up to three years ahead.',
  invalid_url: 'Please enter a full web address starting with https://.',
  contact_required: 'Please give a phone number or an email address.',
  consent_required: 'Please confirm this to continue.',
};

export const LEAD_ERROR_MESSAGES: Record<LeadErrorCode, string> = {
  validation: 'Some details need fixing. Please check the highlighted boxes.',
  turnstile: 'The spam check did not pass. Please try the check again.',
  rate_limited: 'Too many tries. Please wait a few minutes and try again, or message us on WhatsApp.',
  duplicate: 'This enquiry was already sent. Please refresh the page and try again.',
  degraded: 'We could not save your enquiry just now. Please message us on WhatsApp so it is not lost.',
  server: 'Something went wrong on our side. Please message us on WhatsApp.',
};

/** Field limits, in Unicode code points (not bytes). Forms should set `maxlength` from these. */
export const LEAD_LIMITS = {
  name: { min: 2, max: 80 },
  organization: { max: 120 },
  email: { max: 254 },
  phone: { minDigits: 8, maxDigits: 15 },
  shortText: { max: 120 }, // venue, event name, district, company...
  tinyText: { max: 60 }, // level, fee text, budget range label...
  longText: { max: 1500 }, // notes, objectives, message
  noteText: { max: 800 },
  /** M2/M3 request form: the link or description of the profile, video or page (text only, never fetched). */
  requestWhat: { max: 300 },
  listItems: { max: 12 },
  listItemText: { max: 40 },
  turnstileToken: { max: 2048 }, // Cloudflare: tokens are at most 2,048 characters
  utmValue: { max: 64 },
  sourcePath: { max: 200 },
  url: { max: 300 },
  /** Total JSON body cap in bytes (D-029: 20 KB). */
  bodyBytes: 20 * 1024,
} as const;

/** A submission faster than this after the first interaction (client-reported `elapsedMs`) is refused as a likely bot (D-029). */
export const MIN_FILL_MS = 1000;

/**
 * R-ELAPSED: `elapsedMs` is CLAMPED into 0..ELAPSED_MS_MAX by the server (a non-integer counts as 0); it never rejects a request.
 * The client clamps the same way before sending and resets its timer after every submit (a form left open overnight must still send).
 */
export const ELAPSED_MS_MAX = 86_400_000;
export function clampElapsedMs(value: unknown): number {
  if (typeof value !== 'number' || !Number.isInteger(value)) return 0;
  return Math.min(Math.max(value, 0), ELAPSED_MS_MAX);
}

// ---------------------------------------------------------------------------------------------------------------
// R-PHONE: characters that a pasted phone number may carry and that are REMOVED before it is validated
// ---------------------------------------------------------------------------------------------------------------
/**
 * No-break and thin spaces (U+00A0, U+2007, U+2009, U+202F), zero-width space (U+200B), the direction marks U+200E and U+200F,
 * the embedding and override controls U+202A-U+202E, the isolates U+2066-U+2069 and the byte order mark U+FEFF. A number copied
 * from WhatsApp or Contacts carries some of them. They are removed (not turned into spaces) and then the normal rules apply.
 */
const PHONE_IGNORABLE = /[    ​‎‏‪-‮⁦-⁩﻿]/g;
export const stripPhoneIgnorables = (s: string): string => s.replace(PHONE_IGNORABLE, '');

// ---------------------------------------------------------------------------------------------------------------
// R-TEXT: the characters a single-line free-text field may contain (event or venue name, district, budget, company...)
// ---------------------------------------------------------------------------------------------------------------
/** A person's name: letters, marks, digits, ZWNJ/ZWJ, space and . , ' (curly too) ( ) - only. */
export const NAME_CHARS_RE = /^[\p{L}\p{M}\p{N}‌‍ .,'’()\-]+$/u;
/**
 * Single-line labels: the name characters plus & / # + : and (R-TEXT) the rupee sign, en dash, em dash, curly single and double
 * quotes, % ! ? and the middle dot. Still rejected: control characters, line breaks, < > { } [ ] \ | ` and a leading = + - @
 * (the formula check in cleanText). `;` `*` `_` `$` `~` `^` `"` are not in the list because nobody asked for them.
 */
export const LABEL_CHARS_RE = /^[\p{L}\p{M}\p{N}‌‍ .,'‘’()&/#+:\-₹–—“”%!?·]+$/u;

// ---------------------------------------------------------------------------------------------------------------
// R-DATE: a start date is a real calendar date from YESTERDAY (IST) up to 1,095 days after today (IST). The clock is injectable.
// ---------------------------------------------------------------------------------------------------------------
export const START_DATE_MAX_DAYS_AHEAD = 1095;
export const START_DATE_OUT_OF_RANGE_MESSAGE = 'Please check the date: it should be from yesterday up to three years ahead.';

const IST_OFFSET_MS = 5.5 * 3600 * 1000;
/** Today's calendar date in Asia/Kolkata as `YYYY-MM-DD` (D-030: plain dates are read as IST). */
export const istToday = (now: Date): string => new Date(now.getTime() + IST_OFFSET_MS).toISOString().slice(0, 10);
/** `YYYY-MM-DD` plus a whole number of days (calendar arithmetic, no time zone involved). */
export function addDaysToDate(isoDate: string, days: number): string {
  const [y, m, d] = isoDate.split('-').map(Number) as [number, number, number];
  return new Date(Date.UTC(y, m - 1, d + days)).toISOString().slice(0, 10);
}
export function startDateWindow(now: Date): { min: string; max: string } {
  const today = istToday(now);
  return { min: addDaysToDate(today, -1), max: addDaysToDate(today, START_DATE_MAX_DAYS_AHEAD) };
}
/** True when `date` (`YYYY-MM-DD`, already known to be a real date) lies inside the window. Plain strings compare in date order. */
export function isStartDateInWindow(date: string, now: Date): boolean {
  const { min, max } = startDateWindow(now);
  return date >= min && date <= max;
}

export const CONTACT_PREFERENCES = ['whatsapp', 'call', 'email'] as const;
export const FILMING_PERMISSION_STATUSES = ['yes', 'no', 'unsure'] as const; // D-019: written filming and monetisation permission agreed?
// M3 (additive): the "send your video" and alerts sign-up forms.
/** Spec 7.12: who is sending the video. */
export const VIDEO_SUBMITTER_ROLES = ['player', 'parent_guardian', 'coach', 'organizer', 'other'] as const;
/** D-019 and the licence draft (section 2.2): who owns the footage. */
export const FOOTAGE_SOURCES = ['self', 'asked_by_organizer', 'organizer_owns', 'other'] as const;
/** Licence draft section 2.3: can players under 18 be recognised in the video? Same three answers as FILMING_PERMISSION_STATUSES. */
export const MINORS_VISIBLE_ANSWERS = ['yes', 'no', 'unsure'] as const;
// Request form (spec 7.5 footer, 15.3, 15.6, D-012, D-015, D-019): ONE form with a type selector, two lead kinds.
/** `profile_request`: claim a profile, correct details, hide a profile (a player, or a parent or guardian on their behalf). */
export const PROFILE_REQUEST_TYPES = ['claim_profile', 'correct_details', 'hide_profile'] as const;
/** `content_removal`: remove a video or other content (a player, a parent or guardian, or a rights holder). One request type. */
export const CONTENT_REMOVAL_TYPE = 'remove_content' as const;
/** What the visitor chooses in the form's first box; the form sends `content_removal` for the last one and `profile_request` for the rest. */
export const REQUEST_TYPES = [...PROFILE_REQUEST_TYPES, CONTENT_REMOVAL_TYPE] as const;
/** Who is asking. A parent or guardian is verified LATER by a one-time code on their own phone (not built yet). */
export const REQUEST_RELATIONSHIPS = ['self', 'parent_guardian', 'coach', 'rights_holder', 'other'] as const;
/** Spec 8.7: what an alerts subscriber wants to hear about (the Power Smash Open and followed players are later phases). */
export const ALERT_INTERESTS = ['tournaments', 'new-videos'] as const;
/**
 * Share hosts the video-link hint names (Google Drive and friends). The link is NEVER fetched, opened by a server or embedded:
 * it is stored as text for the owner to open. Any other https address is accepted too (host kind "other").
 */
export const VIDEO_SHARE_HOSTS = [
  'drive.google.com',
  'photos.app.goo.gl',
  'photos.google.com',
  'youtu.be',
  'youtube.com',
  'dropbox.com',
  'onedrive.live.com',
  '1drv.ms',
  'wetransfer.com',
  'we.tl',
  'instagram.com',
  'facebook.com',
  'fb.watch',
] as const;
/** 'known' when the host (or a parent domain) is on VIDEO_SHARE_HOSTS, otherwise 'other'. Pure; does not validate the URL. */
export function videoHostKind(url: string): 'known' | 'other' {
  let host: string;
  try {
    host = new URL(url).hostname.toLowerCase();
  } catch {
    return 'other';
  }
  return VIDEO_SHARE_HOSTS.some((h) => host === h || host.endsWith(`.${h}`)) ? 'known' : 'other';
}

export const TOURNAMENT_LISTING_TYPES = ['free', 'featured'] as const; // spec 7.8: P1 only records the request
export const LEAD_LANGS = ['en', 'ta'] as const;

/** Allow-listed first-party event names for POST /api/event (spec 16, D-029). Extend additively. */
export const EVENT_NAMES = ['whatsapp_click', 'share_click', 'form_start', 'form_submit', 'form_error', 'outbound_click'] as const;
export type EventName = (typeof EVENT_NAMES)[number];

/** Reference code shape: PS-<IST year>-<6 characters of Crockford base32 without I L O U>. */
export const REF_CODE_PATTERN = /^PS-\d{4}-[0-9A-HJKMNP-TV-Z]{6}$/;

// ---------------------------------------------------------------------------------------------------------------
// Response shapes
// ---------------------------------------------------------------------------------------------------------------

export interface LeadSuccessResponse {
  ok: true;
  /** Reference code, `PS-YYYY-XXXXXX`. A retry with the same idempotencyKey returns the same ref. */
  ref: string;
  /** WhatsApp link with a prefilled message quoting the reference (no personal data in the text). Absent when no WhatsApp number is configured. */
  waLink?: string;
  /** true when this response replays an earlier identical submission (same idempotencyKey). */
  replay?: boolean;
}

export interface LeadErrorResponse {
  ok: false;
  code: LeadErrorCode;
  /** One plain-English sentence suitable for an `aria-live` status area. */
  message: string;
  /** Present for `validation`: field path (dot notation) to FieldErrorCode. */
  fieldErrors?: Record<string, FieldErrorCode>;
  /** WhatsApp fallback (degraded, server, rate_limited) so the visitor can still reach us. */
  waLink?: string;
  /** Short id to quote when asking for help; also in the Worker log line (no personal data). */
  correlationId: string;
  /** Present for `rate_limited`. */
  retryAfterSec?: number;
  /** Present for `degraded` only: the PROVISIONAL reference quoted in the waLink text; the enquiry was not stored. */
  ref?: string;
}

export type LeadResponse = LeadSuccessResponse | LeadErrorResponse;
