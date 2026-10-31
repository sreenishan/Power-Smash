// The approved local ranking points table (D-129, owner decision 2026-10-31 "use it as is"): the TS constant is a valid admin record
// and holds the owner's numbers cell by cell, nothing more.
import { describe, expect, it } from 'vitest';
import { pointsTableProblems } from '../../src/lib/admin/competition/validate';
import type { PointsTableRecord } from '../../src/lib/admin/competition/types';
import { APPROVED_POINTS_TABLE_2026, POINTS_TABLE_2026_COLUMNS } from '../../src/lib/competition/points-table-2026';
import { FINISHES, localRanking } from '../../src/lib/competition/stats/ranking';

// The owner's table as given: W, F, SF, QF, R16, R32, R64, R128, group/league (taking part).
const OWNER: Record<string, readonly number[]> = {
  national: [1000, 700, 500, 350, 250, 150, 100, 50, 50],
  zonal: [700, 490, 350, 245, 175, 105, 70, 35, 35],
  state: [500, 350, 250, 175, 125, 75, 50, 25, 25],
  open: [300, 210, 150, 105, 75, 45, 30, 15, 15],
  district: [200, 140, 100, 70, 50, 30, 20, 10, 10],
  corporate: [150, 105, 75, 53, 38, 23, 15, 8, 8],
  veterans: [150, 105, 75, 53, 38, 23, 15, 8, 8],
  other: [100, 70, 50, 35, 25, 15, 10, 5, 5],
};

describe('APPROVED_POINTS_TABLE_2026 (D-129)', () => {
  it('is a record the admin form and admin_set_ranking_points accept', () => {
    const record: PointsTableRecord = APPROVED_POINTS_TABLE_2026 as PointsTableRecord;
    expect(pointsTableProblems(record)).toEqual({});
    expect(Object.keys(APPROVED_POINTS_TABLE_2026).sort()).toEqual(['bestN', 'label', 'levels', 'windowDays']);
  });

  it('has the owner label, window and best N', () => {
    expect(APPROVED_POINTS_TABLE_2026.label).toBe('Power Smash local ranking 2026');
    expect(APPROVED_POINTS_TABLE_2026.windowDays).toBe(364);
    expect(APPROVED_POINTS_TABLE_2026.bestN).toBe(6);
  });

  it('matches the owner numbers cell by cell; group and league share the taking-part column', () => {
    expect(POINTS_TABLE_2026_COLUMNS).toEqual(FINISHES);
    expect(Object.keys(APPROVED_POINTS_TABLE_2026.levels).sort()).toEqual(Object.keys(OWNER).sort());
    for (const [level, numbers] of Object.entries(OWNER)) {
      const row = APPROVED_POINTS_TABLE_2026.levels[level] ?? {};
      expect(Object.keys(row), level).toEqual([...FINISHES]);
      const [w, f, sf, qf, r16, r32, r64, r128, taking] = numbers;
      expect(row, level).toEqual({ W: w, F: f, SF: sf, QF: qf, R16: r16, R32: r32, R64: r64, R128: r128, group: taking, league: taking });
    }
  });

  it('has no school_college row: those results are not counted', () => {
    expect(Object.prototype.hasOwnProperty.call(APPROVED_POINTS_TABLE_2026.levels, 'school_college')).toBe(false);
    const snap = localRanking(
      [{ entryId: 'fake-a', tournamentId: 'fake-t', level: 'school_college', finish: 'W', date: '2026-10-01' }],
      { label: APPROVED_POINTS_TABLE_2026.label, approved: true, levels: APPROVED_POINTS_TABLE_2026.levels },
      { asOf: '2026-10-31', windowDays: APPROVED_POINTS_TABLE_2026.windowDays, bestN: APPROVED_POINTS_TABLE_2026.bestN },
    );
    expect(snap.rows).toEqual([]);
    expect(snap.excluded.map((x) => x.reason)).toEqual(['unknown_level']);
  });

  it('is frozen', () => {
    expect(Object.isFrozen(APPROVED_POINTS_TABLE_2026)).toBe(true);
    expect(Object.isFrozen(APPROVED_POINTS_TABLE_2026.levels)).toBe(true);
    expect(Object.isFrozen(APPROVED_POINTS_TABLE_2026.levels['district'])).toBe(true);
  });
});
