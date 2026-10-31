// LOCAL ranking calculator (Module 7, Phase A). PURE: no I/O, no clock (the "as of" date is injected), no randomness.
// Nothing here is published. This is a local points list worked out from results on this platform; it is NEVER an official BWF,
// BAI or state-association ranking and must never be called one (every snapshot carries that disclaimer).
//
// The formula (transparent and configurable; describeRankingFormula() says it in plain English):
// - Each result is one entry's finish in one tournament event: 'W' (won the final), 'F' (lost the final), 'SF', 'QF', 'R16' ...
//   'R128', 'group', 'league'. A third-place play-off is not a finish of its own: report the semifinal ('SF').
// - Points = pointsTable.levels[tournament level][finish]. A finish missing from the level's row scores 0 (and is listed as
//   such); an unknown level is excluded and reported. The DEFAULT table is an EXAMPLE ONLY and needs the owner's approval
//   (`approved: false`); the numbers are invented placeholders, not any federation's table.
// - Window: results dated from (asOf - windowDays + 1) to asOf inclusive count (default 364 days = 52 weeks, an assumption,
//   configurable). Results after asOf are ignored (not yet in the window), not errors.
// - Best N: only an entry's best `bestN` results in the window count (default 4, an assumption, configurable). Higher points
//   first; equal points: the more recent result first, then the tournament id. If an entry has two results for one tournament
//   (a data error), only the best is kept and the other is reported; "best" is fully ordered (points, date, then the further finish,
//   then the level and the players), so the kept result and the entry's players never depend on the input order.
// - Ties (documented rule, in order): more total points; then the better best counted result, then second best, and so on (a
//   missing result counts as 0 points, the same as a result worth 0); then the more recent latest counted result. Entries still
//   equal SHARE the position (1, 1, 3) and are listed by entry id.
// - The points table is REQUIRED (no default): the admin passes the owner-approved table (D-110). DEFAULT_POINTS_TABLE stays an
//   explicit export for tests and previews only.
// - Entries with 0 points are still listed (they played in the window) at the bottom by the same rules.
import { addDays, isIsoDate } from '../../dates';
import type { IsoDate } from '../types';

export type Finish = 'W' | 'F' | 'SF' | 'QF' | 'R16' | 'R32' | 'R64' | 'R128' | 'group' | 'league';
export const FINISHES: readonly Finish[] = ['W', 'F', 'SF', 'QF', 'R16', 'R32', 'R64', 'R128', 'group', 'league'];

/** One entry's finish in one tournament event. */
export interface RankingResult {
  /** A player id (singles) or a pair key (doubles); the caller decides how pairs are keyed. */
  entryId: string;
  /** Optional display ids of the players in the entry. */
  players?: readonly string[];
  tournamentId: string;
  /** Key into pointsTable.levels, for example 'district'. */
  level: string;
  finish: Finish;
  /** The date the result counts from (normally the tournament's last day), IST calendar date. */
  date: IsoDate;
}

export interface PointsTable {
  /** Shown with every snapshot. */
  label: string;
  /** False until the owner approves the table; snapshots repeat it. */
  approved: boolean;
  /** Points by level x finish; whole, non-negative numbers. */
  levels: Readonly<Record<string, Readonly<Partial<Record<Finish, number>>>>>;
}

/** EXAMPLE ONLY, needs the owner's approval. Invented numbers for testing the calculator; not any federation's table. */
export const DEFAULT_POINTS_TABLE: Readonly<PointsTable> = Object.freeze({
  label: "Example points table (example, needs the owner's approval)",
  approved: false,
  levels: Object.freeze({
    club: Object.freeze({ W: 100, F: 70, SF: 50, QF: 30, R16: 15, R32: 5 }),
    district: Object.freeze({ W: 200, F: 140, SF: 100, QF: 60, R16: 30, R32: 15, R64: 5 }),
    state: Object.freeze({ W: 400, F: 280, SF: 200, QF: 120, R16: 60, R32: 30, R64: 15, R128: 5 }),
  }),
});

