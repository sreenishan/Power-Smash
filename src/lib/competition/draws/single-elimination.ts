// Single-elimination draw (Module 4, Phase A). PURE and reproducible: the same entries and the same integer seed give the same
// draw on every machine (the seed drives seededRandom from ../types and is returned with the draw so it can be recorded).
//
// Rules and decisions:
// - Bracket size = the next power of two (bracket.ts), at most 128 entries (RoundCode stops at R128).
// - Seeds: seed 1 on line 1, seed 2 on line N; seeds 3-4 drawn by lot into the two rank-3/4 lines, seeds 5-8 by lot into the
//   rank-5..8 lines, 9-16 into the rank-9..16 lines, and so on. The rank-to-line table defaults to the perfect seeding order
//   (bracket.ts; an ASSUMPTION, not a verified regulation) and is configurable through `seedingOrder` for a competition's own
//   seeding tables; the referee confirms the lines against the competition's regulations. Seeds must run 1..S; S is capped by `maxSeeds`
//   (default N / 2, the structural limit; regulations such as the BWF's usually allow fewer seeds per draw size, set it lower).
// - Byes (N minus entries) go to the top seeds first (standard practice): seed 1's opponent line is a bye, then seed 2's, and so
//   on; when there are more byes than seeds, the rest go opposite the next free lines in rank order. Two byes never meet.
// - Unseeded entries are sorted by id (so input order never matters), shuffled with the seeded random source, and fill the
//   remaining lines from the top.
// - Club separation (configurable, default OFF so the draw stays purely by lot unless the referee asks): avoid two entries of
//   one club meeting in round 1 by swapping unseeded entries (separation.ts); clashes that cannot be separated are reported.
import { seededRandom, type Entry, type RoundCode } from '../types';
import {
  bracketSizeFor,
  checkSeedingOrder,
  isDrawSeed,
  knockoutRoundCodes,
  MAX_BRACKET_SIZE,
  partnerLine,
  seedingOrder,
  shuffle,
  type SeedingOrderFn,
} from './bracket';
import { separateFirstRound, type SeparationClash } from './separation';
import { clubKey, splitBySeed, validateEntries, type DrawOutcome, type DrawRefusal } from './validate';

export interface SingleEliminationOptions {
  /** Integer 0 .. 2^32 - 1 fed to seededRandom; recorded on the draw. */
  seed: number;
  /** Keep entries of one club apart in round 1 when possible. Default false. */
  separateClubs?: boolean;
  /** Most seeds allowed: a whole number from 0 to bracket size / 2. Default bracket size / 2. */
  maxSeeds?: number;
  /** The competition's seeding table (rank on each line). Default: bracket.ts `seedingOrder` (perfect seeding). */
  seedingOrder?: SeedingOrderFn;
}

/** One line of the draw sheet. `entryId` null = a bye. */
export interface DrawLine {
  line: number;
  entryId: string | null;
  seed: number | null;
}

/** A first-round match (lines 2k-1 and 2k). When one side is a bye, the other side advances without playing. */
export interface FirstRoundMatch {
  match: number;
  round: RoundCode;
  lineA: number;
  lineB: number;
  a: string | null;
  b: string | null;
  bye: boolean;
}

export interface SingleEliminationDraw {
  seed: number;
  bracketSize: number;
  entryCount: number;
  /** First round first: ['QF', 'SF', 'F']. */
  rounds: RoundCode[];
  lines: DrawLine[];
  firstRound: FirstRoundMatch[];
  /** Entries that advance on a bye, with their line. */
  byes: { line: number; entryId: string }[];
  separation: { applied: boolean; swaps: number; unresolved: SeparationClash[] };
}

/** The seed group of seed s: [1], [2], [3, 4], [5, 8], [9, 16], ... as an inclusive rank range. */
function seedGroup(s: number): [number, number] {
  if (s <= 2) return [s, s];
  let hi = 4;
  while (hi < s) hi *= 2;
  return [hi / 2 + 1, hi];
}

