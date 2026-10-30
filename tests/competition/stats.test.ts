// Statistics and local ranking calculators (src/lib/competition/stats). Fictional players only.
import { describe, expect, it } from 'vitest';
import {
  DEFAULT_POINTS_TABLE,
  RANKING_DISCLAIMER,
  RANKING_FORMULA_DESCRIPTION,
  describeRankingFormula,
  diffSnapshots,
  disciplineOf,
  gameWinner,
  hasFullScores,
  headToHead,
  localRanking,
  partnerHistory,
  playerStats,
  type PointsTable,
  type RankingResult,
  type StatsMatch,
} from '../../src/lib/competition/stats';
import type { Category, GameScore, MatchResult, RoundCode, Side } from '../../src/lib/competition/types';

let n = 0;
function match(
  sideA: string[],
  sideB: string[],
  result: Partial<MatchResult> | null,
  extra: { category?: Category; round?: RoundCode; date?: string; id?: string; order?: number } = {},
): StatsMatch {
  n += 1;
  const category = extra.category ?? (sideA.length === 1 ? 'MS' : 'MD');
  const m: StatsMatch = {
    id: extra.id ?? `m${n}`,
    date: extra.date ?? '2026-05-01',
    category,
    round: extra.round ?? 'R16',
    sideA,
    sideB,
    result: result === null ? null : { status: 'completed', winner: 'A', games: [], confirmed: true, ...result },
  };
  if (extra.order !== undefined) m.order = extra.order;
  return m;
}
const g = (a: number, b: number): GameScore => ({ a, b });
const win = (winner: Side, games: GameScore[]): Partial<MatchResult> => ({ status: 'completed', winner, games });

describe('gameWinner and hasFullScores (BWF Laws of Badminton, Law 7 default)', () => {
  it('accepts legal finished games and refuses unfinished or impossible ones', () => {
    for (const [a, b] of [[21, 0], [21, 19], [22, 20], [29, 27], [30, 28], [30, 29], [19, 21]] as const) expect(gameWinner(g(a, b))).not.toBeNull();
    for (const [a, b] of [[21, 20], [23, 20], [30, 27], [31, 29], [20, 18], [21, 21], [-1, 21], [21.5, 3]] as const) expect(gameWinner(g(a, b))).toBeNull();
    expect(gameWinner(g(19, 21))).toBe('B');
  });
  it('honours configurable rules (15 points, no cap)', () => {
    const rules = { gamesToWin: 2, pointsToWin: 15, winBy: 2, pointCap: null };
    expect(gameWinner(g(15, 10), rules)).toBe('A');
    expect(gameWinner(g(35, 33), rules)).toBe('A');
    expect(gameWinner(g(21, 10), rules)).toBeNull();
  });
  it('requires the winner to reach gamesToWin in the last game and no extra games', () => {
    expect(hasFullScores([g(21, 10), g(21, 12)], 'A')).toBe(true);
    expect(hasFullScores([g(21, 10), g(10, 21), g(21, 18)], 'A')).toBe(true);
    expect(hasFullScores([g(21, 10), g(21, 12)], 'B')).toBe(false);
    expect(hasFullScores([g(21, 10)], 'A')).toBe(false);
    expect(hasFullScores([g(21, 10), g(21, 12), g(21, 5)], 'A')).toBe(false);
    expect(hasFullScores([], 'A')).toBe(false);
  });
});

describe('disciplineOf', () => {
  it('maps categories', () => {
    expect(disciplineOf('MS')).toBe('singles');
    expect(disciplineOf('GS')).toBe('singles');
    expect(disciplineOf('WD')).toBe('doubles');
    expect(disciplineOf('BD')).toBe('doubles');
    expect(disciplineOf('XD')).toBe('mixed');
  });
});

