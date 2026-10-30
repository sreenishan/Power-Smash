// Bracket progression and results (src/lib/competition/brackets). Fictional entries only.
import { describe, expect, it } from 'vitest';
import {
  BYE,
  NOT_DECIDED,
  applyResult,
  correctResult,
  createBracket,
  getMatch,
  playableMatches,
  previewCorrection,
  roundCodeFor,
  standings,
  type Bracket,
  type BracketOptions,
  type BracketUpdate,
} from '../../src/lib/competition/brackets';
import type { MatchResult, Side } from '../../src/lib/competition/types';

const win = (winner: Side, status: MatchResult['status'] = 'completed'): MatchResult => ({
  status,
  winner,
  games: status === 'completed' ? [{ a: 21, b: 15 }, { a: 21, b: 18 }] : [],
  confirmed: true,
});
const abandoned: MatchResult = { status: 'abandoned', winner: null, games: [], confirmed: true };

function make(lines: readonly string[], options: BracketOptions = {}): Bracket {
  const out = createBracket(lines, options);
  if (!out.ok) throw new Error(out.message);
  return out.bracket;
}

function ok(u: BracketUpdate): Bracket {
  if (!u.ok) throw new Error(`${u.error}: ${u.message}`);
  return u.bracket;
}

function play(b: Bracket, ...steps: [string, Side][]): Bracket {
  return steps.reduce((acc, [id, side]) => ok(applyResult(acc, id, win(side))), b);
}

const EIGHT = ['p1', 'p2', 'p3', 'p4', 'p5', 'p6', 'p7', 'p8'];

describe('createBracket', () => {
  it('builds rounds and match ids for 8 lines', () => {
    const b = make(EIGHT);
    expect(b.rounds).toEqual(['QF', 'SF', 'F']);
    expect(b.matches.map((m) => m.id)).toEqual(['QF-1', 'QF-2', 'QF-3', 'QF-4', 'SF-1', 'SF-2', 'F-1']);
    expect(getMatch(b, 'QF-2')?.a).toEqual({ kind: 'entry', entryId: 'p3' });
    expect(getMatch(b, 'QF-2')?.next).toEqual({ matchId: 'SF-1', side: 'B' });
    expect(getMatch(b, 'QF-3')?.next).toEqual({ matchId: 'SF-2', side: 'A' });
    expect(getMatch(b, 'F-1')?.next).toBeNull();
    expect(playableMatches(b).map((m) => m.id)).toEqual(['QF-1', 'QF-2', 'QF-3', 'QF-4']);
  });

  it('maps line counts to round codes up to R128', () => {
    expect([2, 4, 8, 16, 32, 64, 128].map(roundCodeFor)).toEqual(['F', 'SF', 'QF', 'R16', 'R32', 'R64', 'R128']);
    const big = make(Array.from({ length: 128 }, (_, i) => `p${i + 1}`));
    expect(big.rounds[0]).toBe('R128');
    expect(big.matches).toHaveLength(127);
  });

  it('handles a two-line bracket (final only)', () => {
    const b = play(make(['Demo Player A', 'Demo Player B']), ['F-1', 'B']);
    const s = standings(b);
    expect(s.champion).toBe('Demo Player B');
    expect(s.runnerUp).toBe('Demo Player A');
    expect(s.semifinalists).toEqual([]);
    expect(s.complete).toBe(true);
  });

  it('refuses bad sizes, ids, duplicates and fields with fewer than two entries', () => {
    expect(createBracket(['p1', 'p2', 'p3'])).toMatchObject({ ok: false, error: 'invalid_size' });
    expect(createBracket(['p1'])).toMatchObject({ ok: false, error: 'invalid_size' });
    expect(createBracket([])).toMatchObject({ ok: false, error: 'invalid_size' });
    expect(createBracket(Array.from({ length: 256 }, (_, i) => `p${i}`))).toMatchObject({ ok: false, error: 'invalid_size' });
    expect(createBracket(['p1', 'p1'])).toMatchObject({ ok: false, error: 'duplicate_entry' });
    expect(createBracket(['p1', ' '])).toMatchObject({ ok: false, error: 'invalid_entry_id' });
    expect(createBracket(['p1', NOT_DECIDED])).toMatchObject({ ok: false, error: 'invalid_entry_id' });
    expect(createBracket(['p1', BYE, BYE, BYE])).toMatchObject({ ok: false, error: 'too_few_entries' });
  });

  it('does not keep a reference to the caller array', () => {
    const lines = [...EIGHT];
    const b = make(lines);
    lines[0] = 'changed';
    expect(b.lines[0]).toBe('p1');
    expect(Object.isFrozen(b)).toBe(true);
  });
});

