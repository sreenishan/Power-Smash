// THE lead contract (M1): request schema (zod, strict), response types, error codes, field error mapping.
// Owner: Lead-backend worker. Endpoint: POST /api/lead (JSON). Human-readable description: docs/m1/leads-api.md.
// Change this file ADDITIVELY only (new optional field, new kind) and tell the lead: the forms depend on it.
//
// Rules built in (D-029): unknown keys are stripped; every text value is NFC-normalised, trimmed, length-capped;
// control characters, CR/LF (in single-line fields), zero-width and bidi characters are rejected; links, handles and
// markup are rejected where only text is expected; phone numbers become digits with country code; emails are
// lower-cased ASCII; dates are real calendar dates; URLs are https only with the host checked.
//
// Client code that only needs constants and response types should import from ./lead-constants (no zod).
import { z } from 'zod';
import { CONSENT } from '../../content/consent';
import {
  CONTACT_PREFERENCES,
  ALERT_INTERESTS,
  CONTENT_REMOVAL_TYPE,
  PROFILE_REQUEST_TYPES,
  REQUEST_RELATIONSHIPS,
  FIELD_ERROR_CODES,
  FILMING_PERMISSION_STATUSES,
  FOOTAGE_SOURCES,
  LABEL_CHARS_RE,
  LEAD_KINDS,
  LEAD_LANGS,
  LEAD_LIMITS,
  MINORS_VISIBLE_ANSWERS,
  NAME_CHARS_RE,
  TOURNAMENT_LISTING_TYPES,
  VIDEO_SUBMITTER_ROLES,
  clampElapsedMs,
  isStartDateInWindow,
  type FieldErrorCode,
  type LeadKind,
} from './lead-constants';
import { cleanSitePath } from './site-path';
import { cleanText, normaliseEmail, normaliseHttpsUrl, normalisePhone, type TextRules } from '../security/text';

export * from './lead-constants';

// ---------------------------------------------------------------------------------------------------------------
// Field builders
// ---------------------------------------------------------------------------------------------------------------

// The character rules live in lead-constants.ts (R-TEXT) so the browser copy can import the same patterns.
const NAME_CHARS = NAME_CHARS_RE;
const LABEL_CHARS = LABEL_CHARS_RE;
const SLUG = /^[a-z0-9][a-z0-9_-]{0,47}$/;
const VIDEO_ID = /^[A-Za-z0-9_-]{11}$/;

const NAME_RULES: TextRules = { min: LEAD_LIMITS.name.min, max: LEAD_LIMITS.name.max, pattern: NAME_CHARS };
const ORG_RULES: TextRules = { max: LEAD_LIMITS.organization.max, pattern: LABEL_CHARS };
const SHORT_RULES: TextRules = { max: LEAD_LIMITS.shortText.max, pattern: LABEL_CHARS };
const TINY_RULES: TextRules = { max: LEAD_LIMITS.tinyText.max, pattern: LABEL_CHARS };
const LIST_ITEM_RULES: TextRules = { max: LEAD_LIMITS.listItemText.max, pattern: LABEL_CHARS };
const LONG_RULES: TextRules = { max: LEAD_LIMITS.longText.max, multiline: true };
const NOTE_RULES: TextRules = { max: LEAD_LIMITS.noteText.max, multiline: true };

type Ctx = z.core.$RefinementCtx<unknown>;
const fail = (ctx: Ctx, code: FieldErrorCode, input: unknown): typeof z.NEVER => {
  ctx.issues.push({ code: 'custom', message: code, input });
  return z.NEVER;
};

/** Required single or multi-line text. */
function reqText(rules: TextRules) {
  return z.string().transform((raw, ctx) => {
    if (raw.trim() === '') return fail(ctx, 'required', raw);
    const r = cleanText(raw, rules);
    return r.ok ? r.value : fail(ctx, r.issue, raw);
  });
}

/** Optional text: absent or blank becomes undefined. */
function optText(rules: TextRules) {
  return z
    .string()
    .optional()
    .transform((raw, ctx) => {
      if (raw === undefined || raw.trim() === '') return undefined;
      const r = cleanText(raw, rules);
      return r.ok ? r.value : fail(ctx, r.issue, raw);
    });
}

