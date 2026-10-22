// Patterns for the privacy scan (D-029 "Privacy scan", D-027 "dist/ scan after every build").
// Shapes follow .gitleaks.toml where it has a rule. A pattern here is a HEURISTIC: a hit means "look at this", a miss
// proves nothing. Keep each pattern anchored on something specific so real pages do not trip it.
//
// The scan does not read only the raw bytes: scripts/privacy-scan.ts also reads each file DECODED (HTML entities, percent-encoding and
// JS or JSON escapes undone, digits of any script mapped to 0-9, zero-width characters removed) and, for pages, with the markup removed,
// so the patterns below only describe the plain form (review finding S-2). See scripts/lib/text-normalise.ts.
// Node 24 type stripping: type-annotation-only.

export type Severity = 'critical' | 'strict';
/** `markup`: HTML, JSON, XML, text and similar content people read. `code`: JS, CSS, SVG and source maps. */
export type FileKind = 'markup' | 'code';
/**
 * The ways one file is read (scripts/lib/text-normalise.ts). `raw`: the bytes as text. `decoded`: entities, percent-encoding and JS escapes
 * decoded, other-script digits mapped to 0-9, invisible characters removed. `plain`: as `decoded` with the markup removed (HTML and SVG only).
 * `b64`: base64-looking blobs decoded (secret shapes only).
 */
export type ViewName = 'raw' | 'decoded' | 'plain' | 'b64';
export const TEXT_VIEWS: readonly ViewName[] = ['raw', 'decoded', 'plain'];
export const SECRET_VIEWS: readonly ViewName[] = ['raw', 'decoded', 'plain', 'b64'];

export interface Rule {
  id: string;
  severity: Severity;
  description: string;
  regex: RegExp;
  /** Which kinds of file the rule runs on. */
  kinds: readonly FileKind[];
  /** Which readings of a file the rule runs on. Default: TEXT_VIEWS. Secret shapes use SECRET_VIEWS. */
  views?: readonly ViewName[];
  /** Extra check on a match (after the regex). Return false to ignore the match. */
  accept?: (match: string) => boolean;
}

const FILE_EXTENSION_TLDS = new Set([
  'png', 'jpg', 'jpeg', 'gif', 'webp', 'avif', 'svg', 'ico', 'css', 'js', 'mjs', 'json', 'html', 'htm', 'map', 'txt',
  'woff', 'woff2', 'ttf', 'otf', 'pdf', 'xml',
]);

/** Names of the private variables. Their VALUES are searched for as well (see scanSecretValues). */
export const SECRET_ENV_NAMES: readonly string[] = [
  'SUPABASE_SECRET_KEY',
  'TURNSTILE_SECRET_KEY',
  'RESEND_API_KEY',
  'EMAIL_FROM',
  'OWNER_EMAIL',
  'TELEGRAM_BOT_TOKEN',
  'TELEGRAM_CHAT_ID',
  'HMAC_KEY',
  'YOUTUBE_API_KEY',
  'REBUILD_DISPATCH_TOKEN',
  'CLOUDFLARE_API_TOKEN',
  'SUPABASE_ACCESS_TOKEN',
  'SUPABASE_DB_URL',
  'AGE_DRILL_KEY',
  'RAZORPAY_KEY_SECRET',
  'RAZORPAY_WEBHOOK_SECRET',
];

/** Private database and field names that must never appear in the public output (D-005, D-029). */
export const PRIVATE_FIELD_NAMES: readonly string[] = [
  'tournament_private',
  'sponsor_contacts',
  'organizer_phone',
  'organizer_email',
  'organizer_mobile',
  'organizer_contact',
  'organizer_contacts',
  'organiser_phone',
  'organiser_email',
  'contact_phone',
  'contact_email',
  'contact_number',
  'contact_mobile',
  'owner_email',
];

