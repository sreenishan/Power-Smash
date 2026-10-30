// Groups then knockout (Module 4, Phase A). PURE and reproducible from the recorded integer seed.
//
// Rules and decisions:
// - Group order: seeded entries by seed, then unseeded entries (sorted by id, then shuffled with seededRandom(seed)).
// - Snake seeding into groups A, B, C...: row 1 left to right (A, B, C), row 2 right to left (C, B, A), and so on, so seed 1 and
//   seed 2 are in different groups and group strength evens out. Group sizes differ by at most one.
// - Inside each group: a round robin (round-robin.ts, round code 'group'), circle order = snake order.
// - Qualifiers: the top `advancePerGroup` of each group. How a group is ranked (wins, games, points, head to head) belongs to the
//   standings engine, not here; this module only lays out the knockout SLOTS ("winner of A", "runner-up of B").
// - Knockout pattern (configurable, default 'seeded'):
//   'seeded'   group winners take ranks 1..G of the seeding order (bracket.ts; A1 = rank 1, B1 = rank 2, ...; the order itself is
//              configurable through `seedingOrder`), so byes go to group winners first. Each lower finishing position p then
//              takes the lines of ranks (p-1)G+1 .. pG, and the groups are assigned to those lines by a minimum-cost assignment
//              (assignment.ts) that keeps every qualifier as far as the bracket allows from its own group mates: a meeting in
//              an earlier round always costs more than any number of meetings in later rounds. Result: with 2 per group the
//              runner-up sits in the other half from its winner (they can only meet in the final) whenever the bracket allows;
//              with 2 groups x 2 this is A1 v B2 and A2 v B1. Any first-round meeting of group mates left over is reported.
//   'adjacent' the classic cross-over for 2 qualifiers per group and a power-of-two number of groups: A1 v B2, C1 v D2, ... in
//              the top half and ..., D1 v C2, B1 v A2 in the bottom half, so two qualifiers of one group can only meet in the final.
//   Both patterns report `groupMateMeetings`: for every pair of qualifiers from one group, the earliest round they could meet.
// - Refused: fewer than 2 entries per group, more than 26 groups, advancePerGroup not below the smallest group size (someone
//   must be knocked out in every group), fewer than 2 or more than 128 qualifiers, 'adjacent' when its shape does not fit.
import { seededRandom, type Entry, type RoundCode } from '../types';
import { minCostAssignment } from './assignment';
import {
  bracketSizeFor,
  checkSeedingOrder,
  isDrawSeed,
  knockoutRoundCodes,
  MAX_BRACKET_SIZE,
  meetingRound,
  seedingOrder,
  shuffle,
  type SeedingOrderFn,
} from './bracket';
import { roundRobin, type RoundRobinDraw } from './round-robin';
import type { SeparationClash } from './separation';
import { splitBySeed, validateEntries, type DrawOutcome, type DrawRefusal } from './validate';

export type KnockoutPattern = 'seeded' | 'adjacent';

export interface GroupsThenKnockoutOptions {
  /** Integer 0 .. 2^32 - 1 fed to seededRandom (unseeded entries' group order); recorded on the draw. */
  seed: number;
  /** Default 'seeded'. */
  pattern?: KnockoutPattern;
  /** The competition's seeding table for the 'seeded' pattern. Default: bracket.ts `seedingOrder` (perfect seeding). */
  seedingOrder?: SeedingOrderFn;
}

export interface Group {
  /** 'A', 'B', ... */
  name: string;
  entryIds: string[];
  schedule: RoundRobinDraw;
}

/** "Finishing `position` in group `group`" (1 = winner, 2 = runner-up, ...). */
export interface Qualifier {
  group: string;
  position: number;
}

export interface KnockoutSlotMatch {
  match: number;
  round: RoundCode;
  lineA: number;
  lineB: number;
  a: Qualifier | null;
  b: Qualifier | null;
  bye: boolean;
}

/** Two qualifiers of one group and the earliest knockout round in which they could meet. */
export interface GroupMateMeeting {
  group: string;
  /** Finishing positions, lower first: [1, 2]. */
  positions: [number, number];
  round: RoundCode;
}