/** A real calendar date in 2000-2100. The start-date WINDOW (R-DATE: yesterday to three years ahead) is checked in validateLeadRequest, which has the clock. */
const isRealDate = (s: string): boolean => {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s);
  if (!m) return false;
  const [y, mo, d] = [Number(m[1]), Number(m[2]), Number(m[3])];
  if (y < 2000 || y > 2100) return false;
  const t = new Date(Date.UTC(y, mo - 1, d));
  return t.getUTCFullYear() === y && t.getUTCMonth() === mo - 1 && t.getUTCDate() === d;
};

/** Event dates are plain `YYYY-MM-DD` read as Asia/Kolkata (D-030). */
function optDate() {
  return z
    .string()
    .optional()
    .transform((raw, ctx) => {
      if (raw === undefined || raw.trim() === '') return undefined;
      return isRealDate(raw.trim()) ? raw.trim() : fail(ctx, 'invalid_date', raw);
    });
}
function reqDate() {
  return z.string().transform((raw, ctx) => {
    if (raw.trim() === '') return fail(ctx, 'required', raw);
    return isRealDate(raw.trim()) ? raw.trim() : fail(ctx, 'invalid_date', raw);
  });
}

function optMonth() {
  return z
    .string()
    .optional()
    .transform((raw, ctx) => {
      if (raw === undefined || raw.trim() === '') return undefined;
      const m = /^(\d{4})-(0[1-9]|1[0-2])$/.exec(raw.trim());
      return m && Number(m[1]) >= 2000 && Number(m[1]) <= 2100 ? raw.trim() : fail(ctx, 'invalid_date', raw);
    });
}

function optUrl() {
  return z
    .string()
    .optional()
    .transform((raw, ctx) => {
      if (raw === undefined || raw.trim() === '') return undefined;
      const u = normaliseHttpsUrl(raw, LEAD_LIMITS.url.max);
      return u ?? fail(ctx, 'invalid_url', raw);
    });
}

/** Integer in a range; HTML inputs send strings, so a digit string is accepted too. Blank = undefined. */
function optInt(min: number, max: number) {
  return z
    .union([z.number(), z.string()])
    .optional()
    .transform((raw, ctx) => {
      if (raw === undefined || (typeof raw === 'string' && raw.trim() === '')) return undefined;
      const n = typeof raw === 'number' ? raw : /^\d{1,6}$/.test(raw.trim()) ? Number(raw.trim()) : Number.NaN;
      return Number.isInteger(n) && n >= min && n <= max ? n : fail(ctx, 'invalid', raw);
    });
}

function slugList(max = LEAD_LIMITS.listItems.max) {
  return z
    .array(z.string())
    .max(max)
    .optional()
    .transform((arr, ctx) => {
      if (!arr || arr.length === 0) return undefined;
      const out: string[] = [];
      for (const item of arr) {
        const s = item.trim().toLowerCase();
        if (!SLUG.test(s)) return fail(ctx, 'invalid', item);
        if (!out.includes(s)) out.push(s);
      }
      return out;
    });
}

function textList(rules: TextRules, max = LEAD_LIMITS.listItems.max) {
  return z
    .array(z.string())
    .max(max)
    .optional()
    .transform((arr, ctx) => {
      if (!arr || arr.length === 0) return undefined;
      const out: string[] = [];
      for (const item of arr) {
        if (item.trim() === '') continue;
        const r = cleanText(item, rules);
        if (!r.ok) return fail(ctx, r.issue, item);
        if (!out.includes(r.value)) out.push(r.value);
      }
      return out.length === 0 ? undefined : out;
    });
}

const optSlug = () =>
  z
    .string()
    .optional()
    .transform((raw, ctx) => {
      if (raw === undefined || raw.trim() === '') return undefined;
      const s = raw.trim().toLowerCase();
      return SLUG.test(s) ? s : fail(ctx, 'invalid', raw);
    });

const reqSlug = () =>
  z.string().transform((raw, ctx) => {
    if (raw.trim() === '') return fail(ctx, 'required', raw);
    const s = raw.trim().toLowerCase();
    return SLUG.test(s) ? s : fail(ctx, 'invalid', raw);
  });

const phoneRequired = z.string().transform((raw, ctx) => {
  if (raw.trim() === '') return fail(ctx, 'required', raw);
  return normalisePhone(raw) ?? fail(ctx, 'invalid_phone', raw);
});

