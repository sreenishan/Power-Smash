// Single-elimination bracket progression and results (Module 4, Phase A). PURE: no I/O, no clock, no randomness; every function
// returns a new bracket and never changes its input. Nothing here is wired into a page, the admin or the database yet.
//
// Model:
// - A bracket is built from its first-round lines (2^n of them, 2 to 128): each line is an entry id or BYE. Line 2k and 2k+1 meet
//   in first-round match k+1. Round codes follow the number of lines left: 2 = F, 4 = SF, 8 = QF, 16 = R16 ... 128 = R128 (the
//   archive's codes, src/lib/archive/labels.ts). Match ids are `<round>-<position>` (for example `QF-3`, `F-1`, `3P-1`).
// - The bracket stores ONLY the lines, the options and the results by match id; every match (sides, state, winner) is derived
//   from them, so a bracket can never hold a winner that its results do not explain.
//
// Rules:
// - Byes: an entry against a BYE advances without a match (state `bye`). BYE against BYE (uneven fields) is `void` and sends a BYE
//   on, so a later entry facing it also advances without a match. No result can be entered for a bye or void match.
// - Refused at creation: a layout where one half of the draw (the first or the second half of the lines) holds no entry. Such a
//   final would be a bye, and the places below the champion (runner-up, semi-finalists, third) would no longer follow the round
//   an entry lost in. Draws spread byes so this does not happen (an assumption about common draw practice, not a cited
//   regulation); a field that small belongs in a smaller bracket. So the final is always a real match.
// - A result advances its winner only when it is confirmed (MatchResult.confirmed) and its status is completed, walkover or
//   retired (all three have a winner; BWF General Competition Regulations treat a walkover and a retirement as a loss for the
//   side that did not finish). `abandoned` is recorded but advances nobody; a later result may replace it (a replay).
// - Refused: an unknown match; a match with a side not known yet; an unconfirmed result; a decided status without a winner or an
//   abandoned one with a winner; a winner that is not the expected entry (when the caller names it); a change to a decided match
//   through applyResult (corrections go through correctResult).
// - Immutable: the bracket, its matches, its slots and every stored result (games included) are frozen copies; changing the
//   caller's result object after applyResult or correctResult does not change the bracket.
// - correctResult replaces or clears a recorded result. If the change alters who plays a later match that already has a result
//   (decided or abandoned), it refuses and lists those matches, unless `clearDependents` is set: then those later results are
//   cleared first (transitively) and listed. A score-only correction that keeps the same winner affects nothing downstream.
//
// Decisions and assumptions (configurable where a competition may differ):
// - Third-place match (`3P-1`, between the semi-final losers): OFF by default (an assumption: most BWF individual events do not
//   play one; turn on per competition with `thirdPlace: true`). It needs at least 4 lines. If one semi-final had no loser (a bye
//   or void semi-final), the other loser takes third without a match (an assumption; documented, not configurable yet).
// - Game scores are not validated here (the scoring engine does that); only the result's shape is.
// - Entry ids are opaque; 'BYE' and 'not decided' are reserved and refused as ids.
import type { MatchResult, RoundCode, Side } from '../types';

/** A first-round line with no entry. */
export const BYE = 'BYE' as const;
/** What standings report for a place that is not settled yet. */
export const NOT_DECIDED = 'not decided' as const;
export type NotDecided = typeof NOT_DECIDED;

/** Smallest and largest number of first-round lines (R128 is the largest archive round code). */
export const MIN_LINES = 2;
export const MAX_LINES = 128;

/** One side of a match: a known entry, a bye, or not known yet (waiting for an earlier match). */
export type Slot = { readonly kind: 'entry'; readonly entryId: string } | { readonly kind: 'bye' } | { readonly kind: 'tbd' };

/**
 * waiting = a side is not known yet; ready = both entries known, no result; decided = a winner advanced; abandoned = recorded,
 * nobody advanced; bye = an entry advanced without a match; void = BYE against BYE.
 */