/** Makes a single-elimination draw, or refuses with every reason. */
export function singleElimination(entries: readonly Entry[], options: SingleEliminationOptions): DrawOutcome<SingleEliminationDraw> {
  const refusals: DrawRefusal[] = validateEntries(entries, true);
  if (!isDrawSeed(options.seed)) refusals.push({ code: 'invalid-random-seed', message: 'The draw seed must be a whole number from 0 to 4294967295.' });
  if (entries.length > MAX_BRACKET_SIZE) refusals.push({ code: 'too-many-entries', message: `A knockout draw holds at most ${MAX_BRACKET_SIZE} entries.` });
  // The size-dependent checks need a usable entry count; they add to the same list so every reason is reported together.
  const sizeKnown = entries.length >= 2 && entries.length <= MAX_BRACKET_SIZE;
  const size = sizeKnown ? bracketSizeFor(entries.length) : 0;
  const seededCount = entries.filter((e) => e.seed !== undefined).length;
  if (options.maxSeeds !== undefined && (!Number.isInteger(options.maxSeeds) || options.maxSeeds < 0 || (sizeKnown && options.maxSeeds > size / 2))) {
    const range = sizeKnown ? `from 0 to ${size / 2} for a draw of ${size}` : 'from 0 to half the draw size';
    refusals.push({ code: 'invalid-option', message: `maxSeeds must be a whole number ${range}.` });
  } else if (sizeKnown) {
    const maxSeeds = options.maxSeeds ?? size / 2;
    if (seededCount > maxSeeds) refusals.push({ code: 'too-many-seeds', message: `${seededCount} seeds given; a draw of ${size} allows at most ${maxSeeds}.` });
  }
  let order: readonly number[] = [];
  if (sizeKnown) {
    order = options.seedingOrder ? options.seedingOrder(size) : seedingOrder(size);
    const problem = checkSeedingOrder(order, size);
    if (problem !== null) refusals.push({ code: 'invalid-option', message: problem });
  }
  if (refusals.length > 0) return { ok: false, refusals };

  const { seeded, unseeded } = splitBySeed(entries);
  const random = seededRandom(options.seed);
  const lineOfRank = new Map<number, number>();
  order.forEach((rank, i) => lineOfRank.set(rank, i + 1));
  const rankLine = (rank: number): number => lineOfRank.get(rank) ?? 0;

  const lines: (Entry | null)[] = new Array<Entry | null>(size).fill(null);
  const taken = new Set<number>();

  // Seeds: group by group, lines of the group drawn by lot.
  const seedLines: number[] = [];
  for (let i = 0; i < seeded.length; ) {
    const [lo, hi] = seedGroup(i + 1);
    const groupLines: number[] = [];
    for (let r = lo; r <= hi; r++) groupLines.push(rankLine(r));
    const drawn = lo === hi ? groupLines : shuffle(groupLines, random);
    for (let k = 0; k < drawn.length && i < seeded.length; k++, i++) {
      const line = drawn[k] as number;
      lines[line - 1] = seeded[i] as Entry;
      taken.add(line);
      seedLines.push(line);
    }
  }

  // Byes: opposite the seeds in seed order, then opposite the free lines in rank order.
  const byeCount = size - entries.length;
  const byeTargets: number[] = seedLines.slice(0, byeCount);
  for (let r = 1; r <= size / 2 && byeTargets.length < byeCount; r++) {
    const line = rankLine(r);
    if (!taken.has(line)) byeTargets.push(line);
  }
  const byeLines = new Set(byeTargets.map(partnerLine));

  // Unseeded: shuffled, filling the remaining lines from the top.
  const pool = shuffle(unseeded, random);
  let next = 0;
  for (let line = 1; line <= size; line++) {
    if (taken.has(line) || byeLines.has(line)) continue;
    lines[line - 1] = pool[next++] ?? null;
  }

  const seedLineSet = new Set(seedLines);
  const separateClubs = options.separateClubs ?? false;
  let placed = lines;
  let swaps = 0;
  let unresolved: SeparationClash[] = [];
  if (separateClubs) {
    const result = separateFirstRound(lines, clubKey, (line) => !seedLineSet.has(line) && !byeLines.has(line));
    placed = result.lines;
    swaps = result.swaps;
    unresolved = result.unresolved;
  }

  const rounds = knockoutRoundCodes(size);
  const firstCode = rounds[0] as RoundCode;
  const drawLines: DrawLine[] = placed.map((e, i) => ({ line: i + 1, entryId: e?.id ?? null, seed: e?.seed ?? null }));
  const firstRound: FirstRoundMatch[] = [];
  const byes: { line: number; entryId: string }[] = [];
  for (let m = 0; m < size / 2; m++) {
    const a = placed[2 * m] ?? null;
    const b = placed[2 * m + 1] ?? null;
    const bye = a === null || b === null;
    firstRound.push({ match: m + 1, round: firstCode, lineA: 2 * m + 1, lineB: 2 * m + 2, a: a?.id ?? null, b: b?.id ?? null, bye });
    if (a !== null && b === null) byes.push({ line: 2 * m + 1, entryId: a.id });
    if (b !== null && a === null) byes.push({ line: 2 * m + 2, entryId: b.id });
  }

  return {
    ok: true,
    draw: {
      seed: options.seed,
      bracketSize: size,
      entryCount: entries.length,
      rounds,
      lines: drawLines,
      firstRound,
      byes,
      separation: { applied: separateClubs, swaps, unresolved },
    },
  };
}