const phoneOptional = z
  .string()
  .optional()
  .transform((raw, ctx) => {
    if (raw === undefined || raw.trim() === '') return undefined;
    return normalisePhone(raw) ?? fail(ctx, 'invalid_phone', raw);
  });

const emailOptional = z
  .string()
  .optional()
  .transform((raw, ctx) => {
    if (raw === undefined || raw.trim() === '') return undefined;
    return normaliseEmail(raw) ?? fail(ctx, 'invalid_email', raw);
  });

// ---------------------------------------------------------------------------------------------------------------
// Source (page path + UTM): lenient on purpose. A bad value is dropped, it never costs us the lead.
// ---------------------------------------------------------------------------------------------------------------

const UTM_KEYS = ['source', 'medium', 'campaign', 'term', 'content'] as const;
const UTM_VALUE_CHARS = /^[\p{L}\p{M}\p{N}_. \-]+$/u;
export type UtmKey = (typeof UTM_KEYS)[number];
export interface LeadSource {
  path?: string;
  utm?: Partial<Record<UtmKey, string>>;
}

function sanitiseSource(raw: { path?: string; utm?: Record<string, string> } | undefined): LeadSource | undefined {
  if (!raw) return undefined;
  const out: LeadSource = {};
  const path = cleanSitePath(raw.path); // S-14: one leading slash, no '//', no backslash, no '..'
  if (path) out.path = path;
  if (raw.utm && typeof raw.utm === 'object') {
    const utm: Partial<Record<UtmKey, string>> = {};
    for (const key of UTM_KEYS) {
      const v = raw.utm[key];
      if (typeof v !== 'string') continue;
      // S-14: letters, digits, space and _ . - only (no ':' '/' ',' '%' '+'), and never a leading = + - @ (formula starters).
      const r = cleanText(v, { max: LEAD_LIMITS.utmValue.max, allowUrl: true, allowFormula: false, allowManyDigits: true, allowAngle: false, pattern: UTM_VALUE_CHARS });
      if (r.ok) utm[key] = r.value;
    }
    if (Object.keys(utm).length > 0) out.utm = utm;
  }
  return out.path || out.utm ? out : undefined;
}

const sourceSchema = z
  .object({
    path: z.string().max(2000).optional(),
    utm: z.record(z.string().max(100), z.string().max(500)).optional(),
  })
  .optional()
  .catch(undefined)
  .transform(sanitiseSource);

// ---------------------------------------------------------------------------------------------------------------
// Consent (D-028): the id and version of the notice the visitor saw, from src/content/consent.ts
// ---------------------------------------------------------------------------------------------------------------

const versionString = z.string().regex(/^[A-Za-z0-9._-]{1,40}$/, { message: 'invalid' });

const leadConsent = z.object({
  id: z.literal(CONSENT.leadNotice.id, { message: 'invalid' }),
  version: versionString,
});

const publicContactConsent = z
  .object({
    id: z.literal(CONSENT.tournamentPublicContact.id, { message: 'invalid' }),
    version: versionString,
    /** The separate, unticked-by-default checkbox value. */
    given: z.boolean(),
  })
  .optional();

// ---------------------------------------------------------------------------------------------------------------
// Common fields
// ---------------------------------------------------------------------------------------------------------------

const commonShape = {
  name: reqText(NAME_RULES),
  organization: optText(ORG_RULES),
  email: emailOptional,
  /** The visitor ticked "this number is on WhatsApp". Never pre-ticked. */
  whatsappOk: z.boolean().default(false),
  contactPreference: z.enum(CONTACT_PREFERENCES).optional(),
  lang: z.enum(LEAD_LANGS).default('en'),
  source: sourceSchema,
  /** One uuid (crypto.randomUUID()) per form instance; a retry of the same submission re-sends it (idempotency). */
  idempotencyKey: z.uuid({ message: 'invalid' }),
  /** Cloudflare Turnstile response token. */
  token: z.string().regex(/^[A-Za-z0-9._-]{1,2048}$/, { message: 'invalid' }),
  consent: leadConsent,
  /** Honeypot. Must stay empty; hidden from people (off-screen, aria-hidden, tabindex -1, autocomplete off). */
  website: z.string().max(200).optional(),
  /** Milliseconds from the visitor's first interaction to submit; used for the minimum fill time. Optional. */
  /** R-ELAPSED: clamped into 0..24 h by the server (a non-integer counts as 0); never a reason to reject the request. */
  elapsedMs: z
    .unknown()
    .optional()
    .transform((v) => (v === undefined || v === null ? undefined : clampElapsedMs(v))),
};

