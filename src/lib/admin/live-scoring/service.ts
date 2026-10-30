// The live scoring admin actions (D-113). Shared by the memory store (tests, preview) and the Supabase store (Vercel function): both
// give it a LiveScoringBackend. The scoring engine runs here on the server too: the database's replayed state (app.competition_live_replay)
// is rebuilt with the engine (stateFromSnapshot) so the console gets the engine's own cues, and a disagreement is refused, never shown.
// Refusals come back as plain English in `errors.form`.
import { PROTECTED_LABEL } from '../../../components/competition/helpers';
import { cuesOf, replayScoreEvents, stateFromSnapshot, type LiveSnapshot } from '../../live-scores/replay';
import { failResult, okResult, type Actor, type AdminErrorCode, type StoreResult } from '../types';
import { matchLabel } from '../competition/service';
import {
  LiveScoringError,
  type LiveConsoleDto,
  type LiveMatchFacts,
  type LiveScoringAdminStore,
  type LiveScoringBackend,
  type LiveSidePlayer,
} from './types';

const PASS_THROUGH: readonly AdminErrorCode[] = ['INVALID', 'NOT_FOUND', 'STALE', 'FORBIDDEN', 'BACKEND_ERROR'];

/** Shown when the database's score and the engine disagree (it should never happen; the score is not shown half-understood). */
export const SCORE_MISMATCH = 'The score could not be read back. Reload the match before scoring again.';

function toFailure(e: unknown) {
  const code = (e as { code?: unknown })?.code;
  const detail = (e as { detail?: unknown })?.detail;
  if (e instanceof LiveScoringError || (typeof code === 'string' && (PASS_THROUGH as readonly string[]).includes(code))) {
    const c = code as AdminErrorCode;
    return typeof detail === 'string' && detail !== '' ? failResult(c, { form: detail }) : failResult(c);
  }
  return failResult('BACKEND_ERROR');
}

async function guard<T>(fn: () => Promise<StoreResult<T>>): Promise<StoreResult<T>> {
  try {
    return await fn();
  } catch (e) {
    return toFailure(e);
  }
}

const SCORABLE = new Set(['scheduled', 'ready', 'live', 'paused']);

/**
 * A side's name as this actor may see it. The owner sees names (D-109). Anyone else (scorers, later) sees a name only for a player the
 * owner has confirmed as an adult, in an event that is not junior; otherwise "Protected player" (fail closed).
 */
export function sideLabel(players: readonly LiveSidePlayer[] | null, junior: boolean, actor: Actor | null): string {
  if (!players || players.length === 0) return 'To be decided';
  const owner = actor?.role === 'owner';
  return players.map((p) => (owner || (!junior && p.ageStatus === 'adult_confirmed') ? p.displayName : PROTECTED_LABEL)).join(' / ');
}

function labelOf(f: LiveMatchFacts): string {
  return matchLabel({ category: f.category as never, ageGroup: f.ageGroup }, { roundCode: f.roundCode, matchNumber: f.matchNumber, groupLabel: f.groupLabel });
}

function consoleOf(f: LiveMatchFacts, snapshot: LiveSnapshot, actor: Actor | null): LiveConsoleDto {
  const sides = { A: sideLabel(f.sideA, f.junior, actor), B: sideLabel(f.sideB, f.junior, actor) };
  const state = stateFromSnapshot(snapshot, f.ruleset);
  if (!state) throw new LiveScoringError('BACKEND_ERROR', SCORE_MISMATCH);
  return {
    matchId: f.matchId,
    tournamentName: f.tournamentName,
    label: labelOf(f),
    courtLabel: f.courtLabel,
    status: f.status,
    revision: f.revision,
    ruleset: f.ruleset,
    sides,
    snapshot,
    cues: cuesOf(state, sides),
  };
}