export interface RankingOptions {
  /** The ranking date (injected; never "today" from a clock). */
  asOf: IsoDate;
  /** Rolling window length in days, inclusive of asOf (default 364). */
  windowDays?: number;
  /** Results counted per entry (default 4). */
  bestN?: number;
}

export const DEFAULT_WINDOW_DAYS = 364;
export const DEFAULT_BEST_N = 4;

export const RANKING_DISCLAIMER = 'Local ranking calculated from results on this platform. It is not an official BWF, BAI or state association ranking.';

export interface ScoredResult {
  tournamentId: string;
  level: string;
  finish: Finish;
  date: IsoDate;
  points: number;
}

export interface RankingRow {
  position: number;
  /** True when the position is shared with another entry. */
  tied: boolean;
  entryId: string;
  players: readonly string[];
  points: number;
  /** The best-N results that make up `points`, best first. */
  counted: ScoredResult[];
  /** Results in the window beyond best N (do not count), best first. */
  notCounted: ScoredResult[];
}

export type RankingExclusionReason = 'invalid_result' | 'unknown_level' | 'outside_window' | 'duplicate_tournament';

export interface RankingExclusion {
  result: RankingResult;
  reason: RankingExclusionReason;
}

export interface RankingSnapshot {
  asOf: IsoDate;
  windowStart: IsoDate;
  windowEnd: IsoDate;
  windowDays: number;
  bestN: number;
  tableLabel: string;
  tableApproved: boolean;
  disclaimer: string;
  formula: string;
  rows: RankingRow[];
  excluded: RankingExclusion[];
}

function checkPositiveInt(n: number, name: string): void {
  if (!Number.isInteger(n) || n < 1) throw new RangeError(`${name} must be a whole number of at least 1`);
}

function validateTable(table: PointsTable): void {
  if (typeof table.label !== 'string' || table.label.trim() === '') throw new RangeError('The points table needs a label');
  const levels = Object.keys(table.levels);
  if (levels.length === 0) throw new RangeError('The points table has no levels');
  for (const level of levels) {
    const row = table.levels[level] ?? {};
    for (const [finish, pts] of Object.entries(row)) {
      if (!(FINISHES as readonly string[]).includes(finish)) throw new RangeError(`Unknown finish "${finish}" in level "${level}"`);
      if (pts === undefined || !Number.isInteger(pts) || pts < 0) throw new RangeError(`Points for ${level} / ${finish} must be a whole number of 0 or more`);
    }
  }
}

/** Plain-English description of the ranking formula for a table and options (shown beside every preview). */
export function describeRankingFormula(table: PointsTable = DEFAULT_POINTS_TABLE, options: Omit<RankingOptions, 'asOf'> = {}): string {
  const windowDays = options.windowDays ?? DEFAULT_WINDOW_DAYS;
  const bestN = options.bestN ?? DEFAULT_BEST_N;
  const status = table.approved ? 'approved by the owner' : 'NOT yet approved by the owner (example only)';
  return [
    `Points come from the table "${table.label}" (${status}): each tournament level gives fixed points for how far a player or pair got (winner, runner-up, semifinal, quarterfinal and so on).`,
    `Only results from the last ${windowDays} days up to the ranking date count, and only each entry's best ${bestN} ${bestN === 1 ? 'result' : 'results'}.`,
    'Ties: more points first; then the better best result, then the second best, and so on (a missing result counts as 0 points); then the more recent latest result. Entries still equal share the position.',
    'Walkovers and match details do not change points: only the round reached counts.',
    RANKING_DISCLAIMER,
  ].join(' ');
}

/** The formula with the default table and options. */
export const RANKING_FORMULA_DESCRIPTION: string = describeRankingFormula();

const cmpText = (a: string, b: string): number => (a < b ? -1 : a > b ? 1 : 0);

