// Registration rules shared by the browser form and the /api/register function (D-111). NO zod here, so the form can import this
// file without shipping the validation library (the zod contract is ./contract.ts, server and tests only). A change here is a change
// on both sides; tests/registration/parity.test.ts keeps them in step.
//
// What a registration is: one event, the player name(s) AS TYPED, a contact phone and an optional email (private, never public), the
// notice id and version the person saw, and an optional payment reference (a UPI or bank transaction reference). There is NO age field:
// a self-claimed age is never trusted (D-012). Nothing is charged on the site; card and UPI credentials are never asked for.
import { MIN_FILL_MS, clampElapsedMs, ELAPSED_MS_MAX, NAME_CHARS_RE } from '../contracts/lead-constants';
import { cleanText, normaliseEmail, normalisePhone, type TextIssue } from '../security/text';

export { MIN_FILL_MS, clampElapsedMs, ELAPSED_MS_MAX };

export const REGISTRATION_ENDPOINT = '/api/register';

/** Field limits in Unicode code points. The form sets `maxlength` from these. */
export const REGISTRATION_LIMITS = {
  name: { min: 2, max: 80 },
  email: { max: 254 },
  paymentReference: { min: 8, max: 30 },
  turnstileToken: { max: 2048 },
  /** JSON body cap in bytes. */
  bodyBytes: 8 * 1024,
} as const;

/** A person's name: the same characters the lead forms accept (letters of any script, digits, space and . , ' ( ) -). */
export const REGISTRATION_NAME_RE = NAME_CHARS_RE;

/** Machine codes in `{ ok: false, code }`. */
export const REGISTRATION_ERROR_CODES = [
  'closed', // [409] registration is switched off, or this event does not take registrations now
  'validation', // [400/413/415/422] see fieldErrors
  'turnstile', // [403] the spam check failed, expired or was missing
  'rate_limited', // [429] too many tries, or sent too fast
  'duplicate', // [409] the idempotencyKey was used for a different registration
  'already_registered', // [409] this player is already registered for this event from this phone
  'full', // [409] the event has no places left
  'degraded', // [503] we could not store it: message us on WhatsApp
  'server', // [500] unexpected error
] as const;
export type RegistrationErrorCode = (typeof REGISTRATION_ERROR_CODES)[number];

export const REGISTRATION_ERROR_STATUS: Record<RegistrationErrorCode, number> = {
  closed: 409,
  validation: 422,
  turnstile: 403,
  rate_limited: 429,
  duplicate: 409,
  already_registered: 409,
  full: 409,
  degraded: 503,
  server: 500,
};

export const REGISTRATION_ERROR_MESSAGES: Record<RegistrationErrorCode, string> = {
  closed: 'Registration for this event is not open on the website right now.',
  validation: 'Some details need fixing. Please check the highlighted boxes.',
  turnstile: 'The spam check did not pass. Please try the check again.',
  rate_limited: 'Too many tries. Please wait a few minutes and try again.',
  duplicate: 'This registration was already sent. Please refresh the page and try again.',
  already_registered: 'This player is already registered for this event from this phone number.',
  full: 'Sorry, this event has no places left.',
  degraded: 'We could not save your registration just now. Please message us on WhatsApp so it is not lost.',
  server: 'Something went wrong on our side. Please try again later or message us on WhatsApp.',
};

/** Per-field codes in `fieldErrors`. */
export const REGISTRATION_FIELD_CODES = [
  'required',
  'too_short',
  'too_long',
  'invalid',
  'invalid_phone',
  'invalid_email',
  'invalid_reference',
  'card_not_allowed',
  'partner_required',
  'partner_not_allowed',
  'consent_required',
] as const;
export type RegistrationFieldCode = (typeof REGISTRATION_FIELD_CODES)[number];