describe('playerStats', () => {
  const matches: StatsMatch[] = [
    match(['p1'], ['p2'], win('A', [g(21, 10), g(21, 15)]), { date: '2026-01-10', round: 'QF' }),
    match(['p1'], ['p3'], win('B', [g(21, 19), g(18, 21), g(15, 21)]), { date: '2026-01-11', round: 'SF' }),
    match(['p1'], ['p4'], { status: 'walkover', winner: 'A', games: [] }, { date: '2026-02-01', round: 'SF' }),
    match(['p1'], ['p5'], win('A', [g(21, 5), g(21, 6)]), { date: '2026-02-02', round: 'F' }),
    match(['p1'], ['p6'], { status: 'retired', winner: 'A', games: [g(21, 10), g(5, 3)] }, { date: '2026-03-01', round: 'R16' }),
    match(['p1'], ['p7'], win('A', []), { date: '2026-03-02', round: 'QF' }), // no scores
    match(['p1', 'p8'], ['p2', 'p3'], win('A', [g(21, 17), g(21, 17)]), { date: '2026-04-01', round: 'F', category: 'MD' }),
    match(['p1', 'w1'], ['p9', 'w2'], win('B', [g(10, 21), g(11, 21)]), { date: '2026-04-02', round: 'QF', category: 'XD' }),
    // excluded
    match(['p1'], ['p2'], null, { date: '2026-05-01' }),
    match(['p1'], ['p2'], { status: 'abandoned', winner: null, games: [] }),
    match(['p1'], ['p2'], { ...win('A', [g(21, 1), g(21, 1)]), confirmed: false }),
    match(['p1'], ['p2', 'p3'], win('A', [g(21, 1), g(21, 1)])), // MS with a pair
    match(['p1'], ['p2'], win('A', [g(21, 1), g(21, 1)]), { date: '2026-13-01' }),
    match(['p1'], ['p2'], { status: 'completed', winner: null, games: [] }),
    match(['p2'], ['p3'], win('A', [g(21, 1), g(21, 1)])), // not involving p1
  ];

  it('counts played, won, lost and win % from completed and retired only', () => {
    const s = playerStats(matches, 'p1');
    expect(s.overall.played).toBe(7);
    expect(s.overall.won).toBe(5);
    expect(s.overall.lost).toBe(2);
    expect(s.overall.winPercent).toBe(71.4);
    expect(s.overall.walkovers).toEqual({ won: 1, lost: 0 });
    expect(s.overall.retirements).toEqual({ won: 1, lost: 0 });
  });

  it('counts games and points only from completed matches with full scores', () => {
    const s = playerStats(matches, 'p1');
    expect(s.overall.matchesWithFullScores).toBe(5);
    expect(s.overall.matchesWithoutFullScores).toBe(1);
    expect(s.overall.games).toEqual({ won: 7, lost: 4 });
    expect(s.overall.points).toEqual({ won: 21 + 21 + 21 + 18 + 15 + 21 + 21 + 21 + 21 + 10 + 11, lost: 10 + 15 + 19 + 21 + 21 + 5 + 6 + 17 + 17 + 21 + 21 });
  });

  it('counts titles, finals and semifinals (walkovers count as reaching the round)', () => {
    const s = playerStats(matches, 'p1');
    expect(s.overall.titles).toBe(2);
    expect(s.overall.finals).toBe(2);
    expect(s.overall.semifinals).toBe(2);
  });

  it('splits by discipline and credits both doubles partners', () => {
    const s = playerStats(matches, 'p1');
    expect(s.byDiscipline.singles.played).toBe(5);
    expect(s.byDiscipline.doubles.played).toBe(1);
    expect(s.byDiscipline.doubles.titles).toBe(1);
    expect(s.byDiscipline.mixed.lost).toBe(1);
    const partner = playerStats(matches, 'p8');
    expect(partner.overall.won).toBe(1);
    expect(partner.overall.titles).toBe(1);
    expect(partner.byDiscipline.singles.played).toBe(0);
    expect(partner.byDiscipline.singles.winPercent).toBeNull();
  });

  it('gives recent form, most recent first, without walkovers', () => {
    expect(playerStats(matches, 'p1').overall.form).toEqual(['L', 'W', 'W', 'W', 'W']);
    expect(playerStats(matches, 'p1', { formLength: 2 }).overall.form).toEqual(['L', 'W']);
    expect(playerStats(matches, 'p1').byDiscipline.singles.form).toEqual(['W', 'W', 'W', 'L', 'W']);
  });

  it('orders same-day matches by order, then id', () => {
    const ms = [
      match(['x'], ['y'], win('B', [g(1, 21), g(1, 21)]), { id: 'b', date: '2026-01-01', order: 2 }),
      match(['x'], ['y'], win('A', [g(21, 1), g(21, 1)]), { id: 'a', date: '2026-01-01', order: 1 }),
    ];
    expect(playerStats(ms, 'x').overall.form).toEqual(['L', 'W']);
  });

  it('reports data limitations explicitly', () => {
    const l = playerStats(matches, 'p1').limitations;
    expect(l.considered).toBe(14);
    expect(l.counted).toBe(8);
    expect(l.excluded).toEqual({ no_result: 1, not_decided: 1, unconfirmed: 1, invalid_match: 3, duplicate_id: 0 });
    expect(l.walkoversNotCountedAsPlayed).toBe(1);
    expect(l.completedWithoutFullScores).toBe(1);
    expect(l.retiredWithoutPoints).toBe(1);
    expect(l.notes.length).toBe(7);
  });

  it('excludes a repeated match id (the first one wins)', () => {
    const ms = [match(['x'], ['y'], win('A', [g(21, 1), g(21, 1)]), { id: 'same' }), match(['x'], ['y'], win('B', [g(1, 21), g(1, 21)]), { id: 'same' })];
    const s = playerStats(ms, 'x');
    expect(s.overall.won).toBe(1);
    expect(s.overall.lost).toBe(0);
    expect(s.limitations.excluded.duplicate_id).toBe(1);
  });

  it('returns empty statistics for an unknown player and does not change the input', () => {
    const copy = JSON.parse(JSON.stringify(matches)) as unknown;
    const s = playerStats(matches, 'nobody');
    expect(s.overall.played).toBe(0);
    expect(s.overall.winPercent).toBeNull();
    expect(s.limitations.considered).toBe(0);
    expect(s.limitations.notes).toEqual([]);
    expect(JSON.parse(JSON.stringify(matches))).toEqual(copy);
  });

  it('refuses bad input', () => {
    expect(() => playerStats(matches, '')).toThrow(RangeError);
    expect(() => playerStats(matches, 'p1', { formLength: 0 })).toThrow(RangeError);
    expect(() => playerStats(matches, 'p1', { gameRules: { gamesToWin: 0, pointsToWin: 21, winBy: 2, pointCap: 30 } })).toThrow(RangeError);
    expect(() => playerStats(matches, 'p1', { gameRules: { gamesToWin: 2, pointsToWin: 21, winBy: 2, pointCap: 15 } })).toThrow(RangeError);
  });
});

