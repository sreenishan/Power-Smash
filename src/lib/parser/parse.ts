/**
 * The corrected title parser (Milestone M2b). One pure function, `parseTitle`, shared by the tests,
 * the admin Title check and the sync (D-017). Rules: docs/SPEC_AUDIT.md section 5 (PC-01..PC-30),
 * D-012 (protective age handling), D-013 (identity tiers), D-017 (legacy mode), D-033 (content type).
 * The decisions that are NOT in the audit are listed in docs/m1/m2b-notes.md.
 *
 * Pipeline: content type (short / live) -> VS detection (PC-06) -> non-match gates (PC-16) ->
 * segment split (PC-09) -> meta tokens per segment (PC-04, PC-10, PC-13) -> sides and players
 * (PC-01, PC-12, D-017 legacy split) -> flags and integer confidence (PC-03).
 *
 * Nothing here infers gender, a category from names, or an adult age. Tamil words for "versus" and
 * rounds are NOT recognised: the reviewed vocabulary does not exist yet (PC-24, PO-05).
 */
import { computeConfidence } from './confidence';
import { describeName, latinKey, normalizeName, preprocessTitle } from './normalize';
import type {
  AgeGroup,
  AgeSignal,
  Category,
  EntityBlockReason,
  Format,
  HardFlag,
  LiveStatus,
  NonMatchReason,
  ParseContext,
  ParsedPlayer,
  ParseResult,
  Round,
  SoftFlag,
  TournamentLinkPolicy,
  VideoType,
  YearSource,
} from './types';
import { JUNIOR_CATEGORIES } from './types';
import {
  AGE_WORDS,
  CATEGORY_CODES,
  CATEGORY_PHRASES,
  COUNTRY_CODES,
  DOUBLES_CATEGORIES,
  GEAR_BRANDS,
  INTERNATIONAL_EVENTS,
  NEUTRAL_WORDS,
  NON_MATCH_KEYWORDS,
  ROUND_WORDS,
  SERIES_FILLERS,
  SINGLES_CATEGORIES,
  TEAM_WORDS,
  TOURNAMENT_NOUNS,
  NOISE_WORDS,
  NUMBER_WORDS,
  UNKNOWN_AGE_LIKE,
  canonicalPlace,
  isPlaceOrState,
  wordKey,
} from './vocab';

/** Bump on every rule change (stored as `videos.parser_version`). */
export const PARSER_VERSION = '1.0.0-m2b.1';

// ---------------------------------------------------------------------------
// Token recognition (PC-04)
// ---------------------------------------------------------------------------

type TokenKind = 'category' | 'round' | 'age' | 'neutral' | 'format_word';

type Token = {
  kind: TokenKind;
  /** Category code, round, age group, or 'singles' / 'doubles' / ''. */
  value: string;
  ambiguous: boolean;
  /** Age tokens: counts as a minor signal. */
  signal: boolean;
  start: number;
  end: number; // exclusive word index
};

const YEAR_WORD = /^(?:19|20)\d{2}$/u;

