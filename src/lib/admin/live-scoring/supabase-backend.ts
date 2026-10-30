// LiveScoringBackend over Supabase PostgREST (the Vercel admin function only; secret key, service_role). Reads select explicit columns
// from the private tables (never select *), paged at 1,000 rows; writes are only the 0021 RPCs, with the VERIFIED actor id as p_actor.
// Errors come from the store's `rpc`/`select` (a code, and for the database's own INVALID/STALE/NOT_FOUND sentences the sentence once
// the integrator adds LIVE_SCORING_RPCS to COMPETITION_DETAIL_RPCS in supabase-store.ts).
import type { AgeStatus } from '../../archive/types';
import type { Ruleset } from '../../competition/scoring';
import type { MatchStatus, RoundCode, Side } from '../../competition/types';
import type { LiveSnapshot } from '../../live-scores/replay';
import { LiveScoringError, type LiveMatchFacts, type LiveScoringBackend, type LiveScoringSettings, type ScoreRpcResult, type StatusRpcResult } from './types';

export interface SupabaseLiveScoringDeps {
  select: <T>(table: string, query: string) => Promise<T[]>;
  rpc: <T>(name: string, args: Record<string, unknown>) => Promise<T>;
}

/** The 0021 RPCs whose INVALID/STALE/NOT_FOUND sentences may reach the owner (add to COMPETITION_DETAIL_RPCS). */
export const LIVE_SCORING_RPCS = ['admin_live_score', 'admin_live_match_status', 'admin_set_live_scores'] as const;

export const LIVE_SCORING_COLUMNS = {
  competition_matches: 'id,event_id,round_code,match_number,group_label,side_a_entry,side_b_entry,scheduled_at,court_id,status,confirmed,revision',
  tournament_events: 'id,tournament_id,category,age_group,is_junior,ruleset',
  tournaments: 'id,name,level,is_minor_signal',
  draws: 'event_id,status',
  courts: 'id,label',
  event_entries: 'id,player1_id,player2_id,status',
  players: 'id,display_name,age_status',
  match_score_events: 'seq,kind,side,recorded_at',
  competition_settings: 'live_scores_public,live_window_seconds',
} as const;

const PAGE = 1000;
const CHUNK = 80;
const enc = encodeURIComponent;
const list = (ids: readonly string[]): string => `(${ids.map((x) => enc(x)).join(',')})`;

type MatchDb = {
  id: string; event_id: string; round_code: RoundCode; match_number: number; group_label: string | null; side_a_entry: string | null; side_b_entry: string | null;
  scheduled_at: string | null; court_id: string | null; status: MatchStatus; confirmed: boolean; revision: number;
};
type EventDb = { id: string; tournament_id: string; category: string; age_group: string | null; is_junior: boolean; ruleset: Ruleset };
type TournamentDb = { id: string; name: string; level: string | null; is_minor_signal: boolean | null };
type EntryDb = { id: string; player1_id: string; player2_id: string | null; status: string };
type PlayerDb = { id: string; display_name: string; age_status: AgeStatus };

const isInt = (v: unknown, min: number, max: number): v is number => typeof v === 'number' && Number.isInteger(v) && v >= min && v <= max;
const isSide = (v: unknown): v is Side | null => v === null || v === 'A' || v === 'B';