describe('byes', () => {
  it('advances an entry facing a BYE without a match', () => {
    const b = make(['p1', BYE, 'p2', 'p3', 'p4', BYE, BYE, 'p5']);
    expect(getMatch(b, 'QF-1')).toMatchObject({ state: 'bye', winner: 'p1', loser: null });
    expect(getMatch(b, 'QF-4')).toMatchObject({ state: 'bye', winner: 'p5' });
    expect(getMatch(b, 'SF-1')).toMatchObject({ state: 'waiting', a: { kind: 'entry', entryId: 'p1' }, b: { kind: 'tbd' } });
    expect(getMatch(b, 'SF-2')).toMatchObject({ state: 'ready' });
    expect(applyResult(b, 'QF-1', win('A'))).toMatchObject({ ok: false, error: 'no_match_needed' });
  });

  it('turns BYE against BYE into a void match and carries the bye on', () => {
    const b = make(['p1', 'p2', BYE, BYE, 'p3', BYE, 'p4', 'p5']);
    expect(getMatch(b, 'QF-2')).toMatchObject({ state: 'void', winner: null });
    expect(getMatch(b, 'SF-1')?.state).toBe('waiting');
    const after = play(b, ['QF-1', 'B']);
    expect(getMatch(after, 'SF-1')).toMatchObject({ state: 'bye', winner: 'p2' });
    expect(getMatch(after, 'F-1')?.a).toEqual({ kind: 'entry', entryId: 'p2' });
  });

  it('refuses a layout with an empty half (the final would be a bye and the places would be wrong)', () => {
    expect(createBracket(['p1', 'p2', 'p3', BYE, BYE, BYE, BYE, BYE])).toMatchObject({ ok: false, error: 'empty_half' });
    expect(createBracket(['p1', 'p2', BYE, BYE], { thirdPlace: true })).toMatchObject({ ok: false, error: 'empty_half' });
    expect(createBracket([BYE, BYE, BYE, BYE, 'p1', BYE, 'p2', BYE])).toMatchObject({ ok: false, error: 'empty_half' });
  });

  it('places the field correctly when byes are spread over both halves', () => {
    let b = make(['p1', 'p2', BYE, BYE, 'p3', BYE, BYE, BYE], { thirdPlace: true });
    expect(getMatch(b, 'SF-2')).toMatchObject({ state: 'bye', winner: 'p3' });
    b = play(b, ['QF-1', 'A'], ['F-1', 'B']);
    const s = standings(b);
    expect(s).toMatchObject({ complete: true, champion: 'p3', runnerUp: 'p1', semifinalists: [] });
    expect(getMatch(b, '3P-1')?.state).toBe('void');
    expect(s.thirdPlace).toBeNull();
    expect(s.entries.map((e) => [e.entryId, e.finish])).toEqual([
      ['p1', 'runner-up'],
      ['p2', 'eliminated'],
      ['p3', 'champion'],
    ]);
  });
});