const escapeRe = (s: string): string => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/** All ways to split 10 digits into 2 to 5 groups of 2 to 6 digits (4-6, 5-5, 2-4-4, 4-3-3, 3-3-4, 2-2-3-3, ...). */
function compositionsOfTen(): number[][] {
  const out: number[][] = [];
  const walk = (left: number, parts: number[]): void => {
    if (left === 0) {
      if (parts.length >= 2) out.push(parts);
      return;
    }
    if (parts.length === 5) return;
    for (let n = 2; n <= 6 && n <= left; n++) walk(left - n, [...parts, n]);
  };
  walk(10, []);
  return out;
}

/** Between two digit groups of one number: a separator (space, dot, dash), a closing bracket before it, an opening bracket after it. */
const GAP = String.raw`\)?[\s.\-]{0,2}\(?`;
/** Ten digits starting 6-9, written bare or in any grouping of 2-6 digits per group (`98765 43210`, `98765.43210`, `(98765) 43210`, `9876-543-210`). */
const TEN_DIGITS = [
  String.raw`[6-9]\d{9}`,
  ...compositionsOfTen().map((parts) => parts.map((n, i) => (i === 0 ? String.raw`[6-9]\d{${n - 1}}` : String.raw`\d{${n}}`)).join(GAP)),
].join('|');
const COUNTRY_PREFIX = String.raw`(?:(?:\+|00)?91\)?[\s.\-]{0,2}|0[\s.\-]?)?`;
/** What may NOT touch a number on the left (a word character, a dot, a plus or a dash) and on the right (a word character, a dash, or ".<digit>"). */
const LEFT = String.raw`(?<![\w.+-])`;
const RIGHT = String.raw`(?![\w-]|\.\d)`;

/**
 * Exact, tested exceptions for the BARE-number rule in scripts and SVG (`indian-mobile-number-code`): a number that is not a phone number
 * but looks like one. Each entry is an exact file path (relative to dist/client) and an exact digit string; nothing else is excused.
 * Empty on purpose: the current build output has no such number (checked against a real build on 2026-10-21; build hashes mix letters and
 * digits and are cut by word-character boundaries). Add an entry only with a reason, after looking at the line.
 */
export interface CodeNumberAllow {
  file: string;
  digits: string;
  reason: string;
}
export const CODE_NUMBER_ALLOWLIST: readonly CodeNumberAllow[] = [];

export function isAllowedCodeNumber(file: string, matched: string, list: readonly CodeNumberAllow[] = CODE_NUMBER_ALLOWLIST): boolean {
  const digits = matched.replace(/\D/g, '');
  return list.some((a) => a.file === file && a.digits === digits);
}

