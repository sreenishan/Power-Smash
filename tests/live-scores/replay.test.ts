// The rally log replay (D-113): the engine's recordPoint/undo rules, undo as a compensating tap, the first server, and the snapshot
// shape the SQL replay (app.competition_live_replay, 0021) returns. Fictional matches only.
import { describe, expect, it } from 'vitest';
import { DEFAULT_RULESET, startMatch, type Ruleset } from '../../src/lib/competition/scoring';
import { applyTap, cuesOf, replayScoreEvents, snapshotOf, stateFromSnapshot, type ScoreEventRow } from '../../src/lib/live-scores/replay';

let seq = 0;
const ev = (kind: ScoreEventRow['kind'], side: ScoreEventRow['side'] = null, at = '2026-11-07T04:30:00.000Z'): ScoreEventRow => ({ seq: ++seq, kind, side, recordedAt: at });
const rallies = (sides: string, at?: string) => [...sides].map((s) => ev('rally', s as 'A' | 'B', at));
const reset = () => {
  seq = 0;
};

describe('replayScoreEvents', () => {
  it('an empty log is 0-0 in game 1 with nobody serving, exactly the SQL shape', () => {
    reset();
    const r = replayScoreEvents([], DEFAULT_RULESET);
    expect(r.ok && r.snapshot).toEqual({
      lastSeq: 0, firstServer: null, rallySides: '', rallies: 0, gameNumber: 1, pointsA: 0, pointsB: 0, gamesA: 0, gamesB: 0, games: [],
      server: null, matchOver: false, winnerSide: null, lastPointAt: null,
    });
  });

  it('the first server serves until the first rally; then the rally winner serves', () => {
    reset();
    const r = replayScoreEvents([ev('first_server', 'B'), ...rallies('A')], DEFAULT_RULESET);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.snapshot).toMatchObject({ firstServer: 'B', pointsA: 1, server: 'A', lastSeq: 2, rallies: 1 });
  });

  it('undo is a compensating tap: the last effective rally goes, the log keeps growing', () => {
    reset();
    const r = replayScoreEvents([...rallies('AAB'), ev('undo'), ev('undo'), ...rallies('B')], DEFAULT_RULESET);
    expect(r.ok && r.snapshot).toMatchObject({ pointsA: 1, pointsB: 1, rallySides: 'AB', lastSeq: 6 });
  });

  it('undo across the end of a game reopens it', () => {
    reset();
    const log = [...rallies('A'.repeat(21)), ev('undo')];
    const r = replayScoreEvents(log, DEFAULT_RULESET);
    expect(r.ok && r.snapshot).toMatchObject({ gameNumber: 1, pointsA: 20, pointsB: 0, games: [], gamesA: 0 });
  });

  it('21-19 ends game 1 (19-all, then A twice), the SQL check scenario', () => {
    reset();
    const r = replayScoreEvents(rallies('AB'.repeat(19) + 'AA'), DEFAULT_RULESET);
    expect(r.ok && r.snapshot).toMatchObject({ games: [{ a: 21, b: 19 }], gamesA: 1, gameNumber: 2, pointsA: 0, pointsB: 0, server: 'A' });
  });

  it('a won match: 21-19, 21-0; then a rally is refused and the bad tap is named', () => {
    reset();
    const won = rallies('AB'.repeat(19) + 'AA' + 'A'.repeat(21));
    const r = replayScoreEvents(won, DEFAULT_RULESET);
    expect(r.ok && r.snapshot).toMatchObject({ matchOver: true, winnerSide: 'A', gamesA: 2, gameNumber: 2, server: null, pointsA: 0, games: [{ a: 21, b: 19 }, { a: 21, b: 0 }] });
    const bad = replayScoreEvents([...won, ev('rally', 'B')], DEFAULT_RULESET);
    expect(bad).toEqual({ ok: false, seq: won.length + 1, reasons: ['The match is over; no more points can be recorded.'] });
  });

  it('refuses an undo with nothing to undo, and a first server after a rally', () => {
    reset();
    expect(replayScoreEvents([ev('undo')], DEFAULT_RULESET).ok).toBe(false);
    reset();
    expect(replayScoreEvents([ev('rally', 'A'), ev('first_server', 'A')], DEFAULT_RULESET).ok).toBe(false);
  });

  it('sorts by seq and takes the last point time from rallies and undos only', () => {
    reset();
    const a = ev('rally', 'A', '2026-11-07T04:30:00.000Z');
    const b = ev('undo', null, '2026-11-07T04:31:00.000Z');
    const c = ev('first_server', 'A', '2026-11-07T04:32:00.000Z');
    const r = replayScoreEvents([c, b, a], DEFAULT_RULESET);
    expect(r.ok && r.snapshot.lastPointAt).toBe('2026-11-07T04:31:00.000Z');
    expect(r.ok && r.snapshot.lastSeq).toBe(3);
  });

  it('follows the event ruleset (a 15-point, one-game local event)', () => {
    reset();
    const short: Ruleset = { gamesToWin: 1, pointsToWin: 15, winBy: 2, pointCap: 20, intervalAt: 8, changeEndsInDecidingGameAt: 8 };
    const r = replayScoreEvents(rallies('A'.repeat(15)), short);
    expect(r.ok && r.snapshot).toMatchObject({ matchOver: true, winnerSide: 'A', games: [{ a: 15, b: 0 }] });
  });

  it('a 30-29 game at the cap', () => {
    reset();
    const r = replayScoreEvents(rallies('AB'.repeat(29) + 'A'), DEFAULT_RULESET);
    expect(r.ok && r.snapshot.games).toEqual([{ a: 30, b: 29 }]);
  });
});