describe('headToHead', () => {
  const ms: StatsMatch[] = [
    match(['Demo Player A'], ['Demo Player B'], win('A', [g(21, 10), g(21, 15)]), { date: '2026-01-01' }),
    match(['Demo Player B'], ['Demo Player A'], win('A', [g(21, 19), g(22, 20)]), { date: '2026-02-01' }),
    match(['Demo Player A'], ['Demo Player B'], { status: 'walkover', winner: 'B', games: [] }, { date: '2026-03-01' }),
    match(['Demo Player A', 'p3'], ['Demo Player B', 'p4'], { status: 'retired', winner: 'A', games: [g(21, 3)] }, { date: '2026-04-01', category: 'MD' }),
    match(['Demo Player A', 'Demo Player B'], ['p3', 'p4'], win('A', [g(21, 3), g(21, 3)]), { category: 'MD' }), // partners: not a meeting
    match(['Demo Player A'], ['Demo Player B'], { ...win('A', []), confirmed: false }),
  ];
  it('counts meetings on opposite sides only, from a point of view', () => {
    const h = headToHead(ms, 'Demo Player A', 'Demo Player B');
    expect(h.aWins).toBe(2);
    expect(h.bWins).toBe(1);
    expect(h.walkovers).toEqual({ a: 0, b: 1 });
    expect(h.meetings.map((m) => m.winner)).toEqual(['a', 'b', 'b', 'a']);
    expect(h.meetings[1]?.games).toEqual([g(19, 21), g(20, 22)]);
    expect(h.meetings[3]?.games).toBeNull();
    expect(h.limitations.excluded.unconfirmed).toBe(1);
    expect(h.limitations.considered).toBe(5);
  });
  it('refuses the same or empty ids', () => {
    expect(() => headToHead(ms, 'p1', 'p1')).toThrow(RangeError);
    expect(() => headToHead(ms, '', 'p1')).toThrow(RangeError);
  });
});

