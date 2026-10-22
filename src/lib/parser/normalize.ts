/**
 * Pure text helpers of the title parser (M0 skeleton: ONLY helpers that a PC item defines
 * unambiguously are implemented; segmentation and token recognition land in M2b).
 *
 * Implemented here (each has tests in tests/parser/normalize.test.ts):
 *   normalizeTitle   PC-08 punctuation map + D-017 matching copy (entities, FE0F, whitespace)
 *   extractHashtags  PC-07 hashtags are captured first (letter-initial Unicode pattern)
 *   stripEmoji       PC-07 only \p{Extended_Pictographic}-family characters, never digits
 *   preprocessTitle  the three above in the right order
 *   normalizeName    PC-05 ordered pipeline -> `name_normalized`, null instead of an empty key
 *   latinKey         PC-05 ASCII-only key, null when no Latin form exists (no transliteration pinned)
 *   nameKey          PC-12 initial-position-insensitive key
 *   toDisplayName    spec A.3 + PC-12 (Title Case, initials 'S. Karthik', Tamil preserved)
 *   describeName     tokens, identity tier (PC-01), scripts, truncation
 *
 * NOT implemented here (M2b): SUSPECT_INITIALS detection (AJ / SRI), VS and separator
 * detection, token recognition, district and country tables.
 *
 * Keep this file free of value-imports from sibling modules (type-only imports are fine) so the
 * fixture generator can load it with plain Node type stripping.
 */
import type { IdentityTier } from './types';

// ---------------------------------------------------------------------------
// Shared character classes
// ---------------------------------------------------------------------------

/** Zero-width characters stripped from KEYS (PC-05): ZWSP, ZWNJ, ZWJ, word joiner, BOM. */
const ZERO_WIDTH_ALL = /[​‌‍⁠﻿]/gu;
/** Display names keep ZWNJ/ZWJ (they can matter for Tamil conjunct rendering); only junk is stripped. */
const ZERO_WIDTH_JUNK = /[​⁠﻿]/gu;
/** Apostrophe-like characters, dropped from name keys (PC-05). */
const APOSTROPHES = /['‘’‛′ʼ`´]/gu;
const TAMIL_DIGIT_ZERO = 0x0be6;

/** Map Tamil digits U+0BE6..U+0BEF to ASCII 0-9 (NFKC does not fold them, PC-05 / PC-24). */
export function mapTamilDigits(text: string): string {
  return text.replace(/[௦-௯]/gu, (digit) => String((digit.codePointAt(0) as number) - TAMIL_DIGIT_ZERO));
}

function collapseWhitespace(text: string): string {
  return text.replace(/\s+/gu, ' ').trim();
}

// ---------------------------------------------------------------------------
// Titles (PC-07, PC-08, D-017)
// ---------------------------------------------------------------------------

const NAMED_ENTITIES: Record<string, string> = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'" };

/** Single-pass decode of the XML entities and numeric references RSS can carry ("&amp;lt;" -> "&lt;"). */
export function decodeEntities(text: string): string {
  return text.replace(/&(?:(amp|lt|gt|quot|apos)|#(\d{1,7})|#[xX]([0-9a-fA-F]{1,6}));/gu, (whole, named, dec, hex) => {
    if (named) return NAMED_ENTITIES[named as string] as string;
    const code = dec !== undefined ? Number.parseInt(dec as string, 10) : Number.parseInt(hex as string, 16);
    if (code === 0 || code > 0x10ffff || (code >= 0xd800 && code <= 0xdfff)) return whole;
    return String.fromCodePoint(code);
  });
}

/**
 * The matching copy of a title (D-017, PC-08): decode entities, NFKC, strip zero-width and
 * variation-selector characters (U+FE0F is stripped for comparison only; the raw title is kept
 * elsewhere), map Tamil digits, fold the punctuation NFKC leaves alone (en/em dash, U+2016,
 * curly quotes, non-breaking space), then collapse whitespace. Case is NOT changed.
 */
export function normalizeTitle(raw: string): string {
  let text = decodeEntities(raw).normalize('NFKC');
  text = text.replace(ZERO_WIDTH_ALL, '').replace(/[︎️]/gu, '');
  text = mapTamilDigits(text);
  text = text
    .replace(/[‐-―−]/gu, '-')
    .replace(/‖/gu, '||')
    .replace(/[‘’‛′]/gu, "'")
    .replace(/[“”‟″]/gu, '"')
    .replace(/[   ]/gu, ' ');
  return collapseWhitespace(text);
}

/**
 * Capture hashtags first (they are the Shorts signal, PC-07), then remove them. The pattern is
 * letter-initial and Unicode-aware: '#badminton' and a Tamil hashtag match, 'Court #3' does not.
 * Returned tags are lower-case, without '#', unique, in order of appearance.
 */
export function extractHashtags(text: string): { text: string; hashtags: string[] } {
  const hashtags: string[] = [];
  const stripped = text.replace(/(?<![\p{L}\p{N}_])#(\p{L}[\p{L}\p{M}\p{N}_]*)/gu, (_whole, tag: string) => {
    const lower = tag.toLowerCase();
    if (!hashtags.includes(lower)) hashtags.push(lower);
    return ' ';
  });
  return { text: collapseWhitespace(stripped), hashtags };
}

