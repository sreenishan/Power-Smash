// Badminton scoring rules (Module 5, Phase A): ruleset, finished-game and match validation, and a rally-by-rally live-scoring state
// machine. PURE: no I/O, no clock, no randomness; every state is a new object (read-only by type) and the input is never changed. Law references are to the BWF Laws of Badminton by subject
// (scoring, service, change of ends, intervals); the sub-numbers were not verified here, so they are left out on purpose.
//
// Rules (BWF Laws of Badminton, rally-point system; the default ruleset):
// - the Laws: a match is best of three games; a game is won by the side that first scores 21 points; at 20-all the side that
//   first gains a 2-point lead wins; at 29-all the side scoring the 30th point wins. So 30-28 IS a valid score (28-all, then two
//   points in a row: the 2-point lead comes before the cap), while 30-27, 31-29 and 23-20 are not.
// - the Laws: the side winning a rally adds a point and serves next (rally point), so the server is always the last rally winner;
//   the winner of a game serves first in the next game, which is the same thing. the Laws: the server serves from the right
//   service court when its own score is even, from the left when odd (we report the court only, not which doubles player serves).
// - the Laws: an interval when the leading score reaches 11 in each game, and between games.
// - the Laws: change ends at the end of each game (except the last) and in the deciding game when the leading score reaches 11.
//
// Decisions:
// - Everything that varies by competition is in the Ruleset (local events often play 15 points, or best of five). For best of five
//   the change of ends after every game is a fixed ASSUMPTION extending the Laws (the caller may ignore the flag). `pointCap: null` means no cap (an assumption-level local variation; BWF always caps at 30).
// - A game can only end on the first rally that makes it decided: we check that the score before the last point was still open.
// - Results are plain-English reasons for the owner and match officials, never codes alone.
import type { DecidedStatus, GameScore, Side } from '../types';

/** The scoring rules of one event. All points are whole numbers. */
export interface Ruleset {
  /** Games needed to win the match (2 = best of three). */
  gamesToWin: number;
  /** Points needed to win a game (21 under BWF the Laws). */
  pointsToWin: number;
  /** Lead needed once both sides are near the end (2 under the Laws). */
  winBy: number;
  /** The score that wins outright whatever the lead (30 under the Laws); null = no cap. */
  pointCap: number | null;
  /** Interval when the leading score first reaches this in a game (11 under the Laws); null = no interval. */
  intervalAt: number | null;
  /** Change ends in the deciding game when the leading score first reaches this (11 under the Laws); null = never. */
  changeEndsInDecidingGameAt: number | null;
}

/** The BWF Laws of Badminton default: best of three games to 21, win by 2, capped at 30, interval and change of ends at 11. */
export const DEFAULT_RULESET: Readonly<Ruleset> = Object.freeze({
  gamesToWin: 2,
  pointsToWin: 21,
  winBy: 2,
  pointCap: 30,
  intervalAt: 11,
  changeEndsInDecidingGameAt: 11,
});

const isWhole = (n: unknown): n is number => typeof n === 'number' && Number.isInteger(n);

/** Problems with a ruleset itself, in plain English; an empty list means the ruleset is usable. */
export function validateRuleset(ruleset: Readonly<Ruleset>): string[] {
  const reasons: string[] = [];
  if (!isWhole(ruleset.gamesToWin) || ruleset.gamesToWin < 1) reasons.push('Games to win must be a whole number, 1 or more.');
  if (!isWhole(ruleset.pointsToWin) || ruleset.pointsToWin < 1) reasons.push('Points to win a game must be a whole number, 1 or more.');
  if (!isWhole(ruleset.winBy) || ruleset.winBy < 1) reasons.push('The winning lead must be a whole number, 1 or more.');
  if (ruleset.pointCap !== null) {
    if (!isWhole(ruleset.pointCap)) reasons.push('The point cap must be a whole number (or none).');
    else if (isWhole(ruleset.pointsToWin) && ruleset.pointCap < ruleset.pointsToWin)
      reasons.push(`The point cap (${ruleset.pointCap}) cannot be below the points to win (${ruleset.pointsToWin}).`);
  }
  for (const [label, value] of [
    ['The interval point', ruleset.intervalAt],
    ['The change-of-ends point', ruleset.changeEndsInDecidingGameAt],
  ] as const) {
    if (value === null) continue;
    if (!isWhole(value) || value < 1 || (isWhole(ruleset.pointsToWin) && value >= ruleset.pointsToWin))
      reasons.push(`${label} must be a whole number from 1 to one less than the points to win (or none).`);
  }
  return reasons;
}