export type BracketMatchState = 'waiting' | 'ready' | 'decided' | 'abandoned' | 'bye' | 'void';

export interface BracketLink {
  readonly matchId: string;
  readonly side: Side;
}

export interface BracketMatch {
  readonly id: string;
  readonly round: RoundCode;
  /** 0 = first round; the third-place match shares the final's index. */
  readonly roundIndex: number;
  /** 1-based position within the round. */
  readonly position: number;
  readonly a: Slot;
  readonly b: Slot;
  readonly state: BracketMatchState;
  /** The recorded result (decided or abandoned matches only). */
  readonly result: MatchResult | null;
  readonly winner: string | null;
  readonly loser: string | null;
  /** Where the winner goes; null for the final and the third-place match. */
  readonly next: BracketLink | null;
  /** Where the loser goes (semi-finals with a third-place match only). */
  readonly loserNext: BracketLink | null;
}

export interface BracketOptions {
  /** Play a third-place match between the semi-final losers. Default false (assumption, see header). */
  readonly thirdPlace?: boolean;
}

export interface Bracket {
  readonly lines: readonly string[];
  readonly options: { readonly thirdPlace: boolean };
  /** Recorded results by match id: the only state besides the lines. */
  readonly results: Readonly<Record<string, MatchResult>>;
  /** Main-draw round codes, first round first (for example ['QF', 'SF', 'F']). */
  readonly rounds: readonly RoundCode[];
  /** Every match, round by round, then `3P-1` when enabled. */
  readonly matches: readonly BracketMatch[];
}

export type BracketError =
  | 'invalid_size'
  | 'too_few_entries'
  | 'empty_half'
  | 'invalid_entry_id'
  | 'duplicate_entry'
  | 'unknown_match'
  | 'no_match_needed'
  | 'sides_not_known'
  | 'not_confirmed'
  | 'invalid_result'
  | 'winner_not_in_match'
  | 'already_decided'
  | 'nothing_to_correct'
  | 'later_rounds_depend';

export type CreateBracketOutcome =
  | { readonly ok: true; readonly bracket: Bracket }
  | { readonly ok: false; readonly error: BracketError; readonly message: string };

export type BracketUpdate =
  | { readonly ok: true; readonly bracket: Bracket; /** Later results that were cleared (correctResult only). */ readonly affected: readonly string[] }
  | { readonly ok: false; readonly error: BracketError; readonly message: string; /** Later matches that depend on this one. */ readonly affected: readonly string[] };

export interface ResultOptions {
  /** When given, the winning side must hold this entry (guards against entering a result on the wrong side). */
  readonly winnerEntryId?: string;
}

export interface CorrectionOptions extends ResultOptions {
  /** Clear the results of later matches that depend on this one instead of refusing. Default false. */
  readonly clearDependents?: boolean;
}

export type EntryFinish = 'champion' | 'runner-up' | 'third' | 'fourth' | 'semifinalist' | 'eliminated' | 'alive';

export interface EntryStanding {
  readonly entryId: string;
  /** The furthest main-draw round the entry has a place in. */
  readonly roundReached: RoundCode;
  readonly finish: EntryFinish;
}

export interface BracketStandings {
  /** The final and (when enabled) the third-place match are settled. */
  readonly complete: boolean;
  readonly champion: string | NotDecided;
  /** Never null for a bracket from createBracket (an empty half is refused); null only as a safe fallback. */
  readonly runnerUp: string | NotDecided | null;
  /** The losing semi-finalists; empty for a 2-line bracket. */
  readonly semifinalists: readonly string[] | NotDecided;
  /** null = no third-place match (disabled, too small, or no opponent). */
  readonly thirdPlace: string | NotDecided | null;
  readonly fourthPlace: string | NotDecided | null;
  /** One row per entry, in line order. */
  readonly entries: readonly EntryStanding[];
}

const BYE_SLOT: Slot = Object.freeze({ kind: 'bye' });
const TBD_SLOT: Slot = Object.freeze({ kind: 'tbd' });
const THIRD_PLACE_ID = '3P-1';
const DECIDED = new Set<string>(['completed', 'walkover', 'retired']);