/** Remove emoji. Digits are NOT touched (\p{Emoji} would match them; PC-07 forbids it). */
export function stripEmoji(text: string): string {
  const emoji = /[\p{Extended_Pictographic}\p{Emoji_Modifier}\p{Regional_Indicator}︎️⃣\u{E0020}-\u{E007F}]/gu;
  return collapseWhitespace(text.replace(emoji, ' '));
}

export type PreprocessedTitle = {
  /** Matching copy (emoji and hashtags still present). */
  normalizedTitle: string;
  /** Text the segment parser works on: normalized, hashtags captured out, emoji removed. */
  text: string;
  hashtags: string[];
};

export function preprocessTitle(raw: string): PreprocessedTitle {
  const normalizedTitle = normalizeTitle(raw);
  const { text, hashtags } = extractHashtags(normalizedTitle);
  return { normalizedTitle, text: stripEmoji(text), hashtags };
}

// ---------------------------------------------------------------------------
// Names (PC-01, PC-05, PC-12, spec A.3)
// ---------------------------------------------------------------------------

/**
 * `name_normalized` (PC-05), an ordered pipeline: NFKC, strip zero-width characters, map Tamil
 * digits, casefold, drop apostrophes, turn dots into spaces (this splits glued initials:
 * 'S.KARTHIK' -> 's karthik', 'Karthik.S' -> 'karthik s'), turn every other non-letter into a
 * space (hyphen -> space), collapse spaces. Letters and combining marks of ANY script are kept,
 * so a Tamil name never becomes an empty string. Returns `null` instead of '' so an empty key
 * can never be stored (PC-05: "reject empty keys").
 */
export function normalizeName(raw: string): string | null {
  let text = raw.normalize('NFKC').replace(ZERO_WIDTH_ALL, '');
  text = mapTamilDigits(text).toLowerCase().replace(APOSTROPHES, '');
  text = text.replace(/\./gu, ' ').replace(/[^\p{L}\p{M}\p{N}]+/gu, ' ');
  text = collapseWhitespace(text);
  return text === '' ? null : text;
}

/**
 * ASCII-only key for search, slugs and duplicate detection (PC-05). Latin letters with accents
 * are folded ('José' -> 'jose'). Returns `null` for Tamil-only, mixed-script and any name with a
 * letter that has no ASCII form: no transliteration is pinned yet (PC-24), so there is no key
 * rather than a wrong or empty one.
 */
export function latinKey(raw: string): string | null {
  const normalized = normalizeName(raw);
  if (normalized === null) return null;
  const folded = normalized.normalize('NFKD').replace(/\p{M}+/gu, '');
  if (!/^[a-z0-9 ]+$/u.test(folded)) return null;
  const key = collapseWhitespace(folded);
  return key === '' ? null : key;
}

type NameToken = { text: string; isInitial: boolean };

const ELLIPSIS_SUFFIX = /(?:…|\.{3,})\s*$/u;

function stripTruncationMarker(raw: string): { text: string; truncated: boolean } {
  const normalized = raw.normalize('NFKC');
  const truncated = ELLIPSIS_SUFFIX.test(normalized);
  return { text: truncated ? normalized.replace(ELLIPSIS_SUFFIX, '') : normalized, truncated };
}

/**
 * PC-12: an initial is a single Latin letter, or a two-to-three letter ALL-CAPS token made only of
 * consonants ('KP', 'SR'). Words with a vowel ('AJ', 'SRI', 'RAJ') stay words; deciding that some of
 * them are SUSPECT_INITIALS is M2b work.
 */
export function isInitialToken(token: string): boolean {
  return /^[A-Za-z]$/u.test(token) || /^[BCDFGHJKLMNPQRSTVWXYZ]{2,3}$/u.test(token);
}

