// Draw generation (src/lib/competition/draws). Fictional entries only ('p1', 'Demo Player A', 'Demo Club X').
import { describe, expect, it } from 'vitest';
import type { Entry } from '../../src/lib/competition/types';
import {
  bracketSizeFor,
  checkSeedingOrder,
  meetingRound,
  groupsThenKnockout,
  knockoutRoundCodes,
  partnerLine,
  roundCodeFor,
  roundRobin,
  seedingOrder,
  singleElimination,
  type DrawOutcome,
} from '../../src/lib/competition/draws';
import { separateFirstRound } from '../../src/lib/competition/draws/separation';
import { minCostAssignment } from '../../src/lib/competition/draws/assignment';

function make(n: number, seeds = 0, club?: (i: number) => string | null): Entry[] {
  return Array.from({ length: n }, (_, k) => {
    const i = k + 1;
    const e: Entry = { id: `e${i}`, players: [`p${i}`] };
    if (i <= seeds) e.seed = i;
    if (club) e.club = club(i);
    return e;
  });
}

function draw<T>(outcome: DrawOutcome<T>): T {
  if (!outcome.ok) throw new Error(outcome.refusals.map((r) => r.message).join('; '));
  return outcome.draw;
}

function codes<T>(outcome: DrawOutcome<T>): string[] {
  return outcome.ok ? [] : outcome.refusals.map((r) => r.code);
}

describe('bracket geometry', () => {
  it('sizes, round codes and perfect seeding order', () => {
    expect([2, 3, 4, 5, 8, 9, 17, 128].map(bracketSizeFor)).toEqual([2, 4, 4, 8, 8, 16, 32, 128]);
    expect(() => bracketSizeFor(129)).toThrow(RangeError);
    expect(() => bracketSizeFor(1)).toThrow(RangeError);
    expect(roundCodeFor(16)).toBe('R16');
    expect(() => roundCodeFor(12)).toThrow(RangeError);
    expect(knockoutRoundCodes(32)).toEqual(['R32', 'R16', 'QF', 'SF', 'F']);
    expect(seedingOrder(2)).toEqual([1, 2]);
    expect(seedingOrder(4)).toEqual([1, 4, 3, 2]);
    expect(seedingOrder(8)).toEqual([1, 8, 5, 4, 3, 6, 7, 2]);
    expect(partnerLine(1)).toBe(2);
    expect(partnerLine(4)).toBe(3);
  });

  it('perfect seeding: every first-round pair of ranks sums to N + 1, ranks 1 and 2 on the outer lines', () => {
    for (const n of [4, 8, 16, 32, 64, 128]) {
      const order = seedingOrder(n);
      expect([...order].sort((a, b) => a - b)).toEqual(Array.from({ length: n }, (_, i) => i + 1));
      expect(order[0]).toBe(1);
      expect(order[n - 1]).toBe(2);
      for (let i = 0; i < n; i += 2) expect((order[i] as number) + (order[i + 1] as number)).toBe(n + 1);
      // Ranks 1-2 in opposite halves, 1-4 in different quarters.
      const quarter = (rank: number): number => Math.floor(order.indexOf(rank) / (n / 4));
      expect(new Set([1, 2, 3, 4].map(quarter)).size).toBe(4);
    }
  });
});

