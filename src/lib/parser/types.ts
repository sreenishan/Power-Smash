/**
 * Title parser - CORRECTED output types (Milestone M0 skeleton).
 *
 * Source of truth: docs/SPEC_AUDIT.md section 5 (PC-01..PC-30) and docs/DECISIONS.md
 * D-012 (age_status signals), D-013 (identity tiers), D-014 (suppression), D-017 (parser
 * redesign, test-first) and D-033 (Shorts / live classification). These types REPLACE the
 * `ParsedTitle` of spec Appendix A.4, which the parser audit showed to be unsafe.
 *
 * What changed against Appendix A.4 and why:
 *  - `confidence: number (0..1)` -> integer `confidencePoints` (PC-03). 1.0 - 0.3 is exactly
 *    0.7, which is not "below 0.7", so a 1-versus-2 title used to auto-publish. Integer points
 *    plus HARD FLAGS that force review whatever the score remove the boundary problem.
 *  - `kind` gains `team_tie` (PC-16); `non_match` always carries a reason.
 *  - the untouched `rawTitle` is kept next to a separate `normalizedTitle` (D-017: key on video
 *    id, never on the title; raw title is displayed unmodified for YouTube-policy reasons, D-016).
 *  - every player carries an `identityTier` and a `linkPolicy` (PC-01, D-013): single tokens and
 *    initials-only names never link across editions and render as plain text.
 *  - age handling follows D-012: the parser emits SIGNALS (`ageSignals`) and a per-player
 *    `ageStatus` of only `minor_suspected` or `unknown`. It NEVER emits `adult_confirmed`
 *    (only an admin review or a verified claim may) and never `minor_confirmed`. This is the
 *    safest reading: "Protected = every status except adult_confirmed".
 *  - international titles (and other blocked cases) set `entityCreation = 'blocked'` so no
 *    player or tournament rows can be created from them (PC-17).
 *  - NULL means unknown for category, round, age group, year (PC-23). There is no 'unknown'
 *    string in the parser vocabulary; the `toDb()` mapper (M2b) is the single place that maps
 *    to database enums.
 *
 * Choices the audit left open (the safest option was taken and is recorded here):
 *  - Each distinct HARD flag also subtracts HARD_FLAG_PENALTY_POINTS (30) so that the score
 *    stays monotone with risk in the review queue. A hard flag forces review regardless.
 *  - A score of exactly 70 with no hard flag is NOT reviewed ("below 70", PC-03).
 *  - `NO_LATIN_KEY` is an EXTENSION (not in PC-03's list): fixtures PF-040 / PF-041 require a
 *    Tamil-script-only name to be reviewed (no pinned transliteration exists, so no slug and
 *    no latin_key can be produced; D-017 says Tamil slugs are entered manually).
 *  - Hyphenated names ('Mohamed-Ali') count as ONE token for the identity tier (they are very
 *    common given names; treating them as two tokens would make them linkable).
 *  - A minor-signal match is held separately (`minorHold`, D-012, still "proposed") and does
 *    NOT raise `needsReview` on its own: fixtures PF-014/063/065 say review=N while D-012 says
 *    "held in review". The pipeline must hold a match when `needsReview || minorHold`.
 *
 * This file is part of the M0 skeleton: types and constants only, plus two trivial pure
 * predicates. The parser itself lands in M2b.
 */

// ---------------------------------------------------------------------------
// Vocabulary
// ---------------------------------------------------------------------------

export const CATEGORIES = ['MS', 'WS', 'MD', 'WD', 'XD', 'BS', 'GS', 'BD', 'GD'] as const;
export type Category = (typeof CATEGORIES)[number];

/** Categories that are junior (under-age) by definition (spec 15.3, D-012). */
export const JUNIOR_CATEGORIES = ['BS', 'GS', 'BD', 'GD'] as const satisfies readonly Category[];

export const ROUNDS = ['R128', 'R64', 'R32', 'R16', 'QF', 'SF', 'F', '3P', 'league', 'group'] as const;
export type Round = (typeof ROUNDS)[number];

export type Format = 'singles' | 'doubles' | 'unknown';

