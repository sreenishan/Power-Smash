/**
 * GREEN (M0): the integer confidence scheme of PC-03.
 *
 * The spec's float scheme (1.0 - 0.3 per penalty, review when < 0.7) never fired on a single
 * penalty because 1.0 - 0.3 is exactly 0.7. These tests pin the corrected behaviour:
 * integer points, hard flags that force review whatever the score, and "below 70" meaning
 * strictly below.
 */
import { describe, expect, it } from 'vitest';
import { computeConfidence, needsReviewFor } from '../../src/lib/parser/confidence';
import {
  HARD_FLAGS,
  HARD_FLAG_PENALTY_POINTS,
  PER_OCCURRENCE_SOFT_FLAGS,
  REVIEW_THRESHOLD_POINTS,
  SOFT_FLAGS,
  SOFT_FLAG_POINTS,
  START_POINTS,
} from '../../src/lib/parser/types';
import type { HardFlag, SoftFlag } from '../../src/lib/parser/types';

describe('why the float scheme failed (documentation of PC-03)', () => {
  it('1.0 - 0.3 is exactly 0.7, which is not below 0.7: a 1-versus-2 title used to auto-publish', () => {
    expect(1.0 - 0.3).toBe(0.7);
    expect(1.0 - 0.3 < 0.7).toBe(false);
  });

  it('chained float penalties drift (1 - 0.2 - 0.1 is 0.7000000000000001)', () => {
    expect(1 - 0.2 - 0.1).not.toBe(0.7);
  });
});

describe('integer scheme constants', () => {
  it('start at 100, review below 70, every penalty an integer', () => {
    expect(START_POINTS).toBe(100);
    expect(REVIEW_THRESHOLD_POINTS).toBe(70);
    expect(Number.isInteger(HARD_FLAG_PENALTY_POINTS)).toBe(true);
    for (const flag of SOFT_FLAGS) expect(Number.isInteger(SOFT_FLAG_POINTS[flag]), flag).toBe(true);
  });

  it('soft flag values are the PC-03 values', () => {
    expect(SOFT_FLAG_POINTS).toEqual({
      NO_TOURNAMENT: 20,
      NO_CATEGORY: 10,
      NO_ROUND: 5,
      NO_YEAR: 5,
      SINGLE_TOKEN_NAME: 5,
      SHORT_NAME: 20,
      SUSPECT_INITIALS: 10,
    });
  });

  it('hard flags are exactly the 13 PC-03 flags plus the documented NO_LATIN_KEY extension', () => {
    const pc03 = [
      'UNEVEN_SIDES', 'AMBIGUOUS_VS', 'NO_SEPARATOR', 'TRUNCATED_TITLE', 'DUP_ALIAS_IN_MATCH',
      'FORMAT_CATEGORY_MISMATCH', 'NAME_COUNT_GT2', 'NAME_TOO_LONG', 'TEAM_SIDE', 'MIXED_SCRIPT_NAME',
      'UNKNOWN_AGE_TOKEN', 'INDIA_ONLY_CODE', 'AMBIGUOUS_ALIAS',
    ];
    expect([...HARD_FLAGS].slice(0, 13)).toEqual(pc03);
    expect([...HARD_FLAGS].slice(13)).toEqual(['NO_LATIN_KEY']);
  });
});

describe('the 0.7 boundary (PC-03)', () => {
  it('one 0.3-class penalty (UNEVEN_SIDES) lands exactly on 70 points and STILL triggers review', () => {
    const outcome = computeConfidence({ hard: ['UNEVEN_SIDES'] });
    expect(outcome.points).toBe(70);
    expect(outcome.points < REVIEW_THRESHOLD_POINTS).toBe(false); // not below the threshold...
    expect(outcome.needsReview).toBe(true); // ...but the hard flag forces review
    expect(outcome.reviewReasons).toEqual(['UNEVEN_SIDES']);
  });

  it('the same 70 points WITHOUT a hard flag is not reviewed ("below 70" is strict)', () => {
    const outcome = computeConfidence({ soft: [{ flag: 'NO_TOURNAMENT' }, { flag: 'NO_CATEGORY' }] }); // 20 + 10
    expect(outcome.points).toBe(70);
    expect(outcome.needsReview).toBe(false);
    expect(outcome.reviewReasons).toEqual([]);
  });

  it('needsReviewFor draws the line at 70 exactly', () => {
    expect(needsReviewFor(71, [])).toBe(false);
    expect(needsReviewFor(70, [])).toBe(false);
    expect(needsReviewFor(69, [])).toBe(true);
    expect(needsReviewFor(0, [])).toBe(true);
    expect(needsReviewFor(100, [])).toBe(false);
  });

  it('a hard flag forces review at any score, even 100', () => {
    for (const flag of HARD_FLAGS) {
      expect(needsReviewFor(100, [flag]), flag).toBe(true);
      expect(computeConfidence({ hard: [flag] }).needsReview, flag).toBe(true);
    }
  });

  it('refuses a non-integer score instead of reopening the float problem', () => {
    expect(() => needsReviewFor(70.0000001, [])).toThrow(RangeError);
    expect(() => needsReviewFor(Number.NaN, [])).toThrow(RangeError);
  });

  it('adds LOW_SCORE as a review reason only when strictly below 70', () => {
    const low = computeConfidence({ soft: [{ flag: 'NO_TOURNAMENT' }, { flag: 'NO_CATEGORY' }, { flag: 'NO_YEAR' }] }); // 65
    expect(low.points).toBe(65);
    expect(low.needsReview).toBe(true);
    expect(low.reviewReasons).toEqual(['LOW_SCORE']);
  });
});