describe('singleElimination', () => {
  it('places seeds 1 and 2 on the outer lines and every entry exactly once', () => {
    const d = draw(singleElimination(make(16, 4), { seed: 7 }));
    expect(d.bracketSize).toBe(16);
    expect(d.rounds).toEqual(['R16', 'QF', 'SF', 'F']);
    expect(d.lines[0]?.entryId).toBe('e1');
    expect(d.lines[15]?.entryId).toBe('e2');
    const ids = d.lines.map((l) => l.entryId).filter((x) => x !== null);
    expect(new Set(ids).size).toBe(16);
    expect(d.byes).toEqual([]);
    expect(d.firstRound).toHaveLength(8);
    expect(d.firstRound.every((m) => m.round === 'R16')).toBe(true);
    // Seeds 3 and 4 sit in the two middle quarters (lines 5-8 and 9-12).
    const line3 = d.lines.find((l) => l.entryId === 'e3')?.line ?? 0;
    const line4 = d.lines.find((l) => l.entryId === 'e4')?.line ?? 0;
    expect([line3, line4].sort((a, b) => a - b)).toEqual([8, 9]);
  });

  it('is reproducible for a seed, independent of input order, and changes with the seed', () => {
    const entries = make(13, 4);
    const a = draw(singleElimination(entries, { seed: 123 }));
    const b = draw(singleElimination([...entries].reverse(), { seed: 123 }));
    expect(a).toEqual(b);
    expect(a.seed).toBe(123);
    const lines = new Set(Array.from({ length: 10 }, (_, s) => JSON.stringify(draw(singleElimination(entries, { seed: s })).lines)));
    expect(lines.size).toBeGreaterThan(1);
  });

  it('draws seeds 3-4 and 5-8 by lot within their lines', () => {
    const seen3 = new Set<number>();
    const seen5to8 = new Set<number>();
    for (let s = 0; s < 40; s++) {
      const d = draw(singleElimination(make(16, 8), { seed: s }));
      seen3.add(d.lines.find((l) => l.entryId === 'e3')?.line ?? 0);
      for (const id of ['e5', 'e6', 'e7', 'e8']) seen5to8.add(d.lines.find((l) => l.entryId === id)?.line ?? 0);
    }
    expect([...seen3].sort((a, b) => a - b)).toEqual([8, 9]);
    const expected = seedingOrder(16).flatMap((rank, i) => (rank >= 5 && rank <= 8 ? [i + 1] : []));
    expect([...seen5to8].sort((a, b) => a - b)).toEqual(expected.sort((a, b) => a - b));
  });

  it('gives byes to the top seeds first and never pairs two byes', () => {
    const d = draw(singleElimination(make(13, 4), { seed: 1 }));
    expect(d.bracketSize).toBe(16);
    expect(d.byes.map((b) => b.entryId)).toEqual(expect.arrayContaining(['e1', 'e2', 'e3']));
    expect(d.byes).toHaveLength(3);
    expect(d.firstRound.filter((m) => m.bye)).toHaveLength(3);
    expect(d.firstRound.some((m) => m.a === null && m.b === null)).toBe(false);
    expect(d.byes.map((b) => b.entryId)).not.toContain('e4');
  });

  it('spreads extra byes beyond the seeds and still never pairs two byes', () => {
    const d = draw(singleElimination(make(9, 2), { seed: 5 }));
    expect(d.bracketSize).toBe(16);
    expect(d.byes).toHaveLength(7);
    expect(d.byes.map((b) => b.entryId)).toEqual(expect.arrayContaining(['e1', 'e2']));
    expect(d.firstRound.some((m) => m.a === null && m.b === null)).toBe(false);
    expect(d.firstRound.filter((m) => !m.bye)).toHaveLength(1);
  });

  it('handles the smallest draws (2 and 3 entries, no seeds)', () => {
    const two = draw(singleElimination(make(2), { seed: 0 }));
    expect(two.rounds).toEqual(['F']);
    expect(two.firstRound).toHaveLength(1);
    const three = draw(singleElimination(make(3), { seed: 0 }));
    expect(three.rounds).toEqual(['SF', 'F']);
    expect(three.byes).toHaveLength(1);
  });

  it('separates clubs in round 1 when asked, and only then', () => {
    const club = (i: number): string => (i % 2 === 0 ? 'Demo Club X' : 'Demo Club Y');
    const entries = make(16, 2, club);
    for (let s = 0; s < 20; s++) {
      const d = draw(singleElimination(entries, { seed: s, separateClubs: true }));
      expect(d.separation.applied).toBe(true);
      expect(d.separation.unresolved).toEqual([]);
      const clubOf = new Map(entries.map((e) => [e.id, e.club]));
      for (const m of d.firstRound) expect(clubOf.get(m.a ?? '')).not.toBe(clubOf.get(m.b ?? ''));
      expect(d.lines[0]?.entryId).toBe('e1');
      expect(d.lines[15]?.entryId).toBe('e2');
    }
    const off = draw(singleElimination(entries, { seed: 3 }));
    expect(off.separation).toEqual({ applied: false, swaps: 0, unresolved: [] });
  });

  it('reports separation it cannot achieve', () => {
    const entries = make(4, 0, (i) => (i <= 3 ? ' Demo Club X ' : 'demo club x'));
    const d = draw(singleElimination(entries, { seed: 9, separateClubs: true }));
    expect(d.separation.unresolved).toHaveLength(2);
    expect(d.separation.unresolved[0]?.key).toBe('demo club x');
  });

  it('ignores blank or missing clubs for separation', () => {
    const entries = make(4, 0, () => '  ');
    const d = draw(singleElimination(entries, { seed: 9, separateClubs: true }));
    expect(d.separation.unresolved).toEqual([]);
    expect(d.separation.swaps).toBe(0);
  });

  it('works for doubles pairs', () => {
    const pairs: Entry[] = [
      { id: 'd1', players: ['Demo Player A', 'Demo Player B'], seed: 1 },
      { id: 'd2', players: ['Demo Player C', 'Demo Player D'] },
      { id: 'd3', players: ['Demo Player E', 'Demo Player F'] },
    ];
    const d = draw(singleElimination(pairs, { seed: 2 }));
    expect(d.byes).toEqual([{ line: 1, entryId: 'd1' }]);
  });

  it('refuses bad entry lists and options', () => {
    expect(codes(singleElimination(make(1), { seed: 1 }))).toContain('too-few-entries');
    expect(codes(singleElimination([], { seed: 1 }))).toContain('too-few-entries');
    expect(codes(singleElimination([...make(3), { id: 'e1', players: ['p99'] }], { seed: 1 }))).toContain('duplicate-entry-id');
    expect(codes(singleElimination([...make(3), { id: 'e9', players: ['p2'] }], { seed: 1 }))).toContain('duplicate-player');
    expect(codes(singleElimination([{ id: 'x', players: ['p1', 'p1'] }, ...make(3).slice(1)], { seed: 1 }))).toContain('duplicate-player');
    expect(codes(singleElimination([{ id: 'x', players: ['p9', 'p8'] }, ...make(3)], { seed: 1 }))).toContain('mixed-entry-sizes');
    expect(codes(singleElimination([{ id: ' ', players: ['p9'] }, ...make(3)], { seed: 1 }))).toContain('invalid-entry');
    expect(codes(singleElimination([{ id: 'x', players: [] }, ...make(3)], { seed: 1 }))).toContain('invalid-entry');
    const dupSeed = make(4, 2);
    dupSeed[2] = { ...(dupSeed[2] as Entry), seed: 2 };
    expect(codes(singleElimination(dupSeed, { seed: 1 }))).toContain('duplicate-seed');
    const gap = make(4);
    gap[0] = { ...(gap[0] as Entry), seed: 1 };
    gap[1] = { ...(gap[1] as Entry), seed: 3 };
    expect(codes(singleElimination(gap, { seed: 1 }))).toContain('seed-gap');
    const zero = make(4);
    zero[0] = { ...(zero[0] as Entry), seed: 0 };
    expect(codes(singleElimination(zero, { seed: 1 }))).toContain('invalid-seed');
    expect(codes(singleElimination(make(4, 3), { seed: 1 }))).toContain('too-many-seeds');
    expect(codes(singleElimination(make(16, 4), { seed: 1, maxSeeds: 2 }))).toContain('too-many-seeds');
    expect(codes(singleElimination(make(129), { seed: 1 }))).toContain('too-many-entries');
    expect(codes(singleElimination(make(4), { seed: 1.5 }))).toContain('invalid-random-seed');
    expect(codes(singleElimination(make(4), { seed: -1 }))).toContain('invalid-random-seed');
  });

  it('uses a competition seeding table when given one', () => {
    // Fictional table: the default 16 order with ranks 3-4 moved to lines 5 and 12 (pairs still hold one top-half rank each).
    const custom = (n: number): number[] => {
      const order = seedingOrder(n);
      const swap = (a: number, b: number): void => {
        const i = order.indexOf(a);
        const j = order.indexOf(b);
        order[i] = b;
        order[j] = a;
      };
      swap(3, 6);
      swap(4, 5);
      return order;
    };
    const seen = new Set<number>();
    for (let s = 0; s < 20; s++) {
      const d = draw(singleElimination(make(16, 4), { seed: s, seedingOrder: custom }));
      expect(d.lines[0]?.entryId).toBe('e1');
      expect(d.lines[15]?.entryId).toBe('e2');
      for (const id of ['e3', 'e4']) seen.add(d.lines.find((l) => l.entryId === id)?.line ?? 0);
    }
    expect([...seen].sort((a, b) => a - b)).toEqual([5, 12]);
    expect(codes(singleElimination(make(4), { seed: 1, seedingOrder: () => [1, 2, 3, 4] }))).toEqual(['invalid-option']);
  });

  it('reports every refusal together, and a bad maxSeeds as an invalid option', () => {
    expect(codes(singleElimination(make(4), { seed: 1, maxSeeds: 1.5 }))).toEqual(['invalid-option']);
    expect(codes(singleElimination(make(4), { seed: 1, maxSeeds: -1 }))).toEqual(['invalid-option']);
    expect(codes(singleElimination(make(4), { seed: 1, maxSeeds: 3 }))).toEqual(['invalid-option']);
    expect(codes(singleElimination(make(4, 3), { seed: -1 })).sort()).toEqual(['invalid-random-seed', 'too-many-seeds']);
    expect(codes(singleElimination(make(1), { seed: -1, maxSeeds: 0.5 })).sort()).toEqual(['invalid-option', 'invalid-random-seed', 'too-few-entries']);
    const zero = make(4, 3);
    zero[3] = { ...(zero[3] as Entry), seed: 0 };
    expect(codes(singleElimination(zero, { seed: 1, maxSeeds: 1 })).sort()).toEqual(['invalid-seed', 'too-many-seeds']);
  });

  it('handles a full 128 draw with 32 seeds', () => {
    const d = draw(singleElimination(make(100, 32), { seed: 2026 }));
    expect(d.bracketSize).toBe(128);
    expect(d.rounds[0]).toBe('R128');
    expect(d.byes).toHaveLength(28);
    expect(d.byes.map((b) => b.entryId)).toEqual(expect.arrayContaining(Array.from({ length: 28 }, (_, i) => `e${i + 1}`)));
  });
});