const phoneRequiredShape = { phone: phoneRequired };

// ---------------------------------------------------------------------------------------------------------------
// Kinds
// ---------------------------------------------------------------------------------------------------------------

const endAfterStart = (val: { startDate?: string; endDate?: string }, ctx: Ctx) => {
  if (val.startDate && val.endDate && val.endDate < val.startDate) {
    ctx.issues.push({ code: 'custom', message: 'invalid_date', input: val.endDate, path: ['endDate'] });
  }
};

/** Spec 7.10: coverage enquiry (a.k.a. "Book coverage"). */
export const coverageLeadSchema = z
  .object({
    kind: z.literal('coverage'),
    ...commonShape,
    ...phoneRequiredShape,
    // Event
    eventName: reqText(SHORT_RULES),
    startDate: optDate(), // D-025 step 1 asks for it; the form should require it
    endDate: optDate(),
    venue: optText(SHORT_RULES),
    district: optText({ ...TINY_RULES }),
    level: optText({ ...TINY_RULES, max: 40 }),
    courts: optInt(1, 64),
    categories: textList(LIST_ITEM_RULES),
    expectedEntries: optInt(1, 10_000),
    // Services
    packageKey: optSlug(),
    serviceKeys: slugList(),
    liveStream: z.boolean().optional(),
    matchDays: optInt(1, 30),
    addOns: slugList(),
    // Rights groundwork (D-019): organizer or promoting association, and has written permission been agreed?
    organizerName: optText(ORG_RULES),
    filmingPermission: z.enum(FILMING_PERMISSION_STATUSES).optional(),
    // Contact step
    budgetRange: optText(TINY_RULES),
    notes: optText(LONG_RULES),
  })
  .superRefine(endAfterStart);

/** Spec 7.11: sponsorship enquiry. */
export const sponsorshipLeadSchema = z.object({
  kind: z.literal('sponsorship'),
  ...commonShape,
  ...phoneRequiredShape,
  company: reqText(ORG_RULES),
  companyUrl: optUrl(),
  objectives: optText(LONG_RULES),
  budgetRange: optText(TINY_RULES),
  /** `YYYY-MM` */
  startMonth: optMonth(),
  packageKey: optSlug(),
  notes: optText(LONG_RULES),
});

/** Contact page / anything else. Needs a phone or an email. */
export const generalLeadSchema = z
  .object({
    kind: z.literal('general'),
    ...commonShape,
    phone: phoneOptional,
    message: reqText({ ...LONG_RULES, min: 5 }),
    topic: optSlug(),
  })
  .superRefine((val, ctx) => {
    if (!val.phone && !val.email) {
      ctx.issues.push({ code: 'custom', message: 'contact_required', input: undefined, path: ['phone'] });
    }
  });

/** Future use (HD file, season pack...). Keep minimal: no free-text player names, no minors' data (D-012). */
export const playerProductLeadSchema = z.object({
  kind: z.literal('player_product'),
  ...commonShape,
  ...phoneRequiredShape,
  productKey: reqSlug(),
  /** Slug of a PUBLIC player page the request relates to. Never for a protected player. */
  playerSlug: z
    .string()
    .optional()
    .transform((raw, ctx) => {
      if (raw === undefined || raw.trim() === '') return undefined;
      const s = raw.trim().toLowerCase();
      return /^[a-z0-9][a-z0-9-]{0,79}$/.test(s) ? s : fail(ctx, 'invalid', raw);
    }),
  /** YouTube video ids (11 characters). */
  matchRefs: z
    .array(z.string())
    .max(5)
    .optional()
    .transform((arr, ctx) => {
      if (!arr || arr.length === 0) return undefined;
      const out: string[] = [];
      for (const item of arr) {
        if (!VIDEO_ID.test(item.trim())) return fail(ctx, 'invalid', item);
        if (!out.includes(item.trim())) out.push(item.trim());
      }
      return out;
    }),
  notes: optText(NOTE_RULES),
});