export const REGISTRATION_FIELD_MESSAGES: Record<RegistrationFieldCode, string> = {
  required: 'Please fill this in.',
  too_short: 'This is too short.',
  too_long: 'This is too long. Please shorten it.',
  invalid: 'Please use letters, spaces and . , \' ( ) - only.',
  invalid_phone: 'Please enter a valid mobile number with 10 digits.',
  invalid_email: 'Please enter a valid email address, or leave it empty.',
  invalid_reference: 'The payment reference is 8 to 30 letters and digits, for example the 12-digit UPI reference. Leave it empty if you have not paid yet.',
  card_not_allowed: 'This looks like a card number. Never type card details here: we only need the payment reference.',
  partner_required: 'This is a doubles event: please give your partner\'s name too (a different name).',
  partner_not_allowed: 'This is a singles event: leave the partner\'s name empty.',
  consent_required: 'Please tick this to continue.',
};

/** Singles categories take one player, doubles two (the same rule as admin_add_entry and registration_submit in SQL). */
export const SINGLES_CATEGORIES = ['MS', 'WS', 'BS', 'GS'] as const;
export function playersForCategory(category: string): 1 | 2 {
  return (SINGLES_CATEGORIES as readonly string[]).includes(category) ? 1 : 2;
}

// ---------------------------------------------------------------------------------------------------------------
// Payment reference: a UPI or bank transaction reference (UTR). Spaces and hyphens are removed, letters are made capital; then it must
// be 8 to 30 letters and digits. 13 to 19 digits that pass the Luhn check look like a CARD NUMBER and are refused, so a card number
// typed by mistake is never stored or sent (the same rule is app.registration_card_like in SQL).
// ---------------------------------------------------------------------------------------------------------------
const PAYMENT_REF_RE = /^[A-Z0-9]{8,30}$/;

export function luhnValid(digits: string): boolean {
  let sum = 0;
  let double = false;
  for (let i = digits.length - 1; i >= 0; i -= 1) {
    let d = digits.charCodeAt(i) - 48;
    if (double) {
      d *= 2;
      if (d > 9) d -= 9;
    }
    sum += d;
    double = !double;
  }
  return sum % 10 === 0;
}

export function looksLikeCardNumber(value: string): boolean {
  const digits = value.replace(/[\s-]/g, '');
  return /^\d{13,19}$/.test(digits) && luhnValid(digits);
}

export type PaymentReferenceCheck = { ok: true; value: string | null } | { ok: false; code: 'invalid_reference' | 'card_not_allowed' };

/** Blank = no reference (null). Otherwise the cleaned reference, or why it is refused. */
/** Words that mean someone is typing a secret, not a reference: such text is refused whole, never cleaned and stored. */
const SECRET_WORDS = /\b(?:m?pin|password|passcode|otp|cvv|cvc|expiry)\b/i;

export function normalisePaymentReference(raw: string | null | undefined): PaymentReferenceCheck {
  const typed = (raw ?? '').normalize('NFKC');
  const s = typed.replace(/[\s-]/g, '').toUpperCase();
  if (s === '') return { ok: true, value: null };
  if (looksLikeCardNumber(s)) return { ok: false, code: 'card_not_allowed' };
  if (SECRET_WORDS.test(typed)) return { ok: false, code: 'invalid_reference' };
  // a transaction reference is mostly digits (a UPI reference is 12): at least 6 digits, the same rule as the SQL check (0020)
  if (!PAYMENT_REF_RE.test(s) || s.replace(/\D/g, '').length < 6) return { ok: false, code: 'invalid_reference' };
  return { ok: true, value: s };
}

/** Name key used for "is this the same player?" (lower case, single spaces); mirrors event_registrations.player_key in SQL. */
export function playerNameKey(name: string): string {
  return name.trim().replace(/\s+/g, ' ').toLowerCase();
}

/** Reference shape: PSR-<IST year>-<6 characters of Crockford base32 without I L O U>. */
export const REGISTRATION_REF_PATTERN = /^PSR-\d{4}-[0-9A-HJKMNP-TV-Z]{6}$/;

/** The name of the honeypot input (must stay empty; the same trick as the lead forms). */
export const REGISTRATION_HONEYPOT = 'website';

export interface RegistrationSuccessResponse {
  ok: true;
  ref: string;
  /** The fee shown when the person registered (integer paise), or null when none was shown. */
  feePaise: number | null;
  /** WhatsApp link quoting the reference (no personal data), absent when no number is configured. */
  waLink?: string;
  replay?: boolean;
}