describe('partnerHistory', () => {
  it('groups doubles and mixed matches by partner', () => {
    const ms: StatsMatch[] = [
      match(['p1', 'p2'], ['p3', 'p4'], win('A', [g(21, 1), g(21, 1)]), { date: '2026-01-01', category: 'MD' }),
      match(['p3', 'p4'], ['p1', 'p2'], win('A', [g(21, 1), g(21, 1)]), { date: '2026-02-01', category: 'MD' }),
      match(['p1', 'p2'], ['p5', 'p6'], { status: 'walkover', winner: 'A', games: [] }, { date: '2026-03-01', category: 'MD' }),
      match(['p1', 'w1'], ['p5', 'w2'], win('A', [g(21, 1), g(21, 1)]), { date: '2026-01-15', category: 'XD' }),
      match(['p1'], ['p2'], win('A', [g(21, 1), g(21, 1)])), // singles: ignored
    ];
    const h = partnerHistory(ms, 'p1');
    expect(h.partners.map((p) => p.partnerId)).toEqual(['p2', 'w1']);
    expect(h.partners[0]).toMatchObject({ played: 2, won: 1, lost: 1, winPercent: 50, walkovers: { won: 1, lost: 0 }, disciplines: ['doubles'], firstDate: '2026-01-01', lastDate: '2026-03-01' });
    expect(h.partners[1]).toMatchObject({ played: 1, disciplines: ['mixed'] });
    expect(h.limitations.considered).toBe(4);
    expect(h.limitations.walkoversNotCountedAsPlayed).toBe(1);
    expect(() => partnerHistory(ms, ' ')).toThrow(RangeError);
  });
});