/**
 * Canonical age-group vocabulary (PC-13, D-012). Casing: `U` upper-case plus digits, `35+`
 * style digits plus a plus sign, everything else lower-case snake_case.
 * `U21` is a valid group but is NOT a minor signal (PC-13, D-012).
 */
export type AgeGroup =
  | `U${number}`
  | `${number}+`
  | 'senior'
  | 'open'
  | 'veterans'
  | 'masters'
  | 'sub_junior'
  | 'junior'
  | 'youth'
  | 'cadet'
  | 'mini';

/** Player age state (D-012). Everything except `adult_confirmed` is PROTECTED. */
export type AgeStatus = 'adult_confirmed' | 'minor_confirmed' | 'minor_suspected' | 'unknown';

/** The only age states the PARSER may emit (never a confirmed state). */
export type ParserAgeStatus = Extract<AgeStatus, 'minor_suspected' | 'unknown'>;

/** Title-level age signals (D-012). Tournament-level signals are added later by the pipeline. */
export type AgeSignal =
  | `age_token:${string}` // e.g. age_token:U13, age_token:sub_junior
  | `junior_category:${Category}` // BS / GS / BD / GD
  | `unknown_age_word:${string}`; // any age-like word the vocabulary does not map (fail closed)

/** D-012: protected = every status except adult_confirmed. */
export function isProtectedAgeStatus(status: AgeStatus): boolean {
  return status !== 'adult_confirmed';
}

export type ParseKind = 'match' | 'non_match' | 'team_tie';

export type NonMatchReason =
  | 'NO_VS' // no VS token at all (spec A.4, PF-035)
  | 'NON_MATCH_KEYWORD' // compilation / highlights / top-N ... (PC-16)
  | 'GEAR_VS' // brand or gear comparison (PC-16)
  | 'SHORT_FORM'; // Short (duration + #shorts / UUSH), never a match page (PC-15)

/** `videos.type` of the spec. */
export type VideoType = 'match' | 'short' | 'live' | 'other';

/** `videos.live_status` of the spec. `completed` = had liveStreamingDetails and has ended (PC-15). */
export type LiveStatus = 'none' | 'upcoming' | 'live' | 'completed';

export type YearSource = 'title' | 'published_at_ist' | null;

// ---------------------------------------------------------------------------
// Identity (PC-01, D-013)
// ---------------------------------------------------------------------------

/**
 * multi_token    : two or more tokens with at least one non-initial ("Arun Kumar", "S. Karthik",
 *                  "Karthik S."). May create a provisional player scoped to the tournament edition.
 * single_token   : one non-initial token ("Ganesh", a Tamil mononym, "Mohamed-Ali"). Never linked
 *                  across editions; rendered as plain text.
 * initials_only  : every token is an initial ("A", "S. V."). Plain text, never linked.
 */
export type IdentityTier = 'multi_token' | 'single_token' | 'initials_only';

/**
 * provisional_ok  : tier allows a provisional player (and an exact confirmed-alias link)
 * plain_text_only : single token or initials only: no link, no player row
 * blocked         : this specific name must never create or link a player (truncated name,
 *                   same alias on both sides, ...)
 * A parse-level `entityCreation = 'blocked'` overrides every player policy.
 */
export type LinkPolicy = 'provisional_ok' | 'plain_text_only' | 'blocked';

export type EntityCreation = 'allowed' | 'blocked';
export type EntityBlockReason = 'INTERNATIONAL' | 'NON_MATCH' | 'TEAM_TIE' | 'AMBIGUOUS_VS';

export type TournamentLinkPolicy = 'candidate_ok' | 'blocked' | 'none';

