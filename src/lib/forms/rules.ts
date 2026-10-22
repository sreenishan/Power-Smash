// Client-side copy of the field rules in src/lib/contracts/lead.ts, WITHOUT zod.
//
// Why a copy: importing the zod contract into the browser adds about 30 KB of gzip JavaScript, and React alone already uses
// about 67 KB of the 80 KB page budget (spec 12.5, measured in docs/m1/forms-notes.md). The server still validates with the
// zod contract and is the authority. These rules use the SAME primitives the contract uses (src/lib/security/text.ts:
// cleanText, normalisePhone, normaliseEmail, normaliseHttpsUrl) and the same limits (LEAD_LIMITS), and
// tests/forms/parity.test.ts compares this file with the contract on a matrix of good and bad inputs for every field,
// so a change in the contract that is not copied here fails the tests.
// REQUEST to the Lead-backend worker (in forms-notes.md): export these rule sets from a zod-free module so this copy can go.
//
// Shared rules agreed in the M1 review-fix wave (R-PHONE, R-TEXT, R-DATE): the Lead-backend worker put the zod-free parts in
// src/lib/contracts/lead-constants.ts and this file imports them, so there is one copy of the character lists, the phone
// clean-up (inside normalisePhone) and the start-date window. tests/forms/parity.test.ts still compares both sides on a fuzz corpus.
import { LABEL_CHARS_RE, LEAD_LIMITS, NAME_CHARS_RE, isStartDateInWindow, type FieldErrorCode } from '../contracts/lead-constants';
import { cleanText, normaliseEmail, normaliseHttpsUrl, normalisePhone, type TextRules } from '../security/text';

// Letters, marks and digits of any script, ZWNJ and ZWJ (used in some Indic scripts), space and a few punctuation marks. R-TEXT:
// the label-style boxes also take the rupee sign, dashes, curly quotes, % ! ? and the middle dot (a person's name does not).
// Both patterns come from lead-constants.ts, the same ones the server contract uses.
const NAME_CHARS = NAME_CHARS_RE;
const LABEL_CHARS = LABEL_CHARS_RE;

export const NAME_RULES: TextRules = { min: LEAD_LIMITS.name.min, max: LEAD_LIMITS.name.max, pattern: NAME_CHARS };
export const ORG_RULES: TextRules = { max: LEAD_LIMITS.organization.max, pattern: LABEL_CHARS };
export const SHORT_RULES: TextRules = { max: LEAD_LIMITS.shortText.max, pattern: LABEL_CHARS };
export const TINY_RULES: TextRules = { max: LEAD_LIMITS.tinyText.max, pattern: LABEL_CHARS };
export const LEVEL_RULES: TextRules = { ...TINY_RULES, max: 40 };
export const LIST_ITEM_RULES: TextRules = { max: LEAD_LIMITS.listItemText.max, pattern: LABEL_CHARS };
export const LONG_RULES: TextRules = { max: LEAD_LIMITS.longText.max, multiline: true };
export const NOTE_RULES: TextRules = { max: LEAD_LIMITS.noteText.max, multiline: true };
export const MESSAGE_RULES: TextRules = { ...LONG_RULES, min: 5 };
export const WHAT_RULES: TextRules = { max: LEAD_LIMITS.requestWhat.max, allowUrl: true, allowManyDigits: true };

/** How one field is checked. `required` comes from the field's `optional` flag and `requiredByForm`. */
export type FieldRule =
  | { kind: 'text'; rules: TextRules }
  | { kind: 'phone' }
  | { kind: 'email' }
  | { kind: 'url' }
  /** A real calendar date (2000-2100). */
  | { kind: 'date' }
  /** A start date: a real date AND from yesterday up to three years ahead, India time (R-DATE). */
  | { kind: 'startDate' }
  | { kind: 'month' }
  | { kind: 'int'; min: number; max: number }
  | { kind: 'list'; rules: TextRules; maxItems: number }
  /** The value must be one of the field's options (selects and radios). */
  | { kind: 'choice' }
  /** No check (tick boxes). */
  | { kind: 'none' };

/**
 * The contract's rule for each payload field name (the contract is per name; the same name has the same rule in every
 * kind, except `message`, which only the general kind has). Names with no entry here fall back to a rule by input type.
 */
