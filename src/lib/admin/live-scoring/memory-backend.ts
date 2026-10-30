// In-memory LiveScoringBackend: tests and the no-backend admin preview. It applies the same rules as the 0021 RPCs (owner only, the
// tap key stored once, STALE on an old expected sequence or revision, rallies only while live, the result written from the rally log
// as an UNCONFIRMED result) over the competition memory state (src/lib/admin/competition/memory-backend.ts). FICTIONAL data only.
import type { CompPlayerRef, CompTournamentRef } from '../competition/types';
import type { MemoryCompetitionState } from '../competition/memory-backend';
import { checkResult } from '../competition/result';
import { validateGame } from '../../competition/scoring';
import { replayScoreEvents, type ScoreEventRow } from '../../live-scores/replay';
import { isIdempotencyKey, LIVE_WINDOW_SECONDS_DEFAULT, LIVE_WINDOW_SECONDS_MAX, LIVE_WINDOW_SECONDS_MIN } from '../../live-scores/rules';
import type { Actor } from '../types';
import { LiveScoringError, type LiveMatchFacts, type LiveScoringBackend, type LiveScoringSettings, type ScoreRpcResult } from './types';

export interface MemoryScoreEvent extends ScoreEventRow {
  matchId: string;
  key: string;
  recordedBy: string;
  recordedAt: string;
}

export interface MemoryLiveState {
  events: MemoryScoreEvent[];
  settings: LiveScoringSettings;
}

export function emptyLiveState(): MemoryLiveState {
  return { events: [], settings: { public: false, windowSeconds: LIVE_WINDOW_SECONDS_DEFAULT } };
}

export interface MemoryLiveDeps {
  competition: () => MemoryCompetitionState;
  live: () => MemoryLiveState;
  tournaments: () => CompTournamentRef[];
  players: () => CompPlayerRef[];
  audit: (actor: Actor, action: string, entity: string, entityId: string | null, reason: string | null) => void;
  markDirty: () => void;
  now: () => Date;
}

const invalid = (m: string): never => {
  throw new LiveScoringError('INVALID', m);
};
const ownerOnly = (a: Actor): void => {
  if (a.role !== 'owner') throw new LiveScoringError('FORBIDDEN');
};
const reasonOk = (r: string): void => {
  if (r.trim() === '') invalid('A change needs a reason.');
};

