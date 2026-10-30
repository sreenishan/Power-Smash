// The competition actions over Supabase (mock fetch, no network): which RPC is called with which arguments, the verified actor as
// p_actor, explicit columns on every read, and errors: the database's own INVALID sentences reach the owner, nothing else does.
import { describe, expect, it } from 'vitest';
import { competitionDetail, createSupabaseAdminStore } from '../../src/lib/admin/supabase-store';
import { COMPETITION_COLUMNS, createSupabaseCompetitionBackend } from '../../src/lib/admin/competition/supabase-backend';
import { CONFIRMED_BUT_NOT_ADVANCED, createCompetitionService } from '../../src/lib/admin/competition/service';

const URL_OK = 'https://fakeref.supabase.co';
const SECRET = ['sb', 'secret', 'FAKE'].join('_');
const ACTOR = { userId: '9a000000-0000-4000-8000-000000000001', role: 'owner' as const };
const T1 = '20000000-0000-4000-8000-000000000001';
const EV = '81000000-0000-4000-8000-000000000001';
const M1 = '85000000-0000-4000-8000-000000000001';
const E1 = '82000000-0000-4000-8000-000000000001';
const E2 = '82000000-0000-4000-8000-000000000002';
const P1 = '80000000-0000-4000-8000-000000000001';
const P2 = '80000000-0000-4000-8000-000000000002';
const RULES = { gamesToWin: 2, pointsToWin: 21, winBy: 2, pointCap: 30, intervalAt: 11, changeEndsInDecidingGameAt: 11 };

type Call = { url: string; method: string; body: any; headers: Record<string, string> };

function fake(tables: Record<string, unknown[]>, rpc: Record<string, unknown> = {}, fail?: { rpc: string; status: number; message: string }) {
  const calls: Call[] = [];
  const f = (async (url: string, init: RequestInit) => {
    const u = new URL(url);
    calls.push({ url, method: init.method ?? 'GET', body: init.body ? JSON.parse(init.body as string) : undefined, headers: init.headers as Record<string, string> });
    const name = u.pathname.split('/').pop()!;
    if (u.pathname.includes('/rpc/')) {
      if (fail && fail.rpc === name) return new Response(JSON.stringify({ message: fail.message, details: 'Key (phone)=(910000000000)' }), { status: fail.status });
      return new Response(JSON.stringify(rpc[name] ?? {}), { status: 200 });
    }
    return new Response(JSON.stringify(tables[name] ?? []), { status: 200 });
  }) as unknown as typeof fetch;
  return { calls, store: createSupabaseAdminStore({ url: URL_OK, secretKey: SECRET, fetch: f, now: () => new Date('2026-10-22T10:00:00.000Z') }) };
}
const rpcCalls = (calls: Call[]) => calls.filter((c) => c.url.includes('/rpc/'));
const reads = (calls: Call[]) => calls.filter((c) => !c.url.includes('/rpc/'));

const eventRow = { id: EV, tournament_id: T1, category: 'MS', age_group: null, is_junior: false, format: 'knockout', ruleset: RULES, capacity: 8, status: 'open' };
const matchRow = { id: M1, event_id: EV, round_code: 'F', match_number: 1, group_label: null, side_a_entry: E1, side_b_entry: E2, scheduled_at: null, court_id: null, status: 'scheduled', winner_side: null, confirmed: false, revision: 3 };