/** The engine's state must give the database's numbers: games, current points, server, winner. */
export function snapshotAgrees(snapshot: LiveSnapshot, ruleset: LiveMatchFacts['ruleset']): boolean {
  const state = stateFromSnapshot(snapshot, ruleset);
  if (!state) return false;
  const games = JSON.stringify(state.games.map((g) => [g.a, g.b])) === JSON.stringify(snapshot.games.map((g) => [g.a, g.b]));
  return (
    games &&
    (state.current?.a ?? 0) === snapshot.pointsA &&
    (state.current?.b ?? 0) === snapshot.pointsB &&
    state.gamesWon.a === snapshot.gamesA &&
    state.gamesWon.b === snapshot.gamesB &&
    state.server === snapshot.server &&
    state.winner === snapshot.winnerSide &&
    state.gameNumber === snapshot.gameNumber
  );
}

export function createLiveScoringService(backend: LiveScoringBackend): LiveScoringAdminStore {
  const facts = async (matchId: string): Promise<LiveMatchFacts> => {
    const f = await backend.getMatchFacts(matchId);
    if (!f) throw new LiveScoringError('NOT_FOUND', 'Match not found.');
    return f;
  };
  const snapshotFromLog = async (f: LiveMatchFacts): Promise<LiveSnapshot> => {
    const r = replayScoreEvents(await backend.listScoreEvents(f.matchId), f.ruleset);
    if (!r.ok) throw new LiveScoringError('BACKEND_ERROR', SCORE_MISMATCH);
    return r.snapshot;
  };

  return {
    liveScoringMatches: (actor) =>
      guard(async () => {
        const list = (await backend.listScorableMatches()).filter((f) => !f.confirmed && SCORABLE.has(f.status) && f.sideA && f.sideB && f.drawPublished);
        // the live ones first, then by tournament and match
        const rank = (s: string) => (s === 'live' ? 0 : s === 'paused' ? 1 : 2);
        list.sort((x, y) => rank(x.status) - rank(y.status) || x.tournamentName.localeCompare(y.tournamentName) || labelOf(x).localeCompare(labelOf(y)));
        return okResult(
          list.map((f) => ({
            matchId: f.matchId,
            tournamentId: f.tournamentId,
            tournamentName: f.tournamentName,
            label: labelOf(f),
            sideA: sideLabel(f.sideA, f.junior, actor),
            sideB: sideLabel(f.sideB, f.junior, actor),
            status: f.status,
            courtLabel: f.courtLabel,
            scheduledAt: f.scheduledAt,
          })),
        );
      }),
    liveScoringMatch: (input, actor) =>
      guard(async () => {
        const f = await facts(input.matchId);
        return okResult(consoleOf(f, await snapshotFromLog(f), actor));
      }),
    liveScoringScore: (actor, input) =>
      guard(async () => {
        const f = await facts(input.matchId);
        const r = await backend.score(actor, input.matchId, { kind: input.kind, side: input.side, key: input.key, expectedSeq: input.expectedSeq });
        if (!snapshotAgrees(r.state, f.ruleset)) return failResult('BACKEND_ERROR', { form: SCORE_MISMATCH });
        return okResult({ duplicate: r.duplicate, seq: r.seq, status: r.status, revision: r.revision, snapshot: r.state });
      }),
    liveScoringStatus: (actor, input) =>
      guard(async () => {
        await backend.setStatus(
          actor,
          input.matchId,
          { action: input.action, endStatus: input.endStatus, retiringSide: input.retiringSide },
          input.expectedRevision,
          input.reason,
        );
        const f = await facts(input.matchId);
        return okResult(consoleOf(f, await snapshotFromLog(f), actor));
      }),
    liveScoringSettings: () => guard(async () => okResult(await backend.getSettings())),
    liveScoringSaveSettings: (actor, input) =>
      guard(async () => okResult(await backend.setSettings(actor, { public: input.public, windowSeconds: input.windowSeconds }, input.reason))),
  };
}
