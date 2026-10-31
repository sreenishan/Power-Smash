// Badminton scoring rules (BWF Laws of Badminton defaults, configurable rulesets) and the live rally state machine. Fictional data only.
import { describe, expect, it } from 'vitest';
import {
  DEFAULT_RULESET,
  isGameOver,
  isValidInProgressGame,
  matchWinner,
  maxGames,
  recordPoint,
  scoreline,
  startMatch,
  undo,
  validateGame,
  validateMatch,
  validateRuleset,
  type LiveState,
  type Ruleset,
} from '../../src/lib/competition/scoring';
import type { Side } from '../../src/lib/competition/types';

const g = (a: number, b: number): { a: number; b: number } => ({ a, b });
const RULES_15: Ruleset = { ...DEFAULT_RULESET, pointsToWin: 15, pointCap: 21, intervalAt: 8, changeEndsInDecidingGameAt: 8 };
const BEST_OF_5: Ruleset = { ...DEFAULT_RULESET, gamesToWin: 3 };

function start(ruleset: Ruleset = DEFAULT_RULESET, firstServer?: Side): LiveState {
  const r = startMatch(ruleset, firstServer === undefined ? {} : { firstServer });
  if (!r.ok) throw new Error(r.reasons.join(' '));
  return r.state;
}
function play(state: LiveState, sides: string): LiveState {
  let s = state;
  for (const ch of sides) {
    const r = recordPoint(s, ch as Side);
    if (!r.ok) throw new Error(r.reasons.join(' '));
    s = r.state;
  }
  return s;
}
const times = (side: Side, n: number): string => side.repeat(n);

describe('ruleset', () => {
  it('the default is the BWF rally-point system', () => {
    expect(DEFAULT_RULESET).toEqual({ gamesToWin: 2, pointsToWin: 21, winBy: 2, pointCap: 30, intervalAt: 11, changeEndsInDecidingGameAt: 11 });
    expect(validateRuleset(DEFAULT_RULESET)).toEqual([]);
    expect(maxGames(DEFAULT_RULESET)).toBe(3);
    expect(maxGames(BEST_OF_5)).toBe(5);
    expect(Object.isFrozen(DEFAULT_RULESET)).toBe(true);
  });
  it('accepts local variations', () => {
    expect(validateRuleset(RULES_15)).toEqual([]);
    expect(validateRuleset(BEST_OF_5)).toEqual([]);
    expect(validateRuleset({ ...DEFAULT_RULESET, pointCap: null })).toEqual([]);
    expect(validateRuleset({ ...DEFAULT_RULESET, intervalAt: null, changeEndsInDecidingGameAt: null })).toEqual([]);
    expect(validateRuleset({ ...DEFAULT_RULESET, pointCap: 21 })).toEqual([]);
  });
  it('refuses broken rulesets with reasons', () => {
    expect(validateRuleset({ ...DEFAULT_RULESET, pointsToWin: 0 })).toHaveLength(3); // the interval and change-of-ends points are now out of range too
    expect(validateRuleset({ ...DEFAULT_RULESET, winBy: 0 })[0]).toMatch(/lead/);
    expect(validateRuleset({ ...DEFAULT_RULESET, pointCap: 20 })[0]).toMatch(/cannot be below/);
    expect(validateRuleset({ ...DEFAULT_RULESET, gamesToWin: 0 })[0]).toMatch(/Games to win/);
    expect(validateRuleset({ ...DEFAULT_RULESET, gamesToWin: 1.5 })).toHaveLength(1);
    expect(validateRuleset({ ...DEFAULT_RULESET, intervalAt: 21 })[0]).toMatch(/interval/);
    expect(validateRuleset({ ...DEFAULT_RULESET, changeEndsInDecidingGameAt: 0 })[0]).toMatch(/change-of-ends/);
  });
});