/** Spec 7.8: list your tournament. Stored as a pending lead; M3 turns it into a tournament record. No file upload in M1 (D-035). */
export const tournamentSubmissionLeadSchema = z
  .object({
    kind: z.literal('tournament_submission'),
    ...commonShape,
    ...phoneRequiredShape,
    // `name` = the contact person, `organization` = the organizer or association.
    tournamentName: reqText(SHORT_RULES),
    startDate: reqDate(),
    endDate: optDate(),
    venue: optText(SHORT_RULES),
    city: optText(TINY_RULES),
    district: optText(TINY_RULES),
    categories: textList(LIST_ITEM_RULES),
    ageGroups: textList(LIST_ITEM_RULES),
    entryFee: optText(TINY_RULES),
    registrationDetails: optText(NOTE_RULES),
    /** https link only. */
    registrationLink: optUrl(),
    /** Poster as an https link only (no upload in M1, D-035). */
    posterUrl: optUrl(),
    /** Separate checkbox: may the contact be shown publicly on the tournament page? Absent or `given: false` = no. */
    publicContactConsent,
    listingType: z.enum(TOURNAMENT_LISTING_TYPES).default('free'),
    /** "I'm interested in Power Smash coverage": the handler also creates a coverage lead. */
    coverageInterest: z.boolean().default(false),
  })
  .superRefine(endAfterStart);

// ---------------------------------------------------------------------------------------------------------------
// M3 kinds (additive): video_submission (spec 7.12, D-019) and alerts_signup (spec 8.7, D-026)
// ---------------------------------------------------------------------------------------------------------------

/**
 * A separate consent tick box (never pre-ticked). The client sends `{ id, version, given }`; the server accepts only `given: true`
 * (the box is required), reports `consent_required` on `<field>.given` otherwise, and stores the id and version (consent_events).
 */
const tickedConsent = (id: string) =>
  z.object({
    id: z.literal(id, { message: 'invalid' }),
    version: versionString,
    given: z.boolean(),
  });

/** One required `given: true` check per consent field of a kind. */
const requireTicks = (keys: readonly string[]) => (val: Record<string, unknown>, ctx: Ctx) => {
  for (const key of keys) {
    const c = val[key] as { given?: boolean } | undefined;
    if (c && c.given !== true) ctx.issues.push({ code: 'custom', message: 'consent_required', input: undefined, path: [key, 'given'] });
  }
};

const emailRequired = z.string().transform((raw, ctx) => {
  if (raw.trim() === '') return fail(ctx, 'required', raw);
  return normaliseEmail(raw) ?? fail(ctx, 'invalid_email', raw);
});

/** Required https link. It is stored as text only: never fetched, never embedded. */
const reqUrl = () =>
  z.string().transform((raw, ctx) => {
    if (raw.trim() === '') return fail(ctx, 'required', raw);
    return normaliseHttpsUrl(raw, LEAD_LIMITS.url.max) ?? fail(ctx, 'invalid_url', raw);
  });

const VIDEO_CONSENT_KEYS = ['adultConfirmation', 'videoRights', 'videoLicence', 'videoRemoval'] as const;

/** Spec 7.12: send your match video. A link only (no upload). Stored as a lead for the owner's review; nothing is published from here. */
export const videoSubmissionLeadSchema = z
  .object({
    kind: z.literal('video_submission'),
    ...commonShape,
    ...phoneRequiredShape,
    /** `name` = the submitter. */
    role: z.enum(VIDEO_SUBMITTER_ROLES),
    /** https link only, stored as text. */
    videoUrl: reqUrl(),
    tournamentName: optText(SHORT_RULES),
    /** The match day (a real date; past dates are normal here, so there is no window). */
    matchDate: optDate(),
    category: optText(TINY_RULES),
    round: optText(TINY_RULES),
    /** Players on each side, free text ("A and B vs C and D"). */
    players: optText(SHORT_RULES),
    notes: optText(LONG_RULES),
    // Rights (D-019, licence draft 2.2 and 2.3)
    footageSource: z.enum(FOOTAGE_SOURCES),
    organizerName: optText(ORG_RULES),
    filmingPermission: z.enum(FILMING_PERMISSION_STATUSES).optional(),
    minorsVisible: z.enum(MINORS_VISIBLE_ANSWERS),
    adultConfirmation: tickedConsent(CONSENT.adultConfirmation.id),
    videoRights: tickedConsent(CONSENT.videoRights.id),
    videoLicence: tickedConsent(CONSENT.videoLicence.id),
    videoRemoval: tickedConsent(CONSENT.videoRemoval.id),
  })
  .superRefine(requireTicks(VIDEO_CONSENT_KEYS));