/** The highest number of games a match can have (3 for best of three). */
export function maxGames(ruleset: Readonly<Ruleset>): number {
  return ruleset.gamesToWin * 2 - 1;
}

/** True when a game at this score is over (the Laws, or the ruleset's variation). Assumes non-negative whole numbers. */
export function isGameOver(a: number, b: number, ruleset: Readonly<Ruleset>): boolean {
  const hi = Math.max(a, b);
  if (ruleset.pointCap !== null && hi >= ruleset.pointCap) return true;
  return hi >= ruleset.pointsToWin && Math.abs(a - b) >= ruleset.winBy;
}

/** The result of checking one game score. */
export interface GameCheck {
  valid: boolean;
  /** The winner of a valid finished game; null otherwise. */
  winner: Side | null;
  reasons: string[];
}

const fmt = (s: Readonly<GameScore>): string => `${s.a}-${s.b}`;

function scoreShapeReasons(score: Readonly<GameScore>): string[] {
  return isWhole(score.a) && isWhole(score.b) && score.a >= 0 && score.b >= 0
    ? []
    : [`${String(score.a)}-${String(score.b)}: scores must be whole numbers, 0 or more.`];
}

/**
 * Is this a valid FINISHED game score under the ruleset (for example 21-19, 22-20, 30-29, 30-28 are fine; 21-20, 23-20, 31-29 are
 * not)? The game must be over at this score and must not have been over one point earlier.
 */
export function validateGame(score: Readonly<GameScore>, ruleset: Readonly<Ruleset> = DEFAULT_RULESET): GameCheck {
  const fail = (reasons: string[]): GameCheck => ({ valid: false, winner: null, reasons });
  const rulesetReasons = validateRuleset(ruleset);
  if (rulesetReasons.length > 0) return fail(rulesetReasons);
  const shape = scoreShapeReasons(score);
  if (shape.length > 0) return fail(shape);
  const s = fmt(score);
  if (score.a === score.b) return fail([`${s}: the scores are level, so the game has no winner yet.`]);
  const winner: Side = score.a > score.b ? 'A' : 'B';
  const w = Math.max(score.a, score.b);
  const l = Math.min(score.a, score.b);
  const { pointCap, pointsToWin, winBy } = ruleset;
  if (pointCap !== null && w > pointCap) return fail([`${s}: no game goes past ${pointCap} points.`]);
  if (!isGameOver(w, l, ruleset)) {
    if (w < pointsToWin) return fail([`${s}: the winner needs at least ${pointsToWin} points.`]);
    const capText = pointCap !== null ? ` (or to reach ${pointCap})` : '';
    return fail([`${s}: the game is not over; the winner needs a ${winBy}-point lead${capText}.`]);
  }
  if (isGameOver(w - 1, l, ruleset)) {
    const before = winner === 'A' ? `${w - 1}-${l}` : `${l}-${w - 1}`;
    return fail([`${s}: the game would already have ended at ${before}.`]);
  }
  return { valid: true, winner, reasons: [] };
}

/** True when a score is a possible point in an UNFINISHED game (reachable and not yet over). */
export function isValidInProgressGame(score: Readonly<GameScore>, ruleset: Readonly<Ruleset> = DEFAULT_RULESET): boolean {
  // Any open score is reachable: play level to the lower score, then the leader's points; none of those steps can end the game.
  if (validateRuleset(ruleset).length > 0) return false;
  return scoreShapeReasons(score).length === 0 && !isGameOver(score.a, score.b, ruleset);
}

/**
 * The side that won the match: the first to win `gamesToWin` games, counting games in order (a game's winner is the side with more
 * points). Null when nobody has won yet. It does not check the scores; use validateMatch for that.
 */
export function matchWinner(games: readonly Readonly<GameScore>[], ruleset: Readonly<Ruleset> = DEFAULT_RULESET): Side | null {
  let a = 0;
  let b = 0;
  for (const g of games) {
    if (g.a > g.b) a += 1;
    else if (g.b > g.a) b += 1;
    if (a >= ruleset.gamesToWin) return 'A';
    if (b >= ruleset.gamesToWin) return 'B';
  }
  return null;
}

/** Extra facts validateMatch needs for a walkover or a retirement. */
export interface MatchContext {
  /** Retired: the side that retired (its opponent wins). */
  retiringSide?: Side;
  /** Walkover: the side that received the walkover (the winner). */
  walkoverWinner?: Side;
}

/** The result of checking a whole match. */
export interface MatchCheck {
  valid: boolean;
  winner: Side | null;
  reasons: string[];
}

const other = (side: Side): Side => (side === 'A' ? 'B' : 'A');