/** The replayed state an RPC returns, checked field by field (anything odd is a backend error, never shown). */
export function parseSnapshot(raw: unknown): LiveSnapshot {
  const s = raw as Record<string, unknown> | null;
  const bad = () => new LiveScoringError('BACKEND_ERROR');
  if (typeof s !== 'object' || s === null) throw bad();
  if (!isInt(s.lastSeq, 0, 1_000_000) || !isSide(s.firstServer) || typeof s.rallySides !== 'string' || !/^[AB]*$/.test(s.rallySides)) throw bad();
  if (!isInt(s.rallies, 0, 1_000_000) || s.rallies !== s.rallySides.length || !isInt(s.gameNumber, 1, 5)) throw bad();
  if (!isInt(s.pointsA, 0, 30) || !isInt(s.pointsB, 0, 30) || !isInt(s.gamesA, 0, 3) || !isInt(s.gamesB, 0, 3)) throw bad();
  if (!Array.isArray(s.games) || !s.games.every((g) => isInt((g as { a?: unknown })?.a, 0, 30) && isInt((g as { b?: unknown })?.b, 0, 30))) throw bad();
  if (!isSide(s.server) || typeof s.matchOver !== 'boolean' || !isSide(s.winnerSide)) throw bad();
  if (!(s.lastPointAt === null || (typeof s.lastPointAt === 'string' && !Number.isNaN(Date.parse(s.lastPointAt))))) throw bad();
  return {
    lastSeq: s.lastSeq,
    firstServer: s.firstServer,
    rallySides: s.rallySides,
    rallies: s.rallies,
    gameNumber: s.gameNumber,
    pointsA: s.pointsA,
    pointsB: s.pointsB,
    gamesA: s.gamesA,
    gamesB: s.gamesB,
    games: (s.games as { a: number; b: number }[]).map((g) => ({ a: g.a, b: g.b })),
    server: s.server,
    matchOver: s.matchOver,
    winnerSide: s.winnerSide,
    lastPointAt: s.lastPointAt as string | null,
  };
}