describe('validateGame (default 21, win by 2, cap 30)', () => {
  const ok: [number, number][] = [[21, 19], [22, 20], [30, 29], [30, 28], [21, 15], [25, 23], [21, 0], [0, 21], [19, 21], [29, 30], [24, 26]];
  const bad: [number, number, RegExp][] = [
    [21, 20, /2-point lead \(or to reach 30\)/],
    [30, 27, /already have ended at 29-27/],
    [31, 29, /past 30/],
    [23, 20, /already have ended at 22-20/],
    [20, 18, /at least 21/],
    [21, 21, /level/],
    [0, 0, /level/],
    [29, 28, /not over/],
    [22, 19, /already have ended at 21-19/],
    [19, 22, /already have ended at 19-21/],
    [-1, 21, /whole numbers/],
    [21.5, 19, /whole numbers/],
  ];
  it.each(ok)('%i-%i is a valid finished game', (a, b) => {
    const r = validateGame(g(a, b));
    expect(r).toEqual({ valid: true, winner: a > b ? 'A' : 'B', reasons: [] });
  });
  it.each(bad)('%i-%i is refused', (a, b, why) => {
    const r = validateGame(g(a, b));
    expect(r.valid).toBe(false);
    expect(r.winner).toBeNull();
    expect(r.reasons.join(' ')).toMatch(why);
  });
  it('NaN is refused', () => {
    expect(validateGame(g(Number.NaN, 21)).valid).toBe(false);
  });
  it('follows a 15-point ruleset (cap 21)', () => {
    expect(validateGame(g(15, 13), RULES_15).valid).toBe(true);
    expect(validateGame(g(16, 14), RULES_15).valid).toBe(true);
    expect(validateGame(g(21, 20), RULES_15).valid).toBe(true);
    expect(validateGame(g(21, 19), RULES_15).valid).toBe(true);
    expect(validateGame(g(15, 14), RULES_15).valid).toBe(false);
    expect(validateGame(g(22, 20), RULES_15).reasons[0]).toMatch(/past 21/);
    expect(validateGame(g(21, 15), RULES_15).valid).toBe(false);
  });
  it('without a cap, a game goes on until the lead', () => {
    const noCap: Ruleset = { ...DEFAULT_RULESET, pointCap: null };
    expect(validateGame(g(35, 33), noCap).valid).toBe(true);
    expect(validateGame(g(31, 30), noCap).reasons[0]).toMatch(/2-point lead\.$/);
  });
  it('a first-to-21 ruleset (cap = 21) has no deuce', () => {
    const sudden: Ruleset = { ...DEFAULT_RULESET, pointCap: 21 };
    expect(validateGame(g(21, 20), sudden).valid).toBe(true);
    expect(validateGame(g(22, 20), sudden).valid).toBe(false);
  });
  it('refuses when the ruleset is broken', () => {
    expect(validateGame(g(21, 10), { ...DEFAULT_RULESET, winBy: 0 }).reasons[0]).toMatch(/lead/);
  });
  it('isGameOver and isValidInProgressGame', () => {
    expect(isGameOver(20, 20, DEFAULT_RULESET)).toBe(false);
    expect(isGameOver(30, 29, DEFAULT_RULESET)).toBe(true);
    expect(isValidInProgressGame(g(29, 29))).toBe(true);
    expect(isValidInProgressGame(g(11, 4))).toBe(true);
    expect(isValidInProgressGame(g(21, 4))).toBe(false);
    expect(isValidInProgressGame(g(-1, 0))).toBe(false);
  });
});

describe('matchWinner', () => {
  it('first to the games needed, counting in order', () => {
    expect(matchWinner([g(21, 10), g(21, 12)])).toBe('A');
    expect(matchWinner([g(21, 10), g(10, 21), g(19, 21)])).toBe('B');
    expect(matchWinner([g(21, 10)])).toBeNull();
    expect(matchWinner([])).toBeNull();
    expect(matchWinner([g(21, 10), g(10, 21), g(21, 3)], BEST_OF_5)).toBeNull();
    expect(matchWinner([g(10, 21), g(10, 21), g(21, 3), g(21, 3)])).toBe('B');
  });
});

