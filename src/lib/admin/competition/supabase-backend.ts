// CompetitionBackend over Supabase PostgREST (the Vercel admin function only; secret key, service_role). Reads select explicit columns
// from the private competition tables (never select *), paged at 1,000 rows; writes are only the owner RPCs of 0017 and 0018, with the
// VERIFIED actor id as p_actor (plus the three organizer RPCs of 0024: player search, a new provisional player, the naming preview). Errors come from the store's `rpc`/`select` (a code, and for the database's own INVALID/STALE/NOT_FOUND
// sentences the sentence, never a response body).
import type { Category } from '../../parser/types';
import type { AgeStatus } from '../../archive/types';
import type { Ruleset } from '../../competition/scoring';
import type { DrawStatus, EntryStatus, EventFormat, EventStatus } from '../../competition/db';
import type { MatchStatus, RoundCode, Side } from '../../competition/types';
import type {
  ApprovedPointsTable,
  CompDrawRow,
  CompEventRow,
  CompMatchRow,
  CompTournamentRef,
  CompetitionBackend,
} from './types';

export interface SupabaseCompetitionDeps {
  select: <T>(table: string, query: string) => Promise<T[]>;
  rpc: <T>(name: string, args: Record<string, unknown>) => Promise<T>;
}

const PAGE = 1000;
const CHUNK = 80;
const enc = encodeURIComponent;
const list = (ids: readonly string[]): string => `(${ids.map((x) => enc(x)).join(',')})`;

type TournamentDb = { id: string; name: string; level: string | null; start_date: string | null; end_date: string | null; is_minor_signal: boolean | null; status: string };
type EventDb = { id: string; tournament_id: string; category: Category; age_group: string | null; is_junior: boolean; format: EventFormat; ruleset: Ruleset; capacity: number | null; status: EventStatus };
type EntryDb = { id: string; event_id: string; player1_id: string; player2_id: string | null; seed: number | null; status: EntryStatus };
type DrawDb = { id: string; event_id: string; seed: number; status: DrawStatus; published_at: string | null };
type SlotDb = { position: number; entry_id: string | null; group_label: string | null };
type MatchDb = {
  id: string; event_id: string; round_code: RoundCode; match_number: number; group_label: string | null; side_a_entry: string | null; side_b_entry: string | null;
  scheduled_at: string | null; court_id: string | null; status: MatchStatus; winner_side: Side | null; confirmed: boolean; revision: number;
};
type SnapshotDb = { id: string; label: string; category: Category | null; age_group: string | null; as_of: string; published: boolean; published_at: string | null; created_at: string; ranking_entries: { count: number }[] | null };
type GameDb = { match_id: string; game_number: number; points_a: number; points_b: number; finished: boolean };

export const COMPETITION_COLUMNS = {
  tournaments: 'id,name,level,start_date,end_date,is_minor_signal,status',
  tournament_events: 'id,tournament_id,category,age_group,is_junior,format,ruleset,capacity,status',
  event_entries: 'id,event_id,player1_id,player2_id,seed,status',
  draws: 'id,event_id,seed,status,published_at',
  draw_slots: 'position,entry_id,group_label',
  competition_matches: 'id,event_id,round_code,match_number,group_label,side_a_entry,side_b_entry,scheduled_at,court_id,status,winner_side,confirmed,revision',
  match_games: 'match_id,game_number,points_a,points_b,finished',
  courts: 'id,tournament_id,venue_id,label,sort',
  venues: 'id,name,city',
  players: 'id,display_name,age_status,academy',
  ranking_snapshots: 'id,label,category,age_group,as_of,published,published_at,created_at,ranking_entries(count)',
  ranking_entries: 'player_id,rank,points,events_counted',
  competition_settings: 'rankings_public,registration_enabled,ranking_points_table,ranking_points_approved_at',
} as const;