export type ParsedPlayer = {
  /** The name text as it appeared in the title (after emoji / hashtag stripping, before casing). */
  raw: string;
  /** Title Case; initials stay upper-case with a dot and a space; Tamil script preserved. */
  displayName: string;
  /**
   * PC-05 key, e.g. 's karthik'. Computed from `displayName`, so 'KP ARUN' and 'K. P. Arun' give
   * the same key on purpose. Never an empty string.
   */
  nameNormalized: string;
  /** Initial-position-insensitive key (PC-12), 'karthik|s' for both 'S. Karthik' and 'Karthik S.'. */
  nameKey: string;
  /** ASCII-only key for search / slugs / duplicate detection; null when no Latin form exists (PC-05). */
  latinKey: string | null;
  identityTier: IdentityTier;
  linkPolicy: LinkPolicy;
  /** The name ended in an ellipsis: it must never create or link a player (PF-062). */
  truncated: boolean;
  /** Per participation (PC-13). Never `adult_confirmed`. */
  ageStatus: ParserAgeStatus;
  seed?: number;
  /** IOC/BWF code (PC-17), upper-case. */
  country?: string;
  /** Canonical district name from the districts table (PC-28). */
  districtHint?: string;
  /** Parenthetical that is neither a country nor a district ("CBE"). */
  affiliationHint?: string;
};

// ---------------------------------------------------------------------------
// Confidence, flags and review (PC-03)
// ---------------------------------------------------------------------------

export const START_POINTS = 100;
/** Review when a hard flag fires OR points < REVIEW_THRESHOLD_POINTS (strictly below). */
export const REVIEW_THRESHOLD_POINTS = 70;
/** Points taken per distinct hard flag (choice recorded in the header comment). */
export const HARD_FLAG_PENALTY_POINTS = 30;

/**
 * The first thirteen are the PC-03 list, in order. `AMBIGUOUS_ALIAS` is raised by the
 * resolution stage (PC-02) and never by `parseTitle`. `NO_LATIN_KEY` is the extension noted above.
 */
export const HARD_FLAGS = [
  'UNEVEN_SIDES',
  'AMBIGUOUS_VS',
  'NO_SEPARATOR',
  'TRUNCATED_TITLE',
  'DUP_ALIAS_IN_MATCH',
  'FORMAT_CATEGORY_MISMATCH',
  'NAME_COUNT_GT2',
  'NAME_TOO_LONG',
  'TEAM_SIDE',
  'MIXED_SCRIPT_NAME',
  'UNKNOWN_AGE_TOKEN',
  'INDIA_ONLY_CODE',
  'AMBIGUOUS_ALIAS',
  'NO_LATIN_KEY',
] as const;
export type HardFlag = (typeof HARD_FLAGS)[number];

/** Soft flags subtract integer points (PC-03). */
export const SOFT_FLAG_POINTS = {
  NO_TOURNAMENT: 20,
  NO_CATEGORY: 10,
  NO_ROUND: 5,
  NO_YEAR: 5,
  SINGLE_TOKEN_NAME: 5, // per affected player
  SHORT_NAME: 20, // once, when any player name is shorter than 2 characters
  SUSPECT_INITIALS: 10, // once (ambiguous tokens such as AJ or SRI, PC-12; detection lands in M2b)
} as const;
export type SoftFlag = keyof typeof SOFT_FLAG_POINTS;
export const SOFT_FLAGS = Object.keys(SOFT_FLAG_POINTS) as SoftFlag[];

/** Soft flags that accumulate per occurrence; every other soft flag counts once. */
export const PER_OCCURRENCE_SOFT_FLAGS: readonly SoftFlag[] = ['SINGLE_TOKEN_NAME'];

export type SoftFlagHit = { flag: SoftFlag; count: number; points: number };

export type ReviewReason = HardFlag | 'LOW_SCORE';

// ---------------------------------------------------------------------------
// Input context and output
// ---------------------------------------------------------------------------

/** What the sync knows about the video besides its title (D-033). All optional. */
export type ParseContext = {
  durationSeconds?: number | null;
  /** `snippet.liveBroadcastContent` from the API. */
  liveBroadcastContent?: 'none' | 'upcoming' | 'live' | null;
  /** True when `liveStreamingDetails` is present (a completed stream keeps it). */
  hasLiveStreamingDetails?: boolean;
  /** Which uploads playlist the video was seen in (UUSH = Shorts, UULF = long-form, UULV = live). */
  playlist?: 'UUSH' | 'UULF' | 'UULV' | null;
  /** RSS entry link type, a second Shorts signal for recent videos (D-033). */
  rssLinkType?: 'shorts' | 'watch' | null;
  /** ISO instant; the IST year of it is the fallback when the title has no year (PC-10). */
  publishedAt?: string | null;
};

