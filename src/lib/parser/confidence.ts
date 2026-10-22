/**
 * Integer confidence scoring (PC-03). Pure, no floating point anywhere, so the review
 * threshold cannot fail on a rounding error.
 *
 *   points = clamp(100 - 30 * (distinct hard flags) - sum(soft points), 0, 100)
 *   needsReview = (any hard flag) OR (points < 70)
 *
 * Why not the spec's 1.0 - 0.3 < 0.7? Because 1.0 - 0.3 is exactly 0.7 and 0.7 is not below 0.7,
 * so a 1-versus-2 title auto-published. UNEVEN_SIDES is now a hard flag, which forces review
 * regardless of the score, and it also costs 30 points (the spec's original -0.3).
 */
import {
  HARD_FLAGS,
  HARD_FLAG_PENALTY_POINTS,
  PER_OCCURRENCE_SOFT_FLAGS,
  REVIEW_THRESHOLD_POINTS,
  SOFT_FLAGS,
  SOFT_FLAG_POINTS,
  START_POINTS,
} from './types';
import type { HardFlag, ReviewReason, SoftFlag, SoftFlagHit } from './types';

export type ConfidenceInput = {
  hard?: readonly HardFlag[];
  soft?: readonly { flag: SoftFlag; count?: number }[];
};

export type ConfidenceOutcome = {
  points: number;
  hardFlags: HardFlag[];
  softFlags: SoftFlagHit[];
  needsReview: boolean;
  reviewReasons: ReviewReason[];
};

/** The single review rule. Throws on a non-integer score (a float would reopen PC-03). */
export function needsReviewFor(points: number, hardFlags: readonly HardFlag[]): boolean {
  if (!Number.isInteger(points)) {
    throw new RangeError(`confidence points must be an integer, got ${points}`);
  }
  return hardFlags.length > 0 || points < REVIEW_THRESHOLD_POINTS;
}

export function computeConfidence(input: ConfidenceInput = {}): ConfidenceOutcome {
  const hardSet = new Set<HardFlag>();
  for (const flag of input.hard ?? []) {
    if (!(HARD_FLAGS as readonly string[]).includes(flag)) {
      throw new RangeError(`unknown hard flag: ${String(flag)}`);
    }
    hardSet.add(flag);
  }
  // canonical order so output is deterministic whatever order the caller used
  const hardFlags = HARD_FLAGS.filter((flag) => hardSet.has(flag));

  const counts = new Map<SoftFlag, number>();
  for (const entry of input.soft ?? []) {
    if (!SOFT_FLAGS.includes(entry.flag)) {
      throw new RangeError(`unknown soft flag: ${String(entry.flag)}`);
    }
    const count = entry.count ?? 1;
    if (!Number.isInteger(count) || count < 0) {
      throw new RangeError(`soft flag count must be a non-negative integer, got ${count}`);
    }
    counts.set(entry.flag, (counts.get(entry.flag) ?? 0) + count);
  }

  const softFlags: SoftFlagHit[] = [];
  for (const flag of SOFT_FLAGS) {
    const raw = counts.get(flag) ?? 0;
    if (raw === 0) continue;
    const count = PER_OCCURRENCE_SOFT_FLAGS.includes(flag) ? raw : 1;
    softFlags.push({ flag, count, points: count * SOFT_FLAG_POINTS[flag] });
  }

  const penalty =
    hardFlags.length * HARD_FLAG_PENALTY_POINTS + softFlags.reduce((sum, hit) => sum + hit.points, 0);
  const points = Math.min(START_POINTS, Math.max(0, START_POINTS - penalty));

  const reviewReasons: ReviewReason[] = [...hardFlags];
  if (points < REVIEW_THRESHOLD_POINTS) reviewReasons.push('LOW_SCORE');

  return { points, hardFlags, softFlags, needsReview: needsReviewFor(points, hardFlags), reviewReasons };
}