describe('applyResult', () => {
  it('advances the winner to the correct slot of the next round', () => {
    let b = make(EIGHT);
    b = play(b, ['QF-1', 'B'], ['QF-2', 'A']);
    expect(getMatch(b, 'SF-1')).toMatchObject({ state: 'ready', a: { kind: 'entry', entryId: 'p2' }, b: { kind: 'entry', entryId: 'p3' } });
    b = play(b, ['QF-4', 'A']);
    expect(getMatch(b, 'SF-2')).toMatchObject({ state: 'waiting', b: { kind: 'entry', entryId: 'p7' } });
  });

  it('advances the winner of a walkover and of a retirement', () => {
    let b = make(['p1', 'p2', 'p3', 'p4']);
    b = ok(applyResult(b, 'SF-1', win('B', 'walkover')));
    b = ok(applyResult(b, 'SF-2', win('A', 'retired')));
    expect(getMatch(b, 'F-1')).toMatchObject({ a: { kind: 'entry', entryId: 'p2' }, b: { kind: 'entry', entryId: 'p3' } });
  });

  it('records an abandoned match without advancing anyone, and accepts a replay result later', () => {
    let b = ok(applyResult(make(['p1', 'p2', 'p3', 'p4']), 'SF-1', abandoned));
    expect(getMatch(b, 'SF-1')).toMatchObject({ state: 'abandoned', winner: null });
    expect(getMatch(b, 'F-1')?.a).toEqual({ kind: 'tbd' });
    expect(playableMatches(b).map((m) => m.id)).toContain('SF-1');
    b = ok(applyResult(b, 'SF-1', win('A')));
    expect(getMatch(b, 'F-1')?.a).toEqual({ kind: 'entry', entryId: 'p1' });
  });

  it('refuses an unconfirmed result', () => {
    const r = applyResult(make(EIGHT), 'QF-1', { ...win('A'), confirmed: false });
    expect(r).toMatchObject({ ok: false, error: 'not_confirmed' });
  });

  it('refuses malformed results', () => {
    const b = make(EIGHT);
    expect(applyResult(b, 'QF-1', { status: 'completed', winner: null, games: [], confirmed: true })).toMatchObject({ ok: false, error: 'invalid_result' });
    expect(applyResult(b, 'QF-1', { status: 'abandoned', winner: 'A', games: [], confirmed: true })).toMatchObject({ ok: false, error: 'invalid_result' });
  });

  it('refuses unknown matches and matches whose sides are not both known', () => {
    const b = make(EIGHT);
    expect(applyResult(b, 'QF-9', win('A'))).toMatchObject({ ok: false, error: 'unknown_match' });
    expect(applyResult(b, '__proto__', win('A'))).toMatchObject({ ok: false, error: 'unknown_match' });
    expect(applyResult(b, 'SF-1', win('A'))).toMatchObject({ ok: false, error: 'sides_not_known' });
    expect(applyResult(play(b, ['QF-1', 'A']), 'SF-1', win('A'))).toMatchObject({ ok: false, error: 'sides_not_known' });
  });

  it('refuses a named winner who is not on the winning side', () => {
    const b = make(EIGHT);
    expect(applyResult(b, 'QF-1', win('A'), { winnerEntryId: 'p5' })).toMatchObject({ ok: false, error: 'winner_not_in_match' });
    expect(applyResult(b, 'QF-1', win('A'), { winnerEntryId: 'p2' })).toMatchObject({ ok: false, error: 'winner_not_in_match' });
    expect(applyResult(b, 'QF-1', win('B'), { winnerEntryId: 'p2' }).ok).toBe(true);
  });

  it('refuses to change a decided match (corrections go through correctResult)', () => {
    const b = play(make(EIGHT), ['QF-1', 'A']);
    expect(applyResult(b, 'QF-1', win('B'))).toMatchObject({ ok: false, error: 'already_decided' });
  });

  it('stores a frozen copy of the result, so changing the caller object later changes nothing', () => {
    const input: MatchResult = { status: 'completed', winner: 'A', games: [{ a: 21, b: 10 }, { a: 21, b: 12 }], confirmed: true };
    const b = ok(applyResult(make(['p1', 'p2', 'p3', 'p4']), 'SF-1', input));
    (input as { winner: Side | null }).winner = 'B';
    (input.games as { a: number; b: number }[])[0] = { a: 0, b: 21 };
    expect(b.results['SF-1']).toMatchObject({ winner: 'A', games: [{ a: 21, b: 10 }, { a: 21, b: 12 }] });
    expect(getMatch(b, 'SF-1')?.winner).toBe('p1');
    expect(Object.isFrozen(b.results['SF-1'])).toBe(true);
    expect(Object.isFrozen(b.results['SF-1']?.games[0])).toBe(true);
    expect(Object.isFrozen(getMatch(b, 'SF-1'))).toBe(true);
    expect(Object.isFrozen(getMatch(b, 'F-1')?.a)).toBe(true);
    expect(Object.isFrozen(getMatch(b, 'SF-1')?.next)).toBe(true);
    const fixed: MatchResult = { ...win('A'), games: [{ a: 21, b: 19 }] };
    const c = ok(correctResult(b, 'SF-1', fixed));
    (fixed.games as { a: number; b: number }[])[0] = { a: 1, b: 1 };
    expect(c.results['SF-1']?.games).toEqual([{ a: 21, b: 19 }]);
  });

  it('never changes its input', () => {
    const b = make(EIGHT);
    const snapshot = JSON.stringify(b);
    play(b, ['QF-1', 'A']);
    expect(JSON.stringify(b)).toBe(snapshot);
    expect(b.results).toEqual({});
  });
});

