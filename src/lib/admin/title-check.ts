// Title check (spec 10.8, D-017): the owner types a planned YouTube title and sees how the parser would read it, whether the match
// would be accepted without review, and how to bring it closer to title convention v2. PURE: it only READS `parseTitle` (never changes
// it), takes no clock, makes no call. Everything it says is plain English for the owner.
//
// Convention v2 (D-017): `Player A vs Player B || Category Round || Tournament name Year`, a double pipe, at most one " - " (a place after
// the tournament) and none inside the tournament name, category and round present, initial plus surname or full names, year last.
import { parseTitle } from '../parser';
import type { HardFlag, ParseResult, SoftFlag } from '../parser';

export type Verdict = { accepted: true; headline: string; reasons: [] } | { accepted: false; headline: string; reasons: string[] };

export interface TitleCheck {
  rawTitle: string;
  /** What the parser made of it. */
  kind: 'match' | 'team_tie' | 'not_a_match';
  notAMatchWhy: string | null;
  sideA: string[];
  sideB: string[];
  category: string | null;
  ageGroup: string | null;
  /** Set when any age signal fired: plain words about protection. Always shown first. */
  ageWarning: string | null;
  round: string | null;
  tournament: string | null;
  year: number | null;
  /** Where the year came from, in words ("in the title" or "guessed from the upload date"). */
  yearNote: string | null;
  location: string | null;
  confidencePoints: number;
  verdict: Verdict;
  /** Ways to match convention v2. */
  suggestions: string[];
  /** A title built from what the parser found, in convention v2 order; null when the parser found no players. */
  correctedTitle: string | null;
  /** True when `correctedTitle` differs from the typed title. */
  correctedDiffers: boolean;
}

export const YOUTUBE_TITLE_MAX = 100;

const HARD_TEXT: Record<HardFlag, string> = {
  UNEVEN_SIDES: 'The two sides have a different number of players.',
  AMBIGUOUS_VS: 'It is not clear where the match starts: there is more than one "vs".',
  NO_SEPARATOR: 'There is no clear break between the players and the match details. Use || between them.',
  TRUNCATED_TITLE: 'The title looks cut off at the end.',
  DUP_ALIAS_IN_MATCH: 'The same name appears on both sides.',
  FORMAT_CATEGORY_MISMATCH: 'The number of players does not fit the category (singles or doubles).',
  NAME_COUNT_GT2: 'A side has more than two names.',
  NAME_TOO_LONG: 'A name is very long, so it may include other words.',
  TEAM_SIDE: 'A side looks like a team, not a player.',
  MIXED_SCRIPT_NAME: 'A name mixes Tamil and English letters.',
  UNKNOWN_AGE_TOKEN: 'A word looks like an age group but the site does not know it, so the players are treated as possible juniors.',
  INDIA_ONLY_CODE: 'A short code in the title only makes sense inside India.',
  AMBIGUOUS_ALIAS: 'A name could be more than one known player.',
  NO_LATIN_KEY: 'A name is in Tamil letters only, so an English spelling has to be added by hand.',
};

const SOFT_TEXT: Record<SoftFlag, string> = {
  NO_TOURNAMENT: 'No tournament name was found.',
  NO_CATEGORY: 'No category (MS, WS, MD, WD, XD) was found.',
  NO_ROUND: 'No round (Final, Semi Final...) was found.',
  NO_YEAR: 'No year was found.',
  SINGLE_TOKEN_NAME: 'A player has only one name, which cannot be matched to a person.',
  SHORT_NAME: 'A player name is a single letter.',
  SUSPECT_INITIALS: 'Some initials look like a word.',
};

const NON_MATCH_TEXT: Record<string, string> = {
  NO_VS: 'There is no "vs", so this is not read as a match video.',
  NON_MATCH_KEYWORD: 'It contains a word such as highlights or compilation, so it is not read as a single match.',
  GEAR_VS: 'It looks like a gear or brand comparison, not a match.',
  SHORT_FORM: 'It looks like a Short, which never gets a match page.',
};