export interface RegistrationErrorResponse {
  ok: false;
  code: RegistrationErrorCode;
  message: string;
  fieldErrors?: Record<string, RegistrationFieldCode>;
  waLink?: string;
  correlationId: string;
  retryAfterSec?: number;
  /** degraded only: the provisional reference quoted in the WhatsApp text (nothing was stored). */
  ref?: string;
}

export type RegistrationResponse = RegistrationSuccessResponse | RegistrationErrorResponse;

/** The request body the form sends (the server re-checks every field). */
export interface RegistrationRequestBody {
  eventId: string;
  player1Name: string;
  player2Name?: string;
  phone: string;
  email?: string;
  whatsappOk?: boolean;
  paymentReference?: string;
  /** given is the tick box itself: the server stores consent only when it is exactly true. */
  consent: { id: string; version: string; given: boolean };
  idempotencyKey: string;
  token: string;
  website?: string;
  elapsedMs?: number;
}

const NAME_ISSUE: Record<TextIssue, RegistrationFieldCode> = {
  too_short: 'too_short',
  too_long: 'too_long',
  control_chars: 'invalid',
  url_not_allowed: 'invalid',
  formula_not_allowed: 'invalid',
  html_not_allowed: 'invalid',
  too_many_digits: 'invalid',
  invalid: 'invalid',
};

/** A player's name as the lead forms clean a name (cleanText with the name characters): the cleaned value, or why it is refused. */
export function cleanPlayerName(raw: string): { ok: true; value: string } | { ok: false; code: RegistrationFieldCode } {
  if (raw.trim() === '') return { ok: false, code: 'required' };
  const r = cleanText(raw, { min: REGISTRATION_LIMITS.name.min, max: REGISTRATION_LIMITS.name.max, pattern: REGISTRATION_NAME_RE });
  return r.ok ? r : { ok: false, code: NAME_ISSUE[r.issue] };
}

export interface RegistrationFieldValues {
  player1Name: string;
  player2Name: string;
  phone: string;
  email: string;
  paymentReference: string;
  consent: boolean;
}

export interface CleanRegistrationFields {
  player1Name: string;
  player2Name: string | null;
  phone: string;
  email: string | null;
  paymentReference: string | null;
}

export type RegistrationFieldCheck = { ok: true; value: CleanRegistrationFields } | { ok: false; fieldErrors: Record<string, RegistrationFieldCode> };

/**
 * THE field rules, run by the form before sending and by the server after the shape check (one function, so the two can never
 * disagree). `playersNeeded` comes from the event's category (playersForCategory); the server's database checks it again.
 */
export function checkRegistrationFields(v: RegistrationFieldValues, playersNeeded: 1 | 2): RegistrationFieldCheck {
  const errors: Record<string, RegistrationFieldCode> = {};
  const p1 = cleanPlayerName(v.player1Name);
  if (!p1.ok) errors.player1Name = p1.code;
  let p2: string | null = null;
  if (playersNeeded === 2) {
    const r = cleanPlayerName(v.player2Name);
    if (!r.ok) errors.player2Name = r.code === 'required' ? 'partner_required' : r.code;
    else if (p1.ok && playerNameKey(r.value) === playerNameKey(p1.value)) errors.player2Name = 'partner_required';
    else p2 = r.value;
  } else if (v.player2Name.trim() !== '') {
    errors.player2Name = 'partner_not_allowed';
  }
  const phone = v.phone.trim() === '' ? null : normalisePhone(v.phone);
  if (v.phone.trim() === '') errors.phone = 'required';
  else if (phone === null) errors.phone = 'invalid_phone';
  const email = v.email.trim() === '' ? null : normaliseEmail(v.email);
  if (v.email.trim() !== '' && email === null) errors.email = 'invalid_email';
  const ref = normalisePaymentReference(v.paymentReference);
  if (!ref.ok) errors.paymentReference = ref.code;
  if (v.consent !== true) errors.consent = 'consent_required';
  if (Object.keys(errors).length > 0 || !p1.ok || phone === null || !ref.ok) return { ok: false, fieldErrors: errors };
  return { ok: true, value: { player1Name: p1.value, player2Name: p2, phone, email, paymentReference: ref.value } };
}