describe('correctResult', () => {
  const played = (): Bracket => play(make(EIGHT), ['QF-1', 'A'], ['QF-2', 'A'], ['SF-1', 'A'], ['QF-3', 'A'], ['QF-4', 'A']);

  it('allows a score-only correction that keeps the winner, with nothing affected', () => {
    const fixed: MatchResult = { status: 'completed', winner: 'A', games: [{ a: 21, b: 19 }, { a: 22, b: 20 }], confirmed: true };
    const r = correctResult(played(), 'QF-1', fixed);
    expect(r).toMatchObject({ ok: true, affected: [] });
    if (r.ok) expect(getMatch(r.bracket, 'QF-1')?.result).toEqual(fixed);
  });

  it('refuses a winner change whose winner already played the next round, and lists what depends on it', () => {
    const b = played();
    expect(previewCorrection(b, 'QF-1', win('B'))).toEqual(['SF-1']);
    const r = correctResult(b, 'QF-1', win('B'));
    expect(r).toMatchObject({ ok: false, error: 'later_rounds_depend', affected: ['SF-1'] });
  });

  it('clears dependent later results transitively when asked', () => {
    let b = played();
    b = play(b, ['SF-2', 'B'], ['F-1', 'A']);
    expect(previewCorrection(b, 'QF-2', win('B'))).toEqual(['SF-1', 'F-1']);
    const r = correctResult(b, 'QF-2', win('B'), { clearDependents: true });
    expect(r).toMatchObject({ ok: true, affected: ['SF-1', 'F-1'] });
    if (!r.ok) return;
    expect(getMatch(r.bracket, 'SF-1')).toMatchObject({ state: 'ready', b: { kind: 'entry', entryId: 'p4' } });
    expect(getMatch(r.bracket, 'F-1')).toMatchObject({ state: 'waiting', b: { kind: 'entry', entryId: 'p7' } });
    expect(Object.keys(r.bracket.results).sort()).toEqual(['QF-1', 'QF-2', 'QF-3', 'QF-4', 'SF-2']);
  });

  it('allows a winner change when the next match has not been played', () => {
    const b = play(make(EIGHT), ['QF-1', 'A'], ['QF-2', 'A']);
    const r = correctResult(b, 'QF-1', win('B'));
    expect(r.ok).toBe(true);
    if (r.ok) expect(getMatch(r.bracket, 'SF-1')?.a).toEqual({ kind: 'entry', entryId: 'p2' });
  });

  it('clears a result with null, refusing while later results depend on it', () => {
    const b = played();
    expect(correctResult(b, 'QF-3', null)).toMatchObject({ ok: true, affected: [] });
    expect(correctResult(b, 'QF-1', null)).toMatchObject({ ok: false, error: 'later_rounds_depend', affected: ['SF-1'] });
    const cleared = correctResult(b, 'QF-1', null, { clearDependents: true });
    expect(cleared.ok && getMatch(cleared.bracket, 'QF-1')?.state).toBe('ready');
  });

  it('treats a change to abandoned as removing the winner', () => {
    expect(correctResult(played(), 'QF-1', abandoned)).toMatchObject({ ok: false, error: 'later_rounds_depend', affected: ['SF-1'] });
  });

  it('refuses unknown matches, matches without a result and invalid results', () => {
    const b = played();
    expect(correctResult(b, 'X-1', win('A'))).toMatchObject({ ok: false, error: 'unknown_match' });
    expect(correctResult(b, 'SF-2', win('A'))).toMatchObject({ ok: false, error: 'nothing_to_correct' });
    expect(correctResult(b, 'QF-1', { ...win('B'), confirmed: false })).toMatchObject({ ok: false, error: 'not_confirmed' });
    expect(correctResult(b, 'QF-1', win('B'), { winnerEntryId: 'p1' })).toMatchObject({ ok: false, error: 'winner_not_in_match' });
    expect(previewCorrection(b, 'nope', null)).toEqual([]);
  });

  it('previews nothing for a change correctResult would refuse', () => {
    let b = make(['p1', BYE, 'p2', 'p3', 'p4', 'p5', 'p6', 'p7']);
    b = play(b, ['QF-2', 'A'], ['SF-1', 'A'], ['QF-3', 'A']);
    // Sanity: a valid change to QF-2 does clear SF-1.
    expect(previewCorrection(b, 'QF-2', win('B'))).toEqual(['SF-1']);
    expect(previewCorrection(b, 'QF-2', { ...win('B'), confirmed: false })).toEqual([]);
    expect(correctResult(b, 'QF-2', { ...win('B'), confirmed: false })).toMatchObject({ ok: false, error: 'not_confirmed' });
    expect(previewCorrection(b, 'QF-2', { status: 'completed', winner: null, games: [], confirmed: true })).toEqual([]);
    expect(previewCorrection(b, 'QF-2', win('B'), { winnerEntryId: 'p2' })).toEqual([]);
    expect(previewCorrection(b, 'QF-1', null)).toEqual([]);
    expect(correctResult(b, 'QF-1', null)).toMatchObject({ ok: false, error: 'nothing_to_correct' });
    expect(previewCorrection(b, 'QF-4', win('A'))).toEqual([]);
    expect(correctResult(b, 'QF-4', win('A'))).toMatchObject({ ok: false, error: 'nothing_to_correct' });
  });
});