describe('localRanking', () => {
  const r = (entryId: string, tournamentId: string, level: string, finish: RankingResult['finish'], date: string): RankingResult => ({ entryId, tournamentId, level, finish, date });
  const asOf = '2026-10-30';

  it('uses the example table, labelled as needing approval, with the disclaimer', () => {
    const s = localRanking([r('p1', 't1', 'district', 'W', '2026-10-01')], undefined, { asOf });
    expect(s.tableApproved).toBe(false);
    expect(s.tableLabel).toContain("needs the owner's approval");
    expect(s.disclaimer).toBe(RANKING_DISCLAIMER);
    expect(s.disclaimer).toContain('not an official BWF');
    expect(s.rows[0]).toMatchObject({ position: 1, entryId: 'p1', points: 200 });
    expect(DEFAULT_POINTS_TABLE.approved).toBe(false);
  });

  it('counts only the best N results inside the rolling window', () => {
    const results = [
      r('p1', 't1', 'club', 'W', '2026-09-01'),
      r('p1', 't2', 'club', 'F', '2026-08-01'),
      r('p1', 't3', 'club', 'SF', '2026-07-01'),
      r('p1', 't4', 'state', 'QF', '2025-10-31'), // first day of a 365-day window
      r('p1', 't5', 'state', 'W', '2025-10-30'), // one day too old
      r('p1', 't6', 'state', 'W', '2026-10-31'), // after asOf
    ];
    const s = localRanking(results, DEFAULT_POINTS_TABLE, { asOf, windowDays: 365, bestN: 2 });
    expect(s.windowStart).toBe('2025-10-31');
    expect(s.rows[0]?.points).toBe(120 + 100);
    expect(s.rows[0]?.counted.map((c) => c.tournamentId)).toEqual(['t4', 't1']);
    expect(s.rows[0]?.notCounted.map((c) => c.tournamentId)).toEqual(['t2', 't3']);
    expect(s.excluded.map((e) => [e.result.tournamentId, e.reason])).toEqual([
      ['t5', 'outside_window'],
      ['t6', 'outside_window'],
    ]);
  });

  it('defaults to a 364-day window and best 4', () => {
    const s = localRanking([], DEFAULT_POINTS_TABLE, { asOf });
    expect(s.windowDays).toBe(364);
    expect(s.bestN).toBe(4);
    expect(s.windowStart).toBe('2025-11-01');
    expect(s.rows).toEqual([]);
  });

  it('breaks ties by best results, then recency, then shares the position', () => {
    const table: PointsTable = { label: 'Test table', approved: true, levels: { x: { W: 100, F: 60, SF: 40, QF: 20 } } };
    const results = [
      // a: 100 + 20 = 120; b: 60 + 60 = 120 -> a ahead (better best result)
      r('a', 't1', 'x', 'W', '2026-01-01'),
      r('a', 't2', 'x', 'QF', '2026-01-02'),
      r('b', 't1', 'x', 'F', '2026-01-01'),
      r('b', 't3', 'x', 'F', '2026-01-03'),
      // c and d: 40 each; d more recent -> d ahead
      r('c', 't1', 'x', 'SF', '2026-01-01'),
      r('d', 't3', 'x', 'SF', '2026-01-03'),
      // e and f: identical -> shared position
      r('f', 't4', 'x', 'QF', '2026-02-01'),
      r('e', 't4', 'x', 'QF', '2026-02-01'),
      // g: level row lacks this finish -> 0 points, still listed
      r('g', 't4', 'x', 'R16', '2026-02-01'),
    ];
    const s = localRanking(results, table, { asOf });
    expect(s.rows.map((x) => [x.position, x.entryId, x.points, x.tied])).toEqual([
      [1, 'a', 120, false],
      [2, 'b', 120, false],
      [3, 'd', 40, false],
      [4, 'c', 40, false],
      [5, 'e', 20, true],
      [5, 'f', 20, true],
      [7, 'g', 0, false],
    ]);
    expect(s.tableApproved).toBe(true);
  });

  it('reports invalid results, unknown levels and duplicate tournaments (keeping the best)', () => {
    const results = [
      r('p1', 't1', 'nowhere', 'W', '2026-10-01'),
      r('p1', 't1', 'club', 'QF', '2026-10-01'),
      r('p1', 't1', 'club', 'W', '2026-10-01'),
      r('', 't2', 'club', 'W', '2026-10-01'),
      r('p2', 't2', 'club', 'W', '2026-02-30'),
      { ...r('p2', 't2', 'club', 'W', '2026-10-01'), finish: '3P' as unknown as RankingResult['finish'] },
      r('p3', 't2', 'toString', 'W', '2026-10-01'),
    ];
    const s = localRanking(results, DEFAULT_POINTS_TABLE, { asOf });
    expect(s.rows.map((x) => [x.entryId, x.points])).toEqual([['p1', 100]]);
    expect(s.excluded.map((e) => e.reason)).toEqual(['unknown_level', 'duplicate_tournament', 'invalid_result', 'invalid_result', 'invalid_result', 'unknown_level']);
  });

  it('refuses bad options and malformed tables', () => {
    expect(() => localRanking([], DEFAULT_POINTS_TABLE, { asOf: '30-10-2026' })).toThrow(RangeError);
    expect(() => localRanking([], DEFAULT_POINTS_TABLE, { asOf, windowDays: 0 })).toThrow(RangeError);
    expect(() => localRanking([], DEFAULT_POINTS_TABLE, { asOf, bestN: 1.5 })).toThrow(RangeError);
    expect(() => localRanking([], { label: 'x', approved: false, levels: {} }, { asOf })).toThrow(RangeError);
    expect(() => localRanking([], { label: 'x', approved: false, levels: { a: { W: -1 } } }, { asOf })).toThrow(RangeError);
    expect(() => localRanking([], { label: '', approved: false, levels: { a: { W: 1 } } }, { asOf })).toThrow(RangeError);
  });

  it('is deterministic regardless of input order', () => {
    const results = [r('p1', 't1', 'club', 'W', '2026-10-01'), r('p2', 't1', 'club', 'F', '2026-10-01'), r('p3', 't2', 'club', 'F', '2026-10-01')];
    const a = localRanking(results, DEFAULT_POINTS_TABLE, { asOf });
    const b = localRanking([...results].reverse(), DEFAULT_POINTS_TABLE, { asOf });
    expect(a.rows).toEqual(b.rows);
  });
});