// A school_college LEVEL is a minor signal too (nothing in the database sets is_minor_signal from the level); same rule as
// app.competition_public_events (0018) and the memory store. Fail closed: an unknown flag counts as a signal.
const tournamentOf = (r: TournamentDb): CompTournamentRef => ({ id: r.id, name: r.name, level: r.level, startDate: r.start_date, endDate: r.end_date, minorSignal: r.is_minor_signal !== false || r.level === 'school_college', status: r.status });
const snapshotOf = (s: SnapshotDb) => ({ id: s.id, label: s.label, category: s.category, ageGroup: s.age_group, asOf: s.as_of, published: s.published, publishedAt: s.published_at, createdAt: s.created_at, rows: s.ranking_entries?.[0]?.count ?? 0 });
const eventOf = (r: EventDb): CompEventRow => ({ id: r.id, tournamentId: r.tournament_id, category: r.category, ageGroup: r.age_group, isJunior: r.is_junior, format: r.format, ruleset: r.ruleset, capacity: r.capacity, status: r.status });
const matchOf = (r: MatchDb): CompMatchRow => ({
  id: r.id, eventId: r.event_id, roundCode: r.round_code, matchNumber: r.match_number, groupLabel: r.group_label, sideA: r.side_a_entry, sideB: r.side_b_entry,
  scheduledAt: r.scheduled_at, courtId: r.court_id, status: r.status, winnerSide: r.winner_side, confirmed: r.confirmed, revision: r.revision,
});