describe('validateMatch', () => {
  it('completed: straight games and three games', () => {
    expect(validateMatch([g(21, 19), g(21, 15)], DEFAULT_RULESET, 'completed')).toEqual({ valid: true, winner: 'A', reasons: [] });
    expect(validateMatch([g(21, 19), g(28, 30), g(18, 21)]).winner).toBe('B');
  });
  it('completed: best of five', () => {
    expect(validateMatch([g(21, 1), g(1, 21), g(21, 1), g(1, 21), g(21, 19)], BEST_OF_5).winner).toBe('A');
    expect(validateMatch([g(21, 1), g(21, 1)], BEST_OF_5).reasons[0]).toMatch(/Nobody has won 3/);
  });
  it('completed: refusals', () => {
    expect(validateMatch([]).reasons[0]).toMatch(/needs its game scores/);
    expect(validateMatch([g(21, 19)]).reasons[0]).toMatch(/not complete/);
    expect(validateMatch([g(21, 19), g(21, 20)]).reasons[0]).toMatch(/^Game 2: 21-20/);
    expect(validateMatch([g(21, 19), g(21, 17), g(10, 21)]).reasons[0]).toMatch(/already decided after game 2/);
    expect(validateMatch([g(21, 1), g(1, 21), g(21, 1), g(21, 1)]).reasons[0]).toMatch(/at most 3 games/);
  });
  it('walkover: no games, named winner', () => {
    expect(validateMatch([], DEFAULT_RULESET, 'walkover', { walkoverWinner: 'B' })).toEqual({ valid: true, winner: 'B', reasons: [] });
    expect(validateMatch([g(21, 0)], DEFAULT_RULESET, 'walkover', { walkoverWinner: 'B' }).reasons[0]).toMatch(/no games/);
    expect(validateMatch([], DEFAULT_RULESET, 'walkover').reasons[0]).toMatch(/received the walkover/);
  });
  it('retired: unfinished last game, opponent wins', () => {
    expect(validateMatch([g(21, 19), g(5, 11)], DEFAULT_RULESET, 'retired', { retiringSide: 'B' })).toEqual({ valid: true, winner: 'A', reasons: [] });
    // No rally played: that is a walkover, not a retirement (one status per situation).
    for (const games of [[], [g(0, 0)]]) {
      const r = validateMatch(games, DEFAULT_RULESET, 'retired', { retiringSide: 'A' });
      expect(r.valid).toBe(false);
      expect(r.winner).toBeNull();
      expect(r.reasons.join(' ')).toMatch(/walkover/);
    }
    // Retired between games: the last game is finished but the match is not decided.
    expect(validateMatch([g(21, 19)], DEFAULT_RULESET, 'retired', { retiringSide: 'A' }).winner).toBe('B');
  });
  it('retired: refusals', () => {
    expect(validateMatch([g(21, 19), g(5, 11)], DEFAULT_RULESET, 'retired').reasons[0]).toMatch(/which side retired/);
    expect(validateMatch([g(21, 20), g(5, 11)], DEFAULT_RULESET, 'retired', { retiringSide: 'A' }).reasons[0]).toMatch(/^Game 1/);
    expect(validateMatch([g(21, 19), g(31, 29)], DEFAULT_RULESET, 'retired', { retiringSide: 'A' }).reasons[0]).toMatch(/^Game 2.*past 30/);
    expect(validateMatch([g(21, 19), g(21, 10)], DEFAULT_RULESET, 'retired', { retiringSide: 'B' }).reasons[0]).toMatch(/already decided/);
    expect(validateMatch([g(21, 19), g(21, 10), g(3, 0)], DEFAULT_RULESET, 'retired', { retiringSide: 'B' }).reasons.length).toBeGreaterThan(0);
  });
  it('refuses a broken ruleset', () => {
    expect(validateMatch([g(21, 1), g(21, 1)], { ...DEFAULT_RULESET, gamesToWin: 0 }).valid).toBe(false);
    expect(isValidInProgressGame(g(3, 2), { ...DEFAULT_RULESET, pointsToWin: 0 })).toBe(false);
  });
});