const entrySlot = (entryId: string): Slot => Object.freeze({ kind: 'entry', entryId });

/** A frozen copy of a result (games included), so the caller's object can never change a stored one. */
function freezeResult(result: MatchResult): MatchResult {
  return Object.freeze({ ...result, games: Object.freeze(result.games.map((g) => Object.freeze({ ...g }))) });
}

/** Round code for a round that starts with `lines` lines (2 = F ... 128 = R128). */
export function roundCodeFor(lines: number): RoundCode {
  switch (lines) {
    case 2:
      return 'F';
    case 4:
      return 'SF';
    case 8:
      return 'QF';
    case 16:
      return 'R16';
    case 32:
      return 'R32';
    case 64:
      return 'R64';
    case 128:
      return 'R128';
    default:
      throw new RangeError(`No round code for ${lines} lines`);
  }
}

function isPowerOfTwo(n: number): boolean {
  return Number.isInteger(n) && n > 0 && (n & (n - 1)) === 0;
}

interface Evaluated {
  match: BracketMatch;
  advance: Slot;
  drop: Slot;
}

function evaluate(
  id: string,
  round: RoundCode,
  roundIndex: number,
  position: number,
  a: Slot,
  b: Slot,
  stored: MatchResult | null,
  next: BracketLink | null,
  loserNext: BracketLink | null,
): Evaluated {
  const base = { id, round, roundIndex, position, a, b, next, loserNext };
  if (a.kind === 'tbd' || b.kind === 'tbd') {
    return { match: { ...base, state: 'waiting', result: null, winner: null, loser: null }, advance: TBD_SLOT, drop: TBD_SLOT };
  }
  if (a.kind === 'bye' && b.kind === 'bye') {
    return { match: { ...base, state: 'void', result: null, winner: null, loser: null }, advance: BYE_SLOT, drop: BYE_SLOT };
  }
  if (a.kind === 'bye' || b.kind === 'bye') {
    const winner = a.kind === 'entry' ? a.entryId : b.kind === 'entry' ? b.entryId : '';
    return { match: { ...base, state: 'bye', result: null, winner, loser: null }, advance: entrySlot(winner), drop: BYE_SLOT };
  }
  if (stored === null) {
    return { match: { ...base, state: 'ready', result: null, winner: null, loser: null }, advance: TBD_SLOT, drop: TBD_SLOT };
  }
  if (stored.status === 'abandoned' || stored.winner === null) {
    return { match: { ...base, state: 'abandoned', result: stored, winner: null, loser: null }, advance: TBD_SLOT, drop: TBD_SLOT };
  }
  const winner = stored.winner === 'A' ? a.entryId : b.entryId;
  const loser = stored.winner === 'A' ? b.entryId : a.entryId;
  return { match: { ...base, state: 'decided', result: stored, winner, loser }, advance: entrySlot(winner), drop: entrySlot(loser) };
}