describe('third-place match', () => {
  it('is off by default', () => {
    expect(make(EIGHT).matches.some((m) => m.round === '3P')).toBe(false);
    expect(standings(make(EIGHT)).thirdPlace).toBeNull();
  });

  it('feeds the semi-final losers in and settles third and fourth', () => {
    let b = make(EIGHT, { thirdPlace: true });
    expect(getMatch(b, 'SF-1')?.loserNext).toEqual({ matchId: '3P-1', side: 'A' });
    b = play(b, ['QF-1', 'A'], ['QF-2', 'A'], ['QF-3', 'A'], ['QF-4', 'A'], ['SF-1', 'A'], ['SF-2', 'B']);
    expect(getMatch(b, '3P-1')).toMatchObject({ state: 'ready', a: { kind: 'entry', entryId: 'p3' }, b: { kind: 'entry', entryId: 'p5' } });
    b = play(b, ['F-1', 'A']);
    expect(standings(b).complete).toBe(false);
    expect(standings(b).thirdPlace).toBe(NOT_DECIDED);
    b = play(b, ['3P-1', 'B']);
    const s = standings(b);
    expect(s).toMatchObject({ complete: true, champion: 'p1', runnerUp: 'p7', thirdPlace: 'p5', fourthPlace: 'p3' });
    expect(s.entries.find((e) => e.entryId === 'p5')).toEqual({ entryId: 'p5', roundReached: 'SF', finish: 'third' });
    expect(s.entries.find((e) => e.entryId === 'p3')?.finish).toBe('fourth');
  });

  it('protects a played third-place match from a semi-final correction', () => {
    let b = make(['p1', 'p2', 'p3', 'p4'], { thirdPlace: true });
    b = play(b, ['SF-1', 'A'], ['SF-2', 'A'], ['3P-1', 'A']);
    expect(correctResult(b, 'SF-1', win('B'))).toMatchObject({ ok: false, error: 'later_rounds_depend', affected: ['3P-1'] });
  });

  it('gives third without a match when one semi-final had no loser', () => {
    const b = play(make(['p1', 'p2', 'p3', BYE], { thirdPlace: true }), ['SF-1', 'A']);
    expect(getMatch(b, '3P-1')).toMatchObject({ state: 'bye', winner: 'p2' });
    expect(standings(b).thirdPlace).toBe('p2');
    expect(standings(b).fourthPlace).toBeNull();
  });

  it('is not added to a two-line bracket', () => {
    expect(make(['p1', 'p2'], { thirdPlace: true }).matches.map((m) => m.id)).toEqual(['F-1']);
  });
});