export interface GroupsThenKnockoutDraw {
  seed: number;
  groups: Group[];
  knockout: {
    pattern: KnockoutPattern;
    bracketSize: number;
    rounds: RoundCode[];
    /** index 0 = line 1; null = a bye. */
    lines: (Qualifier | null)[];
    firstRound: KnockoutSlotMatch[];
    /** First-round matches between two qualifiers of one group that the layout could not avoid (key = group name). */
    unresolved: SeparationClash[];
    /** Every pair of group mates and the earliest round they could meet, in group then position order. */
    groupMateMeetings: GroupMateMeeting[];
  };
}

const LETTERS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';

function isPowerOfTwo(n: number): boolean {
  return n >= 1 && (n & (n - 1)) === 0;
}

/** Splits entries into snake-seeded groups with a round robin each, and lays out the knockout slots. */
export function groupsThenKnockout(
  entries: readonly Entry[],
  groupCount: number,
  advancePerGroup: number,
  options: GroupsThenKnockoutOptions,
): DrawOutcome<GroupsThenKnockoutDraw> {
  const refusals: DrawRefusal[] = validateEntries(entries, true);
  if (!isDrawSeed(options.seed)) refusals.push({ code: 'invalid-random-seed', message: 'The draw seed must be a whole number from 0 to 4294967295.' });
  const pattern = options.pattern ?? 'seeded';
  const bad = (message: string): void => {
    refusals.push({ code: 'invalid-group-config', message });
  };
  if (!Number.isInteger(groupCount) || groupCount < 1 || groupCount > LETTERS.length) bad(`The number of groups must be 1 to ${LETTERS.length}.`);
  else if (entries.length < groupCount * 2) bad(`${groupCount} groups need at least ${groupCount * 2} entries (2 per group).`);
  else {
    const minSize = Math.floor(entries.length / groupCount);
    const qualifiers = groupCount * advancePerGroup;
    if (!Number.isInteger(advancePerGroup) || advancePerGroup < 1) bad('At least 1 entry must advance from each group.');
    else if (advancePerGroup >= minSize) bad(`With groups of ${minSize}, fewer than ${minSize} entries must advance from each group.`);
    else if (qualifiers < 2) bad('The knockout needs at least 2 qualifiers.');
    else if (qualifiers > MAX_BRACKET_SIZE) bad(`The knockout holds at most ${MAX_BRACKET_SIZE} qualifiers.`);
    else if (pattern === 'adjacent' && (advancePerGroup !== 2 || groupCount < 2 || !isPowerOfTwo(groupCount))) {
      bad("The 'adjacent' pattern needs 2 qualifiers per group and 2, 4, 8 or 16 groups.");
    }
  }
  let order: readonly number[] = [];
  if (refusals.length === 0) {
    const size = bracketSizeFor(groupCount * advancePerGroup);
    if (pattern === 'seeded' && options.seedingOrder !== undefined) {
      order = options.seedingOrder(size);
      const problem = checkSeedingOrder(order, size);
      if (problem !== null) refusals.push({ code: 'invalid-option', message: problem });
    } else {
      order = seedingOrder(size);
    }
  }
  if (refusals.length > 0) return { ok: false, refusals };

  // Snake seeding.
  const { seeded, unseeded } = splitBySeed(entries);
  const ordered = [...seeded, ...shuffle(unseeded, seededRandom(options.seed))];
  const members: Entry[][] = Array.from({ length: groupCount }, () => []);
  ordered.forEach((entry, i) => {
    const row = Math.floor(i / groupCount);
    const col = i % groupCount;
    const g = row % 2 === 0 ? col : groupCount - 1 - col;
    (members[g] as Entry[]).push(entry);
  });
  const groups: Group[] = [];
  for (let g = 0; g < groupCount; g++) {
    const list = members[g] as Entry[];
    const schedule = roundRobin(list, { roundCode: 'group' });
    if (!schedule.ok) return { ok: false, refusals: schedule.refusals };
    groups.push({ name: LETTERS[g] as string, entryIds: list.map((e) => e.id), schedule: schedule.draw });
  }

  // Knockout slots.
  const q = groupCount * advancePerGroup;
  const size = bracketSizeFor(q);
  let lines: (Qualifier | null)[];
  if (pattern === 'adjacent') {
    const top: Qualifier[] = [];
    const bottom: Qualifier[] = [];
    for (let k = 0; k < groupCount / 2; k++) {
      const x = LETTERS[2 * k] as string;
      const y = LETTERS[2 * k + 1] as string;
      top.push({ group: x, position: 1 }, { group: y, position: 2 });
      bottom.unshift({ group: y, position: 1 }, { group: x, position: 2 });
    }
    lines = [...top, ...bottom];
  } else {
    lines = seededLayout(order, groupCount, advancePerGroup, size);
  }

  const rounds = knockoutRoundCodes(size);
  const lineOf = new Map<string, number>();
  lines.forEach((x, i) => {
    if (x !== null) lineOf.set(`${x.group}${x.position}`, i + 1);
  });
  const groupMateMeetings: GroupMateMeeting[] = [];
  for (let g = 0; g < groupCount; g++) {
    const group = LETTERS[g] as string;
    for (let p1 = 1; p1 <= advancePerGroup; p1++) {
      for (let p2 = p1 + 1; p2 <= advancePerGroup; p2++) {
        const r = meetingRound(lineOf.get(`${group}${p1}`) ?? 1, lineOf.get(`${group}${p2}`) ?? 1);
        groupMateMeetings.push({ group, positions: [p1, p2], round: rounds[r - 1] as RoundCode });
      }
    }
  }
  const unresolved: SeparationClash[] = [];
  const firstRound: KnockoutSlotMatch[] = [];
  for (let m = 0; m < size / 2; m++) {
    const a = lines[2 * m] ?? null;
    const b = lines[2 * m + 1] ?? null;
    firstRound.push({ match: m + 1, round: rounds[0] as RoundCode, lineA: 2 * m + 1, lineB: 2 * m + 2, a, b, bye: a === null || b === null });
    if (a !== null && b !== null && a.group === b.group) unresolved.push({ lineA: 2 * m + 1, lineB: 2 * m + 2, key: a.group });
  }
  return { ok: true, draw: { seed: options.seed, groups, knockout: { pattern, bracketSize: size, rounds, lines, firstRound, unresolved, groupMateMeetings } } };
}