/** Dots separate tokens ('V.S.' -> V, S); hyphens do NOT (a hyphenated name is one token). */
function tokenizeName(text: string, stripAllZeroWidth: boolean): NameToken[] {
  const cleaned = text.replace(stripAllZeroWidth ? ZERO_WIDTH_ALL : ZERO_WIDTH_JUNK, '').replace(/\./gu, ' ');
  return cleaned
    .split(/\s+/u)
    .filter((token) => token !== '')
    .map((token) => ({ text: token, isInitial: isInitialToken(token) }));
}

function titleCaseToken(token: string): string {
  // capitalise after hyphens and apostrophes too: 'MOHAMED-ALI' -> 'Mohamed-Ali', "D'SOUZA" -> "D'Souza"
  return token
    .split(/([-'’])/u)
    .map((part) => (part.length === 0 || /[-'’]/u.test(part) ? part : part.charAt(0).toUpperCase() + part.slice(1).toLowerCase()))
    .join('');
}

/**
 * Display name (spec A.3, PC-12): Title Case; initials become upper-case letters with a dot and a
 * space ('S.KARTHIK' -> 'S. Karthik', 'KP ARUN' -> 'K. P. Arun', 'KARTHIK S' -> 'Karthik S.');
 * Tamil-script text is preserved (it has no case); a trailing ellipsis is dropped.
 */
export function toDisplayName(raw: string): string {
  const { text } = stripTruncationMarker(raw);
  const parts: string[] = [];
  for (const token of tokenizeName(text, false)) {
    if (token.isInitial) {
      for (const letter of token.text) parts.push(`${letter.toUpperCase()}.`);
    } else {
      parts.push(titleCaseToken(token.text));
    }
  }
  return parts.join(' ');
}

/**
 * Initial-position-insensitive key (PC-12): the non-initial words in order, then '|', then the
 * initial letters in order. 'S. Karthik', 'Karthik S.', 'KARTHIK S' and 'Karthik.S' all give
 * 'karthik|s'; 'KP ARUN' gives 'arun|k p'; a name without initials has no '|'. Null for an empty key.
 */
export function nameKey(raw: string): string | null {
  const { text } = stripTruncationMarker(raw);
  const tokens = tokenizeName(text, true);
  const words: string[] = [];
  const initials: string[] = [];
  for (const token of tokens) {
    if (token.isInitial) {
      for (const letter of token.text) initials.push(letter.toLowerCase());
    } else {
      const key = normalizeName(token.text);
      if (key !== null) words.push(key);
    }
  }
  if (words.length === 0 && initials.length === 0) return null;
  return initials.length === 0 ? words.join(' ') : `${words.join(' ')}|${initials.join(' ')}`;
}

export type NameScript = 'latin' | 'tamil' | 'other';

export type NameInfo = {
  displayName: string;
  nameNormalized: string | null;
  nameKey: string | null;
  latinKey: string | null;
  /** Whitespace/dot separated tokens, hyphenated names count as one. */
  tokenCount: number;
  initialCount: number;
  /** Null only when the name has no tokens at all. */
  identityTier: IdentityTier | null;
  truncated: boolean;
  scripts: NameScript[];
  /** Latin together with another script inside one name (MIXED_SCRIPT_NAME, PF-042). */
  mixedScript: boolean;
  /** Letter count of the normalised name (spaces excluded); < 2 means SHORT_NAME (spec A.4). */
  nameLength: number;
};

export function describeName(raw: string): NameInfo {
  const { text, truncated } = stripTruncationMarker(raw);
  const tokens = tokenizeName(text, true);
  const words = tokens.filter((token) => !token.isInitial).length;
  const initials = tokens.length - words;
  let identityTier: IdentityTier | null = null;
  if (tokens.length > 0) {
    if (words === 0) identityTier = 'initials_only';
    else if (tokens.length === 1) identityTier = 'single_token';
    else identityTier = 'multi_token';
  }
  const normalized = normalizeName(text);
  const scripts: NameScript[] = [];
  if (/\p{Script=Latin}/u.test(text)) scripts.push('latin');
  if (/\p{Script=Tamil}/u.test(text)) scripts.push('tamil');
  const hasOtherScript = [...text].some(
    (char) => /\p{L}/u.test(char) && !/\p{Script=Latin}|\p{Script=Tamil}/u.test(char),
  );
  if (hasOtherScript) scripts.push('other');
  return {
    displayName: toDisplayName(raw),
    nameNormalized: normalized,
    nameKey: nameKey(raw),
    latinKey: latinKey(text),
    tokenCount: tokens.length,
    initialCount: initials,
    identityTier,
    truncated,
    scripts,
    mixedScript: scripts.includes('latin') && scripts.length > 1,
    nameLength: normalized === null ? 0 : normalized.replace(/\s/gu, '').length,
  };
}