describe('live scoring', () => {
  it('starts at 0-0 in game 1', () => {
    const s = start(DEFAULT_RULESET, 'B');
    expect(s.current).toEqual(g(0, 0));
    expect(s.gameNumber).toBe(1);
    expect(s.server).toBe('B');
    expect(s.serviceCourt).toBe('right');
    expect(s.lastRallyWinner).toBeNull();
    expect(s.matchOver).toBe(false);
    expect(start().server).toBeNull();
    expect(start().serviceCourt).toBeNull();
  });
  it('refuses a broken ruleset', () => {
    const r = startMatch({ ...DEFAULT_RULESET, pointCap: 10 });
    expect(r.ok).toBe(false);
  });
  it('rally point: the rally winner scores and serves, court by own score parity', () => {
    let s = play(start(DEFAULT_RULESET, 'A'), 'B');
    expect(s.current).toEqual(g(0, 1));
    expect(s.server).toBe('B');
    expect(s.serviceCourt).toBe('left');
    s = play(s, 'B');
    expect(s.serviceCourt).toBe('right');
    expect(s.lastRallyWinner).toBe('B');
  });
  it('is immutable: recording a point leaves the old state alone', () => {
    const s0 = start();
    const s1 = play(s0, 'A');
    expect(s0.rallies).toEqual([]);
    expect(s0.current).toEqual(g(0, 0));
    expect(s1.rallies).toEqual(['A']);
  });
  it('interval when the leading score first reaches 11, not again', () => {
    let s = play(start(), times('A', 10) + times('B', 10));
    expect(s.interval).toBe(false);
    s = play(s, 'B');
    expect(s.current).toEqual(g(10, 11));
    expect(s.interval).toBe(true);
    expect(s.changeEnds).toBe(false); // not the deciding game
    s = play(s, 'A');
    expect(s.current).toEqual(g(11, 11));
    expect(s.interval).toBe(false);
  });
  it('a game ends at 21, ends change, the winner serves first in the next game', () => {
    let s = play(start(), times('B', 20) + times('A', 5));
    s = play(s, 'B');
    expect(s.games).toEqual([g(5, 21)]);
    expect(s.current).toEqual(g(0, 0));
    expect(s.gameNumber).toBe(2);
    expect(s.gamesWon).toEqual({ a: 0, b: 1 });
    expect(s.gameJustEnded).toBe(true);
    expect(s.changeEnds).toBe(true);
    expect(s.server).toBe('B');
    expect(s.serviceCourt).toBe('right');
    s = play(s, 'A');
    expect(s.gameJustEnded).toBe(false);
    expect(s.changeEnds).toBe(false);
  });
  it('deuce all the way to 30: 29-all, the 30th point wins', () => {
    let s = play(start(), times('A', 20) + times('B', 20));
    for (let i = 0; i < 9; i += 1) {
      s = play(s, 'AB');
      expect(s.games).toEqual([]);
    }
    expect(s.current).toEqual(g(29, 29));
    s = play(s, 'B');
    expect(s.games).toEqual([g(29, 30)]);
    expect(validateGame(s.games[0] ?? g(0, 0)).valid).toBe(true);
  });
  it('deuce: a 2-point lead wins at 22-20 and at 30-28', () => {
    const s = play(start(), times('A', 20) + times('B', 20) + 'AA');
    expect(s.games).toEqual([g(22, 20)]);
    const t = play(start(), times('A', 20) + times('B', 20) + 'AB'.repeat(8) + 'AA');
    expect(t.games).toEqual([g(30, 28)]);
  });
  it('deciding game: change ends at 11, match over refuses more points, undo is exact', () => {
    let s = play(start(), times('A', 21) + times('B', 21));
    expect(s.gameNumber).toBe(3);
    expect(s.isDecidingGame).toBe(true);
    s = play(s, times('B', 10));
    s = play(s, 'B');
    expect(s.interval).toBe(true);
    expect(s.changeEnds).toBe(true);
    s = play(s, times('B', 10));
    expect(s.matchOver).toBe(true);
    expect(s.winner).toBe('B');
    expect(s.current).toBeNull();
    expect(s.server).toBeNull();
    expect(s.gameJustEnded).toBe(false);
    expect(s.changeEnds).toBe(false);
    expect(s.gameNumber).toBe(3);
    expect(s.games).toEqual([g(21, 0), g(0, 21), g(0, 21)]);
    expect(scoreline(s)).toEqual(s.games);
    expect(validateMatch(scoreline(s)).winner).toBe('B');
    const refused = recordPoint(s, 'A');
    expect(refused).toEqual({ ok: false, reasons: ['The match is over; no more points can be recorded.'] });
    const back = undo(s);
    if (!back.ok) throw new Error('undo refused');
    expect(back.state.matchOver).toBe(false);
    expect(back.state.current).toEqual(g(0, 20));
    expect(back.state.games).toHaveLength(2);
    expect(back.state).toEqual(play(start(), times('A', 21) + times('B', 21) + times('B', 20)));
  });
  it('undo across a game boundary restores the previous game', () => {
    const s = play(start(), times('A', 21));
    const r = undo(s);
    if (!r.ok) throw new Error('undo refused');
    expect(r.state.games).toEqual([]);
    expect(r.state.current).toEqual(g(20, 0));
    expect(r.state.gameNumber).toBe(1);
  });
  it('undo back to the start, then refuses', () => {
    let s = play(start(DEFAULT_RULESET, 'A'), 'BBA');
    for (let i = 0; i < 3; i += 1) {
      const r = undo(s);
      if (!r.ok) throw new Error('undo refused');
      s = r.state;
    }
    expect(s).toEqual(start(DEFAULT_RULESET, 'A'));
    expect(undo(s)).toEqual({ ok: false, reasons: ['Nothing to undo; no points have been recorded.'] });
  });
  it('refuses a side that is not A or B', () => {
    expect(recordPoint(start(), 'C' as Side).ok).toBe(false);
  });
  it('a straight-games match ends after game 2 with no deciding game', () => {
    const s = play(start(), times('A', 21) + times('A', 21));
    expect(s.matchOver).toBe(true);
    expect(s.winner).toBe('A');
    expect(s.gamesWon).toEqual({ a: 2, b: 0 });
    expect(s.isDecidingGame).toBe(false);
  });
  it('a 15-point best-of-5 match, interval at 8, scoreline mid-game', () => {
    const rules: Ruleset = { ...RULES_15, gamesToWin: 3 };
    let s = play(start(rules), times('A', 15) + times('B', 15) + times('A', 15) + times('B', 15));
    expect(s.gameNumber).toBe(5);
    expect(s.isDecidingGame).toBe(true);
    s = play(s, times('A', 8));
    expect(s.interval).toBe(true);
    expect(s.changeEnds).toBe(true);
    expect(scoreline(s)).toEqual([g(15, 0), g(0, 15), g(15, 0), g(0, 15), g(8, 0)]);
    expect(validateMatch(scoreline(s), rules, 'retired', { retiringSide: 'B' }).winner).toBe('A');
    s = play(s, times('A', 7));
    expect(s.winner).toBe('A');
    expect(validateMatch(scoreline(s), rules).valid).toBe(true);
  });
});