describe('competition over Supabase: request shapes', () => {
  it('a result is checked by the scoring engine first: an impossible score never reaches the RPC', async () => {
    const { calls, store } = fake({ competition_matches: [matchRow], tournament_events: [eventRow] });
    const r = await store.competitionRecordResult(ACTOR, { matchId: M1, expectedRevision: 3, status: 'completed', games: [{ a: 21, b: 20 }, { a: 21, b: 5 }], walkoverWinner: null, retiringSide: null, reason: 'demo' });
    expect(r).toMatchObject({ ok: false, code: 'INVALID' });
    expect(rpcCalls(calls)).toHaveLength(0);
  });
  it('a good result calls admin_record_result with the actor, the whole record and the expected revision', async () => {
    const { calls, store } = fake({ competition_matches: [matchRow], tournament_events: [eventRow] }, { admin_record_result: { id: M1, status: 'completed', winnerSide: 'A', confirmed: false, revision: 4 } });
    const r = await store.competitionRecordResult(ACTOR, { matchId: M1, expectedRevision: 3, status: 'completed', games: [{ a: 21, b: 15 }, { a: 21, b: 18 }], walkoverWinner: null, retiringSide: null, reason: 'demo result' });
    expect(r).toEqual({ ok: true, data: { id: M1, status: 'completed', winnerSide: 'A', confirmed: false, revision: 4 } });
    const [call] = rpcCalls(calls);
    expect(call!.url).toBe(`${URL_OK}/rest/v1/rpc/admin_record_result`);
    expect(call!.headers.apikey).toBe(SECRET);
    expect(call!.body).toEqual({ p_actor: ACTOR.userId, p_match: M1, p_record: { status: 'completed', games: [{ a: 21, b: 15 }, { a: 21, b: 18 }], walkoverWinner: null, retiringSide: null }, p_expected_revision: 3, p_reason: 'demo result' });
  });
  it('an old revision is STALE before any write', async () => {
    const { calls, store } = fake({ competition_matches: [matchRow], tournament_events: [eventRow] });
    const r = await store.competitionRecordResult(ACTOR, { matchId: M1, expectedRevision: 2, status: 'walkover', games: [], walkoverWinner: 'A', retiringSide: null, reason: 'demo' });
    expect(r).toMatchObject({ ok: false, code: 'STALE' });
    expect(rpcCalls(calls)).toHaveLength(0);
  });
  it('an entry goes to admin_add_entry; the event is full: the database sentence reaches the owner, the details never do', async () => {
    const { calls, store } = fake({ tournament_events: [eventRow] }, {}, { rpc: 'admin_add_entry', status: 400, message: 'INVALID: the event is full (capacity 8); waitlist the entry instead' });
    const r = await store.competitionAddEntry(ACTOR, { eventId: EV, players: [P1], seed: null, status: 'confirmed', reason: 'demo' });
    expect(r).toEqual({ ok: false, code: 'INVALID', errors: { form: 'The event is full (capacity 8); waitlist the entry instead' } });
    expect(JSON.stringify(r)).not.toContain('910000000000');
    expect(rpcCalls(calls)[0]!.body).toEqual({ p_actor: ACTOR.userId, p_event: EV, p_record: { players: [P1], seed: null, status: 'confirmed' }, p_reason: 'demo' });
  });
  it('other database errors carry no sentence; a non-competition RPC never passes one through', async () => {
    const a = fake({ tournament_events: [eventRow] }, {}, { rpc: 'admin_add_entry', status: 400, message: 'duplicate key value violates unique constraint "x"' });
    expect(await a.store.competitionAddEntry(ACTOR, { eventId: EV, players: [P1], seed: null, status: 'confirmed', reason: 'demo' })).toEqual({ ok: false, code: 'BACKEND_ERROR' });
    expect(competitionDetail('rpc/admin_set_setting', 'INVALID: something')).toBeUndefined();
    expect(competitionDetail('rpc/admin_save_draw', 'INVALID: a draw has 2 to 1024 slots')).toBe('A draw has 2 to 1024 slots');
    expect(competitionDetail('rpc/admin_save_draw', 'new row violates check constraint')).toBeUndefined();
    expect(competitionDetail('players', 'INVALID: x')).toBeUndefined();
  });
  it('generating a draw reads confirmed entries, runs the engine and stores slots with the seed through admin_save_draw', async () => {
    const { calls, store } = fake(
      {
        tournament_events: [eventRow],
        draws: [],
        event_entries: [
          { id: E1, event_id: EV, player1_id: P1, player2_id: null, seed: 1, status: 'confirmed' },
          { id: E2, event_id: EV, player1_id: P2, player2_id: null, seed: null, status: 'confirmed' },
        ],
        players: [
          { id: P1, display_name: 'Demo One', age_status: 'adult_confirmed', academy: null },
          { id: P2, display_name: 'Demo Two', age_status: 'unknown', academy: null },
        ],
      },
      { admin_save_draw: { id: '86000000-0000-4000-8000-000000000001', status: 'draft', slots: 2 } },
    );
    const r = await store.competitionGenerateDraw(ACTOR, { eventId: EV, seed: 11, separateClubs: false, seeds: 1, reason: 'demo' });
    expect(r.ok).toBe(true);
    const [call] = rpcCalls(calls);
    expect(call!.url).toContain('/rpc/admin_save_draw');
    expect(call!.body).toEqual({ p_actor: ACTOR.userId, p_event: EV, p_record: { seed: 11, slots: [{ position: 1, entryId: E1, group: null }, { position: 2, entryId: E2, group: null }] }, p_reason: 'demo' });
  });
  it('confirming a result calls admin_confirm_result with the revision', async () => {
    const decided = { ...matchRow, status: 'completed', winner_side: 'A', revision: 4 };
    const { calls, store } = fake({ competition_matches: [decided], tournament_events: [eventRow], draws: [] }, { admin_confirm_result: { id: M1, confirmed: true, revision: 5 } });
    const r = await store.competitionConfirmResult(ACTOR, { matchId: M1, expectedRevision: 4, reason: 'demo' });
    expect(r).toMatchObject({ ok: true, data: { id: M1, confirmed: true, revision: 5, created: 0, updated: 0 } });
    expect(rpcCalls(calls)[0]!.body).toEqual({ p_actor: ACTOR.userId, p_match: M1, p_expected_revision: 4, p_reason: 'demo' });
  });
  it('the 0018 writes: set entry, venue, court, points table', async () => {
    const { calls, store } = fake({ tournaments: [{ id: T1, name: 'Demo Open Cup', level: null, start_date: null, end_date: null, is_minor_signal: false, status: 'pending' }] }, { admin_set_ranking_points: { approvedAt: '2026-10-22T10:00:00Z' } });
    await store.competitionSetEntry(ACTOR, { entryId: E1, status: 'confirmed', seed: 2, reason: 'demo' });
    await store.competitionSaveVenue(ACTOR, { id: null, name: ' Demo Hall ', city: '', reason: 'demo' });
    await store.competitionSaveCourt(ACTOR, { id: null, tournamentId: T1, venueId: null, label: 'Court 1', sort: 1, reason: 'demo' });
    const pts = await store.competitionApprovePointsTable(ACTOR, { label: 'Demo table', levels: { district: { W: 100 } }, windowDays: 364, bestN: 4, reason: 'demo' });
    expect(pts).toEqual({ ok: true, data: { approvedAt: '2026-10-22T10:00:00Z' } });
    expect(rpcCalls(calls).map((c) => [c.url.split('/rpc/')[1], c.body.p_record])).toEqual([
      ['admin_set_entry', { status: 'confirmed', seed: 2 }],
      ['admin_save_venue', { name: 'Demo Hall', city: null }],
      ['admin_save_court', { tournamentId: T1, venueId: null, label: 'Court 1', sort: 1 }],
      ['admin_set_ranking_points', { label: 'Demo table', levels: { district: { W: 100 } }, windowDays: 364, bestN: 4 }],
    ]);
    expect(rpcCalls(calls).every((c) => c.body.p_actor === ACTOR.userId)).toBe(true);
  });
  it('no points table approved: the ranking is refused without writing anything', async () => {
    const { calls, store } = fake({ competition_settings: [{ rankings_public: false, registration_enabled: false, ranking_points_table: null, ranking_points_approved_at: null }] });
    const r = await store.competitionComputeRanking(ACTOR, { label: 'Demo ranking', category: 'MS', ageGroup: null, asOf: '2026-10-22', reason: 'demo' });
    expect(r).toMatchObject({ ok: false, code: 'INVALID', errors: { form: expect.stringMatching(/No ranking points table/) } });
    expect(rpcCalls(calls)).toHaveLength(0);
  });
  it('every read names its columns (never select=*), is paged, and never reads a contact column', async () => {
    const { calls, store } = fake({ tournament_events: [eventRow], tournaments: [{ id: T1, name: 'Demo Open Cup', level: null, start_date: null, end_date: null, is_minor_signal: false, status: 'pending' }] });
    await store.competitionTournaments();
    await store.competitionEvent({ eventId: EV });
    await store.competitionRankings();
    await store.competitionSettings();
    for (const c of reads(calls)) {
      expect(c.method).toBe('GET');
      expect(c.url).toMatch(/select=[a-z_]/);
      expect(c.url).not.toMatch(/select=\*|phone|email|contact/);
      expect(c.url).toMatch(/limit=\d+/);
    }
    for (const cols of Object.values(COMPETITION_COLUMNS)) expect(cols).not.toMatch(/\*|phone|email/);
  });
});