describe('standings', () => {
  it('reports not decided for an incomplete bracket', () => {
    const b = play(make(EIGHT), ['QF-1', 'A'], ['QF-2', 'B']);
    const s = standings(b);
    expect(s).toMatchObject({ complete: false, champion: NOT_DECIDED, runnerUp: NOT_DECIDED, semifinalists: NOT_DECIDED });
    expect(s.entries.find((e) => e.entryId === 'p1')).toEqual({ entryId: 'p1', roundReached: 'SF', finish: 'alive' });
    expect(s.entries.find((e) => e.entryId === 'p2')).toEqual({ entryId: 'p2', roundReached: 'QF', finish: 'eliminated' });
    expect(s.entries.find((e) => e.entryId === 'p5')).toEqual({ entryId: 'p5', roundReached: 'QF', finish: 'alive' });
  });

  it('reports a full result with round reached per entry', () => {
    const b = play(make(EIGHT), ['QF-1', 'A'], ['QF-2', 'A'], ['QF-3', 'A'], ['QF-4', 'B'], ['SF-1', 'B'], ['SF-2', 'A'], ['F-1', 'B']);
    const s = standings(b);
    expect(s).toMatchObject({ complete: true, champion: 'p5', runnerUp: 'p3', semifinalists: ['p1', 'p8'] });
    expect(s.entries.map((e) => [e.entryId, e.roundReached, e.finish])).toEqual([
      ['p1', 'SF', 'semifinalist'],
      ['p2', 'QF', 'eliminated'],
      ['p3', 'F', 'runner-up'],
      ['p4', 'QF', 'eliminated'],
      ['p5', 'F', 'champion'],
      ['p6', 'QF', 'eliminated'],
      ['p7', 'QF', 'eliminated'],
      ['p8', 'SF', 'semifinalist'],
    ]);
  });

  it('counts a bye as reaching the next round and skips BYE lines', () => {
    const b = make(['p1', BYE, 'p2', 'p3']);
    const s = standings(b);
    expect(s.entries.map((e) => e.entryId)).toEqual(['p1', 'p2', 'p3']);
    expect(s.entries[0]).toEqual({ entryId: 'p1', roundReached: 'F', finish: 'alive' });
  });

  it('is deterministic', () => {
    const run = (): string => JSON.stringify(standings(play(make(EIGHT, { thirdPlace: true }), ['QF-1', 'A'], ['QF-2', 'B'])));
    expect(run()).toBe(run());
  });
});