describe('diffSnapshots', () => {
  it('reports new, dropped, up, down and same entries', () => {
    const t = DEFAULT_POINTS_TABLE;
    const prev = localRanking(
      [
        { entryId: 'p1', tournamentId: 't1', level: 'club', finish: 'W', date: '2026-01-01' },
        { entryId: 'p2', tournamentId: 't1', level: 'club', finish: 'F', date: '2026-01-01' },
        { entryId: 'p3', tournamentId: 't1', level: 'club', finish: 'SF', date: '2026-01-01' },
        { entryId: 'p4', tournamentId: 't1', level: 'club', finish: 'QF', date: '2025-06-01' },
      ],
      t,
      { asOf: '2026-01-10' },
    );
    const next = localRanking(
      [
        { entryId: 'p1', tournamentId: 't1', level: 'club', finish: 'W', date: '2026-01-01' },
        { entryId: 'p2', tournamentId: 't1', level: 'club', finish: 'F', date: '2026-01-01' },
        { entryId: 'p3', tournamentId: 't1', level: 'club', finish: 'SF', date: '2026-01-01' },
        { entryId: 'p2', tournamentId: 't2', level: 'district', finish: 'W', date: '2026-02-01' },
        { entryId: 'p5', tournamentId: 't2', level: 'district', finish: 'F', date: '2026-02-01' },
      ],
      t,
      { asOf: '2026-02-10' },
    );
    expect(prev.rows.map((r) => r.entryId)).toEqual(['p1', 'p2', 'p3', 'p4']);
    const d = diffSnapshots(prev, next);
    expect(d.map((c) => [c.entryId, c.movement, c.positionChange, c.pointsChange])).toEqual([
      ['p2', 'up', 1, 200],
      ['p5', 'new', null, 140],
      ['p1', 'down', -2, 0],
      ['p3', 'down', -1, 0],
      ['p4', 'dropped', null, -30],
    ]);
    expect(diffSnapshots(next, next).every((c) => c.movement === 'same')).toBe(true);
  });
});

describe('formula description', () => {
  it('is plain English and says the table status and the disclaimer', () => {
    expect(RANKING_FORMULA_DESCRIPTION).toContain('NOT yet approved');
    expect(RANKING_FORMULA_DESCRIPTION).toContain('last 364 days');
    expect(RANKING_FORMULA_DESCRIPTION).toContain('best 4 results');
    expect(describeRankingFormula({ label: 'T', approved: true, levels: { a: { W: 1 } } }, { windowDays: 30, bestN: 1 })).toContain('best 1 result.');
  });
});