export function createSupabaseLiveScoringBackend(deps: SupabaseLiveScoringDeps): LiveScoringBackend {
  const { select, rpc } = deps;
  async function all<T>(table: string, query: string): Promise<T[]> {
    const out: T[] = [];
    for (let offset = 0; offset < 100 * PAGE; offset += PAGE) {
      const page = await select<T>(table, `${query}&limit=${PAGE}&offset=${offset}`);
      out.push(...page);
      if (page.length < PAGE) break;
    }
    return out;
  }
  async function byIds<T>(table: string, cols: string, column: string, ids: readonly (string | null)[]): Promise<T[]> {
    const unique = [...new Set(ids.filter((x): x is string => typeof x === 'string'))];
    const out: T[] = [];
    for (let i = 0; i < unique.length; i += CHUNK) out.push(...(await all<T>(table, `select=${cols}&${column}=in.${list(unique.slice(i, i + CHUNK))}&order=${column}.asc`)));
    return out;
  }

  async function factsFor(matches: MatchDb[]): Promise<LiveMatchFacts[]> {
    if (matches.length === 0) return [];
    const C = LIVE_SCORING_COLUMNS;
    const events = await byIds<EventDb>('tournament_events', C.tournament_events, 'id', matches.map((m) => m.event_id));
    const [tournaments, draws, courts, entries] = await Promise.all([
      byIds<TournamentDb>('tournaments', C.tournaments, 'id', events.map((e) => e.tournament_id)),
      byIds<{ event_id: string; status: string }>('draws', C.draws, 'event_id', events.map((e) => e.id)),
      byIds<{ id: string; label: string }>('courts', C.courts, 'id', matches.map((m) => m.court_id)),
      byIds<EntryDb>('event_entries', C.event_entries, 'id', matches.flatMap((m) => [m.side_a_entry, m.side_b_entry])),
    ]);
    const players = await byIds<PlayerDb>('players', C.players, 'id', entries.flatMap((e) => [e.player1_id, e.player2_id]));
    const side = (entryId: string | null) => {
      const en = entries.find((x) => x.id === entryId);
      if (!en) return null;
      return [en.player1_id, en.player2_id]
        .filter((x): x is string => typeof x === 'string')
        .map((id) => {
          const p = players.find((x) => x.id === id);
          // an unreadable player is shown the safe way: unknown age (protected for anyone but the owner)
          return { displayName: p?.display_name ?? 'Unknown player', ageStatus: p?.age_status ?? ('unknown' as AgeStatus) };
        });
    };
    const out: LiveMatchFacts[] = [];
    for (const m of matches) {
      const e = events.find((x) => x.id === m.event_id);
      if (!e) continue;
      const t = tournaments.find((x) => x.id === e.tournament_id);
      out.push({
        matchId: m.id,
        eventId: e.id,
        tournamentId: e.tournament_id,
        tournamentName: t?.name ?? 'Tournament',
        category: e.category,
        ageGroup: e.age_group,
        // fail closed: an unknown minor signal counts as one; a school_college level is junior (0018)
        junior: e.is_junior || t?.is_minor_signal !== false || t?.level === 'school_college',
        roundCode: m.round_code,
        matchNumber: m.match_number,
        groupLabel: m.group_label,
        courtLabel: courts.find((c) => c.id === m.court_id)?.label ?? null,
        scheduledAt: m.scheduled_at,
        status: m.status,
        revision: m.revision,
        confirmed: m.confirmed,
        ruleset: e.ruleset,
        drawPublished: draws.some((d) => d.event_id === e.id && (d.status === 'published' || d.status === 'locked')),
        sideA: side(m.side_a_entry),
        sideB: side(m.side_b_entry),
      });
    }
    return out;
  }

  return {
    listScorableMatches: async () =>
      factsFor(
        await all<MatchDb>(
          'competition_matches',
          `select=${LIVE_SCORING_COLUMNS.competition_matches}&status=in.(scheduled,ready,live,paused)&confirmed=is.false&side_a_entry=not.is.null&side_b_entry=not.is.null&order=id.asc`,
        ),
      ),
    getMatchFacts: async (id) => {
      const rows = await select<MatchDb>('competition_matches', `select=${LIVE_SCORING_COLUMNS.competition_matches}&id=eq.${enc(id)}&limit=1`);
      return (await factsFor(rows))[0] ?? null;
    },
    listScoreEvents: async (matchId) =>
      (await all<{ seq: number; kind: 'first_server' | 'rally' | 'undo'; side: Side | null; recorded_at: string }>(
        'match_score_events',
        `select=${LIVE_SCORING_COLUMNS.match_score_events}&match_id=eq.${enc(matchId)}&order=seq.asc`,
      )).map((e) => ({ seq: e.seq, kind: e.kind, side: e.side, recordedAt: e.recorded_at })),
    getSettings: async () => {
      const [r] = await select<{ live_scores_public: boolean; live_window_seconds: number }>('competition_settings', `select=${LIVE_SCORING_COLUMNS.competition_settings}&id=eq.1&limit=1`);
      // an unreadable row is read the safe way: off
      return { public: r?.live_scores_public === true, windowSeconds: isInt(r?.live_window_seconds, 60, 3600) ? r.live_window_seconds : 300 };
    },
    score: async (a, matchId, record) => {
      const r = await rpc<Record<string, unknown>>('admin_live_score', { p_actor: a.userId, p_match: matchId, p_record: record });
      if (!r || typeof r.duplicate !== 'boolean' || !isInt(r.seq, 1, 1_000_000) || typeof r.status !== 'string' || !isInt(r.revision, 1, 1_000_000_000)) {
        throw new LiveScoringError('BACKEND_ERROR');
      }
      return { matchId, duplicate: r.duplicate, seq: r.seq, status: r.status as MatchStatus, revision: r.revision, state: parseSnapshot(r.state) } satisfies ScoreRpcResult;
    },
    setStatus: async (a, matchId, record, expected, reason) =>
      rpc<StatusRpcResult>('admin_live_match_status', { p_actor: a.userId, p_match: matchId, p_record: record, p_expected_revision: expected, p_reason: reason }),
    setSettings: async (a, record, reason) => rpc<LiveScoringSettings>('admin_set_live_scores', { p_actor: a.userId, p_record: record, p_reason: reason }),
  };
}