describe('a winning lead of 1 (a local variation): no score past the first decided point', () => {
  const winBy1 = { ...DEFAULT_RULESET, winBy: 1, pointCap: null, intervalAt: null, changeEndsInDecidingGameAt: null };
  it('21-20 ends the game, so 22-21 and 21-21 can never happen', () => {
    expect(validateGame({ a: 21, b: 20 }, winBy1).valid).toBe(true);
    expect(validateGame({ a: 22, b: 21 }, winBy1).valid).toBe(false);
    expect(validateGame({ a: 22, b: 21 }, winBy1).reasons[0]).toMatch(/already have ended/);
    expect(isValidInProgressGame({ a: 21, b: 21 }, winBy1)).toBe(false);
    expect(isValidInProgressGame({ a: 20, b: 20 }, winBy1)).toBe(true);
  });
  it('with a cap above the points to win, 30-29 is refused too (the game ended at 21-20)', () => {
    expect(validateGame({ a: 30, b: 29 }, { ...winBy1, pointCap: 30 }).valid).toBe(false);
  });
  it('the Laws default is unchanged (every open score reachable)', () => {
    expect(validateGame({ a: 30, b: 28 }).valid).toBe(true);
    expect(validateGame({ a: 30, b: 29 }).valid).toBe(true);
    expect(isValidInProgressGame({ a: 29, b: 29 })).toBe(true);
  });
});