const ALERT_CONSENT_KEYS = ['alertsConsent', 'adultConfirmation'] as const;

/**
 * Spec 8.7, D-026: email alerts sign-up. NO phone number is collected (a `phone` sent anyway is dropped). Double opt-in: the row is
 * stored as `new` and nothing is sent until the email path is on (EMAIL_ENABLED); see docs/m1/m3-slice-notes.md.
 */
export const alertsSignupLeadSchema = z
  .object({
    kind: z.literal('alerts_signup'),
    ...commonShape,
    email: emailRequired,
    phone: z
      .unknown()
      .optional()
      .transform((): undefined => undefined),
    district: optText(TINY_RULES),
    interests: z.array(z.enum(ALERT_INTERESTS)).max(ALERT_INTERESTS.length).optional(),
    alertsConsent: tickedConsent(CONSENT.alertsSignup.id),
    adultConfirmation: tickedConsent(CONSENT.adultConfirmation.id),
  })
  .superRefine(requireTicks(ALERT_CONSENT_KEYS));

// ---------------------------------------------------------------------------------------------------------------
// Request kinds (additive): profile_request and content_removal (spec 7.5 footer, 15.3, 15.6, D-012, D-015, D-019). ONE form with a
// type selector: the form sends `content_removal` for "remove a video or page" and `profile_request` for the rest. Both carry the
// request notice (CONSENT.requestNotice, a NOTICE: id and version stored, no tick). A parent or guardian is verified LATER by a
// one-time code on their own phone; nothing here does that, and nothing here hides or removes anything by itself.
// ---------------------------------------------------------------------------------------------------------------

const requestConsent = z.object({
  id: z.literal(CONSENT.requestNotice.id, { message: 'invalid' }),
  version: versionString,
});

/** The link or description of the profile, video or page. Text only: stored, never fetched, opened or embedded. */
const WHAT_RULES: TextRules = { max: LEAD_LIMITS.requestWhat.max, allowUrl: true, allowManyDigits: true };

const requestShape = {
  ...commonShape,
  consent: requestConsent,
  ...phoneRequiredShape,
  /** `name` = the person asking. */
  what: reqText(WHAT_RULES),
  relationship: z.enum(REQUEST_RELATIONSHIPS),
  details: optText(LONG_RULES),
};

/** Claim a profile, correct details, or hide a profile (a player, or a parent or guardian on their behalf). */
export const profileRequestLeadSchema = z.object({
  kind: z.literal('profile_request'),
  ...requestShape,
  requestType: z.enum(PROFILE_REQUEST_TYPES),
});

/** Remove a video or other content (a player, a parent or guardian, or a rights holder). */
export const contentRemovalLeadSchema = z.object({
  kind: z.literal('content_removal'),
  ...requestShape,
  requestType: z.literal(CONTENT_REMOVAL_TYPE),
});

export const leadRequestSchema = z.discriminatedUnion('kind', [
  coverageLeadSchema,
  sponsorshipLeadSchema,
  generalLeadSchema,
  playerProductLeadSchema,
  tournamentSubmissionLeadSchema,
  videoSubmissionLeadSchema,
  alertsSignupLeadSchema,
  profileRequestLeadSchema,
  contentRemovalLeadSchema,
]);

export type LeadRequestInput = z.input<typeof leadRequestSchema>;
export type LeadRequest = z.output<typeof leadRequestSchema>;
export type CoverageLeadRequest = Extract<LeadRequest, { kind: 'coverage' }>;
export type SponsorshipLeadRequest = Extract<LeadRequest, { kind: 'sponsorship' }>;
export type GeneralLeadRequest = Extract<LeadRequest, { kind: 'general' }>;
export type PlayerProductLeadRequest = Extract<LeadRequest, { kind: 'player_product' }>;
export type TournamentSubmissionLeadRequest = Extract<LeadRequest, { kind: 'tournament_submission' }>;