export const RULE_BY_NAME: Readonly<Record<string, FieldRule>> = {
  name: { kind: 'text', rules: NAME_RULES },
  organization: { kind: 'text', rules: ORG_RULES },
  organizerName: { kind: 'text', rules: ORG_RULES },
  company: { kind: 'text', rules: ORG_RULES },
  eventName: { kind: 'text', rules: SHORT_RULES },
  tournamentName: { kind: 'text', rules: SHORT_RULES },
  venue: { kind: 'text', rules: SHORT_RULES },
  district: { kind: 'text', rules: TINY_RULES },
  city: { kind: 'text', rules: TINY_RULES },
  level: { kind: 'text', rules: LEVEL_RULES },
  budgetRange: { kind: 'text', rules: TINY_RULES },
  entryFee: { kind: 'text', rules: TINY_RULES },
  notes: { kind: 'text', rules: LONG_RULES },
  // Request form: the link or description (text only, links allowed) and the details.
  what: { kind: 'text', rules: WHAT_RULES },
  details: { kind: 'text', rules: LONG_RULES },
  objectives: { kind: 'text', rules: LONG_RULES },
  message: { kind: 'text', rules: MESSAGE_RULES },
  registrationDetails: { kind: 'text', rules: NOTE_RULES },
  categories: { kind: 'list', rules: LIST_ITEM_RULES, maxItems: LEAD_LIMITS.listItems.max },
  ageGroups: { kind: 'list', rules: LIST_ITEM_RULES, maxItems: LEAD_LIMITS.listItems.max },
  courts: { kind: 'int', min: 1, max: 64 },
  expectedEntries: { kind: 'int', min: 1, max: 10_000 },
  // R-DATE: the server checks the window on `startDate` only (coverage and tournament listing); `endDate` is a plain date.
  startDate: { kind: 'startDate' },
  matchDays: { kind: 'int', min: 1, max: 30 },
  // M3 video submission (same limits as the contract's TINY_RULES / SHORT_RULES)
  category: { kind: 'text', rules: TINY_RULES },
  round: { kind: 'text', rules: TINY_RULES },
  players: { kind: 'text', rules: SHORT_RULES },
};

/** The rule for a field: by name where the contract has one, otherwise by input type. */
export function ruleFor(field: { name: string; type: string }): FieldRule {
  const byName = RULE_BY_NAME[field.name];
  if (byName) return byName;
  switch (field.type) {
    case 'tel':
      return { kind: 'phone' };
    case 'email':
      return { kind: 'email' };
    case 'url':
      return { kind: 'url' };
    case 'date':
      return { kind: 'date' };
    case 'month':
      return { kind: 'month' };
    case 'select':
    case 'radio':
      return { kind: 'choice' };
    default:
      return { kind: 'none' };
  }
}

/** A real calendar date in 2000-2100 (the same check as the contract's isRealDate; the window is separate, see 'startDate'). */
export function isRealDate(s: string): boolean {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s);
  if (!m) return false;
  const [y, mo, d] = [Number(m[1]), Number(m[2]), Number(m[3])];
  if (y < 2000 || y > 2100) return false;
  const t = new Date(Date.UTC(y, mo - 1, d));
  return t.getUTCFullYear() === y && t.getUTCMonth() === mo - 1 && t.getUTCDate() === d;
}

/** Split "a, b\nc" into items, dropping blanks (same rule as the payload builder). */
export function splitItems(text: string): string[] {
  return text
    .split(/[,\n]/)
    .map((s) => s.trim())
    .filter((s) => s !== '');
}

/**
 * Check one text-like value. Returns null when it is fine (or blank and optional), otherwise the contract's field error
 * code. `allowed` is the list of option values for choices. `now` is the clock for the date window (R-DATE).
 */
export function checkValue(rule: FieldRule, raw: string, required: boolean, allowed?: readonly string[], now?: Date): FieldErrorCode | null {
  if (rule.kind === 'none') return null;
  if (raw.trim() === '') return required ? 'required' : null;
  switch (rule.kind) {
    case 'text': {
      const r = cleanText(raw, rule.rules);
      return r.ok ? null : r.issue;
    }
    case 'phone':
      // R-PHONE: normalisePhone removes no-break spaces, zero-width and direction marks before it checks the number
      return normalisePhone(raw) === null ? 'invalid_phone' : null;
    case 'email':
      return normaliseEmail(raw) === null ? 'invalid_email' : null;
    case 'url':
      return normaliseHttpsUrl(raw, LEAD_LIMITS.url.max) === null ? 'invalid_url' : null;
    case 'date':
      return isRealDate(raw.trim()) ? null : 'invalid_date';
    case 'startDate': {
      const date = raw.trim();
      if (!isRealDate(date)) return 'invalid_date';
      return isStartDateInWindow(date, now ?? new Date()) ? null : 'date_out_of_range';
    }
    case 'month': {
      const m = /^(\d{4})-(0[1-9]|1[0-2])$/.exec(raw.trim());
      return m && Number(m[1]) >= 2000 && Number(m[1]) <= 2100 ? null : 'invalid_date';
    }
    case 'int': {
      const n = /^\d{1,6}$/.test(raw.trim()) ? Number(raw.trim()) : Number.NaN;
      return Number.isInteger(n) && n >= rule.min && n <= rule.max ? null : 'invalid';
    }
    case 'list': {
      const items = splitItems(raw);
      if (items.length === 0) return required ? 'required' : null;
      if (items.length > rule.maxItems) return 'too_long';
      for (const item of items) {
        const r = cleanText(item, rule.rules);
        if (!r.ok) return r.issue;
      }
      return null;
    }
    case 'choice':
      return allowed && allowed.includes(raw.trim()) ? null : 'invalid';
  }
}