export type ParseResult = {
  /** Bump on every rule change; stored as `videos.parser_version`. */
  parserVersion: string;
  /** The title exactly as received. NEVER altered (displayed unmodified, D-016). */
  rawTitle: string;
  /** Matching copy: NFKC, punctuation folded (PC-08), entities decoded, whitespace collapsed. */
  normalizedTitle: string;
  /** Hashtags captured before stripping, lower-case without '#', e.g. ['shorts'] (PC-07). */
  signals: string[];

  videoType: VideoType;
  liveStatus: LiveStatus;

  kind: ParseKind;
  /** Set iff `kind === 'non_match'`. */
  nonMatchReason: NonMatchReason | null;

  /** Empty for `non_match`, `team_tie` and an ambiguous VS (no player rows from those). */
  sideA: ParsedPlayer[];
  sideB: ParsedPlayer[];
  /** Set iff `kind === 'team_tie'`: the two team names as written (PC-16). */
  teams: { a: string; b: string } | null;
  /** From player counts only, never from names (spec A.3). */
  format: Format;

  /** Only from explicit tokens; never inferred from names (spec A.3). */
  category: Category | null;
  ageGroup: AgeGroup | null;
  /** Title-level age signals (D-012). */
  ageSignals: AgeSignal[];
  /**
   * D-012 (still "proposed"): a REAL minor signal (an age token up to U19 or a junior category,
   * not U-21, not an unknown word) means the match is held out of auto-publication. Separate
   * from `needsReview` on purpose; the pipeline holds when `needsReview || minorHold`.
   */
  minorHold: boolean;
  round: Round | null;

  year: number | null;
  yearSource: YearSource;
  /** '2025-26' style (PC-10). */
  seasonLabel: string | null;
  /** Ordinal edition ('12th Test Cup' -> 12), removed from the series name (PC-10). */
  editionNo: number | null;
  /** 'YYYY-MM-DD' parsed DD/MM/YYYY (India), null when absent. */
  playedOn: string | null;

  /** Series name WITHOUT the year, edition ordinal or trailing location (PC-10). */
  tournamentName: string | null;
  /** Normalised series key with filler words removed (PC-11); null when no tournament. */
  seriesKey: string | null;
  tournamentLinkPolicy: TournamentLinkPolicy;
  /** Canonical district or city (PC-28), e.g. 'Tiruchirappalli' for 'Trichy'. */
  locationHint: string | null;
  /** Score peeled out of side B ('21-15 21-18'), never part of a name (PC-09). */
  scoreText: string | null;

  /** Any non-IND country code or a known international event (PC-17). */
  isInternational: boolean;
  /**
   * Opaque duplicate-detection key (PC-19): equal for two videos of the same match (same
   * edition, category, round and side name keys), different otherwise; null when sides are
   * unresolvable. The exact format is implementation-defined; tests only compare keys.
   */
  matchKey: string | null;

  entityCreation: EntityCreation;
  entityBlockReason: EntityBlockReason | null;

  /** Integer 0..100. Not a probability. DB column should be a smallint. */
  confidencePoints: number;
  hardFlags: HardFlag[];
  softFlags: SoftFlagHit[];
  /** `hardFlags.length > 0 || confidencePoints < REVIEW_THRESHOLD_POINTS` for matches and team ties. */
  needsReview: boolean;
  reviewReasons: ReviewReason[];
};

/** Marker returned by the M0 skeleton `parseTitle`. M2b removes it. */
export const NOT_IMPLEMENTED = 'NOT_IMPLEMENTED' as const;

export type NotImplementedParse = {
  status: typeof NOT_IMPLEMENTED;
  rawTitle: string;
  message: string;
};

/** Return type of the skeleton `parseTitle`. M2b narrows it to `ParseResult`. */
export type ParseOutcome = ParseResult | NotImplementedParse;

export function isNotImplemented(outcome: ParseOutcome): outcome is NotImplementedParse {
  return (outcome as { status?: unknown }).status === NOT_IMPLEMENTED;
}
