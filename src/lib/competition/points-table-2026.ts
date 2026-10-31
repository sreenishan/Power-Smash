// The local ranking points table the owner approved on 2026-10-31 (D-129, "use it as is"; the table D-110 asked for). These are the
// owner's numbers, cell by cell; nothing here is invented. It is the record the admin form sends to admin_set_ranking_points (0018):
// {label, levels: {<tournament level>: {<finish>: points}}, windowDays, bestN}. Saving it in the LIVE admin (Competitions -> Rankings)
// is the formal approval and is audited; supabase/demo/points-table-2026-dev.sql installs the same table on the DEVELOPMENT project
// for the private preview only.
//
// - Finishes: W (winner), F (lost the final), SF, QF, R16, R32, R64, R128, and group / league (taking part: both get the same points).
// - school_college has NO row on purpose: those results are not counted (and every school or college event is junior anyway).
// - A local Power Smash ranking, never an official BWF, BAI or state association ranking.
import type { Finish } from './stats/ranking';

export interface ApprovedPointsTableRecord {
  readonly label: string;
  readonly levels: Readonly<Record<string, Readonly<Partial<Record<Finish, number>>>>>;
  readonly windowDays: number;
  readonly bestN: number;
}

/** The finishes in the order of the owner's table (group and league share the last column). */
export const POINTS_TABLE_2026_COLUMNS: readonly Finish[] = ['W', 'F', 'SF', 'QF', 'R16', 'R32', 'R64', 'R128', 'group', 'league'];

/** One level's row from the owner's nine numbers: W, F, SF, QF, R16, R32, R64, R128, group/league. */
function row(w: number, f: number, sf: number, qf: number, r16: number, r32: number, r64: number, r128: number, taking: number): Readonly<Partial<Record<Finish, number>>> {
  return Object.freeze({ W: w, F: f, SF: sf, QF: qf, R16: r16, R32: r32, R64: r64, R128: r128, group: taking, league: taking });
}

export const APPROVED_POINTS_TABLE_2026: ApprovedPointsTableRecord = Object.freeze({
  label: 'Power Smash local ranking 2026',
  levels: Object.freeze({
    national: row(1000, 700, 500, 350, 250, 150, 100, 50, 50),
    zonal: row(700, 490, 350, 245, 175, 105, 70, 35, 35),
    state: row(500, 350, 250, 175, 125, 75, 50, 25, 25),
    open: row(300, 210, 150, 105, 75, 45, 30, 15, 15),
    district: row(200, 140, 100, 70, 50, 30, 20, 10, 10),
    corporate: row(150, 105, 75, 53, 38, 23, 15, 8, 8),
    veterans: row(150, 105, 75, 53, 38, 23, 15, 8, 8),
    other: row(100, 70, 50, 35, 25, 15, 10, 5, 5),
  }),
  windowDays: 364,
  bestN: 6,
});