/**
 * Check a decided match. `completed`: every game is a valid finished game and the match is decided exactly by the last game.
 * `walkover`: no games, and the caller names the winner. `retired`: every game but the last is a valid finished game, the last may
 * be unfinished (or finished, if the retirement came between games), the match was not already decided, and the winner is the
 * opponent of the retiring side.
 */
export function validateMatch(
  games: readonly Readonly<GameScore>[],
  ruleset: Readonly<Ruleset> = DEFAULT_RULESET,
  status: DecidedStatus = 'completed',
  context: Readonly<MatchContext> = {},
): MatchCheck {
  const rulesetReasons = validateRuleset(ruleset);
  if (rulesetReasons.length > 0) return { valid: false, winner: null, reasons: rulesetReasons };
  const reasons: string[] = [];
  const fail = (): MatchCheck => ({ valid: false, winner: null, reasons });

  if (status === 'walkover') {
    if (games.length > 0) reasons.push('A walkover has no games; remove the game scores or use another status.');
    if (context.walkoverWinner === undefined) reasons.push('Say which side received the walkover.');
    return reasons.length > 0 ? fail() : { valid: true, winner: context.walkoverWinner ?? null, reasons: [] };
  }

  if (games.length > maxGames(ruleset)) reasons.push(`A match has at most ${maxGames(ruleset)} games; ${games.length} were given.`);

  if (status === 'completed') {
    if (games.length === 0) reasons.push('A completed match needs its game scores.');
    games.forEach((g, i) => {
      for (const r of validateGame(g, ruleset).reasons) reasons.push(`Game ${i + 1}: ${r}`);
    });
    if (reasons.length > 0) return fail();
    const decidedAt = decidedAfter(games, ruleset);
    if (decidedAt === null) {
      reasons.push(`Nobody has won ${ruleset.gamesToWin} games yet, so the match is not complete.`);
      return fail();
    }
    if (decidedAt < games.length) {
      reasons.push(`The match was already decided after game ${decidedAt}; no games can follow it.`);
      return fail();
    }
    return { valid: true, winner: matchWinner(games, ruleset), reasons: [] };
  }

  // retired
  if (context.retiringSide === undefined) reasons.push('Say which side retired.');
  // a side that retires before any rally is a walkover, not a retirement (one status per situation)
  if (games.every((g) => g.a === 0 && g.b === 0)) {
    reasons.push('No rally was played: record this as a walkover, not a retirement.');
    return fail();
  }
  games.forEach((g, i) => {
    const last = i === games.length - 1;
    if (!last || !isValidInProgressGame(g, ruleset)) {
      for (const r of validateGame(g, ruleset).reasons) reasons.push(`Game ${i + 1}: ${r}`);
    }
  });
  if (reasons.length > 0) return fail();
  const finished = games.filter((g) => validateGame(g, ruleset).valid);
  if (matchWinner(finished, ruleset) !== null) {
    reasons.push('The match was already decided by the games played, so it cannot end in a retirement.');
    return fail();
  }
  return { valid: true, winner: other(context.retiringSide as Side), reasons: [] };
}

/** The number of games after which the match was decided, or null. */
function decidedAfter(games: readonly Readonly<GameScore>[], ruleset: Readonly<Ruleset>): number | null {
  for (let i = 1; i <= games.length; i += 1) if (matchWinner(games.slice(0, i), ruleset) !== null) return i;
  return null;
}

// ---------------------------------------------------------------- live scoring ----------------------------------------------------

/** The live state of a match, rebuilt from the rally history. Every field is derived from `ruleset`, `firstServer` and `rallies`. */
export interface LiveState {
  readonly ruleset: Readonly<Ruleset>;
  /** The side that served the first rally, if recorded (toss result). */
  readonly firstServer: Side | null;
  /** Every rally winner in order: the exact history that undo() steps back through. */
  readonly rallies: readonly Side[];
  /** Finished games, in order. */
  readonly games: readonly GameScore[];
  /** The game being played; null once the match is over. */
  readonly current: GameScore | null;
  /** 1-based number of the game being played (or of the last game, once the match is over). */
  readonly gameNumber: number;
  readonly gamesWon: Readonly<{ a: number; b: number }>;
  /** True while the current game is the last possible one (the third in best of three). */
  readonly isDecidingGame: boolean;
  /** Winner of the most recent rally; null before the first. */
  readonly lastRallyWinner: Side | null;
  /** The side serving next (the Laws: the last rally winner, or the first server); null if unknown or the match is over. */
  readonly server: Side | null;
  /** The court the server serves from (the Laws: right on its own even score); null when the server is unknown. */
  readonly serviceCourt: 'right' | 'left' | null;
  /** The last rally made the leading score reach the interval point (the Laws). */
  readonly interval: boolean;
  /** The last rally ended a game and the match goes on (interval between games, the Laws). */
  readonly gameJustEnded: boolean;
  /** Players change ends now (the Laws: after a game, or at the deciding-game point). */
  readonly changeEnds: boolean;
  readonly matchOver: boolean;
  readonly winner: Side | null;
}