const CATEGORY_LABEL: Record<string, string> = {
  MS: "Men's singles",
  WS: "Women's singles",
  MD: "Men's doubles",
  WD: "Women's doubles",
  XD: 'Mixed doubles',
  BS: "Boys' singles",
  GS: "Girls' singles",
  BD: "Boys' doubles",
  GD: "Girls' doubles",
};

const ROUND_LABEL: Record<string, string> = {
  R128: 'Round of 128',
  R64: 'Round of 64',
  R32: 'Round of 32',
  R16: 'Round of 16',
  QF: 'Quarter Final',
  SF: 'Semi Final',
  F: 'Final',
  '3P': 'Third Place',
  league: 'League',
  group: 'Group',
};

const AGE_LABEL = (g: string): string => {
  if (/^U\d+$/.test(g)) return `Under ${g.slice(1)}`;
  if (/^\d+\+$/.test(g)) return `${g.slice(0, -1)} and over`;
  return g.replace(/_/g, ' ');
};

/** Plain words about age signals. `null` only when the parser saw none. Bracketed and trailing ages are covered by the parser's age corpus. */
function ageWarningFor(r: ParseResult): string | null {
  const unknownWord = r.hardFlags.includes('UNKNOWN_AGE_TOKEN');
  const signals = r.ageSignals.length > 0 || r.sideA.concat(r.sideB).some((p) => p.ageStatus === 'minor_suspected');
  if (!r.minorHold && !unknownWord && !signals) return null;
  const which = r.ageGroup ? ` (${AGE_LABEL(r.ageGroup)})` : '';
  if (unknownWord && !r.minorHold) {
    return 'A word in this title looks like an age group but the site cannot tell which. To be safe the players are treated as possibly under 18: the match is held for your review and kept off the public site until you decide.';
  }
  return `This title mentions an age group or a junior category${which}. The players in it are treated as possibly under 18: the match is held back and, with the launch settings, hidden from the public site. If these players are adults, take the age words out of the title. If they are juniors, hiding them is the right result.`;
}

function verdictFor(r: ParseResult): Verdict {
  if (r.kind === 'non_match') return { accepted: false, headline: 'Will need review: it is not read as a match.', reasons: [NON_MATCH_TEXT[r.nonMatchReason ?? ''] ?? 'It is not read as a match video.'] };
  const reasons: string[] = [];
  if (r.entityCreation === 'blocked' && r.entityBlockReason === 'INTERNATIONAL') reasons.push('It looks like an international event: videos are listed but get no player or tournament pages.');
  if (r.kind === 'team_tie') reasons.push('It looks like a team tie, which is listed without player pages.');
  for (const h of r.hardFlags) reasons.push(HARD_TEXT[h]);
  if (r.reviewReasons.includes('LOW_SCORE')) {
    for (const s of r.softFlags) reasons.push(SOFT_TEXT[s.flag]);
    reasons.push('Too many details are missing for it to be accepted without a look.');
  }
  if (r.minorHold) reasons.push('A possible junior player: matches like this are always held back for your decision.');
  const accepted = r.kind === 'match' && !r.needsReview && !r.minorHold && r.entityCreation === 'allowed';
  if (accepted) return { accepted: true, headline: 'Will be accepted without review.', reasons: [] };
  if (reasons.length === 0) reasons.push('The reader was not sure about this title.');
  return { accepted: false, headline: 'Will need review.', reasons };
}

const names = (side: ParseResult['sideA']): string[] => side.map((p) => p.displayName);