/**
 * The 'seeded' layout: winners on the lines of ranks 1..G, then each lower position assigned to the lines of its rank band so
 * that group mates meet as late as possible. Lines of ranks above the qualifier count stay null (byes, opposite the winners).
 */
function seededLayout(order: readonly number[], groupCount: number, advancePerGroup: number, size: number): (Qualifier | null)[] {
  const lineOfRank = new Map<number, number>();
  order.forEach((rank, i) => lineOfRank.set(rank, i + 1));
  const lines: (Qualifier | null)[] = new Array<Qualifier | null>(size).fill(null);
  const placed: number[][] = Array.from({ length: groupCount }, () => []);
  const finalRound = Math.log2(size);
  // A meeting in round r costs base^(final - r); base > the number of qualifiers, so one earlier meeting always outweighs any
  // number of later ones. Largest total about 129^6 * 128, far below 2^53, so the sums stay exact.
  const base = groupCount * advancePerGroup + 1;
  for (let p = 1; p <= advancePerGroup; p++) {
    const slots: number[] = [];
    for (let g = 0; g < groupCount; g++) slots.push(lineOfRank.get((p - 1) * groupCount + g + 1) ?? 0);
    let assignment: number[];
    if (p === 1) {
      assignment = slots.map((_, g) => g);
    } else {
      const cost = placed.map((mates) =>
        slots.map((slot) => mates.reduce((sum, mate) => sum + base ** (finalRound - meetingRound(mate, slot)), 0)),
      );
      assignment = minCostAssignment(cost);
    }
    for (let g = 0; g < groupCount; g++) {
      const line = slots[assignment[g] ?? 0] ?? 0;
      lines[line - 1] = { group: LETTERS[g] as string, position: p };
      (placed[g] as number[]).push(line);
    }
  }
  return lines;
}