describe('stateFromSnapshot and applyTap', () => {
  it('rebuilds the engine state from the first server and the rally sides', () => {
    reset();
    const r = replayScoreEvents([ev('first_server', 'B'), ...rallies('ABBA')], DEFAULT_RULESET);
    if (!r.ok) throw new Error('replay');
    const s = stateFromSnapshot(r.snapshot, DEFAULT_RULESET);
    expect(s && snapshotOf(s, r.snapshot.lastSeq, r.snapshot.lastPointAt)).toEqual(r.snapshot);
    expect(stateFromSnapshot({ firstServer: null, rallySides: 'AXB' }, DEFAULT_RULESET)).toBeNull();
  });

  it('applyTap refuses a side-less rally, an undo with a side and a first server after play', () => {
    const s = startMatch(DEFAULT_RULESET);
    if (!s.ok) throw new Error('start');
    expect(applyTap(s.state, 'rally', null).ok).toBe(false);
    expect(applyTap(s.state, 'undo', 'A').ok).toBe(false);
    const one = applyTap(s.state, 'rally', 'A');
    expect(one.ok && applyTap(one.state, 'first_server', 'B').ok).toBe(false);
  });
});

describe('cuesOf (plain English for the scorer)', () => {
  const names = { A: 'Demo Arun', B: 'Demo Bala' };
  const after = (sides: string, first?: 'A' | 'B') => {
    reset();
    const r = replayScoreEvents([...(first ? [ev('first_server', first)] : []), ...rallies(sides)], DEFAULT_RULESET);
    if (!r.ok) throw new Error('replay');
    return cuesOf(r.state, names);
  };
  it('before play: choose the first server', () => {
    expect(after('')).toEqual(['Choose who serves first, or tap the first point.']);
    expect(after('', 'B')).toEqual(['Demo Bala to serve, from the right service court.']);
  });
  it('the interval when the leader reaches 11', () => {
    expect(after('A'.repeat(11))).toEqual(['Interval: Demo Arun reached 11.', 'Demo Arun to serve, from the left service court.']);
  });
  it('the end of a game: interval and change of ends', () => {
    expect(after('A'.repeat(21))[0]).toBe('Game 1 to Demo Arun, 21-0. Interval between games: change ends.');
  });
  it('the change of ends at 11 in the deciding game', () => {
    const cues = after('A'.repeat(21) + 'B'.repeat(21) + 'B'.repeat(11));
    expect(cues).toContain('Change ends now (deciding game).');
  });
  it('the end of the match', () => {
    expect(after('A'.repeat(42))).toEqual(['Match over: Demo Arun wins 2-0 in games. End the match to record the result.']);
  });
});