function suggestionsFor(raw: string, r: ParseResult): string[] {
  const out: string[] = [];
  const trimmed = raw.trim();
  if (trimmed.length > YOUTUBE_TITLE_MAX) out.push(`YouTube cuts titles at ${YOUTUBE_TITLE_MAX} characters. This one has ${trimmed.length}: shorten it.`);
  if (r.kind === 'non_match') {
    out.push('Use the shape "Player A vs Player B || Category Round || Tournament Year" so the site reads it as a match.');
    return out;
  }
  if (!trimmed.includes('||')) out.push('Put a double pipe || between the players and the match details.');
  const dashes = (trimmed.match(/ - /g) ?? []).length;
  if (dashes > 1) out.push('Use at most one " - " in the whole title.');
  if (r.tournamentName && /\s-\s|\s-$|^-\s|[-–—]/.test(r.tournamentName)) out.push('Keep dashes out of the tournament name. Put a place after one " - " at the end if you need it.');
  if (!r.category) out.push('Add the category: MS, WS, MD, WD or XD.');
  if (!r.round) out.push('Add the round: Final, Semi Final, Quarter Final, R16, League...');
  if (!r.tournamentName) out.push('Add the tournament name.');
  if (r.year === null || r.yearSource !== 'title') out.push('Put the year at the end of the tournament name.');
  else if (r.tournamentName && !new RegExp(`${r.year}\\s*(?:-\\s*[^|]*)?$`).test(trimmed.replace(/#\S+/g, '').trim())) out.push('Put the year last.');
  if (r.sideA.concat(r.sideB).some((p) => p.identityTier !== 'multi_token')) out.push('Write each player as initial plus surname, or the full name. A single first name cannot be matched to a person.');
  if (/#\S+|\p{Extended_Pictographic}/u.test(trimmed)) out.push('Hashtags and emojis are ignored by the site: put them in the description instead.');
  if (r.sideA.concat(r.sideB).some((p) => p.truncated)) out.push('Do not end a name with "...".');
  if (r.ageGroup || r.minorHold) out.push('If players are under 18, leave their names out of public posts. Age words in the title keep the match protected.');
  return out;
}

function correctedFor(r: ParseResult): string | null {
  if (r.kind !== 'match' || r.sideA.length === 0 || r.sideB.length === 0) return null;
  const side = (s: ParseResult['sideA']) => names(s).join(' / ');
  const mid = [r.category ?? '', r.ageGroup && r.ageGroup !== 'open' ? r.ageGroup : '', r.round ? ROUND_LABEL[r.round] ?? r.round : ''].filter((x) => x !== '').join(' ');
  const tournament = r.tournamentName ? `${r.tournamentName}${r.locationHint ? ` - ${r.locationHint}` : ''}${r.year !== null ? ` ${r.year}` : ''}` : '';
  return [`${side(r.sideA)} vs ${side(r.sideB)}`, mid, tournament].filter((x) => x !== '').join(' || ');
}

export function checkTitle(rawInput: string): TitleCheck {
  // one visible line: pasted text can carry line breaks the title cannot hold
  const rawTitle = rawInput.replace(/[\r\n\t]+/g, ' ').trim();
  const r = parseTitle(rawTitle);
  const corrected = correctedFor(r);
  return {
    rawTitle,
    kind: r.kind === 'non_match' ? 'not_a_match' : r.kind,
    notAMatchWhy: r.kind === 'non_match' ? (NON_MATCH_TEXT[r.nonMatchReason ?? ''] ?? 'It is not read as a match video.') : null,
    sideA: names(r.sideA),
    sideB: names(r.sideB),
    category: r.category ? `${r.category} (${CATEGORY_LABEL[r.category] ?? r.category})` : null,
    ageGroup: r.ageGroup ? AGE_LABEL(r.ageGroup) : null,
    ageWarning: ageWarningFor(r),
    round: r.round ? (ROUND_LABEL[r.round] ?? r.round) : null,
    tournament: r.tournamentName,
    year: r.year,
    yearNote: r.year === null ? null : r.yearSource === 'title' ? 'in the title' : 'not in the title (taken from the upload date)',
    location: r.locationHint,
    confidencePoints: r.confidencePoints,
    verdict: verdictFor(r),
    suggestions: suggestionsFor(rawTitle, r),
    correctedTitle: corrected,
    correctedDiffers: corrected !== null && corrected !== rawTitle,
  };
}
