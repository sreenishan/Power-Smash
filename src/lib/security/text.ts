// Input hygiene primitives for every public form (D-029): control characters, CR/LF, formula text, links where only
// text is expected, over-long values, phone and email normalisation. Pure functions, no I/O, safe to import in tests.
// The lead contract (src/lib/contracts/lead.ts) builds its zod fields from these, and the notify code reuses the
// sanitisers so the same rules apply to anything that is put into a message, a mail header or a CSV cell.
import { stripPhoneIgnorables } from '../contracts/lead-constants';

export type TextIssue =
  | 'too_short'
  | 'too_long'
  | 'control_chars'
  | 'url_not_allowed'
  | 'formula_not_allowed'
  | 'html_not_allowed'
  | 'too_many_digits'
  | 'invalid';

export interface TextRules {
  /** Minimum length in Unicode code points (after trimming). Default 1. */
  min?: number;
  /** Maximum length in Unicode code points (after trimming and normalising). */
  max: number;
  /** Allow line breaks (a textarea). CRLF is normalised to LF; a lone CR is rejected. Default false. */
  multiline?: boolean;
  /** Allow links and handles in the text. In single-line fields the default is to reject them (D-029). */
  allowUrl?: boolean;
  /** Allow a leading = + - @ (spreadsheet formula starters). Single-line default: reject. Multiline default: allow, the CSV export escapes (D-029). */
  allowFormula?: boolean;
  /** Allow a run of more than 6 digits (a phone number pasted into a name field is a spam signal; counted per run of digits, so "Open 2026-27 U19" is fine). */
  allowManyDigits?: boolean;
  /** Allow angle brackets (markup). Single-line default: reject. */
  allowAngle?: boolean;
  /** Optional whitelist pattern the cleaned value must match. */
  pattern?: RegExp;
}