function trimPunct(word: string): string {
  return word.replace(/^[^\p{L}\p{N}#+]+|[^\p{L}\p{N}+]+$/gu, '');
}

function ageFromKey(key: string): { group: string; signal: boolean } | null {
  const match = /^(?:u|under|below)(\d{1,2})s?$/u.exec(key);
  if (!match) return null;
  const n = Number.parseInt(match[1] as string, 10);
  if (n < 4 || n > 30) return null;
  return { group: `U${n}`, signal: n <= 19 };
}

/** The best token starting at word `i`, longest phrase first. */
function tokenAt(words: string[], i: number): Token | null {
  const first = trimPunct(words[i] as string);
  // '35+', '40+' ...
  const plus = /^(\d{2})\+$/u.exec(first);
  if (plus) return { kind: 'age', value: `${plus[1]}+`, ambiguous: false, signal: false, start: i, end: i + 1 };

  // 'Court 3', 'Court #3', 'Day 2'
  const k1 = wordKey(first);
  if ((k1 === 'court' || k1 === 'day') && i + 1 < words.length && /^#?\d+$/u.test(trimPunct(words[i + 1] as string).replace(/^#/u, '#'))) {
    return { kind: 'neutral', value: '', ambiguous: false, signal: false, start: i, end: i + 2 };
  }

  for (let len = Math.min(3, words.length - i); len >= 1; len -= 1) {
    const slice = words.slice(i, i + len).map(trimPunct);
    if (slice.some((w) => w === '')) continue;
    const key = slice.map(wordKey).join('');
    if (key === '') continue;
    const end = i + len;

    const phrase = CATEGORY_PHRASES[key];
    if (phrase !== undefined) return { kind: 'category', value: phrase, ambiguous: false, signal: false, start: i, end };

    if (len === 1 && /^[A-Za-z]+$/u.test(first)) {
      const code = CATEGORY_CODES[key];
      if (code !== undefined) return { kind: 'category', value: code, ambiguous: false, signal: false, start: i, end };
    }

    const round = ROUND_WORDS[key];
    if (round !== undefined) {
      // a lone 'F' must be a bare capital letter (the initial of a name is not a round)
      if (key === 'f' && first !== 'F') continue;
      return { kind: 'round', value: round.round, ambiguous: round.ambiguous, signal: false, start: i, end };
    }

    const age = ageFromKey(key);
    if (age !== null) return { kind: 'age', value: age.group, ambiguous: false, signal: age.signal, start: i, end };

    const ageWord = AGE_WORDS[key];
    if (ageWord !== undefined) {
      return { kind: 'age', value: ageWord.group, ambiguous: ageWord.ambiguous, signal: ageWord.signal, start: i, end };
    }

    if (NEUTRAL_WORDS.has(key)) return { kind: 'neutral', value: '', ambiguous: false, signal: false, start: i, end };

    if (len === 1 && (key === 'single' || key === 'singles')) {
      return { kind: 'format_word', value: 'singles', ambiguous: false, signal: false, start: i, end };
    }
    if (len === 1 && (key === 'double' || key === 'doubles')) {
      return { kind: 'format_word', value: 'doubles', ambiguous: false, signal: false, start: i, end };
    }
  }
  return null;
}

function scanTokens(words: string[]): Token[] {
  const tokens: Token[] = [];
  let i = 0;
  while (i < words.length) {
    const token = tokenAt(words, i);
    if (token) {
      tokens.push(token);
      i = token.end;
    } else {
      i += 1;
    }
  }
  return tokens;
}

type Mode = 'segment' | 'tail';

type PartScan = {
  accepted: Token[];
  /** Tokens that were not accepted but are unambiguous age tokens (still a protective signal). */
  extraAge: Token[];
  remaining: string;
  words: string[];
  allTokens: Token[];
};

function scanPart(text: string, mode: Mode): PartScan {
  const words = text.split(' ').filter((w) => w !== '');
  const tokens = scanTokens(words);
  const covered = tokens.reduce((n, t) => n + (t.end - t.start), 0);
  const pure = tokens.length > 0 && covered === words.length;

  // runs of adjacent tokens
  const runs: Token[][] = [];
  for (const token of tokens) {
    const last = runs[runs.length - 1];
    if (last && (last[last.length - 1] as Token).end === token.start) last.push(token);
    else runs.push([token]);
  }
  const accepted: Token[] = [];
  const extraAge: Token[] = [];
  for (const run of runs) {
    const hasCategory = run.some((t) => t.kind === 'category');
    const allUnambiguous = run.every((t) => !t.ambiguous);
    const leadingTail =
      mode === 'tail' && ((run[0] as Token).start === 0 || (run[run.length - 1] as Token).end === words.length);
    if (pure || hasCategory || allUnambiguous || leadingTail) accepted.push(...run);
    else for (const t of run) if (t.kind === 'age' && !t.ambiguous) extraAge.push(t);
  }
  const used = new Set<number>();
  for (const token of accepted) for (let w = token.start; w < token.end; w += 1) used.add(w);
  const remaining = words.filter((_w, index) => !used.has(index)).join(' ');
  return { accepted, extraAge, remaining, words, allTokens: tokens };
}

// ---------------------------------------------------------------------------
// Small text helpers
// ---------------------------------------------------------------------------

function tidy(text: string): string {
  let out = text.replace(/\s+/gu, ' ').trim();
  out = out.replace(/^[\s\-–:,;.|/]+|[\s\-–:,;.|/]+$/gu, '');
  // an unmatched bracket left over after a removal
  if ((out.match(/\(/gu) ?? []).length !== (out.match(/\)/gu) ?? []).length) out = out.replace(/[()]/gu, '');
  return out.replace(/\s+/gu, ' ').trim();
}

function titleCaseWord(word: string): string {
  return word
    .split(/([-'])/u)
    .map((part) => (part.length === 0 || /[-']/u.test(part) ? part : part.charAt(0).toUpperCase() + part.slice(1).toLowerCase()))
    .join('');
}

const LOWER_CONNECTORS = new Set(['and', 'of', 'the', 'for', 'at', 'in']);

/** All-caps or all-lower-case Latin text becomes Title Case; mixed case is left exactly as written. */
function caseTournament(name: string): string {
  const hasLower = /\p{Ll}/u.test(name);
  const hasUpper = /\p{Lu}/u.test(name);
  if (!hasLower && !hasUpper) return name;
  if (hasLower && hasUpper) {
    // mixed case: only capitalise words that are entirely lower case ('state senior Badminton')
    return name
      .split(' ')
      .map((w) => (/^\p{Ll}[\p{Ll}'-]*$/u.test(w) && w.length > 2 && !LOWER_CONNECTORS.has(w) ? titleCaseWord(w) : w))
      .join(' ');
  }
  return name
    .split(' ')
    .map((w) => (/^[A-Z][A-Z]{1,3}$/u.test(w) && !/[AEIOU]/u.test(w) ? w : titleCaseWord(w)))
    .join(' ');
}

const GUARD_PART = /^(?:power\s+smash(?:\s+badminton)?|badminton|badminton\s+power\s+smash|live(?:\s+score|\s+stream(?:ing)?)?|finals?\s+day|day\s*\d+|court\s*#?\s*\d+|full\s+(?:match|video|game)|match\s*\d+)$/iu;

const DECORATION = /\((?:full\s+(?:match|video|game)|live|hd|official|4k)\)/giu;

function istYear(iso: string | null | undefined): number | null {
  if (!iso) return null;
  const ms = Date.parse(iso);
  if (Number.isNaN(ms)) return null;
  const year = new Date(ms + 5.5 * 3600 * 1000).getUTCFullYear();
  return year >= 1900 && year <= 2099 ? year : null;
}

// ---------------------------------------------------------------------------
// VS detection (PC-06)
// ---------------------------------------------------------------------------

const STRONG_VS = /(?<![\p{L}\p{N}])(?:vs\.?|versus|v\/s)(?![\p{L}\p{N}])/giu;
const BARE_V = /(?<=^|\s)v(?=\s|$)/giu;

type VsHit = { segment: number; index: number; length: number };
type VsOutcome = { kind: 'none' } | { kind: 'ok'; hit: VsHit } | { kind: 'ambiguous'; segment: number };

function letterCount(word: string | undefined): number {
  return word === undefined ? 0 : [...word].filter((c) => /\p{L}/u.test(c)).length;
}

function findVs(segments: string[]): VsOutcome {
  const strong: VsHit[] = [];
  segments.forEach((segment, s) => {
    for (const m of segment.matchAll(STRONG_VS)) strong.push({ segment: s, index: m.index as number, length: m[0].length });
  });
  if (strong.length === 1) return { kind: 'ok', hit: strong[0] as VsHit };
  if (strong.length > 1) return { kind: 'ambiguous', segment: (strong[0] as VsHit).segment };

  const bare: VsHit[] = [];
  segments.forEach((segment, s) => {
    for (const m of segment.matchAll(BARE_V)) bare.push({ segment: s, index: m.index as number, length: m[0].length });
  });
  if (bare.length === 0) return { kind: 'none' };
  if (bare.length === 1) {
    const hit = bare[0] as VsHit;
    const segment = segments[hit.segment] as string;
    const before = segment.slice(0, hit.index).trim().split(/\s+/u).pop();
    const after = segment.slice(hit.index + hit.length).trim().split(/\s+/u)[0];
    if (letterCount(before) >= 2 && letterCount(after) >= 2) return { kind: 'ok', hit };
  }
  return { kind: 'ambiguous', segment: (bare[0] as VsHit).segment };
}

// ---------------------------------------------------------------------------
// Sides and players (PC-01, PC-12)
// ---------------------------------------------------------------------------

type PlayerDraft = {
  raw: string;
  seed?: number;
  country?: string;
  districtHint?: string;
  affiliationHint?: string;
};

const GROUP = /\(([^()]*)\)|\[([^[\]]*)\]/gu;
const PARTNER_SEPARATOR = /\s*(?:\/|&|\+)\s*|\s+and\s+/giu;

// ---------------------------------------------------------------------------
// Age words in ANY position (D-012, review B2-1 / B2-2): bracketed, prefix, trailing, any spacing
// ---------------------------------------------------------------------------

type AgeHit = { start: number; end: number; group: string | null; signal: boolean; unknownKey: string | null };

function classifyAgeKey(key: string, words: number): { group: string | null; signal: boolean; unknownKey: string | null } | null {
  const numeric = (n: number, form: 'u' | 'years'): { group: string | null; signal: boolean; unknownKey: string | null } | null => {
    if (n >= 4 && n <= 19) return { group: `U${n}`, signal: true, unknownKey: null };
    if (form === 'u' && n >= 20 && n <= 30) return { group: `U${n}`, signal: false, unknownKey: null };
    if (form === 'u' && n < 4) return { group: null, signal: false, unknownKey: key };
    return null;
  };
  let m = /^(?:u|under|below)(\d{1,2})s?$/u.exec(key);
  if (m) return numeric(Number.parseInt(m[1] as string, 10), 'u');
  m = /^(\d{1,2})(?:u|y|yr|yrs|year|years|yo|yearold|yearsold)$/u.exec(key);
  if (m) return numeric(Number.parseInt(m[1] as string, 10), key.endsWith('u') ? 'u' : 'years');
  m = /^(?:under|below|u)([a-z]+)$/u.exec(key);
  if (m && NUMBER_WORDS[m[1] as string] !== undefined) return numeric(NUMBER_WORDS[m[1] as string] as number, 'u');
  const word = AGE_WORDS[key];
  if (word !== undefined && word.signal) return { group: word.group, signal: true, unknownKey: null };
  if (/^subjrs?$/u.test(key)) return { group: 'sub_junior', signal: true, unknownKey: null };
  // an unknown word is a single word (or a known two-word compound), never a run of unrelated words
  if (UNKNOWN_AGE_LIKE.test(key) && (words === 1 || /^school(?:boys?|girls?)$/u.test(key))) return { group: null, signal: false, unknownKey: key };
  return null;
}

/** Finds age words in a list of raw words; indexes refer to `rawWords` (punctuation-only words are skipped). */
function scanAgeWords(rawWords: string[]): AgeHit[] {
  const index: number[] = [];
  const keys: string[] = [];
  rawWords.forEach((w, i) => {
    const k = wordKey(w);
    if (k !== '') {
      index.push(i);
      keys.push(k);
    }
  });
  const hits: AgeHit[] = [];
  let i = 0;
  while (i < keys.length) {
    let matched = false;
    for (let len = Math.min(3, keys.length - i); len >= 1; len -= 1) {
      const found = classifyAgeKey(keys.slice(i, i + len).join(''), len);
      if (found) {
        hits.push({ start: index[i] as number, end: (index[i + len - 1] as number) + 1, ...found });
        i += len;
        matched = true;
        break;
      }
    }
    if (!matched) i += 1;
  }
  return hits;
}

/** Removes age words from a name ('U15 Arun Kumar' -> 'Arun Kumar'). */
function stripAgeWords(name: string): string {
  const words = name.split(/\s+/u).filter((w) => w !== '');
  const drop = new Set<number>();
  for (const hit of scanAgeWords(words)) for (let w = hit.start; w < hit.end; w += 1) drop.add(w);
  return words.filter((_w, i) => !drop.has(i)).join(' ');
}

function extractHints(part: string): PlayerDraft {
  const draft: PlayerDraft = { raw: '' };
  const name = part.replace(GROUP, (_whole, round: string | undefined, square: string | undefined) => {
    const content = (round ?? square ?? '').trim();
    if (content === '') return ' ';
    // a bracketed age is a signal (collected from the whole title), never an affiliation
    if (scanAgeWords(content.split(/\s+/u)).length > 0) return ' ';
    if (/^\d{1,3}$/u.test(content)) {
      if (draft.seed === undefined) draft.seed = Number.parseInt(content, 10);
    } else if (/^[A-Z]{3}$/u.test(content) && COUNTRY_CODES.has(content)) {
      if (draft.country === undefined) draft.country = content;
    } else {
      const place = canonicalPlace(content);
      if (place !== null && draft.districtHint === undefined) draft.districtHint = place;
      else if (draft.affiliationHint === undefined) draft.affiliationHint = content;
    }
    return ' ';
  });
  draft.raw = tidy(stripAgeWords(name));
  return draft;
}

function splitSide(text: string): { drafts: PlayerDraft[]; explicit: boolean } {
  const parts = text.split(PARTNER_SEPARATOR).filter((p) => p.trim() !== '');
  const drafts = parts.map(extractHints).filter((d) => d.raw !== '');
  return { drafts, explicit: parts.length > 1 };
}

function hasVowelWord(token: string): boolean {
  return /[AEIOU]/u.test(token);
}

function buildPlayer(draft: PlayerDraft, ageStatus: 'minor_suspected' | 'unknown'): ParsedPlayer | null {
  const info = describeName(draft.raw);
  if (info.nameNormalized === null || info.nameKey === null || info.identityTier === null) return null;
  const displayName = info.displayName.trim() === '' ? draft.raw : info.displayName;
  // PC-05 / types.ts: the keys are computed from the DISPLAY name ('KP ARUN' and 'K. P. Arun' agree)
  const nameNormalized = normalizeName(displayName) ?? info.nameNormalized;
  const latin = latinKey(displayName);
  let linkPolicy: ParsedPlayer['linkPolicy'] = info.identityTier === 'multi_token' ? 'provisional_ok' : 'plain_text_only';
  if (latin === null) linkPolicy = 'plain_text_only';
  const player: ParsedPlayer = {
    raw: draft.raw,
    displayName,
    nameNormalized,
    nameKey: info.nameKey,
    latinKey: latin,
    identityTier: info.identityTier,
    linkPolicy,
    truncated: false,
    ageStatus,
  };
  if (draft.seed !== undefined) player.seed = draft.seed;
  if (draft.country !== undefined) player.country = draft.country;
  if (draft.districtHint !== undefined) player.districtHint = draft.districtHint;
  if (draft.affiliationHint !== undefined) player.affiliationHint = draft.affiliationHint;
  return player;
}

function isTeamName(text: string): boolean {
  const stripped = tidy(text.replace(GROUP, ' '));
  if (stripped === '' || /[/&+]/u.test(stripped)) return false;
  if (isPlaceOrState(stripped)) return true;
  return stripped
    .toLowerCase()
    .split(/\s+/u)
    .some((w) => TEAM_WORDS.has(w));
}

// ---------------------------------------------------------------------------
// Boundaries when the title has no separator (PC-09)
// ---------------------------------------------------------------------------

function isMetaWord(words: string[], i: number): boolean {
  const word = trimPunct(words[i] as string);
  if (YEAR_WORD.test(word)) return true;
  const token = tokenAt(words, i);
  if (token !== null && !(token.kind === 'neutral' && token.end - token.start === 1)) {
    if (token.kind === 'round' && token.value === 'F' && wordKey(word) === 'f') return false;
    if (token.kind === 'age' && token.ambiguous) return false;
    return true;
  }
  return TOURNAMENT_NOUNS.has(wordKey(word)) || /^(?:in|at)$/iu.test(word);
}

const ALL_CAPS = /^[^\p{Ll}]*\p{Lu}[^\p{Ll}]*$/u;

/** Two names of up to three words (PC-09 says 'four words' for one name; a doubles side holds two). */
const MAX_SIDE_WORDS = 7;

/** Where side B ends when nothing separates it from the meta text. */
function cutSideB(rightText: string): { side: string; tail: string; forced: boolean } {
  const words = rightText.split(' ').filter((w) => w !== '');
  let cut = words.length;
  let forced = false;
  for (let i = 1; i < words.length; i += 1) {
    const word = words[i] as string;
    if (/^[([]/u.test(word)) continue;
    const metaCut = isMetaWord(words, i);
    const first = words[0] as string;
    const caseCut =
      ALL_CAPS.test(first) &&
      first.replace(/[^\p{L}]/gu, '').length >= 2 &&
      /\p{Ll}/u.test(word) &&
      !/^(?:and|&)$/iu.test(word);
    if (metaCut || caseCut) {
      cut = i;
      break;
    }
  }
  if (cut === words.length && words.length > MAX_SIDE_WORDS) {
    cut = MAX_SIDE_WORDS;
    forced = true;
  }
  return { side: words.slice(0, cut).join(' '), tail: words.slice(cut).join(' '), forced };
}

/** Where side A starts when text before it has no ' - ' or ':' separator. */
function cutSideA(leftText: string): { prefix: string; side: string } {
  const words = leftText.split(' ').filter((w) => w !== '');
  for (let j = words.length - 2; j >= 0; j -= 1) {
    const word = trimPunct(words[j] as string);
    if (word === '') continue;
    const token = tokenAt(words, j);
    const tokenOk =
      token !== null &&
      token.kind !== 'neutral' &&
      !(token.kind === 'round' && token.ambiguous && token.value !== 'F') &&
      !(token.kind === 'round' && token.ambiguous && wordKey(word) === 'f') &&
      !(token.kind === 'age' && token.ambiguous);
    if (tokenOk || YEAR_WORD.test(word) || TOURNAMENT_NOUNS.has(wordKey(word))) {
      const end = tokenOk && token !== null ? Math.max(j + 1, token.end) : j + 1;
      if (end >= words.length) continue;
      return { prefix: words.slice(0, end).join(' '), side: words.slice(end).join(' ') };
    }
  }
  return { prefix: '', side: leftText };
}

// ---------------------------------------------------------------------------
// Meta (tournament, tokens, year) over the segments
// ---------------------------------------------------------------------------

type MetaPiece = { text: string; mode: Mode; order: number };

type MetaResult = {
  category: Category | null;
  round: Round | null;
  ageGroup: AgeGroup | null;
  ageSignals: AgeSignal[];
  formatWords: Set<string>;
  tournamentName: string | null;
  editionNo: number | null;
  year: number | null;
  seasonLabel: string | null;
  playedOn: string | null;
  locationHint: string | null;
  tournamentEdgeOrder: number;
  hadAnyText: boolean;
};

function extractNumbers(
  input: string,
  acc: { years: number[]; season: string | null; playedOn: string | null; edition: number | null; location: string | null },
): string {
  let text = input;
  // date dd/mm/yyyy (India: day first)
  text = text.replace(/(?<!\d)(\d{1,2})[/.-](\d{1,2})[/.-]((?:19|20)\d{2})(?!\d)/gu, (_whole, d: string, m: string, y: string) => {
    const day = Number.parseInt(d, 10);
    const month = Number.parseInt(m, 10);
    const year = Number.parseInt(y, 10);
    acc.years.push(year);
    // an impossible calendar date is dropped from the name but never stored (B2-4)
    if (month >= 1 && month <= 12 && day >= 1 && day <= new Date(Date.UTC(year, month, 0)).getUTCDate() && acc.playedOn === null) {
      acc.playedOn = `${y}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
    }
    return ' ';
  });
  // trailing ', City'
  const comma = /,\s*([^,]+)$/u.exec(text);
  if (comma) {
    const piece = (comma[1] as string).trim();
    const place = canonicalPlace(piece);
    if (place !== null) {
      acc.location ??= place;
      text = text.slice(0, comma.index);
    } else if (/^[A-Z]{2,6}$/u.test(piece)) {
      // ', KBA': an association code is an organiser, not part of the series name
      text = text.slice(0, comma.index);
    }
  }
  // season 2025-26
  text = text.replace(/(?<!\d)((?:19|20)\d{2})\s*[-/]\s*(\d{2})(?!\d)/gu, (whole, a: string, b: string) => {
    const start = Number.parseInt(a, 10);
    if ((start + 1) % 100 !== Number.parseInt(b, 10)) return whole;
    acc.years.push(start);
    acc.season ??= `${a}-${b}`;
    return ' ';
  });
  // the LAST year in the segment (PC-10)
  const years = [...text.matchAll(/(?<!\d)((?:19|20)\d{2})(?!\d)/gu)];
  if (years.length > 0) {
    const last = years[years.length - 1] as RegExpMatchArray;
    acc.years.push(Number.parseInt(last[1] as string, 10));
    // a season-looking suffix that is not start+1 ('2025-27') goes with the year, never stays in the name
    const after = text.slice((last.index as number) + last[0].length).replace(/^\s*[-/]\s*\d{2}(?!\d)/u, ' ');
    text = text.slice(0, last.index) + ' ' + after;
  }
  // ordinal edition: '12th Test Cup' -> 12
  const edition = /(?<!\d)(\d{1,3})(?:st|nd|rd|th)(?![\p{L}\p{N}])\s+(?=\S)/iu.exec(text);
  if (edition) {
    acc.edition ??= Number.parseInt(edition[1] as string, 10);
    text = text.slice(0, edition.index) + text.slice(edition.index + edition[0].length);
  }
  // a known place as the LAST word of a longer name is the location ('... Tournament Thanjavur')
  const trimmed = text.replace(/[\s\-–:,;.|/]+$/gu, '');
  const lastSpace = trimmed.lastIndexOf(' ');
  if (lastSpace > 0) {
    const place = canonicalPlace(trimmed.slice(lastSpace + 1));
    if (place !== null) {
      acc.location ??= place;
      text = trimmed.slice(0, lastSpace);
    }
  }
  return text;
}

function analyseMeta(pieces: MetaPiece[]): MetaResult {
  const acc = { years: [] as number[], season: null as string | null, playedOn: null as string | null, edition: null as number | null, location: null as string | null };
  const formatWords = new Set<string>();
  const signals: AgeSignal[] = [];
  let category: Category | null = null;
  let round: Round | null = null;
  let ageGroup: string | null = null;
  let tournament: string | null = null;
  let tournamentOrder = -1;
  let tournamentYear: number | null = null;
  const allWords: string[] = [];
  const coveredWords = new Set<string>();
  let hadAnyText = false;

  const addSignal = (signal: AgeSignal): void => {
    if (!signals.includes(signal)) signals.push(signal);
  };

  const sorted = [...pieces].sort((a, b) => a.order - b.order);
  for (const piece of sorted) {
    let segmentText = piece.text.replace(DECORATION, ' ').replace(/\s+/gu, ' ').trim();
    if (piece.mode === 'tail') segmentText = segmentText.replace(/^(?:in|at)\s+/iu, '');
    if (segmentText === '') continue;
    hadAnyText = true;
    const parts = segmentText.split(' - ');
    const candidateParts: string[] = [];
    let segmentYear: number | null = null;
    let sawCandidate = false;
    for (const part of parts) {
      const scan = scanPart(part.trim(), piece.mode);
      for (const token of scan.accepted) {
        if (token.kind === 'category' && category === null) category = token.value as Category;
        if (token.kind === 'round' && round === null) round = token.value as Round;
        if (token.kind === 'format_word') formatWords.add(token.value);
        if (token.kind === 'age') {
          if (ageGroup === null) ageGroup = token.value;
          if (token.signal) addSignal(`age_token:${token.value}`);
        }
      }
      for (const token of scan.extraAge) {
        if (ageGroup === null) ageGroup = token.value;
        if (token.signal) addSignal(`age_token:${token.value}`);
      }
      for (const token of scan.allTokens) for (let w = token.start; w < token.end; w += 1) coveredWords.add(wordKey(scan.words[w] as string));
      for (const word of scan.words) allWords.push(word);

      const startsWithYear = /^(?:19|20)\d{2}(?!\d)/u.test(scan.remaining) && sawCandidate;
      const local = { years: [] as number[], season: null as string | null, playedOn: null as string | null, edition: null as number | null, location: null as string | null };
      let rest = extractNumbers(scan.remaining, local);
      acc.years.push(...local.years);
      acc.season ??= local.season;
      acc.playedOn ??= local.playedOn;
      acc.edition ??= local.edition;
      acc.location ??= local.location;
      if (local.years.length > 0) segmentYear = local.years[local.years.length - 1] as number;
      if (startsWithYear) continue; // '2026 Aadhi Badminton': the organiser text after the year is not part of the series name
      rest = tidy(rest);
      if (rest === '' || GUARD_PART.test(rest)) continue;
      const place = canonicalPlace(rest);
      if (place !== null && sawCandidate) {
        acc.location ??= place;
        continue;
      }
      candidateParts.push(rest);
      sawCandidate = true;
    }
    if (tournament === null && candidateParts.length > 0) {
      tournament = candidateParts.join(' - ');
      tournamentOrder = piece.order;
      tournamentYear = segmentYear;
    }
  }

  // unknown age-like words (fail closed): any word that is age-shaped and not mapped
  for (const word of allWords) {
    const key = wordKey(trimPunct(word));
    if (key !== '' && UNKNOWN_AGE_LIKE.test(key) && !coveredWords.has(key)) addSignal(`unknown_age_word:${key}`);
  }

  const year = tournamentYear ?? (acc.years.length > 0 ? (acc.years[acc.years.length - 1] as number) : null);
  return {
    category,
    round,
    ageGroup: ageGroup as AgeGroup | null,
    ageSignals: signals,
    formatWords,
    tournamentName: tournament === null ? null : tidy(caseTournament(tournament)) || null,
    editionNo: acc.edition,
    year,
    seasonLabel: acc.season,
    playedOn: acc.playedOn,
    locationHint: acc.location,
    tournamentEdgeOrder: tournamentOrder,
    hadAnyText,
  };
}

function makeSeriesKey(name: string | null): string | null {
  if (name === null) return null;
  const words = name
    .normalize('NFKC')
    .toLowerCase()
    .replace(/['‘’`´]/gu, '')
    .replace(/[^\p{L}\p{M}\p{N}]+/gu, ' ')
    .split(' ')
    .filter((w) => w !== '');
  const kept = words.filter((w) => !SERIES_FILLERS.has(w) && !/^(?:19|20)\d{2}$/u.test(w) && !/^\d{1,3}(?:st|nd|rd|th)$/u.test(w));
  const key = (kept.length > 0 ? kept : words).join(' ');
  return key === '' ? null : key;
}

// ---------------------------------------------------------------------------
// Content classification (D-033, PC-15)
// ---------------------------------------------------------------------------

function liveStatusOf(ctx: ParseContext | undefined): LiveStatus {
  if (ctx?.liveBroadcastContent === 'live') return 'live';
  if (ctx?.liveBroadcastContent === 'upcoming') return 'upcoming';
  if (ctx?.hasLiveStreamingDetails === true) return 'completed';
  return 'none';
}

function isShortVideo(ctx: ParseContext | undefined, hasShortsTag: boolean, hasVs: boolean): boolean {
  if (ctx?.playlist === 'UULF' || ctx?.playlist === 'UULV') return false;
  if (ctx?.playlist === 'UUSH' || ctx?.rssLinkType === 'shorts') return true;
  const duration = ctx?.durationSeconds;
  if (typeof duration === 'number') return duration <= 180 && (hasShortsTag || !hasVs);
  return hasShortsTag;
}

// ---------------------------------------------------------------------------
// parseTitle
// ---------------------------------------------------------------------------

const SEGMENT_SPLIT = /\s*(?:\|\||::|\|)\s*/u;
/** A game score after at least one name word: '21-15 21-18' or '21 - 15 21 - 18'. */
const SCORE_ANYWHERE = /(?<=\s)((?:\d{1,2}\s*-\s*\d{1,2})(?:\s+\d{1,2}\s*-\s*\d{1,2})*)(?=\s|$)/u;

const MAX_TITLE_CHARS = 300;

/** Video words that are never part of a name ('Bala Murugan Replay', 'LIVE Arun'); B2-3. */
function stripNoise(text: string, end: 'leading' | 'trailing'): string {
  const words = text.split(' ').filter((w) => w !== '');
  while (words.length > 1 && NOISE_WORDS.has(wordKey(words[end === 'trailing' ? words.length - 1 : 0] as string))) {
    if (end === 'trailing') words.pop();
    else words.shift();
  }
  return words.join(' ');
}

function emptyResult(raw: string, normalizedTitle: string, signals: string[], ctx: ParseContext | undefined): ParseResult {
  return {
    parserVersion: PARSER_VERSION,
    rawTitle: raw,
    normalizedTitle,
    signals,
    videoType: 'other',
    liveStatus: liveStatusOf(ctx),
    kind: 'non_match',
    nonMatchReason: null,
    sideA: [],
    sideB: [],
    teams: null,
    format: 'unknown',
    category: null,
    ageGroup: null,
    ageSignals: [],
    minorHold: false,
    round: null,
    year: null,
    yearSource: null,
    seasonLabel: null,
    editionNo: null,
    playedOn: null,
    tournamentName: null,
    seriesKey: null,
    tournamentLinkPolicy: 'none',
    locationHint: null,
    scoreText: null,
    isInternational: false,
    matchKey: null,
    entityCreation: 'blocked',
    entityBlockReason: 'NON_MATCH',
    confidencePoints: 100,
    hardFlags: [],
    softFlags: [],
    needsReview: false,
    reviewReasons: [],
  };
}

function nonMatch(base: ParseResult, reason: NonMatchReason, videoType: VideoType): ParseResult {
  return { ...base, kind: 'non_match', nonMatchReason: reason, videoType };
}

export function parseTitle(raw: string, ctx?: ParseContext): ParseResult {
  // B2-5: YouTube titles are at most 100 characters; anything longer is parsed only up to a cap and flagged
  const capped = raw.length > MAX_TITLE_CHARS;
  const pre = preprocessTitle(capped ? raw.slice(0, MAX_TITLE_CHARS) : raw);
  const signals = pre.hashtags;
  const base = emptyResult(raw, pre.normalizedTitle, signals, ctx);

  // trailing channel-view ellipsis (NFKC turns U+2026 into '...')
  let text = pre.text.replace(DECORATION, ' ').replace(/\s+/gu, ' ').trim();
  const truncated = capped || /\.{3,}\s*$/u.test(text);
  if (truncated) text = text.replace(/\s*\.{3,}\s*$/u, '').trim();

  const segments = text.split(SEGMENT_SPLIT);
  const vs = findVs(segments);
  const shortVideo = isShortVideo(ctx, signals.includes('shorts'), vs.kind !== 'none');
  if (shortVideo) return nonMatch(base, 'SHORT_FORM', 'short');
  if (vs.kind === 'none') return nonMatch(base, 'NO_VS', 'other');
  if (GEAR_BRANDS.test(text)) return nonMatch(base, 'GEAR_VS', 'other');
  if (NON_MATCH_KEYWORDS.test(text)) return nonMatch(base, 'NON_MATCH_KEYWORD', 'other');

  const liveType: VideoType | null = ctx?.liveBroadcastContent === 'live' || ctx?.liveBroadcastContent === 'upcoming' ? 'live' : null;
  const hard = new Set<HardFlag>();
  if (truncated) hard.add('TRUNCATED_TITLE');

  // ----- locate the match segment, its sides, and the meta pieces -----
  const matchIndex = vs.kind === 'ok' ? vs.hit.segment : vs.segment;
  const pieces: MetaPiece[] = [];
  const preSegments = segments.slice(0, matchIndex);
  const postSegments = segments.slice(matchIndex + 1);
  preSegments.forEach((s, i) => pieces.push({ text: s, mode: 'segment', order: i }));
  const matchOrder = matchIndex;
  postSegments.forEach((s, i) => pieces.push({ text: s, mode: 'segment', order: matchIndex + 1 + i + 1 }));

  let leftText = '';
  let rightText = '';
  let scoreText: string | null = null;
  let tailPresent = false;
  let endsInSideB = false;
  const ambiguous = vs.kind === 'ambiguous';

  if (!ambiguous) {
    const hit = (vs as { kind: 'ok'; hit: VsHit }).hit;
    const matchSegment = segments[matchIndex] as string;
    let left = matchSegment.slice(0, hit.index).trim();
    let right = matchSegment.slice(hit.index + hit.length).trim();

    // text before side A
    const lastDash = left.lastIndexOf(' - ');
    const lastColon = left.lastIndexOf(':');
    const cut = Math.max(lastDash, lastColon);
    if (cut >= 0) {
      const sepLength = cut === lastDash && lastDash >= lastColon ? 3 : 1;
      const candidate = left.slice(cut + sepLength).trim();
      if (candidate !== '') {
        pieces.push({ text: left.slice(0, cut), mode: 'segment', order: matchOrder - 0.5 });
        left = candidate;
      }
    }
    {
      // no separator before side A: text up to the last tournament or token word is not a name
      const split = cutSideA(left);
      if (split.prefix !== '') {
        pieces.push({ text: split.prefix, mode: 'tail', order: matchOrder - 0.25 });
        left = split.side;
      }
    }

    // score, then the part of the title after side B
    const score = SCORE_ANYWHERE.exec(right);
    if (score) {
      scoreText = (score[1] as string).trim();
      // keep whatever follows the score ('... 21-15 21-18 Final') so it can still be read as meta
      right = `${right.slice(0, score.index)} ${right.slice(score.index + score[0].length)}`.replace(/\s+/gu, ' ').trim();
    }
    right = stripNoise(right, 'trailing');
    const dash = right.indexOf(' - ');
    if (dash >= 0) {
      pieces.push({ text: right.slice(dash + 3), mode: 'segment', order: matchOrder + 0.5 });
      right = right.slice(0, dash).trim();
    } else {
      const split = cutSideB(right);
      if (split.tail !== '') {
        pieces.push({ text: split.tail, mode: 'tail', order: matchOrder + 0.5 });
        hard.add('NO_SEPARATOR');
        tailPresent = true;
        right = split.side;
      } else if (split.forced) {
        hard.add('NO_SEPARATOR');
      }
    }
    // 'Play factory CHENNAI VS BANGALORE': a city on the right and a city ending the left side is a team tie
    if (!isTeamName(left) && isPlaceOrState(tidy(right.replace(GROUP, ' ')))) {
      const stripped = tidy(left.replace(GROUP, ' ')).split(' ');
      for (const size of [2, 1]) {
        if (stripped.length <= size) continue;
        const team = stripped.slice(-size).join(' ');
        if (isPlaceOrState(team)) {
          pieces.push({ text: stripped.slice(0, -size).join(' '), mode: 'tail', order: matchOrder - 0.2 });
          left = team;
          break;
        }
      }
    }
    leftText = stripNoise(left, 'leading');
    rightText = right;
    endsInSideB = postSegments.every((s) => s.trim() === '') && dash < 0 && !tailPresent;
  } else {
    // ambiguous VS: only meta from the other segments; no sides are produced (PC-06)
    hard.add('AMBIGUOUS_VS');
  }

  const metaOnly = analyseMeta(pieces);
  // age words anywhere in the title (brackets, prefix, trailing, hashtags): D-012, review B2-1 / B2-2
  const ageHits = scanAgeWords([...text.split(' '), ...signals]);
  const mergedSignals: AgeSignal[] = [...metaOnly.ageSignals];
  let mergedGroup: string | null = metaOnly.ageGroup;
  for (const hit of ageHits) {
    const signal: AgeSignal | null =
      hit.unknownKey !== null ? `unknown_age_word:${hit.unknownKey}` : hit.signal && hit.group !== null ? `age_token:${hit.group}` : null;
    if (signal !== null && !mergedSignals.includes(signal)) mergedSignals.push(signal);
    if (mergedGroup === null && hit.group !== null) mergedGroup = hit.group;
  }
  const meta = { ...metaOnly, ageSignals: mergedSignals, ageGroup: mergedGroup as AgeGroup | null };
  const unknownAge = meta.ageSignals.some((s) => s.startsWith('unknown_age_word:'));
  if (unknownAge) hard.add('UNKNOWN_AGE_TOKEN');

  // ----- side parsing -----
  let teams: { a: string; b: string } | null = null;
  let sideA: ParsedPlayer[] = [];
  let sideB: ParsedPlayer[] = [];
  let kind: ParseResult['kind'] = 'match';
  let blockReason: EntityBlockReason | null = null;
  let effectiveAmbiguous = ambiguous;

  const minorSignals = meta.ageSignals.some((s) => !s.startsWith('unknown_age_word:'));
  const junior = meta.category !== null && (JUNIOR_CATEGORIES as readonly string[]).includes(meta.category);
  const ageSignals: AgeSignal[] = [...meta.ageSignals];
  if (junior && meta.category !== null) ageSignals.push(`junior_category:${meta.category}`);
  const minorHold = minorSignals || junior;
  const playerAge = minorHold || unknownAge ? 'minor_suspected' : 'unknown';

  let nameTooLong = false;
  if (!ambiguous) {
    if (isTeamName(leftText) && isTeamName(rightText)) {
      kind = 'team_tie';
      teams = { a: tidy(leftText.replace(GROUP, ' ')), b: tidy(rightText.replace(GROUP, ' ')) };
      hard.add('TEAM_SIDE');
      blockReason = 'TEAM_TIE';
    } else {
      const a = splitSide(leftText);
      const b = splitSide(rightText);
      let draftsA = a.drafts;
      let draftsB = b.drafts;
      const doublesHint =
        (meta.category !== null && DOUBLES_CATEGORIES.includes(meta.category)) || meta.formatWords.has('doubles');
      // legacy mode (D-017): split a slash-less side only with a doubles token, no explicit separator anywhere,
      // and exactly two name tokens on each side
      if (
        doublesHint &&
        !a.explicit &&
        !b.explicit &&
        draftsA.length === 1 &&
        draftsB.length === 1 &&
        describeName((draftsA[0] as PlayerDraft).raw).tokenCount === 2 &&
        describeName((draftsB[0] as PlayerDraft).raw).tokenCount === 2
      ) {
        const splitTwo = (d: PlayerDraft): PlayerDraft[] => {
          const [first, second] = d.raw.split(/\s+/u);
          const one: PlayerDraft = { raw: first as string };
          const two: PlayerDraft = { raw: second as string };
          if (d.seed !== undefined) two.seed = d.seed;
          if (d.country !== undefined) two.country = d.country;
          if (d.districtHint !== undefined) two.districtHint = d.districtHint;
          if (d.affiliationHint !== undefined) two.affiliationHint = d.affiliationHint;
          return [one, two];
        };
        draftsA = splitTwo(draftsA[0] as PlayerDraft);
        draftsB = splitTwo(draftsB[0] as PlayerDraft);
      }
      sideA = draftsA.map((d) => buildPlayer(d, playerAge)).filter((p): p is ParsedPlayer => p !== null);
      sideB = draftsB.map((d) => buildPlayer(d, playerAge)).filter((p): p is ParsedPlayer => p !== null);
      if (sideA.length === 0 || sideB.length === 0) {
        // one side has no usable name: treat like an ambiguous VS, never invent players
        effectiveAmbiguous = true;
        hard.add('AMBIGUOUS_VS');
        sideA = [];
        sideB = [];
      }
    }
  }

  if (effectiveAmbiguous) blockReason = 'AMBIGUOUS_VS';

  // ----- player-level flags -----
  const players = [...sideA, ...sideB];
  const soft: { flag: SoftFlag; count?: number }[] = [];

  if (kind === 'match' && !effectiveAmbiguous) {
    if (sideA.length !== sideB.length) hard.add('UNEVEN_SIDES');
    if (sideA.length > 2 || sideB.length > 2) hard.add('NAME_COUNT_GT2');
    for (const p of players) {
      const tokens = describeName(p.raw).tokenCount;
      if (tokens > 3 || p.raw.length > 40) {
        nameTooLong = true;
        p.linkPolicy = 'blocked';
      }
    }
    if (nameTooLong) hard.add('NAME_TOO_LONG');

    // the same name on both sides (or twice on a side) can never link (PF-054, PF-055)
    const seen = new Map<string, ParsedPlayer[]>();
    for (const p of players) seen.set(p.nameKey, [...(seen.get(p.nameKey) ?? []), p]);
    for (const group of seen.values()) {
      if (group.length > 1) {
        hard.add('DUP_ALIAS_IN_MATCH');
        for (const p of group) p.linkPolicy = 'blocked';
      }
    }

    if (endsInSideB && truncated && sideB.length > 0) {
      const last = sideB[sideB.length - 1] as ParsedPlayer;
      last.truncated = true;
      last.linkPolicy = 'blocked';
    }

    for (const p of players) {
      const info = describeName(p.raw);
      if (info.mixedScript) hard.add('MIXED_SCRIPT_NAME');
      else if (p.latinKey === null) hard.add('NO_LATIN_KEY');
    }
  }

  let format: Format = 'unknown';
  if (kind === 'match' && !effectiveAmbiguous && !nameTooLong && !hard.has('UNEVEN_SIDES') && !hard.has('NAME_COUNT_GT2')) {
    if (sideA.length === 1 && sideB.length === 1) format = 'singles';
    else if (sideA.length === 2 && sideB.length === 2) format = 'doubles';
  }
  if (
    (format === 'singles' && meta.category !== null && DOUBLES_CATEGORIES.includes(meta.category)) ||
    (format === 'doubles' && meta.category !== null && SINGLES_CATEGORIES.includes(meta.category))
  ) {
    hard.add('FORMAT_CATEGORY_MISMATCH');
  }

  // ----- countries (PC-17) -----
  const countries = players.map((p) => p.country).filter((c): c is string => c !== undefined);
  const foreign = countries.some((c) => c !== 'IND');
  if (countries.length > 0 && !foreign) hard.add('INDIA_ONLY_CODE');
  const knownEvent = INTERNATIONAL_EVENTS.test(text);
  const isInternational = foreign || knownEvent;
  if (isInternational) blockReason = blockReason ?? 'INTERNATIONAL';

  // ----- soft flags -----
  if (meta.tournamentName === null) soft.push({ flag: 'NO_TOURNAMENT' });
  if (meta.category === null) soft.push({ flag: 'NO_CATEGORY' });
  if (meta.round === null) soft.push({ flag: 'NO_ROUND' });
  const published = istYear(ctx?.publishedAt);
  let year = meta.year;
  let yearSource: YearSource = year === null ? null : 'title';
  if (year === null && published !== null) {
    year = published;
    yearSource = 'published_at_ist';
  }
  if (yearSource !== 'title') soft.push({ flag: 'NO_YEAR' });
  const singles = players.filter((p) => p.identityTier === 'single_token').length;
  if (singles > 0) soft.push({ flag: 'SINGLE_TOKEN_NAME', count: singles });
  if (players.some((p) => describeName(p.raw).nameLength < 2)) soft.push({ flag: 'SHORT_NAME' });
  if (
    players.some((p) =>
      p.raw.split(/[\s.]+/u).some((token) => (/^[A-Z]{2}$/u.test(token) && hasVowelWord(token)) || token === 'SRI'),
    )
  ) {
    soft.push({ flag: 'SUSPECT_INITIALS' });
  }

  const confidence = computeConfidence({ hard: [...hard], soft });

  // ----- tournament link policy, keys -----
  let tournamentLinkPolicy: TournamentLinkPolicy = 'none';
  if (meta.tournamentName !== null) {
    tournamentLinkPolicy = truncated && !endsInSideB ? 'blocked' : isInternational || blockReason !== null ? 'blocked' : 'candidate_ok';
    if (truncated && endsInSideB) tournamentLinkPolicy = 'blocked';
  }
  const seriesKey = makeSeriesKey(meta.tournamentName);
  let matchKey: string | null = null;
  if (kind === 'match' && !effectiveAmbiguous && sideA.length > 0 && sideB.length > 0) {
    const key = (side: ParsedPlayer[]): string => side.map((p) => p.nameKey).sort().join('+');
    const sidesKey = [key(sideA), key(sideB)].sort().join(' vs ');
    matchKey = [seriesKey ?? '', year ?? '', meta.category ?? '', meta.round ?? '', sidesKey].join('|');
  }

  const videoType: VideoType = liveType ?? (kind === 'match' ? 'match' : 'other');

  return {
    ...base,
    videoType,
    kind,
    nonMatchReason: null,
    sideA,
    sideB,
    teams,
    format,
    category: meta.category,
    ageGroup: meta.ageGroup,
    ageSignals,
    minorHold,
    round: meta.round,
    year,
    yearSource,
    seasonLabel: meta.seasonLabel,
    editionNo: meta.editionNo,
    playedOn: meta.playedOn,
    tournamentName: meta.tournamentName,
    seriesKey,
    tournamentLinkPolicy,
    locationHint: meta.locationHint,
    scoreText,
    isInternational,
    matchKey,
    entityCreation: blockReason === null ? 'allowed' : 'blocked',
    entityBlockReason: blockReason,
    confidencePoints: confidence.points,
    hardFlags: confidence.hardFlags,
    softFlags: confidence.softFlags,
    needsReview: confidence.needsReview,
    reviewReasons: confidence.reviewReasons,
  };
}