function derive(lines: readonly string[], thirdPlace: boolean, results: Readonly<Record<string, MatchResult>>): BracketMatch[] {
  const stored = (id: string): MatchResult | null => (Object.prototype.hasOwnProperty.call(results, id) ? (results[id] ?? null) : null);
  const out: BracketMatch[] = [];
  let slots: Slot[] = lines.map((line) => (line === BYE ? BYE_SLOT : entrySlot(line)));
  const sfDrops: Slot[] = [];
  const withThird = thirdPlace && lines.length >= 4;
  let roundIndex = 0;
  while (slots.length >= 2) {
    const code = roundCodeFor(slots.length);
    const nextCode = slots.length > 2 ? roundCodeFor(slots.length / 2) : null;
    const nextSlots: Slot[] = [];
    for (let k = 0; k < slots.length / 2; k++) {
      const id = `${code}-${k + 1}`;
      const side: Side = k % 2 === 0 ? 'A' : 'B';
      const next = nextCode === null ? null : { matchId: `${nextCode}-${Math.floor(k / 2) + 1}`, side };
      const loserNext = code === 'SF' && withThird ? { matchId: THIRD_PLACE_ID, side } : null;
      const ev = evaluate(id, code, roundIndex, k + 1, slots[2 * k] ?? TBD_SLOT, slots[2 * k + 1] ?? TBD_SLOT, stored(id), next, loserNext);
      out.push(ev.match);
      nextSlots.push(ev.advance);
      if (code === 'SF') sfDrops.push(ev.drop);
    }
    slots = nextSlots;
    roundIndex++;
  }
  if (withThird) {
    const ev = evaluate(THIRD_PLACE_ID, '3P', roundIndex - 1, 1, sfDrops[0] ?? TBD_SLOT, sfDrops[1] ?? TBD_SLOT, stored(THIRD_PLACE_ID), null, null);
    out.push(ev.match);
  }
  return out.map((m) => Object.freeze({ ...m, next: m.next && Object.freeze({ ...m.next }), loserNext: m.loserNext && Object.freeze({ ...m.loserNext }) }));
}

function build(lines: readonly string[], thirdPlace: boolean, results: Readonly<Record<string, MatchResult>>): Bracket {
  const rounds: RoundCode[] = [];
  for (let n = lines.length; n >= 2; n /= 2) rounds.push(roundCodeFor(n));
  return Object.freeze({
    lines: Object.freeze([...lines]),
    options: Object.freeze({ thirdPlace }),
    results: Object.freeze({ ...results }),
    rounds: Object.freeze(rounds),
    matches: Object.freeze(derive(lines, thirdPlace, results)),
  });
}

/** Builds a bracket from its first-round lines (entry ids or BYE, 2^n lines, 2 to 128, at least two entries). */
export function createBracket(lines: readonly string[], options: BracketOptions = {}): CreateBracketOutcome {
  if (!isPowerOfTwo(lines.length) || lines.length < MIN_LINES || lines.length > MAX_LINES) {
    return { ok: false, error: 'invalid_size', message: `A bracket needs 2, 4, 8 ... 128 lines; got ${lines.length}.` };
  }
  const seen = new Set<string>();
  for (const line of lines) {
    if (line === BYE) continue;
    if (typeof line !== 'string' || line.trim() === '' || line === NOT_DECIDED) {
      return { ok: false, error: 'invalid_entry_id', message: `"${String(line)}" cannot be used as an entry id.` };
    }
    if (seen.has(line)) return { ok: false, error: 'duplicate_entry', message: `Entry "${line}" is on more than one line.` };
    seen.add(line);
  }
  if (seen.size < 2) return { ok: false, error: 'too_few_entries', message: 'A bracket needs at least two entries.' };
  const half = lines.length / 2;
  const hasEntry = (part: readonly string[]): boolean => part.some((line) => line !== BYE);
  if (!hasEntry(lines.slice(0, half)) || !hasEntry(lines.slice(half))) {
    return {
      ok: false,
      error: 'empty_half',
      message: `One half of the draw has no entry, so the final would be a bye. Spread the byes, or use a ${half}-line bracket.`,
    };
  }
  return { ok: true, bracket: build(lines, options.thirdPlace === true, {}) };
}

/** The match with this id, or null. */
export function getMatch(bracket: Bracket, matchId: string): BracketMatch | null {
  return bracket.matches.find((m) => m.id === matchId) ?? null;
}

/** Matches with both entries known and no deciding result yet (ready or abandoned), in bracket order. */
export function playableMatches(bracket: Bracket): readonly BracketMatch[] {
  return bracket.matches.filter((m) => m.state === 'ready' || m.state === 'abandoned');
}

function refuse(error: BracketError, message: string, affected: readonly string[] = []): BracketUpdate {
  return { ok: false, error, message, affected };
}