describe('roundRobin', () => {
  function checkSchedule(n: number): void {
    const entries = make(n);
    const d = draw(roundRobin(entries));
    const rounds = n % 2 === 0 ? n - 1 : n;
    expect(d.rounds).toHaveLength(rounds);
    expect(d.matchCount).toBe((n * (n - 1)) / 2);
    const pairs = new Set<string>();
    const byes: string[] = [];
    for (const r of d.rounds) {
      const playing = r.matches.flatMap((m) => [m.a, m.b]);
      expect(new Set(playing).size).toBe(playing.length);
      for (const m of r.matches) pairs.add([m.a, m.b].sort().join('|'));
      if (r.bye !== null) {
        expect(playing).not.toContain(r.bye);
        byes.push(r.bye);
      }
    }
    expect(pairs.size).toBe((n * (n - 1)) / 2);
    if (n % 2 === 1) expect([...byes].sort()).toEqual(entries.map((e) => e.id).sort());
    else expect(byes).toEqual([]);
  }

  it('every pair meets once, nobody plays twice in a round, one bye per round when odd', () => {
    for (const n of [2, 3, 4, 5, 6, 7, 8, 9, 12]) checkSchedule(n);
  });

  it('defaults to league, can be labelled group, and is deterministic', () => {
    expect(draw(roundRobin(make(4))).roundCode).toBe('league');
    expect(draw(roundRobin(make(4), { roundCode: 'group' })).roundCode).toBe('group');
    expect(roundRobin(make(5))).toEqual(roundRobin(make(5)));
  });

  it('refuses bad lists', () => {
    expect(codes(roundRobin(make(1)))).toContain('too-few-entries');
    expect(codes(roundRobin([...make(2), { id: 'e1', players: ['p7'] }]))).toContain('duplicate-entry-id');
    expect(codes(roundRobin([...make(2), { id: 'e3', players: ['p1'] }]))).toContain('duplicate-player');
  });
});