export type VideoSubmissionLeadRequest = Extract<LeadRequest, { kind: 'video_submission' }>;
export type AlertsSignupLeadRequest = Extract<LeadRequest, { kind: 'alerts_signup' }>;
export type ProfileRequestLeadRequest = Extract<LeadRequest, { kind: 'profile_request' }>;
export type ContentRemovalLeadRequest = Extract<LeadRequest, { kind: 'content_removal' }>;

export const isLeadKind = (v: unknown): v is LeadKind => typeof v === 'string' && (LEAD_KINDS as readonly string[]).includes(v);

// ---------------------------------------------------------------------------------------------------------------
// Validation entry point and error mapping
// ---------------------------------------------------------------------------------------------------------------

const FIELD_CODE_SET = new Set<string>(FIELD_ERROR_CODES);

function valueAt(root: unknown, path: readonly PropertyKey[]): unknown {
  let cur: unknown = root;
  for (const key of path) {
    if (cur === null || typeof cur !== 'object') return undefined;
    cur = (cur as Record<PropertyKey, unknown>)[key];
  }
  return cur;
}

/** Turn zod issues into `{ 'field.path': FieldErrorCode }`. The first issue per field wins. Never echoes input values. */
export function mapZodIssues(issues: readonly z.core.$ZodIssue[], rawInput: unknown): Record<string, FieldErrorCode> {
  const out: Record<string, FieldErrorCode> = {};
  for (const issue of issues) {
    const path = issue.path.length > 0 ? issue.path.map(String).join('.') : '_';
    if (out[path]) continue;
    const raw = valueAt(rawInput, issue.path);
    const blank = raw === undefined || raw === null || (typeof raw === 'string' && raw.trim() === '');
    let code: FieldErrorCode;
    if (issue.code === 'custom' && FIELD_CODE_SET.has(issue.message)) code = issue.message as FieldErrorCode;
    else if (issue.code === 'invalid_type') code = blank ? 'required' : 'invalid';
    else if (issue.code === 'too_small') code = blank ? 'required' : 'too_short';
    else if (issue.code === 'too_big') code = 'too_long';
    else if (issue.code === 'invalid_union' && path === 'kind') code = 'invalid';
    else code = blank ? 'required' : 'invalid';
    out[path] = code;
  }
  return out;
}

export type ValidateLeadResult = { ok: true; data: LeadRequest } | { ok: false; fieldErrors: Record<string, FieldErrorCode> };

export interface ValidateLeadOptions {
  /** The clock for the start-date window (R-DATE). Default: the real time. Injected in tests and by the handler. */
  now?: Date;
}

/** R-DATE: kinds that carry a start date the visitor types; it must lie from yesterday (IST) to 1,095 days ahead. */
const KINDS_WITH_START_DATE = new Set<string>(['coverage', 'tournament_submission']);

export function validateLeadRequest(body: unknown, options: ValidateLeadOptions = {}): ValidateLeadResult {
  if (body === null || typeof body !== 'object' || Array.isArray(body)) return { ok: false, fieldErrors: { _: 'invalid' } };
  const parsed = leadRequestSchema.safeParse(body);
  const fieldErrors: Record<string, FieldErrorCode> = parsed.success ? {} : mapZodIssues(parsed.error.issues, body);
  // R-DATE: a real date outside the window gets its own code (the same plain-English message on the client).
  const { kind, startDate } = body as { kind?: unknown; startDate?: unknown };
  if (typeof kind === 'string' && KINDS_WITH_START_DATE.has(kind) && typeof startDate === 'string' && !fieldErrors.startDate) {
    const date = startDate.trim();
    if (isRealDate(date) && !isStartDateInWindow(date, options.now ?? new Date())) fieldErrors.startDate = 'date_out_of_range';
  }
  if (parsed.success && Object.keys(fieldErrors).length === 0) return { ok: true, data: parsed.data };
  return { ok: false, fieldErrors };
}

/** Fields every kind shares (stored in dedicated columns); everything else goes to the `payload` jsonb column. */
export const COMMON_LEAD_KEYS = [
  'kind',
  'name',
  'organization',
  'phone',
  'email',
  'whatsappOk',
  'contactPreference',
  'lang',
  'source',
  'idempotencyKey',
  'token',
  'consent',
  'website',
  'elapsedMs',
] as const;