/** Checks the match can take a result and the result's shape; null when fine. */
function checkResult(match: BracketMatch | null, matchId: string, result: MatchResult, opts: ResultOptions): BracketUpdate | null {
  if (match === null) return refuse('unknown_match', `There is no match "${matchId}" in this bracket.`);
  if (match.state === 'bye' || match.state === 'void') return refuse('no_match_needed', `${matchId} is a bye: no result is needed.`);
  if (match.state === 'waiting') return refuse('sides_not_known', `Both sides of ${matchId} are not known yet.`);
  if (!result.confirmed) return refuse('not_confirmed', 'Only a confirmed result can be entered.');
  const decided = DECIDED.has(result.status);
  if (decided && result.winner !== 'A' && result.winner !== 'B') {
    return refuse('invalid_result', `A ${result.status} result needs a winner.`);
  }
  if (!decided && (result.status !== 'abandoned' || result.winner !== null)) {
    return refuse('invalid_result', 'An abandoned match has no winner.');
  }
  if (opts.winnerEntryId !== undefined) {
    const side = result.winner === 'A' ? match.a : result.winner === 'B' ? match.b : null;
    if (side === null || side.kind !== 'entry' || side.entryId !== opts.winnerEntryId) {
      return refuse('winner_not_in_match', `"${opts.winnerEntryId}" is not the winning side of ${matchId}.`);
    }
  }
  return null;
}

function sideKey(s: Slot): string {
  return s.kind === 'entry' ? `e:${s.entryId}` : s.kind;
}

/**
 * Puts `next` (or removes the result when null) on `matchId`, then finds later recorded results whose sides change because of it,
 * transitively. Returns the results with those cleared and the ids, in bracket order.
 */
function settle(bracket: Bracket, matchId: string, next: MatchResult | null): { results: Record<string, MatchResult>; affected: string[] } {
  const before = new Map(bracket.matches.map((m) => [m.id, `${sideKey(m.a)}|${sideKey(m.b)}`]));
  const results: Record<string, MatchResult> = { ...bracket.results };
  if (next === null) delete results[matchId];
  else results[matchId] = next;
  const affected = new Set<string>();
  for (;;) {
    const changed = derive(bracket.lines, bracket.options.thirdPlace, results).filter(
      (m) => m.id !== matchId && Object.prototype.hasOwnProperty.call(results, m.id) && before.get(m.id) !== `${sideKey(m.a)}|${sideKey(m.b)}`,
    );
    if (changed.length === 0) break;
    for (const m of changed) {
      delete results[m.id];
      affected.add(m.id);
    }
  }
  const order = bracket.matches.map((m) => m.id).filter((id) => affected.has(id));
  return { results, affected: order };
}

/**
 * Records a confirmed result on a match whose two entries are known and that has no deciding result yet (a result may replace an
 * abandoned one). Completed, walkover and retired advance the winner; abandoned advances nobody.
 */
export function applyResult(bracket: Bracket, matchId: string, result: MatchResult, opts: ResultOptions = {}): BracketUpdate {
  const match = getMatch(bracket, matchId);
  const bad = checkResult(match, matchId, result, opts);
  if (bad) return bad;
  if (match?.state === 'decided') {
    return refuse('already_decided', `${matchId} already has a result; use correctResult to change it.`);
  }
  const { results } = settle(bracket, matchId, freezeResult(result));
  return { ok: true, bracket: build(bracket.lines, bracket.options.thirdPlace, results), affected: [] };
}

/**
 * The later matches whose recorded results would be cleared if `matchId` got `result` (null = cleared). Empty when none, and
 * empty when correctResult would refuse the input itself (unknown match, no recorded result, invalid result); call correctResult
 * for the reason.
 */
export function previewCorrection(bracket: Bracket, matchId: string, result: MatchResult | null, opts: ResultOptions = {}): readonly string[] {
  if (checkCorrection(getMatch(bracket, matchId), matchId, result, opts) !== null) return [];
  return settle(bracket, matchId, result).affected;
}