export const RULES: readonly Rule[] = [
  // ---- critical: a hit fails EVERY build, strict or not -------------------------------------------------------------
  {
    id: 'supabase-secret-key',
    severity: 'critical',
    description: 'Supabase secret API key (sb_secret_...).',
    regex: /\bsb_secret_[A-Za-z0-9_-]{16,}/g,
    kinds: ['markup', 'code'],
    views: SECRET_VIEWS,
  },
  {
    id: 'jwt',
    severity: 'critical',
    description: 'JSON Web Token shape (a legacy Supabase service_role key looks like this).',
    regex: /\beyJ[A-Za-z0-9_-]{10,}\.eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}/g,
    kinds: ['markup', 'code'],
    views: SECRET_VIEWS,
  },
  {
    id: 'telegram-bot-token',
    severity: 'critical',
    description: 'Telegram bot token shape.',
    regex: /\b\d{8,10}:[A-Za-z0-9_-]{35}\b/g,
    kinds: ['markup', 'code'],
    views: SECRET_VIEWS,
  },
  {
    id: 'resend-api-key',
    severity: 'critical',
    description: 'Resend API key shape (re_...). The exact format is not documented, so this is a conservative guess.',
    regex: /\bre_[A-Za-z0-9_]{24,}\b/g,
    kinds: ['markup', 'code'],
    views: SECRET_VIEWS,
    // A pure snake_case identifier (letters and underscores, one case) is code, not a key: a real key is mixed-case with digits.
    accept: (m) => !/^re_(?:[a-z_]+|[A-Z_]+)$/.test(m),
  },
  {
    id: 'turnstile-secret-key',
    severity: 'critical',
    description: 'Cloudflare Turnstile secret key shape (0x4 and at least 30 more characters; the public site key is shorter). A conservative guess, not a documented format.',
    regex: /\b0x4[A-Za-z0-9_-]{30,}\b/g,
    kinds: ['markup', 'code'],
    views: SECRET_VIEWS,
  },
  {
    id: 'github-token',
    severity: 'critical',
    description: 'GitHub token (classic, fine-grained or app).',
    regex: /\b(?:gh[pousr]_[A-Za-z0-9]{36,}|github_pat_[A-Za-z0-9_]{50,})\b/g,
    kinds: ['markup', 'code'],
    views: SECRET_VIEWS,
  },
  {
    id: 'google-api-key',
    severity: 'critical',
    description: 'Google API key shape (a YouTube Data API key looks like this).',
    regex: /\bAIza[0-9A-Za-z_-]{35}\b/g,
    kinds: ['markup', 'code'],
    views: SECRET_VIEWS,
  },
  {
    id: 'private-key-block',
    severity: 'critical',
    description: 'PEM private key block.',
    regex: /-----BEGIN (?:[A-Z]+ )?PRIVATE KEY-----/g,
    kinds: ['markup', 'code'],
    views: SECRET_VIEWS,
  },
  {
    id: 'age-secret-key',
    severity: 'critical',
    description: 'age private key (AGE-SECRET-KEY-1...).',
    regex: /AGE-SECRET-KEY-1[A-Z0-9]{20,}/g,
    kinds: ['markup', 'code'],
    views: SECRET_VIEWS,
  },
  {
    id: 'database-url-with-password',
    severity: 'critical',
    description: 'Database connection string with a password.',
    regex: /\bpostgres(?:ql)?:\/\/[^\s:@/'"]+:[^\s@/'"]+@[^\s'"]+/g,
    kinds: ['markup', 'code'],
    views: SECRET_VIEWS,
  },

  // ---- strict: summary only in a normal build, fails the strict release build ---------------------------------------
  {
    id: 'email-address',
    severity: 'strict',
    description: 'Email address (only the owner\'s official addresses are allowed).',
    regex: /[A-Za-z0-9._%+-]{1,64}@[A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+)*\.[A-Za-z]{2,}/g,
    kinds: ['markup', 'code'],
    // "logo@2x.png" is a file name, not an address.
    accept: (m) => !FILE_EXTENSION_TLDS.has((m.split('.').pop() ?? '').toLowerCase()),
  },
  {
    id: 'email-address-obfuscated',
    severity: 'strict',
    description: 'Email address written with "[at]" and "[dot]" (or (at), {at}, <at>) instead of @ and a dot.',
    regex: /[A-Za-z0-9._%+-]{1,64}\s*[[({<]\s*at\s*[\])}>]\s*[A-Za-z0-9-]+(?:\s*[[({<]\s*dot\s*[\])}>]\s*[A-Za-z0-9-]+)+/gi,
    kinds: ['markup'],
  },
  {
    id: 'indian-mobile-number',
    severity: 'strict',
    description: 'Indian mobile number (10 digits starting 6-9, optional +91, 91 or a leading 0; any usual grouping and separator; digits of any script).',
    regex: new RegExp(`${LEFT}${COUNTRY_PREFIX}\\(?(?:${TEN_DIGITS})${RIGHT}`, 'g'),
    kinds: ['markup'],
  },
  {
    id: 'indian-landline-phone',
    severity: 'strict',
    description: 'Indian landline number with the trunk zero or +91 (STD code and subscriber number: 10 digits after the zero).',
    regex: new RegExp(
      `${LEFT}(?:(?:\\+|00)91\\)?[\\s.\\-]{0,2}\\(?0?|\\(?0)[1-5]\\d{1,3}\\)?[\\s.\\-]{0,2}(?:\\d{6,8}|\\d{3,4}[\\s.\\-]{0,2}\\d{3,4})${RIGHT}`,
      'g',
    ),
    kinds: ['markup'],
    accept: (m) => {
      let d = m.replace(/\D/g, '');
      if (d.startsWith('00')) d = d.slice(2);
      if (d.startsWith('91') && d.length >= 12) d = d.slice(2);
      if (d.startsWith('0')) d = d.slice(1);
      return d.length === 10;
    },
  },
  {
    id: 'indian-mobile-number-formatted',
    severity: 'strict',
    description: 'Indian mobile number written with a country code, or grouped 5-5 with a space or dash (checked inside scripts and styles too).',
    regex: new RegExp(`${LEFT}(?:(?:\\+|00)91\\)?[\\s.\\-]{0,2}\\(?(?:${TEN_DIGITS})|[6-9]\\d{4}[\\s-]\\d{5})${RIGHT}`, 'g'),
    kinds: ['code'],
  },
  {
    id: 'indian-mobile-number-code',
    severity: 'strict',
    description: 'A bare Indian mobile number (10 digits starting 6-9, optionally with 91 or 0 in front) written as a literal in a script or an SVG.',
    regex: /(?<=["'`:=,(\[{>\s])(?:91|0)?[6-9]\d{9}(?=["'`,)\]};:<\s]|$)/gm,
    kinds: ['code'],
  },
  {
    id: 'international-phone-number',
    severity: 'strict',
    description: 'International phone number (+<country code> then 9 to 15 digits in total).',
    regex: /(?<![\w.+-])\+[1-9]\d{0,2}[\s.\-]?\(?\d{2,5}\)?[\s.\-]?\d{3,5}[\s.\-]?\d{0,5}(?![\d-])/g,
    kinds: ['markup'],
    accept: (m) => {
      const digits = m.replace(/\D/g, '').length;
      return digits >= 9 && digits <= 15;
    },
  },
  {
    id: 'localhost-url',
    severity: 'strict',
    description: 'localhost or loopback address in the public output.',
    regex: /\bhttps?:\/\/(?:localhost|127\.0\.0\.1|0\.0\.0\.0|\[::1\]|[a-z0-9-]+\.localhost)(?::\d+)?/gi,
    kinds: ['markup', 'code'],
  },
  {
    id: 'private-field-name',
    severity: 'strict',
    description: 'Name of a private database field or of a secret variable (server-only code or data leaked into the public output).',
    regex: new RegExp(`\\b(?:${[...PRIVATE_FIELD_NAMES, ...SECRET_ENV_NAMES].map(escapeRe).join('|')})\\b`, 'gi'),
    kinds: ['markup', 'code'],
  },
];

/** Digits of a phone number with the Indian country code or trunk zero removed, for comparing formats. */
export function canonicalPhone(value: string): string {
  let d = value.replace(/\D/g, '');
  if (d.startsWith('00')) d = d.slice(2);
  if (d.length === 12 && d.startsWith('91')) d = d.slice(2);
  else if (d.length === 11 && d.startsWith('0')) d = d.slice(1);
  return d;
}

/** An email written as "name [at] host [dot] tld" turned into name@host.tld, for comparing with the official addresses. */
export function canonicalEmail(value: string): string {
  return value
    .replace(/\s*[[({<]\s*at\s*[\])}>]\s*/gi, '@')
    .replace(/\s*[[({<]\s*dot\s*[\])}>]\s*/gi, '.')
    .trim()
    .toLowerCase();
}

/** Hide most of a matched value in log output: enough to find it, not enough to reuse it. */
export function mask(value: string): string {
  const head = value.slice(0, Math.min(3, Math.max(1, Math.floor(value.length / 4))));
  return `${head}***(${value.length} chars)`;
}
