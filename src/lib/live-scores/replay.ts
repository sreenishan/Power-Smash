// The rally log replayed by the scoring engine (src/lib/competition/scoring: startMatch, recordPoint, undo). The SAME rules as
// app.competition_live_replay in supabase/migrations/0021_live_scores.sql:
//   first_server  only before the first effective rally (it may be chosen again until then)
//   rally         a point to side A or B; refused once the match is won
//   undo          a compensating tap: the log never changes, the last effective rally is taken back (refused when there is none)
// Pure: no I/O, no clock. Used by the memory backend, the admin service (cues for the console) and the console's own preview.
import { recordPoint, startMatch, undo as engineUndo, type LiveResult, type LiveState, type Ruleset } from '../competition/scoring';
import type { GameScore, Side } from '../competition/types';
import type { ScoreEventKind } from './rules';

/** One row of public.match_score_events as the replay needs it. */
export interface ScoreEventRow {
  seq: number;
  kind: ScoreEventKind;
  side: Side | null;
  /** ISO instant; used for the last point time. */
  recordedAt?: string | null;
}

/** The replayed state in the shape app.competition_live_replay returns (camelCase jsonb). */
export interface LiveSnapshot {
  lastSeq: number;
  firstServer: Side | null;
  /** Effective rally winners in order, one character each ("ABBA"). */
  rallySides: string;
  rallies: number;
  gameNumber: number;
  pointsA: number;
  pointsB: number;
  gamesA: number;
  gamesB: number;
  games: GameScore[];
  server: Side | null;
  matchOver: boolean;
  winnerSide: Side | null;
  lastPointAt: string | null;
}

export type ReplayResult = { ok: true; state: LiveState; snapshot: LiveSnapshot } | { ok: false; seq: number; reasons: string[] };

/** One tap applied to a live state (the console's preview and the memory backend). */
export function applyTap(state: LiveState, kind: ScoreEventKind, side: Side | null): LiveResult {
  if (kind === 'first_server') {
    if (side !== 'A' && side !== 'B') return { ok: false, reasons: ['Say which side serves first.'] };
    if (state.rallies.length > 0) return { ok: false, reasons: ['The first server is chosen before the first rally.'] };
    return startMatch(state.ruleset, { firstServer: side });
  }
  if (kind === 'rally') {
    if (side !== 'A' && side !== 'B') return { ok: false, reasons: ['A point goes to side A or side B.'] };
    return recordPoint(state, side);
  }
  if (side !== null) return { ok: false, reasons: ['An undo names no side.'] };
  return engineUndo(state);
}

/** The snapshot of an engine state (pointsA/B = the current game; 0-0 once the match is over, like the SQL). */
export function snapshotOf(state: LiveState, lastSeq: number, lastPointAt: string | null): LiveSnapshot {
  return {
    lastSeq,
    firstServer: state.firstServer,
    rallySides: state.rallies.join(''),
    rallies: state.rallies.length,
    gameNumber: state.gameNumber,
    pointsA: state.current?.a ?? 0,
    pointsB: state.current?.b ?? 0,
    gamesA: state.gamesWon.a,
    gamesB: state.gamesWon.b,
    games: state.games.map((g) => ({ a: g.a, b: g.b })),
    server: state.server,
    matchOver: state.matchOver,
    winnerSide: state.winner,
    lastPointAt,
  };
}

/** Replays a rally log (any order in, sorted by seq). A log the rules refuse names the first bad tap. */
export function replayScoreEvents(events: readonly ScoreEventRow[], ruleset: Readonly<Ruleset>): ReplayResult {
  const start = startMatch(ruleset);
  if (!start.ok) return { ok: false, seq: 0, reasons: start.reasons };
  let state = start.state;
  let lastSeq = 0;
  let lastPointAt: string | null = null;
  for (const e of [...events].sort((x, y) => x.seq - y.seq)) {
    const next = applyTap(state, e.kind, e.side);
    if (!next.ok) return { ok: false, seq: e.seq, reasons: next.reasons };
    state = next.state;
    lastSeq = e.seq;
    if (e.kind !== 'first_server') lastPointAt = e.recordedAt ?? lastPointAt;
  }
  return { ok: true, state, snapshot: snapshotOf(state, lastSeq, lastPointAt) };
}

/**
 * The engine state behind a snapshot from the database (first server + effective rallies), so the console gets the engine's own
 * cues (interval, change of ends). Null when the snapshot cannot be replayed under this ruleset.
 */
export function stateFromSnapshot(snapshot: Pick<LiveSnapshot, 'firstServer' | 'rallySides'>, ruleset: Readonly<Ruleset>): LiveState | null {
  const start = startMatch(ruleset, snapshot.firstServer ? { firstServer: snapshot.firstServer } : {});
  if (!start.ok) return null;
  let state = start.state;
  for (const ch of snapshot.rallySides) {
    if (ch !== 'A' && ch !== 'B') return null;
    const next = recordPoint(state, ch);
    if (!next.ok) return null;
    state = next.state;
  }
  return state;
}

/** The plain-English cues for the scorer after the last tap (the engine's flags, the BWF Laws by default). */
export function cuesOf(state: LiveState, names: Readonly<{ A: string; B: string }> = { A: 'Side A', B: 'Side B' }): string[] {
  const out: string[] = [];
  if (state.matchOver && state.winner) {
    out.push(`Match over: ${names[state.winner]} wins ${state.gamesWon.a}-${state.gamesWon.b} in games. End the match to record the result.`);
    return out;
  }
  const lastGame = state.games[state.games.length - 1];
  if (state.gameJustEnded && lastGame) {
    const w: Side = lastGame.a > lastGame.b ? 'A' : 'B';
    out.push(`Game ${state.games.length} to ${names[w]}, ${lastGame.a}-${lastGame.b}. Interval between games: change ends.`);
  } else {
    if (state.interval && state.current) {
      const leader: Side = state.current.a > state.current.b ? 'A' : 'B';
      out.push(`Interval: ${names[leader]} reached ${state.ruleset.intervalAt}.`);
    }
    if (state.changeEnds) out.push('Change ends now (deciding game).');
  }
  if (state.server && state.serviceCourt) out.push(`${names[state.server]} to serve, from the ${state.serviceCourt} service court.`);
  else if (state.rallies.length === 0) out.push('Choose who serves first, or tap the first point.');
  return out;
}