describe('competition over Supabase: paging, direct reads, who may be ranked, a failed advance after a confirm', () => {
  const tRow = (i: number) => ({ id: `20000000-0000-4000-8000-${String(i).padStart(12, '0')}`, name: `Demo Cup ${i}`, level: 'district', start_date: '2026-01-01', end_date: null, is_minor_signal: false, status: 'published' });
  it('reads every tournament and every ranking, 1,000 rows at a time (no silent cut at 200 or 100)', async () => {
    const queries: string[] = [];
    const b = createSupabaseCompetitionBackend({
      select: async <T,>(table: string, query: string) => {
        queries.push(`${table}?${query}`);
        const offset = Number(/offset=(\d+)/.exec(query)?.[1] ?? 0);
        const size = offset === 0 ? 1000 : 7;
        if (table === 'tournaments') return Array.from({ length: size }, (_, i) => tRow(offset + i + 1)) as T[];
        if (table === 'ranking_snapshots') return Array.from({ length: size }, (_, i) => ({ id: `s${offset + i}`, label: 'Demo', category: null, age_group: null, as_of: '2026-10-01', published: false, published_at: null, created_at: '2026-10-01T00:00:00Z', ranking_entries: [{ count: 2 }] })) as T[];
        return [];
      },
      rpc: async () => ({}) as never,
    });
    expect(await b.listTournaments()).toHaveLength(1007);
    expect(await b.listSnapshots()).toHaveLength(1007);
    expect(queries.filter((q) => q.startsWith('tournaments?'))).toEqual([
      expect.stringContaining('limit=1000&offset=0'),
      expect.stringContaining('limit=1000&offset=1000'),
    ]);
    expect(queries.join(' ')).not.toMatch(/limit=(200|100)\b/);
  });
  it('opens one ranking by its id, however old', async () => {
    const queries: string[] = [];
    const b = createSupabaseCompetitionBackend({
      select: async <T,>(table: string, query: string) => {
        queries.push(`${table}?${query}`);
        return [{ id: 'old-one', label: 'Demo', category: 'MS', age_group: null, as_of: '2025-01-01', published: true, published_at: null, created_at: '2025-01-01T00:00:00Z', ranking_entries: [{ count: 4 }] }] as T[];
      },
      rpc: async () => ({}) as never,
    });
    expect(await b.getSnapshot('old-one')).toMatchObject({ id: 'old-one', rows: 4 });
    expect(queries).toEqual([`ranking_snapshots?select=${COMPETITION_COLUMNS.ranking_snapshots}&id=eq.old-one&limit=1`]);
  });
  it('without a verified actor nobody is named and the database is not asked (fail closed)', async () => {
    const calls: string[] = [];
    const b = createSupabaseCompetitionBackend({ select: async () => [], rpc: async <T,>(name: string) => (calls.push(name), [P1] as T) });
    expect(await b.rankablePlayerIds(null, [P1, P2])).toEqual([]);
    expect(calls).toEqual([]);
  });
  it('asks the database who may be ranked (the app.competition_named_players rule) with the verified actor', async () => {
    const calls: [string, Record<string, unknown>][] = [];
    const b = createSupabaseCompetitionBackend({
      select: async () => [],
      rpc: async <T,>(name: string, args: Record<string, unknown>) => {
        calls.push([name, args]);
        return [P1, 42] as T;
      },
    });
    expect(await b.rankablePlayerIds(ACTOR, [P1, P2, P1])).toEqual([P1]);
    expect(calls).toEqual([['admin_competition_rankable_players', { p_actor: ACTOR.userId, p_players: [P1, P2] }]]);
    expect(await b.rankablePlayerIds(ACTOR, [])).toEqual([]);
    expect(calls).toHaveLength(1);
  });
  it('the event screen marks entries by the database naming rule with the verified actor, not by age alone', async () => {
    const tables = {
      tournament_events: [eventRow],
      tournaments: [{ id: T1, name: 'Demo Open Cup', level: 'district', start_date: null, end_date: null, is_minor_signal: false, status: 'published' }],
      event_entries: [{ id: E1, event_id: EV, player1_id: P1, player2_id: null, seed: null, status: 'confirmed' }, { id: E2, event_id: EV, player1_id: P2, player2_id: null, seed: null, status: 'confirmed' }],
      players: [{ id: P1, display_name: 'Demo Player One', age_status: 'adult_confirmed', academy: null }, { id: P2, display_name: 'Demo Player Two', age_status: 'adult_confirmed', academy: null }],
    };
    const { calls, store } = fake(tables, { admin_competition_rankable_players: [P1] });
    const r = await store.competitionEvent({ eventId: EV }, ACTOR);
    if (!r.ok) throw new Error(r.code);
    expect(r.data.entries.map((e) => [e.id, e.isProtected])).toEqual([[E1, false], [E2, true]]);
    expect(rpcCalls(calls).map((c) => c.body)).toEqual([{ p_actor: ACTOR.userId, p_players: [P1, P2] }]);
    // a school_college tournament (flag false) makes every entry protected
    const school = fake({ ...tables, tournaments: [{ ...tables.tournaments[0]!, level: 'school_college' }] }, { admin_competition_rankable_players: [P1, P2] });
    const r2 = await school.store.competitionEvent({ eventId: EV }, ACTOR);
    if (!r2.ok) throw new Error(r2.code);
    expect(r2.data.event.isJunior).toBe(true);
    expect(r2.data.entries.every((e) => e.isProtected)).toBe(true);
  });
  it('a confirmed result stays reported as confirmed when moving the winner on fails; the owner is told to press Update matches', async () => {
    const decided = { ...matchRow, status: 'completed', winner_side: 'A', revision: 4 };
    const rpcs: string[] = [];
    const service = createCompetitionService(
      createSupabaseCompetitionBackend({
        select: async <T,>(table: string) => {
          if (table === 'competition_matches') return [decided] as T[];
          if (table === 'tournament_events') return [eventRow] as T[];
          if (table === 'draws') return [{ id: 'd1', event_id: EV, seed: 1, status: 'locked', published_at: '2026-10-20T00:00:00Z' }] as T[];
          if (table === 'draw_slots') return [{ position: 1, entry_id: E1, group_label: null }, { position: 2, entry_id: E2, group_label: null }] as T[];
          if (table === 'event_entries') throw new Error('network down');
          return [];
        },
        rpc: async <T,>(name: string) => {
          rpcs.push(name);
          return { id: M1, confirmed: true, revision: 5 } as T;
        },
      }),
    );
    const r = await service.competitionConfirmResult(ACTOR, { matchId: M1, expectedRevision: 4, reason: 'demo' });
    expect(r).toEqual({ ok: true, data: { id: M1, confirmed: true, revision: 5, created: 0, updated: 0, advanced: [], problems: [CONFIRMED_BUT_NOT_ADVANCED] } });
    expect(rpcs).toEqual(['admin_confirm_result']);
  });
  it('the minor signal is read fail closed: anything but false counts as junior', async () => {
    const b = createSupabaseCompetitionBackend({ select: async <T,>() => [{ ...tRow(1), is_minor_signal: null }] as T[], rpc: async () => ({}) as never });
    expect((await b.getTournament('x'))?.minorSignal).toBe(true);
  });
  it('a school_college level is a minor signal even when the flag is false (same as the memory store and 0018)', async () => {
    const at = (row: object) => createSupabaseCompetitionBackend({ select: async <T,>() => [row] as T[], rpc: async () => ({}) as never });
    expect((await at({ ...tRow(1), is_minor_signal: false, level: 'school_college' }).getTournament('x'))?.minorSignal).toBe(true);
    expect((await at({ ...tRow(1), is_minor_signal: false, level: 'district' }).getTournament('x'))?.minorSignal).toBe(false);
  });
});