describe('groupsThenKnockout', () => {
  it('snake-seeds into groups, round robin in each, A1 v B2 for two groups', () => {
    const d = draw(groupsThenKnockout(make(8, 4), 2, 2, { seed: 11 }));
    expect(d.groups.map((g) => g.name)).toEqual(['A', 'B']);
    expect(d.groups[0]?.entryIds.slice(0, 2)).toEqual(['e1', 'e4']);
    expect(d.groups[1]?.entryIds.slice(0, 2)).toEqual(['e2', 'e3']);
    for (const g of d.groups) {
      expect(g.entryIds).toHaveLength(4);
      expect(g.schedule.roundCode).toBe('group');
      expect(g.schedule.matchCount).toBe(6);
    }
    expect(d.knockout.rounds).toEqual(['SF', 'F']);
    expect(d.knockout.firstRound.map((m) => [m.a, m.b])).toEqual([
      [{ group: 'A', position: 1 }, { group: 'B', position: 2 }],
      [{ group: 'A', position: 2 }, { group: 'B', position: 1 }],
    ]);
  });

  it('snake order for 3 groups and uneven sizes', () => {
    const d = draw(groupsThenKnockout(make(7, 6), 3, 1, { seed: 0 }));
    expect(d.groups.map((g) => g.entryIds)).toEqual([
      ['e1', 'e6', 'e7'],
      ['e2', 'e5'],
      ['e3', 'e4'],
    ]);
    expect(d.knockout.bracketSize).toBe(4);
    expect(d.knockout.firstRound.filter((m) => m.bye)).toHaveLength(1);
    expect(d.knockout.firstRound[0]?.a).toEqual({ group: 'A', position: 1 });
    expect(d.knockout.firstRound[0]?.bye).toBe(true);
  });

  it('removes first-round rematches of one group and gives byes to group winners', () => {
    const d = draw(groupsThenKnockout(make(9), 3, 2, { seed: 4 }));
    expect(d.knockout.bracketSize).toBe(8);
    expect(d.knockout.unresolved).toEqual([]);
    for (const m of d.knockout.firstRound) {
      if (m.a && m.b) expect(m.a.group).not.toBe(m.b.group);
      if (m.bye) expect((m.a ?? m.b)?.position).toBe(1);
    }
    const all = d.knockout.lines.filter((x) => x !== null);
    expect(all).toHaveLength(6);
  });

  it('seeded pattern for 4 groups x 2 never has a group rematch in round 1', () => {
    const d = draw(groupsThenKnockout(make(16), 4, 2, { seed: 4 }));
    expect(d.knockout.rounds).toEqual(['QF', 'SF', 'F']);
    for (const m of d.knockout.firstRound) {
      expect([m.a?.position, m.b?.position].sort()).toEqual([1, 2]);
      expect(m.a?.group).not.toBe(m.b?.group);
    }
  });

  it('seeded pattern keeps 2 qualifiers of one group apart until the final', () => {
    for (const [groups, perGroup] of [[2, 4], [3, 3], [4, 4], [5, 3], [6, 3], [8, 4], [16, 3]] as const) {
      const d = draw(groupsThenKnockout(make(groups * perGroup), groups, 2, { seed: 4 }));
      expect(d.knockout.unresolved).toEqual([]);
      expect(d.knockout.groupMateMeetings).toHaveLength(groups);
      for (const meeting of d.knockout.groupMateMeetings) expect(meeting.round).toBe('F');
      // Byes go to group winners first; with more byes than winners (5 groups: 6 byes) runners-up get the rest.
      const byes = d.knockout.firstRound.filter((m) => m.bye).map((m) => (m.a ?? m.b)?.position);
      expect(byes.filter((p) => p === 1)).toHaveLength(Math.min(groups, byes.length));
    }
  });

  it('seeded pattern for 4 groups x 2: winners v runners-up, group mates in opposite halves', () => {
    const d = draw(groupsThenKnockout(make(16), 4, 2, { seed: 4 }));
    const half = (g: string, p: number): number => Math.floor(d.knockout.lines.findIndex((q) => q?.group === g && q.position === p) / 4);
    for (const g of ['A', 'B', 'C', 'D']) expect(half(g, 1)).not.toBe(half(g, 2));
    const label = (q: { group: string; position: number } | null): string => (q ? `${q.group}${q.position}` : 'bye');
    expect(d.knockout.lines.slice(0, 1).map(label)).toEqual(['A1']);
    expect(label(d.knockout.lines[7] ?? null)).toBe('B1');
  });

  it('seeded pattern for 3 groups x 2 gives byes to A1 and B1 and pairs mates only in the final', () => {
    const d = draw(groupsThenKnockout(make(9), 3, 2, { seed: 4 }));
    const byes = d.knockout.firstRound.filter((m) => m.bye).map((m) => m.a ?? m.b);
    expect(byes).toEqual([{ group: 'A', position: 1 }, { group: 'B', position: 1 }]);
    expect(d.knockout.groupMateMeetings.map((m) => m.round)).toEqual(['F', 'F', 'F']);
  });

  it('seeded pattern with 3 per group: no group mates in round 1, each pair as late as the bracket allows', () => {
    const d = draw(groupsThenKnockout(make(16), 4, 3, { seed: 4 }));
    expect(d.knockout.bracketSize).toBe(16);
    expect(d.knockout.unresolved).toEqual([]);
    expect(d.knockout.groupMateMeetings).toHaveLength(12);
    for (const m of d.knockout.groupMateMeetings) expect(['SF', 'F']).toContain(m.round);
    for (const g of ['A', 'B', 'C', 'D']) {
      // Of three mates, exactly one pair shares a half (SF); the other two pairs can only meet in the final.
      expect(d.knockout.groupMateMeetings.filter((m) => m.group === g && m.round === 'SF')).toHaveLength(1);
    }
  });

  it('seeded pattern accepts a competition seeding table and refuses a broken one', () => {
    const d = draw(groupsThenKnockout(make(8), 2, 2, { seed: 1, seedingOrder: (n) => [...seedingOrder(n)].reverse() }));
    expect(d.knockout.lines[3]).toEqual({ group: 'A', position: 1 });
    expect(d.knockout.groupMateMeetings.map((m) => m.round)).toEqual(['F', 'F']);
    expect(codes(groupsThenKnockout(make(8), 2, 2, { seed: 1, seedingOrder: () => [1, 2, 3, 4] }))).toEqual(['invalid-option']);
  });

  it("'adjacent' pattern: A1 v B2 ... B1 v A2, group mates in opposite halves", () => {
    const d = draw(groupsThenKnockout(make(16), 4, 2, { seed: 4, pattern: 'adjacent' }));
    const label = (q: { group: string; position: number } | null): string => (q ? `${q.group}${q.position}` : 'bye');
    expect(d.knockout.firstRound.map((m) => `${label(m.a)} v ${label(m.b)}`)).toEqual(['A1 v B2', 'C1 v D2', 'D1 v C2', 'B1 v A2']);
    const half = (g: string, p: number): number => Math.floor(d.knockout.lines.findIndex((q) => q?.group === g && q.position === p) / 4);
    for (const g of ['A', 'B', 'C', 'D']) expect(half(g, 1)).not.toBe(half(g, 2));
  });

  it('is reproducible from the seed and independent of input order', () => {
    const entries = make(12, 2);
    expect(groupsThenKnockout(entries, 3, 2, { seed: 99 })).toEqual(groupsThenKnockout([...entries].reverse(), 3, 2, { seed: 99 }));
  });

  it('refuses impossible configurations and bad entries', () => {
    expect(codes(groupsThenKnockout(make(8), 0, 1, { seed: 1 }))).toContain('invalid-group-config');
    expect(codes(groupsThenKnockout(make(8), 27, 1, { seed: 1 }))).toContain('invalid-group-config');
    expect(codes(groupsThenKnockout(make(5), 3, 1, { seed: 1 }))).toContain('invalid-group-config');
    expect(codes(groupsThenKnockout(make(8), 2, 4, { seed: 1 }))).toContain('invalid-group-config');
    expect(codes(groupsThenKnockout(make(8), 2, 0, { seed: 1 }))).toContain('invalid-group-config');
    expect(codes(groupsThenKnockout(make(4), 1, 1, { seed: 1 }))).toContain('invalid-group-config');
    expect(codes(groupsThenKnockout(make(9), 3, 2, { seed: 1, pattern: 'adjacent' }))).toContain('invalid-group-config');
    expect(codes(groupsThenKnockout(make(8), 2, 1, { seed: 1, pattern: 'adjacent' }))).toContain('invalid-group-config');
    expect(codes(groupsThenKnockout(make(8), 2, 1, { seed: 2 ** 32 }))).toContain('invalid-random-seed');
    const dup = make(8, 2);
    dup[5] = { ...(dup[5] as Entry), seed: 1 };
    expect(codes(groupsThenKnockout(dup, 2, 1, { seed: 1 }))).toContain('duplicate-seed');
  });
});