/** A refusal or a new state. */
export type LiveResult = { ok: true; state: LiveState } | { ok: false; reasons: string[] };

/** Options for startMatch. */
export interface StartOptions {
  /** The side serving the first rally (from the toss); omit if not recorded. */
  firstServer?: Side;
}

function build(ruleset: Readonly<Ruleset>, firstServer: Side | null, rallies: readonly Side[]): LiveState {
  const games: GameScore[] = [];
  let cur: GameScore = { a: 0, b: 0 };
  let interval = false;
  let changeEnds = false;
  let gameJustEnded = false;
  let winner: Side | null = null;
  const deciding = (): boolean => games.length + 1 === maxGames(ruleset);
  for (const side of rallies) {
    interval = false;
    changeEnds = false;
    gameJustEnded = false;
    cur = side === 'A' ? { a: cur.a + 1, b: cur.b } : { a: cur.a, b: cur.b + 1 };
    const mine = side === 'A' ? cur.a : cur.b;
    const theirs = side === 'A' ? cur.b : cur.a;
    if (isGameOver(cur.a, cur.b, ruleset)) {
      games.push(cur);
      cur = { a: 0, b: 0 };
      winner = matchWinner(games, ruleset);
      if (winner === null) {
        gameJustEnded = true;
        changeEnds = true;
      }
    } else {
      // The leading score reaches the mark for the first time: the scorer gets there while the opponent is still below it.
      const reaches = (mark: number | null): boolean => mark !== null && mine === mark && theirs < mark;
      interval = reaches(ruleset.intervalAt);
      changeEnds = deciding() && reaches(ruleset.changeEndsInDecidingGameAt);
    }
  }
  const matchOver = winner !== null;
  const last = rallies.length > 0 ? (rallies[rallies.length - 1] as Side) : null;
  const server = matchOver ? null : (last ?? firstServer);
  const serverScore = server === null ? null : server === 'A' ? cur.a : cur.b;
  const gamesWon = {
    a: games.filter((g) => g.a > g.b).length,
    b: games.filter((g) => g.b > g.a).length,
  };
  return {
    ruleset,
    firstServer,
    rallies,
    games,
    current: matchOver ? null : cur,
    gameNumber: matchOver ? games.length : games.length + 1,
    gamesWon,
    isDecidingGame: !matchOver && deciding(),
    lastRallyWinner: last,
    server,
    serviceCourt: serverScore === null ? null : serverScore % 2 === 0 ? 'right' : 'left',
    interval,
    gameJustEnded,
    changeEnds,
    matchOver,
    winner,
  };
}

/** A new match at 0-0 in game 1, or a refusal when the ruleset itself is not usable. */
export function startMatch(ruleset: Readonly<Ruleset> = DEFAULT_RULESET, options: Readonly<StartOptions> = {}): LiveResult {
  const reasons = validateRuleset(ruleset);
  if (reasons.length > 0) return { ok: false, reasons };
  return { ok: true, state: build({ ...ruleset }, options.firstServer ?? null, []) };
}

/** Record that `side` won a rally. Refused once the match is over. The input state is not changed. */
export function recordPoint(state: LiveState, side: Side): LiveResult {
  if (side !== 'A' && side !== 'B') return { ok: false, reasons: ['A point goes to side A or side B.'] };
  if (state.matchOver) return { ok: false, reasons: ['The match is over; no more points can be recorded.'] };
  return { ok: true, state: build(state.ruleset, state.firstServer, [...state.rallies, side]) };
}

/** Take back the last rally, exactly (the state is rebuilt from the shorter history). Refused when nothing has been played. */
export function undo(state: LiveState): LiveResult {
  if (state.rallies.length === 0) return { ok: false, reasons: ['Nothing to undo; no points have been recorded.'] };
  return { ok: true, state: build(state.ruleset, state.firstServer, state.rallies.slice(0, -1)) };
}

/** The score list for storing a result: finished games plus the unfinished current game if it has any points. */
export function scoreline(state: LiveState): GameScore[] {
  const out = state.games.map((g) => ({ ...g }));
  if (state.current !== null && state.current.a + state.current.b > 0) out.push({ ...state.current });
  return out;
}