describe('uneven sides (one player against two)', () => {
  it('reads as UNEVEN_SIDES with 70 points and review, never as an auto-publish', () => {
    // PF-051: ARUN/KUMAR vs RAJ -> A has 2, B has 1; three single-token names
    const outcome = computeConfidence({ hard: ['UNEVEN_SIDES'], soft: [{ flag: 'SINGLE_TOKEN_NAME', count: 3 }] });
    expect(outcome.points).toBe(55);
    expect(outcome.needsReview).toBe(true);
    expect(outcome.hardFlags).toEqual(['UNEVEN_SIDES']);
    expect(outcome.softFlags).toEqual([{ flag: 'SINGLE_TOKEN_NAME', count: 3, points: 15 }]);
  });
});

describe('computeConfidence', () => {
  it('is 100 and not reviewed with no flags', () => {
    expect(computeConfidence()).toEqual({ points: 100, hardFlags: [], softFlags: [], needsReview: false, reviewReasons: [] });
  });

  it('counts SINGLE_TOKEN_NAME per player and every other soft flag once', () => {
    expect(computeConfidence({ soft: [{ flag: 'SINGLE_TOKEN_NAME', count: 3 }] }).points).toBe(85);
    expect(computeConfidence({ soft: [{ flag: 'SHORT_NAME', count: 4 }] }).points).toBe(80);
    expect(computeConfidence({ soft: [{ flag: 'NO_YEAR', count: 2 }] }).points).toBe(95);
    expect(PER_OCCURRENCE_SOFT_FLAGS).toEqual(['SINGLE_TOKEN_NAME']);
  });

  it('counts a repeated hard flag once and returns flags in canonical order', () => {
    const outcome = computeConfidence({ hard: ['TRUNCATED_TITLE', 'UNEVEN_SIDES', 'TRUNCATED_TITLE'] });
    expect(outcome.hardFlags).toEqual(['UNEVEN_SIDES', 'TRUNCATED_TITLE']);
    expect(outcome.points).toBe(40);
  });

  it('never leaves 0..100 and always returns an integer, for every combination of flags', () => {
    const hardSets: HardFlag[][] = [[], ['UNEVEN_SIDES'], ['TRUNCATED_TITLE', 'NO_SEPARATOR'], [...HARD_FLAGS]];
    const softSets: { flag: SoftFlag; count?: number }[][] = [
      [],
      [{ flag: 'NO_ROUND' }],
      [{ flag: 'NO_TOURNAMENT' }, { flag: 'SINGLE_TOKEN_NAME', count: 6 }],
      SOFT_FLAGS.map((flag) => ({ flag, count: 6 })),
    ];
    for (const hard of hardSets) {
      for (const soft of softSets) {
        const outcome = computeConfidence({ hard, soft });
        expect(Number.isInteger(outcome.points)).toBe(true);
        expect(outcome.points).toBeGreaterThanOrEqual(0);
        expect(outcome.points).toBeLessThanOrEqual(100);
        expect(outcome.needsReview).toBe(hard.length > 0 || outcome.points < 70);
      }
    }
  });

  it('is deterministic whatever order the caller lists the flags in', () => {
    const a = computeConfidence({ hard: ['NO_SEPARATOR', 'UNEVEN_SIDES'], soft: [{ flag: 'NO_YEAR' }, { flag: 'NO_ROUND' }] });
    const b = computeConfidence({ hard: ['UNEVEN_SIDES', 'NO_SEPARATOR'], soft: [{ flag: 'NO_ROUND' }, { flag: 'NO_YEAR' }] });
    expect(a).toEqual(b);
  });

  it('rejects unknown flags and bad counts (typo guard)', () => {
    expect(() => computeConfidence({ hard: ['NOT_A_FLAG' as HardFlag] })).toThrow(RangeError);
    expect(() => computeConfidence({ soft: [{ flag: 'NOPE' as SoftFlag }] })).toThrow(RangeError);
    expect(() => computeConfidence({ soft: [{ flag: 'NO_YEAR', count: -1 }] })).toThrow(RangeError);
    expect(() => computeConfidence({ soft: [{ flag: 'NO_YEAR', count: 1.5 }] })).toThrow(RangeError);
  });
});