/** Best first. A total order on everything a scored result holds, so no choice depends on the input order. */
function compareScored(x: ScoredResult, y: ScoredResult): number {
  if (x.points !== y.points) return y.points - x.points;
  if (x.date !== y.date) return x.date > y.date ? -1 : 1;
  return cmpText(x.tournamentId, y.tournamentId) || FINISHES.indexOf(x.finish) - FINISHES.indexOf(y.finish) || cmpText(x.level, y.level);
}

/** Two results of one entry for one tournament: the better one (compareScored, then the players list, so the choice is order-free). */
function compareSources(x: { scored: ScoredResult; source: RankingResult }, y: { scored: ScoredResult; source: RankingResult }): number {
  return compareScored(x.scored, y.scored) || cmpText(JSON.stringify(x.source.players ?? []), JSON.stringify(y.source.players ?? []));
}

/** Tie comparison (without the entry id): negative = x ranks higher, 0 = shared position. */
function compareRows(x: RankingRow, y: RankingRow): number {
  if (x.points !== y.points) return y.points - x.points;
  const n = Math.max(x.counted.length, y.counted.length);
  for (let i = 0; i < n; i += 1) {
    const px = x.counted[i]?.points ?? 0;
    const py = y.counted[i]?.points ?? 0;
    if (px !== py) return py - px;
  }
  const lx = latest(x.counted);
  const ly = latest(y.counted);
  if (lx !== ly) return lx > ly ? -1 : 1;
  return 0;
}

function latest(results: readonly ScoredResult[]): string {
  let best = '';
  for (const r of results) if (r.date > best) best = r.date;
  return best;
}

function validResult(r: RankingResult): boolean {
  const nonEmpty = (s: unknown): boolean => typeof s === 'string' && s.trim() !== '';
  return (
    nonEmpty(r.entryId) && nonEmpty(r.tournamentId) && nonEmpty(r.level) && isIsoDate(r.date) && (FINISHES as readonly string[]).includes(r.finish)
  );
}

/**
 * A local ranking snapshot: best-N results within the rolling window, points from the table, the documented tie rule.
 * Throws RangeError for a bad asOf date, bad options or a malformed points table.
 */