export function createSupabaseCompetitionBackend(deps: SupabaseCompetitionDeps): CompetitionBackend {
  const { select, rpc } = deps;
  /** Every row of a query, 1,000 at a time (the API's row cap). */
  async function all<T>(table: string, query: string): Promise<T[]> {
    const out: T[] = [];
    for (let offset = 0; offset < 100 * PAGE; offset += PAGE) {
      const page = await select<T>(table, `${query}&limit=${PAGE}&offset=${offset}`);
      out.push(...page);
      if (page.length < PAGE) break;
    }
    return out;
  }
  /** `filter` is a PostgREST filter on a list of ids, run in chunks so the address stays short. */
  async function byIds<T>(table: string, cols: string, column: string, ids: readonly string[], order: string): Promise<T[]> {
    const unique = [...new Set(ids)];
    const out: T[] = [];
    for (let i = 0; i < unique.length; i += CHUNK) out.push(...(await all<T>(table, `select=${cols}&${column}=in.${list(unique.slice(i, i + CHUNK))}&order=${order}`)));
    return out;
  }
  const slotsOf = async (drawId: string) =>
    (await all<SlotDb>('draw_slots', `select=${COMPETITION_COLUMNS.draw_slots}&draw_id=eq.${enc(drawId)}&order=position.asc`)).map((s) => ({ position: s.position, entryId: s.entry_id, group: s.group_label }));

  return {
    listTournaments: async () =>
      (await all<TournamentDb>('tournaments', `select=${COMPETITION_COLUMNS.tournaments}&status=not.in.(rejected)&order=start_date.desc.nullslast,created_at.desc,id.asc`)).map(tournamentOf),
    getTournament: async (id) => {
      const [r] = await select<TournamentDb>('tournaments', `select=${COMPETITION_COLUMNS.tournaments}&id=eq.${enc(id)}&limit=1`);
      return r ? tournamentOf(r) : null;
    },
    listEvents: async (f) => {
      const cols = COMPETITION_COLUMNS.tournament_events;
      if (f.ids) return (await byIds<EventDb>('tournament_events', cols, 'id', f.ids, 'created_at.asc')).map(eventOf);
      if (f.tournamentIds) return (await byIds<EventDb>('tournament_events', cols, 'tournament_id', f.tournamentIds, 'created_at.asc')).map(eventOf);
      return (await all<EventDb>('tournament_events', `select=${cols}&order=created_at.asc`)).map(eventOf);
    },
    listEntries: async (eventIds) =>
      (await byIds<EntryDb>('event_entries', COMPETITION_COLUMNS.event_entries, 'event_id', eventIds, 'created_at.asc')).map((r) => ({
        id: r.id, eventId: r.event_id, players: r.player2_id ? [r.player1_id, r.player2_id] : [r.player1_id], seed: r.seed, status: r.status,
      })),
    getDraw: async (eventId) => {
      const [r] = await select<DrawDb>('draws', `select=${COMPETITION_COLUMNS.draws}&event_id=eq.${enc(eventId)}&limit=1`);
      if (!r) return null;
      return { id: r.id, eventId: r.event_id, seed: r.seed, status: r.status, publishedAt: r.published_at, slots: await slotsOf(r.id) } satisfies CompDrawRow;
    },
    listDraws: async (eventIds) =>
      (await byIds<DrawDb>('draws', COMPETITION_COLUMNS.draws, 'event_id', eventIds, 'created_at.asc')).map((r) => ({ id: r.id, eventId: r.event_id, seed: r.seed, status: r.status, publishedAt: r.published_at })),
    listMatches: async (eventIds) => (await byIds<MatchDb>('competition_matches', COMPETITION_COLUMNS.competition_matches, 'event_id', eventIds, 'match_number.asc')).map(matchOf),
    getMatch: async (id) => {
      const [r] = await select<MatchDb>('competition_matches', `select=${COMPETITION_COLUMNS.competition_matches}&id=eq.${enc(id)}&limit=1`);
      return r ? matchOf(r) : null;
    },
    listGames: async (matchIds) =>
      (await byIds<GameDb>('match_games', COMPETITION_COLUMNS.match_games, 'match_id', matchIds, 'game_number.asc')).map((g) => ({ matchId: g.match_id, gameNumber: g.game_number, a: g.points_a, b: g.points_b, finished: g.finished })),
    listCourts: async (tournamentId) =>
      (await all<{ id: string; tournament_id: string; venue_id: string | null; label: string; sort: number }>('courts', `select=${COMPETITION_COLUMNS.courts}&tournament_id=eq.${enc(tournamentId)}&order=sort.asc,label.asc`)).map((c) => ({
        id: c.id, tournamentId: c.tournament_id, venueId: c.venue_id, label: c.label, sort: c.sort,
      })),
    listVenues: async () => await all<{ id: string; name: string; city: string | null }>('venues', `select=${COMPETITION_COLUMNS.venues}&order=name.asc`),
    getPlayers: async (ids) =>
      (await byIds<{ id: string; display_name: string; age_status: AgeStatus; academy: string | null }>('players', COMPETITION_COLUMNS.players, 'id', ids, 'id.asc')).map((p) => ({
        id: p.id, displayName: p.display_name, ageStatus: p.age_status, academy: p.academy,
      })),
    listSnapshots: async () => (await all<SnapshotDb>('ranking_snapshots', `select=${COMPETITION_COLUMNS.ranking_snapshots}&order=created_at.desc,id.asc`)).map(snapshotOf),
    getSnapshot: async (id) => {
      const [r] = await select<SnapshotDb>('ranking_snapshots', `select=${COMPETITION_COLUMNS.ranking_snapshots}&id=eq.${enc(id)}&limit=1`);
      return r ? snapshotOf(r) : null;
    },
    // the competition naming rule (app.competition_named_players, 0018) lives in SQL; an owner RPC answers it for a list of players.
    // No verified actor = nobody is named (fail closed; the RPC would refuse anyway).
    rankablePlayerIds: async (a, ids) => {
      const unique = [...new Set(ids)];
      if (unique.length === 0 || a === null) return [];
      const out = await rpc<string[] | null>('admin_competition_rankable_players', { p_actor: a.userId, p_players: unique });
      return Array.isArray(out) ? out.filter((x): x is string => typeof x === 'string') : [];
    },
    getSnapshotEntries: async (id) =>
      (await all<{ player_id: string; rank: number; points: number; events_counted: number }>('ranking_entries', `select=${COMPETITION_COLUMNS.ranking_entries}&snapshot_id=eq.${enc(id)}&order=rank.asc`)).map((r) => ({
        playerId: r.player_id, rank: r.rank, points: r.points, eventsCounted: r.events_counted,
      })),
    getSettings: async () => {
      const [r] = await select<{ rankings_public: boolean; registration_enabled: boolean; ranking_points_table: Omit<ApprovedPointsTable, 'approvedAt'> | null; ranking_points_approved_at: string | null }>(
        'competition_settings',
        `select=${COMPETITION_COLUMNS.competition_settings}&id=eq.1&limit=1`,
      );
      // an unreadable row is read the safe way: nothing public, no table approved
      if (!r) return { rankingsPublic: false, registrationEnabled: false, pointsTable: null };
      const t = r.ranking_points_table;
      return {
        rankingsPublic: r.rankings_public === true,
        registrationEnabled: r.registration_enabled === true,
        pointsTable: t && r.ranking_points_approved_at ? { label: t.label, levels: t.levels, windowDays: t.windowDays, bestN: t.bestN, approvedAt: r.ranking_points_approved_at } : null,
      };
    },

    // organizer paths (0024): each RPC checks 'run' access to the tournament first; the search returns only id and display name
    searchPlayersForTournament: async (a, tournamentId, query, limit, offset) => {
      const out = await rpc<{ items?: unknown; hasMore?: unknown } | null>('admin_competition_search_players', { p_actor: a.userId, p_tournament: tournamentId, p_query: query, p_limit: limit, p_offset: offset });
      const items = Array.isArray(out?.items) ? out.items : [];
      return {
        items: items
          .filter((x): x is { id: string; displayName: string } => !!x && typeof (x as { id?: unknown }).id === 'string' && typeof (x as { displayName?: unknown }).displayName === 'string')
          .map((x) => ({ id: x.id, displayName: x.displayName })),
        hasMore: out?.hasMore === true,
      };
    },
    createProvisionalPlayer: async (a, tournamentId, record, reason) => {
      const out = await rpc<{ id: string; displayName: string }>('admin_competition_create_player', { p_actor: a.userId, p_tournament: tournamentId, p_record: record, p_reason: reason });
      return { id: out.id, displayName: out.displayName, named: false };
    },
    eventNamedPlayerIds: async (a, eventId) => {
      const out = await rpc<{ playerId?: unknown; named?: unknown }[] | null>('admin_competition_event_naming', { p_actor: a.userId, p_event: eventId });
      return Array.isArray(out) ? out.filter((x) => x && x.named === true && typeof x.playerId === 'string').map((x) => x.playerId as string) : [];
    },

    saveEvent: (a, id, record, reason) => rpc('admin_save_event', { p_actor: a.userId, p_id: id, p_record: record, p_reason: reason }),
    addEntry: (a, eventId, record, reason) => rpc('admin_add_entry', { p_actor: a.userId, p_event: eventId, p_record: record, p_reason: reason }),
    withdrawEntry: (a, entryId, reason) => rpc('admin_withdraw_entry', { p_actor: a.userId, p_entry: entryId, p_reason: reason }),
    setEntry: (a, entryId, record, reason) => rpc('admin_set_entry', { p_actor: a.userId, p_entry: entryId, p_record: record, p_reason: reason }),
    saveDraw: (a, eventId, record, reason) => rpc('admin_save_draw', { p_actor: a.userId, p_event: eventId, p_record: record, p_reason: reason }),
    publishDraw: (a, drawId, reason) => rpc('admin_publish_draw', { p_actor: a.userId, p_draw: drawId, p_reason: reason }),
    saveMatch: (a, id, record, expected, reason) => rpc('admin_save_match', { p_actor: a.userId, p_id: id, p_record: record, p_expected_revision: expected, p_reason: reason }),
    recordResult: (a, matchId, record, expected, reason) => rpc('admin_record_result', { p_actor: a.userId, p_match: matchId, p_record: record, p_expected_revision: expected, p_reason: reason }),
    confirmResult: (a, matchId, expected, reason) => rpc('admin_confirm_result', { p_actor: a.userId, p_match: matchId, p_expected_revision: expected, p_reason: reason }),
    saveRankingSnapshot: (a, record, reason) => rpc('admin_save_ranking_snapshot', { p_actor: a.userId, p_record: record, p_reason: reason }),
    publishRankingSnapshot: (a, id, reason) => rpc('admin_publish_ranking_snapshot', { p_actor: a.userId, p_snapshot: id, p_reason: reason }),
    saveVenue: (a, id, record, reason) => rpc('admin_save_venue', { p_actor: a.userId, p_id: id, p_record: record, p_reason: reason }),
    saveCourt: (a, id, record, reason) => rpc('admin_save_court', { p_actor: a.userId, p_id: id, p_record: record, p_reason: reason }),
    setPointsTable: (a, record, reason) => rpc('admin_set_ranking_points', { p_actor: a.userId, p_record: record, p_reason: reason }),
  };
}