export function createMemoryLiveScoringBackend(d: MemoryLiveDeps): LiveScoringBackend {
  const comp = () => d.competition();
  const factsOf = (matchId: string): LiveMatchFacts | null => {
    const m = comp().matches.find((x) => x.id === matchId);
    if (!m) return null;
    const e = comp().events.find((x) => x.id === m.eventId);
    if (!e) return null;
    const t = d.tournaments().find((x) => x.id === e.tournamentId);
    const side = (entryId: string | null) => {
      if (!entryId) return null;
      const en = comp().entries.find((x) => x.id === entryId);
      if (!en) return null;
      return en.players.map((id) => {
        const p = d.players().find((x) => x.id === id);
        return { displayName: p?.displayName ?? 'Unknown player', ageStatus: p?.ageStatus ?? 'unknown' };
      });
    };
    return {
      matchId: m.id,
      eventId: e.id,
      tournamentId: e.tournamentId,
      tournamentName: t?.name ?? 'Tournament',
      category: e.category,
      ageGroup: e.ageGroup,
      junior: e.isJunior || t?.minorSignal !== false,
      roundCode: m.roundCode,
      matchNumber: m.matchNumber,
      groupLabel: m.groupLabel,
      courtLabel: comp().courts.find((c) => c.id === m.courtId)?.label ?? null,
      scheduledAt: m.scheduledAt,
      status: m.status,
      revision: m.revision,
      confirmed: m.confirmed,
      ruleset: structuredClone(e.ruleset),
      drawPublished: comp().draws.some((x) => x.eventId === e.id && x.status !== 'draft'),
      sideA: side(m.sideA),
      sideB: side(m.sideB),
    };
  };
  const eventsOf = (matchId: string) => d.live().events.filter((x) => x.matchId === matchId).sort((a, b) => a.seq - b.seq);
  const replay = (f: LiveMatchFacts) => {
    const r = replayScoreEvents(eventsOf(f.matchId), f.ruleset);
    if (!r.ok) throw new LiveScoringError('BACKEND_ERROR');
    return r;
  };
  const match = (id: string) => comp().matches.find((x) => x.id === id) ?? (() => { throw new LiveScoringError('NOT_FOUND', 'Match not found.'); })();
  const bothConfirmed = (m: { sideA: string | null; sideB: string | null }) =>
    [m.sideA, m.sideB].every((id) => comp().entries.some((en) => en.id === id && en.status === 'confirmed'));

  return {
    listScorableMatches: async () => comp().matches.map((m) => factsOf(m.id)).filter((f): f is LiveMatchFacts => f !== null),
    getMatchFacts: async (id) => factsOf(id),
    listScoreEvents: async (id) => eventsOf(id).map((e) => ({ seq: e.seq, kind: e.kind, side: e.side, recordedAt: e.recordedAt })),
    getSettings: async () => structuredClone(d.live().settings),

    score: async (actor, matchId, rec) => {
      ownerOnly(actor);
      if (!isIdempotencyKey(rec.key)) invalid('The tap key must be 8 to 80 letters, digits, - or _.');
      if ((rec.kind === 'undo') !== (rec.side === null)) invalid('A rally and the first server name a side; an undo does not.');
      const m = match(matchId);
      const f = factsOf(matchId) as LiveMatchFacts;
      const same = d.live().events.find((x) => x.matchId === matchId && x.key === rec.key);
      if (same) {
        if (same.kind !== rec.kind || same.side !== rec.side) invalid('This tap key was already used for a different tap.');
        return { matchId, duplicate: true, seq: same.seq, status: m.status, revision: m.revision, state: replay(f).snapshot } satisfies ScoreRpcResult;
      }
      if (m.confirmed) invalid('The result is confirmed; the score cannot change.');
      const last = eventsOf(matchId).at(-1)?.seq ?? 0;
      if (rec.expectedSeq !== last) throw new LiveScoringError('STALE', 'The score was changed on another device; reload it before scoring.');
      if (rec.kind !== 'first_server' && m.status !== 'live') invalid(m.status === 'paused' ? 'The match is paused; resume it first.' : 'Start the match before scoring.');
      if (rec.kind === 'first_server' && !['scheduled', 'ready', 'live'].includes(m.status)) invalid('The first server is chosen before or at the start of the match.');
      const before = replay(f).snapshot;
      if (rec.kind === 'rally' && before.matchOver) invalid('The match is over; end it to record the result.');
      if (rec.kind === 'undo' && before.rallies === 0) invalid('Nothing to undo; no points have been recorded.');
      if (rec.kind === 'first_server' && before.rallies > 0) invalid('The first server is chosen before the first rally.');
      d.live().events.push({ matchId, seq: last + 1, kind: rec.kind, side: rec.side, key: rec.key, recordedBy: actor.userId, recordedAt: d.now().toISOString() });
      if (rec.kind !== 'rally') d.audit(actor, `live_${rec.kind}`, 'competition_matches', matchId, null);
      return { matchId, duplicate: false, seq: last + 1, status: m.status, revision: m.revision, state: replay(f).snapshot };
    },

    setStatus: async (actor, matchId, rec, expected, reason) => {
      ownerOnly(actor);
      reasonOk(reason);
      if ((rec.action === 'end') !== (rec.endStatus !== null)) invalid('Only ending a match names how it ended.');
      if ((rec.endStatus === 'retired') !== (rec.retiringSide !== null)) invalid('Say which side retired, and only for a retirement.');
      const m = match(matchId);
      if (m.revision !== expected) throw new LiveScoringError('STALE', 'The match changed since the console was opened.');
      if (m.confirmed) invalid('The result is confirmed; the match cannot change.');
      const f = factsOf(matchId) as LiveMatchFacts;
      let next = m.status;
      let winner: 'A' | 'B' | null = null;
      if (rec.action === 'start') {
        if (m.status !== 'scheduled' && m.status !== 'ready') invalid(`Only a scheduled or ready match can start (this one is ${m.status}).`);
        if (!m.sideA || !m.sideB) invalid('Both sides must be known before the match starts.');
        if (!f.drawPublished) invalid('Publish the draw before scoring.');
        if (!bothConfirmed(m)) invalid('Both sides must be confirmed entries.');
        next = 'live';
      } else if (rec.action === 'pause') {
        if (m.status !== 'live') invalid('Only a live match can pause.');
        next = 'paused';
      } else if (rec.action === 'resume') {
        if (m.status !== 'paused') invalid('Only a paused match can resume.');
        next = 'live';
      } else {
        if (m.status !== 'live' && m.status !== 'paused') invalid('Only a live or paused match can end here.');
        if (!bothConfirmed(m)) invalid('Both sides must be confirmed entries (record a walkover on the Results screen).');
        const s = replay(f).snapshot;
        const games = s.games.map((g) => ({ ...g }));
        if (rec.endStatus === 'completed' && !s.matchOver) invalid(`The match is not over yet: nobody has won ${f.ruleset.gamesToWin} games.`);
        if (rec.endStatus !== 'completed' && s.pointsA + s.pointsB > 0) games.push({ a: s.pointsA, b: s.pointsB });
        const check = checkResult({ status: rec.endStatus as 'completed' | 'retired' | 'abandoned', games, walkoverWinner: null, retiringSide: rec.retiringSide }, f.ruleset);
        if (!check.ok) invalid(check.reasons[0] ?? 'The result is not possible.');
        winner = check.ok ? check.winner : null;
        comp().games = comp().games.filter((g) => g.matchId !== matchId);
        games.forEach((g, i) => {
          comp().games.push({ matchId, gameNumber: i + 1, a: g.a, b: g.b, finished: validateGame(g, f.ruleset).valid });
        });
        for (const dr of comp().draws) if (dr.eventId === m.eventId && dr.status === 'published') dr.status = 'locked';
        next = rec.endStatus as typeof next;
        m.winnerSide = winner;
      }
      m.status = next;
      m.revision += 1;
      d.audit(actor, `live_${rec.action}`, 'competition_matches', matchId, reason);
      if (rec.action === 'start' || rec.action === 'end') d.markDirty();
      return { id: matchId, status: next, winnerSide: winner, confirmed: false, revision: m.revision };
    },

    setSettings: async (actor, rec, reason) => {
      ownerOnly(actor);
      reasonOk(reason);
      if (!Number.isInteger(rec.windowSeconds) || rec.windowSeconds < LIVE_WINDOW_SECONDS_MIN || rec.windowSeconds > LIVE_WINDOW_SECONDS_MAX) {
        invalid(`The window must be ${LIVE_WINDOW_SECONDS_MIN} to ${LIVE_WINDOW_SECONDS_MAX} seconds.`);
      }
      d.live().settings = { public: rec.public === true, windowSeconds: rec.windowSeconds };
      d.audit(actor, 'set_live_scores', 'competition_settings', '1', reason);
      return structuredClone(d.live().settings);
    },
  };
}