describe('seeding tables, meeting rounds and assignment', () => {
  it('meetingRound gives the earliest round two lines can meet', () => {
    expect(meetingRound(1, 2)).toBe(1);
    expect(meetingRound(1, 4)).toBe(2);
    expect(meetingRound(4, 5)).toBe(3);
    expect(meetingRound(1, 16)).toBe(4);
  });

  it('checkSeedingOrder accepts the default and refuses broken tables', () => {
    for (const n of [2, 4, 8, 16, 128]) expect(checkSeedingOrder(seedingOrder(n), n)).toBeNull();
    expect(checkSeedingOrder([1, 2, 3], 4)).not.toBeNull();
    expect(checkSeedingOrder([1, 1, 3, 4], 4)).not.toBeNull();
    expect(checkSeedingOrder([1, 2, 3, 4], 4)).not.toBeNull(); // ranks 1 and 2 would meet in round 1, two byes could meet
  });

  it('minCostAssignment finds the cheapest assignment', () => {
    expect(minCostAssignment([[4, 1, 3], [2, 0, 5], [3, 2, 2]])).toEqual([1, 0, 2]);
    expect(minCostAssignment([[7]])).toEqual([0]);
    expect(minCostAssignment([])).toEqual([]);
  });
});

describe('separateFirstRound', () => {
  it('never moves fixed lines and reports what it cannot fix', () => {
    const lines = ['x1', 'x2', 'y1', 'y2'];
    const r = separateFirstRound(lines, (s) => s[0] ?? null, (line) => line === 2 || line === 3);
    expect(r.lines[0]).toBe('x1');
    expect(r.lines).toEqual(['x1', 'y1', 'x2', 'y2']);
    expect(r.swaps).toBe(1);
    expect(r.unresolved).toEqual([]);
    const stuck = separateFirstRound(lines, (s) => s[0] ?? null, () => false);
    expect(stuck.unresolved).toEqual([
      { lineA: 1, lineB: 2, key: 'x' },
      { lineA: 3, lineB: 4, key: 'y' },
    ]);
  });
});
