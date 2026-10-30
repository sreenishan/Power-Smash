// Bracket geometry shared by the draw generators (Module 4, Phase A). PURE.
//
// Lines are numbered 1..N from the top of the draw sheet; lines (1,2), (3,4), ... meet in the first round.
// N (the bracket size) is the next power of two at or above the number of entries, at most 128 because RoundCode stops at R128.
//
// Seeding positions (decision, documented, CONFIGURABLE): the default is the "perfect seeding" order. Rank 1 sits on line 1 and
// rank 2 on line N; in every round with K entries left, ranks r and K+1-r would meet if the higher ranks always won (1 v 8, 4 v 5,
// 2 v 7, 3 v 6 in the QF). For N = 8 the lines hold ranks 1, 8, 5, 4, 3, 6, 7, 2; for N = 16 ranks 3-4 land on lines 8 and 9.
// ASSUMPTION: this is a mathematical default, NOT a verified copy of any regulation. A competition's own seeding tables (for
// example the BWF General Competition Regulations' seeding positions, not verified here) may put seeds on other lines, so the
// generators accept a `seedingOrder` option (a function giving the rank on every line, same shape as `seedingOrder` below),
// checked by `checkSeedingOrder`. A referee confirms the lines before any draw is published.
import type { Random, RoundCode } from '../types';

/** The largest bracket a RoundCode can name (R128). */
export const MAX_BRACKET_SIZE = 128;

/** The smallest power of two at or above `entryCount` (at least 2). Throws above MAX_BRACKET_SIZE. */
export function bracketSizeFor(entryCount: number): number {
  if (!Number.isInteger(entryCount) || entryCount < 2) throw new RangeError('A bracket needs at least 2 entries');
  let size = 2;
  while (size < entryCount) size *= 2;
  if (size > MAX_BRACKET_SIZE) throw new RangeError(`More than ${MAX_BRACKET_SIZE} entries cannot be named with a RoundCode`);
  return size;
}

const CODES: Readonly<Record<number, RoundCode>> = { 2: 'F', 4: 'SF', 8: 'QF', 16: 'R16', 32: 'R32', 64: 'R64', 128: 'R128' };

/** The RoundCode of a knockout round that starts with `entriesLeft` lines (2 = F, 4 = SF, 8 = QF, 16 = R16, ... 128 = R128). */
export function roundCodeFor(entriesLeft: number): RoundCode {
  const code = CODES[entriesLeft];
  if (code === undefined) throw new RangeError(`No round code for a round of ${String(entriesLeft)}`);
  return code;
}

/** Every knockout round of a bracket, first round first: 8 -> ['QF', 'SF', 'F']. */
export function knockoutRoundCodes(bracketSize: number): RoundCode[] {
  const codes: RoundCode[] = [];
  for (let left = bracketSize; left >= 2; left /= 2) codes.push(roundCodeFor(left));
  return codes;
}

/** The rank sitting on each line (index 0 = line 1) under perfect seeding: 4 -> [1, 4, 3, 2]; 8 -> [1, 8, 5, 4, 3, 6, 7, 2]. */
export function seedingOrder(bracketSize: number): number[] {
  roundCodeFor(bracketSize); // validates a power of two in range
  let order = [1, 2];
  for (let size = 4; size <= bracketSize; size *= 2) {
    const next: number[] = [];
    order.forEach((rank, i) => {
      const other = size + 1 - rank;
      if (i % 2 === 0) next.push(rank, other);
      else next.push(other, rank);
    });
    order = next;
  }
  return order;
}

/** The first-round opponent line of `line` (1 <-> 2, 3 <-> 4, ...). */
export function partnerLine(line: number): number {
  return line % 2 === 1 ? line + 1 : line - 1;
}

/** Fisher-Yates shuffle into a new array, using only the injected random source. */
export function shuffle<T>(items: readonly T[], random: Random): T[] {
  const out = [...items];
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.min(i, Math.floor(random() * (i + 1)));
    const a = out[i] as T;
    out[i] = out[j] as T;
    out[j] = a;
  }
  return out;
}

/** True for an integer seed that seededRandom uses without loss (0 .. 2^32 - 1). */
export function isDrawSeed(seed: unknown): seed is number {
  return typeof seed === 'number' && Number.isInteger(seed) && seed >= 0 && seed <= 0xffffffff;
}

/** A competition's seeding table: the rank sitting on each line (index 0 = line 1) for a bracket of `bracketSize`. */
export type SeedingOrderFn = (bracketSize: number) => readonly number[];

/**
 * Checks a seeding table for a bracket of `bracketSize`: a permutation of ranks 1..N, and every first-round pair holds exactly
 * one rank from the top half (1..N/2), so byes placed opposite the top ranks never meet each other. Returns a plain-English
 * problem, or null when the table is usable.
 */
export function checkSeedingOrder(order: readonly number[], bracketSize: number): string | null {
  if (order.length !== bracketSize) return `The seeding table must list ${bracketSize} lines (got ${order.length}).`;
  const seen = new Set<number>();
  for (const rank of order) {
    if (!Number.isInteger(rank) || rank < 1 || rank > bracketSize || seen.has(rank)) {
      return `The seeding table must use each rank from 1 to ${bracketSize} exactly once.`;
    }
    seen.add(rank);
  }
  for (let i = 0; i < bracketSize; i += 2) {
    const top = [order[i] ?? 0, order[i + 1] ?? 0].filter((r) => r <= bracketSize / 2).length;
    if (top !== 1) return `Lines ${i + 1} and ${i + 2} must hold exactly one rank from 1 to ${bracketSize / 2}.`;
  }
  return null;
}

/** The earliest round (1 = first round, log2 N = final) in which lines `a` and `b` (1-based) can meet. */
export function meetingRound(a: number, b: number): number {
  let x = (a - 1) ^ (b - 1);
  let round = 0;
  while (x > 0) {
    x >>= 1;
    round++;
  }
  return round;
}