// C0 controls except TAB/LF/CR (handled separately), DEL, C1 controls, soft hyphen, zero-width space, directional
// marks and bidi overrides/isolates, line/paragraph separators, word joiner and invisible operators, BOM.
// Not rejected on purpose: U+200C and U+200D (ZWNJ, ZWJ), which some Indic scripts use.
const BAD_CHARS = /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F-\u009F\u00AD\u200B\u200E\u200F\u2028\u2029\u202A-\u202E\u2060-\u2064\u2066-\u2069\uFEFF]/;
const RAW_CONTROL = /[\u0000-\u001F\u007F-\u009F]/; // any C0/C1 control character, including TAB, CR and LF
const LONE_SURROGATE = /[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/;

// S-4: the cost is linear in the text, however it is built. The old `[\p{L}\p{N}-]{2,}` (any start after a hyphen, scan to the
// end of the run) and `[a-z0-9+.-]*` (any letter is a start) were quadratic: 1,500 hyphens took more than 100 ms.
//  - scheme: found from the `://` backwards (a lookbehind runs only where `://` occurs), at most 32 characters of scheme;
//  - domain: may only START at the beginning of a run of letters, digits and hyphens (the lookbehind also refuses a hyphen),
//    so each run is scanned once, and a label is at most 63 characters (a longer run cannot be a host name).
// tests/security/text-m1-fixes.test.ts holds the timing regression.
const URL_LIKE = new RegExp(
  [
    String.raw`:\/\/(?<=[a-z][a-z0-9+.-]{0,31}:\/\/)`, // any scheme://
    String.raw`\bwww\.`,
    String.raw`\b(?:t\.me|wa\.me|bit\.ly|tinyurl\.com|goo\.gl|youtu\.be)\b`,
    String.raw`(?<![\p{L}\p{N}-])[\p{L}\p{N}-]{2,63}\.(?:com|net|org|in|io|co|me|app|xyz|info|biz|link|top|site|online|shop|store|live|click|ly|gl|cc|tk|ru|cn|dev|page|tech|cloud|ai|us|uk|edu|gov)(?![\p{L}\p{N}])`,
  ].join('|'),
  'iu',
);

export function countUrlLike(text: string): number {
  const global = new RegExp(URL_LIKE.source, 'giu');
  return (text.match(global) ?? []).length;
}

export function codePointLength(s: string): number {
  let n = 0;
  for (const _ of s) n += 1;
  return n;
}

export function digitCount(s: string): number {
  return (s.match(/\p{Nd}/gu) ?? []).length;
}

/** Most digits in one number-like run; one space, dot, hyphen or bracket between digits does not break the run ("98765 43210" is 10, "2026-27 U19" is 6). */
export function longestDigitRun(s: string): number {
  let best = 0;
  for (const m of s.matchAll(/\p{Nd}(?:[ .()-]?\p{Nd})*/gu)) best = Math.max(best, digitCount(m[0]));
  return best;
}

const MAX_RAW_FACTOR = 6; // reject absurd input before doing any work on it

/** Validate and normalise one text value. Never throws. */
export function cleanText(raw: string, rules: TextRules): { ok: true; value: string } | { ok: false; issue: TextIssue } {
  const min = rules.min ?? 1;
  if (raw.length > rules.max * MAX_RAW_FACTOR + 64) return { ok: false, issue: 'too_long' };
  if (LONE_SURROGATE.test(raw)) return { ok: false, issue: 'control_chars' };
  if (BAD_CHARS.test(raw)) return { ok: false, issue: 'control_chars' };

  let s = raw.normalize('NFC');
  if (rules.multiline) {
    s = s.replace(/\r\n/g, '\n');
    if (s.includes('\r')) return { ok: false, issue: 'control_chars' };
    s = s.replace(/\t/g, ' ');
    s = s
      .split('\n')
      .map((line) => line.replace(/[ \u00A0]+$/g, ''))
      .join('\n')
      .replace(/\n{3,}/g, '\n\n')
      .trim();
  } else {
    // Single line: any tab, CR or LF is an attack or a mistake, not content.
    if (/[\t\r\n]/.test(s)) return { ok: false, issue: 'control_chars' };
    s = s.replace(/[ \u00A0]+/g, ' ').trim();
  }

  const length = codePointLength(s);
  if (length < min) return { ok: false, issue: 'too_short' };
  if (length > rules.max) return { ok: false, issue: 'too_long' };

  if (!rules.multiline) {
    if (!rules.allowFormula && /^[=+\-@]/.test(s)) return { ok: false, issue: 'formula_not_allowed' };
    if (!rules.allowAngle && /[<>]/.test(s)) return { ok: false, issue: 'html_not_allowed' };
    if (!rules.allowUrl && (URL_LIKE.test(s) || s.includes('@'))) return { ok: false, issue: 'url_not_allowed' };
    if (!rules.allowManyDigits && longestDigitRun(s) > 6) return { ok: false, issue: 'too_many_digits' };
  } else {
    if (rules.allowFormula === false && /^[=+\-@]/.test(s)) return { ok: false, issue: 'formula_not_allowed' };
    if (!rules.allowUrl && countUrlLike(s) > 2) return { ok: false, issue: 'url_not_allowed' };
  }
  if (rules.pattern && !rules.pattern.test(s)) return { ok: false, issue: 'invalid' };
  return { ok: true, value: s };
}

// ---------------------------------------------------------------------------------------------------------------
// Phone (digits only, with country code, no plus: the form `waLink()` and Telegram links expect)
// ---------------------------------------------------------------------------------------------------------------

// Zero code point of each decimal-digit script commonly typed in India (Tamil first), plus Arabic-Indic and fullwidth.
const DIGIT_ZEROS = [0x0660, 0x06f0, 0x0966, 0x09e6, 0x0a66, 0x0ae6, 0x0b66, 0x0be6, 0x0c66, 0x0ce6, 0x0d66, 0xff10];

export function toAsciiDigits(s: string): string {
  let out = '';
  for (const ch of s) {
    const cp = ch.codePointAt(0) as number;
    if (cp >= 0x30 && cp <= 0x39) {
      out += ch;
      continue;
    }
    const zero = DIGIT_ZEROS.find((z) => cp >= z && cp <= z + 9);
    out += zero === undefined ? ch : String(cp - zero);
  }
  return out;
}

/**
 * Normalise a phone number to digits with country code and no plus sign.
 * - "+91 98765 43210", "098765 43210", "98765-43210", "9876543210" -> "919876543210" (Indian mobile, first digit 6-9)
 * - "+44 7700 900123" -> "447700900123" (an explicit plus means an international number, 8-15 digits)
 * R-PHONE: no-break and thin spaces, zero-width and direction marks (see stripPhoneIgnorables) are removed before any check.
 * Returns null when it is not a plausible number. Letters, brackets other than ( ) and unusual separators are rejected.
 */
export function normalisePhone(raw: string): string | null {
  if (RAW_CONTROL.test(raw)) return null; // a trailing CR/LF is an injection attempt, not whitespace
  // R-PHONE: a number copied from WhatsApp or Contacts carries no-break spaces and direction marks: remove them first.
  const ascii = toAsciiDigits(stripPhoneIgnorables(raw).normalize('NFC')).trim();
  if (ascii.length === 0 || ascii.length > 32) return null;
  if (!/^\+?[0-9 .()\-]+$/.test(ascii)) return null;
  const hasPlus = ascii.startsWith('+');
  const digits = ascii.replace(/\D/g, '');
  if (digits.length < 8 || digits.length > 15) return null;
  if (hasPlus) {
    if (digits.startsWith('91')) return /^91[6-9]\d{9}$/.test(digits) ? digits : null;
    return /^[1-9]\d{7,14}$/.test(digits) ? digits : null;
  }
  if (/^[6-9]\d{9}$/.test(digits)) return `91${digits}`;
  if (/^0[6-9]\d{9}$/.test(digits)) return `91${digits.slice(1)}`;
  if (/^91[6-9]\d{9}$/.test(digits)) return digits;
  if (/^0091[6-9]\d{9}$/.test(digits)) return digits.slice(2);
  return null;
}

// ---------------------------------------------------------------------------------------------------------------
// Email (ASCII only; no display names, no comments, no quoted local parts)
// ---------------------------------------------------------------------------------------------------------------

const EMAIL_RE = /^[A-Za-z0-9.!#$%&'*+/=?^_`{|}~-]{1,64}@[A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?(?:\.[A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?)+$/;

export function normaliseEmail(raw: string): string | null {
  if (raw.length > 400 || RAW_CONTROL.test(raw)) return null;
  const s = raw.trim().toLowerCase();
  if (s.length === 0 || s.length > 254) return null;
  if (BAD_CHARS.test(s) || /[\s\r\n\t,;<>()"\\]/.test(s)) return null;
  if (s.includes('..') || s.startsWith('.') || s.includes('.@')) return null;
  const at = s.indexOf('@');
  if (at < 1 || at !== s.lastIndexOf('@')) return null;
  if (!EMAIL_RE.test(s)) return null;
  if (!/\.[a-z]{2,24}$/.test(s)) return null;
  return s;
}

/**
 * The key the per-email rate limit and the one-acknowledgement-a-day rule use (S-6): the address with the `+tag` removed
 * from the local part, and, for Gmail (gmail.com and googlemail.com), the dots removed too, because those are the same
 * mailbox. `Victim+7@gmail.com` and `v.ictim@googlemail.com` therefore share one bucket with `victim@gmail.com`.
 * Other providers keep their dots (they can be significant). The stored address is NOT changed. Input must already be
 * the output of normaliseEmail.
 */
export function emailRateKey(email: string): string {
  const at = email.lastIndexOf('@');
  if (at < 1) return email;
  let local = email.slice(0, at);
  let domain = email.slice(at + 1);
  const plus = local.indexOf('+');
  if (plus > 0) local = local.slice(0, plus);
  if (domain === 'googlemail.com') domain = 'gmail.com';
  if (domain === 'gmail.com') local = local.replaceAll('.', '');
  return `${local}@${domain}`;
}

// ---------------------------------------------------------------------------------------------------------------
// URLs the visitor may supply (poster, registration link): https only, host checked (D-029)
// ---------------------------------------------------------------------------------------------------------------

const HOST_RE = /^(?=.{4,253}$)(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,24}$/;
const BLOCKED_HOST_SUFFIXES = ['.local', '.localhost', '.internal', '.lan', '.home', '.corp', '.intranet', '.test', '.invalid', '.example'];

/** Returns the normalised https URL, or null. IP literals, userinfo, odd ports, internal host names are refused. */
export function normaliseHttpsUrl(raw: string, maxLength = 300): string | null {
  if (RAW_CONTROL.test(raw)) return null;
  const s = raw.trim();
  if (s.length === 0 || s.length > maxLength) return null;
  if (BAD_CHARS.test(s) || /[\s\u0000-\u001F<>"'`\\^{}|]/.test(s)) return null;
  let u: URL;
  try {
    u = new URL(s);
  } catch {
    return null;
  }
  if (u.protocol !== 'https:') return null;
  if (u.username !== '' || u.password !== '') return null;
  if (u.port !== '' && u.port !== '443') return null;
  const host = u.hostname.toLowerCase();
  if (!HOST_RE.test(host)) return null; // refuses IPv4/IPv6 literals and single-label hosts
  if (BLOCKED_HOST_SUFFIXES.some((suffix) => host.endsWith(suffix))) return null;
  u.hash = '';
  const href = u.toString();
  return href.length <= maxLength ? href : null;
}

// ---------------------------------------------------------------------------------------------------------------
// Outputs: values that go into a Telegram message, a mail header or a CSV cell
// ---------------------------------------------------------------------------------------------------------------

/** Strip CR, LF, tab and other control characters and collapse spaces: for any value that becomes a header or one-line text. */
export function stripToOneLine(raw: string, max = 200): string {
  const noControl = raw.replace(/[\u0000-\u001F\u007F-\u009F\u00AD\u200B\u200E\u200F\u2028\u2029\u202A-\u202E\u2060-\u2064\u2066-\u2069\uFEFF]/g, ' ');
  const collapsed = noControl.replace(/[ \u00A0]+/g, ' ').trim();
  return Array.from(collapsed).slice(0, max).join('');
}

/** First given name, letters only, for alerts and the acknowledgement mail (D-022, D-029). Falls back to "there". */
export function sanitisedFirstName(fullName: string, max = 20): string {
  const first = stripToOneLine(fullName, 80).split(' ')[0] ?? '';
  const letters = Array.from(first.normalize('NFC'))
    .filter((ch) => /[\p{L}\p{M}'’-]/u.test(ch))
    .join('')
    .replace(/^[-'’]+/, '');
  const cut = Array.from(letters).slice(0, max).join('');
  return cut === '' ? 'there' : cut;
}

/** CSV/spreadsheet cell escape (D-029): a cell starting with = + - @ tab or CR gets a leading single quote. */
export function csvSafeCell(value: unknown): string {
  const s = value === null || value === undefined ? '' : String(value);
  const safe = /^[=+\-@\t\r]/.test(s) ? `'${s}` : s;
  return /[",\n\r]/.test(safe) ? `"${safe.replace(/"/g, '""')}"` : safe;
}