/** The checks correctResult makes before looking at later matches; null when fine. */
function checkCorrection(match: BracketMatch | null, matchId: string, result: MatchResult | null, opts: ResultOptions): BracketUpdate | null {
  if (match === null) return refuse('unknown_match', `There is no match "${matchId}" in this bracket.`);
  if (match.result === null) return refuse('nothing_to_correct', `${matchId} has no recorded result; use applyResult.`);
  return result === null ? null : checkResult(match, matchId, result, opts);
}

/**
 * Replaces (or, with null, clears) the recorded result of a match. Refuses when later recorded results depend on the change and
 * lists them in `affected`, unless `clearDependents` is set: then those later results are cleared and listed in `affected`.
 */
export function correctResult(
  bracket: Bracket,
  matchId: string,
  result: MatchResult | null,
  opts: CorrectionOptions = {},
): BracketUpdate {
  const bad = checkCorrection(getMatch(bracket, matchId), matchId, result, opts);
  if (bad) return bad;
  const { results, affected } = settle(bracket, matchId, result === null ? null : freezeResult(result));
  if (affected.length > 0 && opts.clearDependents !== true) {
    return refuse('later_rounds_depend', `Later results depend on ${matchId}: ${affected.join(', ')}. Clear them first.`, affected);
  }
  return { ok: true, bracket: build(bracket.lines, bracket.options.thirdPlace, results), affected };
}

const settled = (m: BracketMatch | undefined): boolean => m !== undefined && (m.state === 'decided' || m.state === 'bye' || m.state === 'void');

/** Champion, runner-up, losing semi-finalists, third and fourth place, and the round each entry reached. */
export function standings(bracket: Bracket): BracketStandings {
  const main = bracket.matches.filter((m) => m.round !== '3P');
  const final = main.find((m) => m.round === 'F');
  const third = bracket.matches.find((m) => m.round === '3P');
  const sfs = main.filter((m) => m.round === 'SF');

  const champion = settled(final) && final?.winner ? final.winner : NOT_DECIDED;
  // createBracket refuses an empty half, so a settled final is always a decided match with a loser; null stays as a safe fallback.
  const runnerUp = !settled(final) ? NOT_DECIDED : (final?.loser ?? null);
  const semifinalists: readonly string[] | NotDecided =
    sfs.length === 0 ? [] : sfs.every(settled) ? sfs.flatMap((m) => (m.loser === null ? [] : [m.loser])) : NOT_DECIDED;
  let thirdPlace: string | NotDecided | null = null;
  let fourthPlace: string | NotDecided | null = null;
  if (third !== undefined && third.state !== 'void') {
    thirdPlace = settled(third) ? (third.winner ?? null) : NOT_DECIDED;
    fourthPlace = settled(third) ? third.loser : NOT_DECIDED;
  }
  const complete = champion !== NOT_DECIDED && (third === undefined || settled(third));

  const entries: EntryStanding[] = [];
  for (const id of bracket.lines) {
    if (id === BYE) continue;
    let reached: RoundCode = main[0]?.round ?? 'F';
    let lostIn: BracketMatch | null = null;
    for (const m of main) {
      const inMatch = (m.a.kind === 'entry' && m.a.entryId === id) || (m.b.kind === 'entry' && m.b.entryId === id);
      if (!inMatch) continue;
      reached = m.round;
      if (m.loser === id) lostIn = m;
    }
    let finish: EntryFinish = 'alive';
    if (champion === id) finish = 'champion';
    else if (lostIn?.round === 'F') finish = 'runner-up';
    else if (third?.state === 'decided' && third.winner === id) finish = 'third';
    else if (third?.state === 'bye' && third.winner === id) finish = 'third';
    else if (third?.state === 'decided' && third.loser === id) finish = 'fourth';
    else if (lostIn?.round === 'SF') finish = 'semifinalist';
    else if (lostIn !== null) finish = 'eliminated';
    entries.push({ entryId: id, roundReached: reached, finish });
  }
  return { complete, champion, runnerUp, semifinalists, thirdPlace, fourthPlace, entries };
}