export function localRanking(results: readonly RankingResult[], pointsTable: PointsTable, options: RankingOptions): RankingSnapshot {
  if (!isIsoDate(options.asOf)) throw new RangeError('asOf must be a calendar date YYYY-MM-DD');
  const windowDays = options.windowDays ?? DEFAULT_WINDOW_DAYS;
  const bestN = options.bestN ?? DEFAULT_BEST_N;
  checkPositiveInt(windowDays, 'windowDays');
  checkPositiveInt(bestN, 'bestN');
  validateTable(pointsTable);

  const windowEnd = options.asOf;
  const windowStart = addDays(options.asOf, -(windowDays - 1));
  const excluded: RankingExclusion[] = [];
  // entry -> tournament -> best scored result (with its source)
  const perEntry = new Map<string, { byTournament: Map<string, { scored: ScoredResult; source: RankingResult }> }>();

  for (const r of results) {
    if (!validResult(r)) {
      excluded.push({ result: r, reason: 'invalid_result' });
      continue;
    }
    const row = pointsTable.levels[r.level];
    if (row === undefined || !Object.prototype.hasOwnProperty.call(pointsTable.levels, r.level)) {
      excluded.push({ result: r, reason: 'unknown_level' });
      continue;
    }
    if (r.date < windowStart || r.date > windowEnd) {
      excluded.push({ result: r, reason: 'outside_window' });
      continue;
    }
    const scored: ScoredResult = { tournamentId: r.tournamentId, level: r.level, finish: r.finish, date: r.date, points: row[r.finish] ?? 0 };
    const entry = perEntry.get(r.entryId) ?? { byTournament: new Map() };
    const existing = entry.byTournament.get(r.tournamentId);
    if (existing === undefined) entry.byTournament.set(r.tournamentId, { scored, source: r });
    else if (compareSources({ scored, source: r }, existing) < 0) {
      excluded.push({ result: existing.source, reason: 'duplicate_tournament' });
      entry.byTournament.set(r.tournamentId, { scored, source: r });
    } else excluded.push({ result: r, reason: 'duplicate_tournament' });
    perEntry.set(r.entryId, entry);
  }

  const rows: RankingRow[] = [];
  for (const [entryId, entry] of perEntry) {
    const kept = [...entry.byTournament.values()].sort(compareSources);
    const all = kept.map((v) => v.scored);
    const counted = all.slice(0, bestN);
    // The players shown: from the best kept result that names them (deterministic: `kept` is fully ordered).
    const players = kept.find((v) => (v.source.players?.length ?? 0) > 0)?.source.players ?? [];
    rows.push({
      position: 0,
      tied: false,
      entryId,
      players: [...players],
      points: counted.reduce((sum, s) => sum + s.points, 0),
      counted,
      notCounted: all.slice(bestN),
    });
  }
  rows.sort((x, y) => compareRows(x, y) || (x.entryId < y.entryId ? -1 : x.entryId > y.entryId ? 1 : 0));
  for (let i = 0; i < rows.length; i += 1) {
    const row = rows[i];
    if (row === undefined) continue;
    const prev = i > 0 ? rows[i - 1] : undefined;
    if (prev !== undefined && compareRows(prev, row) === 0) {
      row.position = prev.position;
      row.tied = true;
      prev.tied = true;
    } else row.position = i + 1;
  }

  return {
    asOf: options.asOf,
    windowStart,
    windowEnd,
    windowDays,
    bestN,
    tableLabel: pointsTable.label,
    tableApproved: pointsTable.approved,
    disclaimer: RANKING_DISCLAIMER,
    formula: describeRankingFormula(pointsTable, { windowDays, bestN }),
    rows,
    excluded,
  };
}

// ---------------------------------------------------------------------------------------------------------------------------
// Snapshot diff (admin preview)
// ---------------------------------------------------------------------------------------------------------------------------

export type Movement = 'new' | 'dropped' | 'up' | 'down' | 'same';

export interface RankingChange {
  entryId: string;
  movement: Movement;
  previousPosition: number | null;
  position: number | null;
  /** Positive = moved up (previousPosition - position); null for new or dropped entries. */
  positionChange: number | null;
  previousPoints: number | null;
  points: number | null;
  /** points - previousPoints, with a missing side read as 0. */
  pointsChange: number;
}

/** What changed between two snapshots: entries in the new snapshot in its order, then dropped entries by their old position. */
export function diffSnapshots(prev: RankingSnapshot, next: RankingSnapshot): RankingChange[] {
  const before = new Map(prev.rows.map((r) => [r.entryId, r] as const));
  const after = new Set(next.rows.map((r) => r.entryId));
  const changes: RankingChange[] = [];
  for (const row of next.rows) {
    const old = before.get(row.entryId);
    if (old === undefined) {
      changes.push({ entryId: row.entryId, movement: 'new', previousPosition: null, position: row.position, positionChange: null, previousPoints: null, points: row.points, pointsChange: row.points });
      continue;
    }
    const delta = old.position - row.position;
    changes.push({
      entryId: row.entryId,
      movement: delta > 0 ? 'up' : delta < 0 ? 'down' : 'same',
      previousPosition: old.position,
      position: row.position,
      positionChange: delta,
      previousPoints: old.points,
      points: row.points,
      pointsChange: row.points - old.points,
    });
  }
  for (const old of prev.rows) {
    if (after.has(old.entryId)) continue;
    changes.push({ entryId: old.entryId, movement: 'dropped', previousPosition: old.position, position: null, positionChange: null, previousPoints: old.points, points: null, pointsChange: -old.points });
  }
  return changes;
}
