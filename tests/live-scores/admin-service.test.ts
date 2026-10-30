// The live scoring admin actions (D-113) over the memory backend (the same rules as the 0021 RPCs) and the Supabase backend with a
// mocked select/rpc. Fictional tournament, players and ids only.
import { describe, expect, it, vi } from 'vitest';
import { DEFAULT_RULESET } from '../../src/lib/competition/scoring';
import { emptyCompetitionState, type MemoryCompetitionState } from '../../src/lib/admin/competition/memory-backend';
import type { CompPlayerRef, CompTournamentRef } from '../../src/lib/admin/competition/types';
import { createMemoryLiveScoringBackend, emptyLiveState, type MemoryLiveState } from '../../src/lib/admin/live-scoring/memory-backend';
import { createLiveScoringService, SCORE_MISMATCH, sideLabel, snapshotAgrees } from '../../src/lib/admin/live-scoring/service';
import { createSupabaseLiveScoringBackend, LIVE_SCORING_COLUMNS, LIVE_SCORING_RPCS, parseSnapshot } from '../../src/lib/admin/live-scoring/supabase-backend';
import { LIVE_SCORING_ACCESS, LIVE_SCORING_SCHEMAS, liveScoreSchema, liveStatusSchema, saveLiveSettingsSchema } from '../../src/lib/admin/live-scoring/schemas';
import { LIVE_SCORING_STORE_METHODS, type LiveScoringAdminStore, type LiveTapDto } from '../../src/lib/admin/live-scoring/types';
import type { Actor, StoreResult } from '../../src/lib/admin/types';
import { replayScoreEvents } from '../../src/lib/live-scores/replay';

const OWNER: Actor = { userId: '9c000000-0000-4000-8000-000000000001', role: 'owner' };
const EDITOR: Actor = { userId: '9c000000-0000-4000-8000-000000000002', role: 'editor' };
const T1 = '9d000000-0000-4000-8000-000000000001';
const EV = '9e000000-0000-4000-8000-000000000001';
const M1 = '9f000000-0000-4000-8000-000000000001';
const M2 = '9f000000-0000-4000-8000-000000000002';
const P = { arun: 'a0000000-0000-4000-8000-000000000001', bala: 'a0000000-0000-4000-8000-000000000002', kid: 'a0000000-0000-4000-8000-000000000003' };
const NOW = new Date('2026-11-07T05:00:00.000Z');

function ok<T>(r: StoreResult<T>): T {
  if (!r.ok) throw new Error(`expected ok, got ${r.code} ${JSON.stringify(r.errors ?? {})}`);
  return r.data;
}

function setup(opts: { drawPublished?: boolean } = {}) {
  const comp: MemoryCompetitionState = emptyCompetitionState();
  comp.events.push({ id: EV, tournamentId: T1, category: 'MS', ageGroup: null, isJunior: false, format: 'knockout', ruleset: { ...DEFAULT_RULESET }, capacity: 4, status: 'open' });
  comp.entries.push(
    { id: 'e1000000-0000-4000-8000-000000000001', eventId: EV, players: [P.arun], seed: null, status: 'confirmed' },
    { id: 'e1000000-0000-4000-8000-000000000002', eventId: EV, players: [P.bala], seed: null, status: 'confirmed' },
    { id: 'e1000000-0000-4000-8000-000000000003', eventId: EV, players: [P.kid], seed: null, status: 'confirmed' },
  );
  comp.draws.push({ id: 'd1000000-0000-4000-8000-000000000001', eventId: EV, seed: 7, status: opts.drawPublished === false ? 'draft' : 'published', publishedAt: '2026-11-01T00:00:00.000Z', slots: [] });
  const base = { eventId: EV, roundCode: 'SF' as const, groupLabel: null, scheduledAt: null, courtId: null, status: 'scheduled' as const, winnerSide: null, confirmed: false, revision: 1 };
  comp.matches.push({ ...base, id: M1, matchNumber: 1, sideA: 'e1000000-0000-4000-8000-000000000001', sideB: 'e1000000-0000-4000-8000-000000000002' });
  comp.matches.push({ ...base, id: M2, matchNumber: 2, sideA: 'e1000000-0000-4000-8000-000000000003', sideB: null });
  const live: MemoryLiveState = emptyLiveState();
  const players: CompPlayerRef[] = [
    { id: P.arun, displayName: 'Demo Arun', ageStatus: 'adult_confirmed', academy: null },
    { id: P.bala, displayName: 'Demo Bala', ageStatus: 'adult_confirmed', academy: null },
    { id: P.kid, displayName: 'Demo Kid', ageStatus: 'unknown', academy: null },
  ];
  const tournaments: CompTournamentRef[] = [{ id: T1, name: 'Demo Open Cup', level: 'district', startDate: '2026-11-07', endDate: null, minorSignal: false, status: 'published' }];
  const audit: { action: string; reason: string | null }[] = [];
  let dirty = 0;
  const backend = createMemoryLiveScoringBackend({
    competition: () => comp,
    live: () => live,
    tournaments: () => tournaments,
    players: () => players,
    audit: (_a, action, _e, _id, reason) => audit.push({ action, reason }),
    markDirty: () => {
      dirty += 1;
    },
    now: () => NOW,
  });
  const api = createLiveScoringService(backend);
  let n = 0;
  const key = () => `fake-key-${String(++n).padStart(4, '0')}`;
  const tap = async (kind: 'rally' | 'undo' | 'first_server', side: 'A' | 'B' | null, k = key()): Promise<StoreResult<LiveTapDto>> => {
    const seq = live.events.filter((e) => e.matchId === M1).length;
    return api.liveScoringScore(OWNER, { matchId: M1, kind, side, key: k, expectedSeq: seq });
  };
  const start = async (matchId = M1) => {
    const rev = comp.matches.find((m) => m.id === matchId)!.revision;
    return api.liveScoringStatus(OWNER, { matchId, action: 'start', endStatus: null, retiringSide: null, expectedRevision: rev, reason: 'test' });
  };
  return { comp, live, api, tap, start, audit, dirty: () => dirty, tournaments };
}

describe('the match list', () => {
  it('lists only matches that can be scored: both sides known, draw published, not confirmed', async () => {
    const s = setup();
    const list = ok(await s.api.liveScoringMatches(OWNER));
    expect(list.map((m) => m.matchId)).toEqual([M1]);
    expect(list[0]).toMatchObject({ tournamentName: 'Demo Open Cup', label: 'MS SF match 1', sideA: 'Demo Arun', sideB: 'Demo Bala', status: 'scheduled' });
    expect(ok(await setup({ drawPublished: false }).api.liveScoringMatches(OWNER))).toEqual([]);
  });
});

describe('scoring', () => {
  it('start, rallies, idempotent retry, STALE, undo, cues', async () => {
    const s = setup();
    expect((await s.tap('rally', 'A')).ok).toBe(false); // not started
    const c = ok(await s.start());
    expect(c.status).toBe('live');
    expect(c.cues).toEqual(['Choose who serves first, or tap the first point.']);
    const a = ok(await s.tap('rally', 'A', 'fake-key-same'));
    expect(a).toMatchObject({ duplicate: false, seq: 1, status: 'live' });
    expect(a.snapshot.pointsA).toBe(1);
    const again = ok(await s.api.liveScoringScore(OWNER, { matchId: M1, kind: 'rally', side: 'A', key: 'fake-key-same', expectedSeq: 0 }));
    expect(again).toMatchObject({ duplicate: true, seq: 1 });
    expect(s.live.events).toHaveLength(1);
    const reused = await s.api.liveScoringScore(OWNER, { matchId: M1, kind: 'rally', side: 'B', key: 'fake-key-same', expectedSeq: 1 });
    expect(reused.ok || reused.code).toBe('INVALID');
    const stale = await s.api.liveScoringScore(OWNER, { matchId: M1, kind: 'rally', side: 'B', key: 'fake-key-stale', expectedSeq: 0 });
    expect(stale.ok || stale.code).toBe('STALE');
    expect(!stale.ok && stale.errors?.form).toMatch(/another device/);
    const u = ok(await s.tap('undo', null));
    expect(u.snapshot).toMatchObject({ pointsA: 0, rallies: 0, lastSeq: 2 });
    const none = await s.tap('undo', null);
    expect(!none.ok && none.errors?.form).toBe('Nothing to undo; no points have been recorded.');
    for (let i = 0; i < 11; i += 1) await s.tap('rally', 'A');
    const view = ok(await s.api.liveScoringMatch({ matchId: M1 }, OWNER));
    expect(view.cues[0]).toBe('Interval: Demo Arun reached 11.');
    expect(s.audit.map((x) => x.action)).toEqual(['live_start', 'live_undo']);
  });

  it('an editor is refused; a paused match takes no rally', async () => {
    const s = setup();
    ok(await s.start());
    const r = await s.api.liveScoringScore(EDITOR, { matchId: M1, kind: 'rally', side: 'A', key: 'fake-key-edit', expectedSeq: 0 });
    expect(r.ok || r.code).toBe('FORBIDDEN');
    const rev = s.comp.matches[0]!.revision;
    ok(await s.api.liveScoringStatus(OWNER, { matchId: M1, action: 'pause', endStatus: null, retiringSide: null, expectedRevision: rev, reason: 'test' }));
    const p = await s.tap('rally', 'A');
    expect(!p.ok && p.errors?.form).toBe('The match is paused; resume it first.');
    const old = await s.api.liveScoringStatus(OWNER, { matchId: M1, action: 'resume', endStatus: null, retiringSide: null, expectedRevision: rev, reason: 'test' });
    expect(old.ok || old.code).toBe('STALE');
  });

  it('ending: completed only when won; the result is written unconfirmed from the log and the draw locks', async () => {
    const s = setup();
    ok(await s.start());
    for (let i = 0; i < 21; i += 1) await s.tap('rally', 'A');
    const end = (status: 'completed' | 'retired' | 'abandoned', side: 'A' | 'B' | null) =>
      s.api.liveScoringStatus(OWNER, { matchId: M1, action: 'end', endStatus: status, retiringSide: side, expectedRevision: s.comp.matches[0]!.revision, reason: 'test' });
    const early = await end('completed', null);
    expect(!early.ok && early.errors?.form).toMatch(/not over yet/);
    for (let i = 0; i < 21; i += 1) await s.tap('rally', 'A');
    const extra = await s.tap('rally', 'B');
    expect(!extra.ok && extra.errors?.form).toMatch(/match is over/);
    const done = ok(await end('completed', null));
    expect(done.status).toBe('completed');
    const m = s.comp.matches[0]!;
    expect(m).toMatchObject({ status: 'completed', winnerSide: 'A', confirmed: false });
    expect(s.comp.games.filter((g) => g.matchId === M1).map((g) => [g.a, g.b, g.finished])).toEqual([[21, 0, true], [21, 0, true]]);
    expect(s.comp.draws[0]!.status).toBe('locked');
    expect(s.dirty()).toBe(2);
  });

  it('a retirement mid-game keeps the unfinished game; an abandoned match has no winner', async () => {
    const s = setup();
    ok(await s.start());
    for (const side of ['A', 'A', 'B'] as const) await s.tap('rally', side);
    const r = ok(await s.api.liveScoringStatus(OWNER, { matchId: M1, action: 'end', endStatus: 'retired', retiringSide: 'A', expectedRevision: s.comp.matches[0]!.revision, reason: 'test' }));
    expect(r.status).toBe('retired');
    expect(s.comp.matches[0]!.winnerSide).toBe('B');
    expect(s.comp.games.map((g) => [g.a, g.b, g.finished])).toEqual([[2, 1, false]]);
    const s2 = setup();
    ok(await s2.start());
    ok(await s2.api.liveScoringStatus(OWNER, { matchId: M1, action: 'end', endStatus: 'abandoned', retiringSide: null, expectedRevision: s2.comp.matches[0]!.revision, reason: 'test' }));
    expect(s2.comp.matches[0]).toMatchObject({ status: 'abandoned', winnerSide: null });
  });

  it('a match with an unknown side cannot start', async () => {
    const s = setup();
    const r = await s.start(M2);
    expect(!r.ok && r.errors?.form).toMatch(/Both sides must be known/);
  });
});

describe('names', () => {
  it('the owner sees names; anyone else sees a name only for a confirmed adult in an adult event', () => {
    const players = [{ displayName: 'Demo Arun', ageStatus: 'adult_confirmed' as const }, { displayName: 'Demo Kid', ageStatus: 'unknown' as const }];
    expect(sideLabel(players, false, OWNER)).toBe('Demo Arun / Demo Kid');
    expect(sideLabel(players, false, EDITOR)).toBe('Demo Arun / Protected player');
    expect(sideLabel(players, true, EDITOR)).toBe('Protected player / Protected player');
    expect(sideLabel(players, true, null)).toBe('Protected player / Protected player');
    expect(sideLabel(null, false, OWNER)).toBe('To be decided');
  });
  it('a junior tournament (minor signal) protects every name for non-owners', async () => {
    const s = setup();
    s.tournaments[0]!.minorSignal = true;
    const c = ok(await s.api.liveScoringMatch({ matchId: M1 }, EDITOR));
    expect(c.sides).toEqual({ A: 'Protected player', B: 'Protected player' });
  });
});

describe('settings', () => {
  it('owner only, 60 to 3600 seconds, off by default', async () => {
    const s = setup();
    expect(ok(await s.api.liveScoringSettings())).toEqual({ public: false, windowSeconds: 300 });
    expect((await s.api.liveScoringSaveSettings(EDITOR, { public: true, windowSeconds: 300, reason: 'test' })).ok).toBe(false);
    expect((await s.api.liveScoringSaveSettings(OWNER, { public: true, windowSeconds: 30, reason: 'test' })).ok).toBe(false);
    expect(ok(await s.api.liveScoringSaveSettings(OWNER, { public: true, windowSeconds: 600, reason: 'test' }))).toEqual({ public: true, windowSeconds: 600 });
  });
});

describe('the engine cross-check', () => {
  it('snapshotAgrees refuses a database answer the engine cannot rebuild', () => {
    const r = replayScoreEvents([{ seq: 1, kind: 'rally', side: 'A' }], DEFAULT_RULESET);
    if (!r.ok) throw new Error('replay');
    expect(snapshotAgrees(r.snapshot, DEFAULT_RULESET)).toBe(true);
    expect(snapshotAgrees({ ...r.snapshot, pointsA: 2 }, DEFAULT_RULESET)).toBe(false);
    expect(snapshotAgrees({ ...r.snapshot, server: 'B' }, DEFAULT_RULESET)).toBe(false);
  });
});

describe('the Supabase backend (mocked)', () => {
  const snap = { lastSeq: 2, firstServer: 'B', rallySides: 'A', rallies: 1, gameNumber: 1, pointsA: 1, pointsB: 0, gamesA: 0, gamesB: 0, games: [], server: 'A', matchOver: false, winnerSide: null, lastPointAt: '2026-11-07T05:00:00.123456+00:00' };
  function mock(rpcAnswer: unknown = { matchId: M1, duplicate: false, seq: 2, status: 'live', revision: 3, state: snap }) {
    const tables: Record<string, unknown[]> = {
      competition_matches: [{ id: M1, event_id: EV, round_code: 'F', match_number: 1, group_label: null, side_a_entry: 'e1', side_b_entry: 'e2', scheduled_at: null, court_id: null, status: 'live', confirmed: false, revision: 3 }],
      tournament_events: [{ id: EV, tournament_id: T1, category: 'MS', age_group: null, is_junior: false, ruleset: DEFAULT_RULESET }],
      tournaments: [{ id: T1, name: 'Demo Open Cup', level: 'school_college', is_minor_signal: false }],
      draws: [{ event_id: EV, status: 'published' }],
      courts: [],
      event_entries: [{ id: 'e1', player1_id: P.arun, player2_id: null, status: 'confirmed' }, { id: 'e2', player1_id: P.bala, player2_id: null, status: 'confirmed' }],
      players: [{ id: P.arun, display_name: 'Demo Arun', age_status: 'adult_confirmed' }, { id: P.bala, display_name: 'Demo Bala', age_status: 'adult_confirmed' }],
      match_score_events: [{ seq: 1, kind: 'first_server', side: 'B', recorded_at: '2026-11-07T04:59:00Z' }, { seq: 2, kind: 'rally', side: 'A', recorded_at: '2026-11-07T05:00:00Z' }],
      competition_settings: [{ live_scores_public: false, live_window_seconds: 300 }],
    };
    const select = vi.fn(async (table: string, query: string) => {
      expect(query).not.toMatch(/select=\*/);
      expect(query.startsWith(`select=${LIVE_SCORING_COLUMNS[table as keyof typeof LIVE_SCORING_COLUMNS]}`)).toBe(true);
      return (tables[table] ?? []) as never[];
    });
    const rpc = vi.fn(async () => rpcAnswer as never);
    return { backend: createSupabaseLiveScoringBackend({ select, rpc }), select, rpc };
  }
  it('reads explicit columns and treats a school_college tournament as junior', async () => {
    const { backend } = mock();
    const f = await backend.getMatchFacts(M1);
    expect(f).toMatchObject({ junior: true, drawPublished: true, tournamentName: 'Demo Open Cup', sideA: [{ displayName: 'Demo Arun' }] });
    expect(await backend.getSettings()).toEqual({ public: false, windowSeconds: 300 });
  });
  it('sends the verified actor and the record to admin_live_score, and checks the answer', async () => {
    const { backend, rpc } = mock();
    const api: LiveScoringAdminStore = createLiveScoringService(backend);
    const r = ok(await api.liveScoringScore(OWNER, { matchId: M1, kind: 'rally', side: 'A', key: 'fake-key-0001', expectedSeq: 1 }));
    expect(r).toMatchObject({ seq: 2, revision: 3, duplicate: false });
    expect(rpc).toHaveBeenCalledWith('admin_live_score', { p_actor: OWNER.userId, p_match: M1, p_record: { kind: 'rally', side: 'A', key: 'fake-key-0001', expectedSeq: 1 } });
  });
  it('an answer the engine cannot rebuild is refused, never shown', async () => {
    const { backend } = mock({ matchId: M1, duplicate: false, seq: 2, status: 'live', revision: 3, state: { ...snap, pointsA: 5 } });
    const r = await createLiveScoringService(backend).liveScoringScore(OWNER, { matchId: M1, kind: 'rally', side: 'A', key: 'fake-key-0001', expectedSeq: 1 });
    expect(!r.ok && r.errors?.form).toBe(SCORE_MISMATCH);
    expect(() => parseSnapshot({ ...snap, rallySides: 'AC' })).toThrow();
    expect(() => parseSnapshot({ ...snap, rallies: 4 })).toThrow();
  });
  it('the status RPC gets the expected revision and the reason; settings go to admin_set_live_scores', async () => {
    const { backend, rpc } = mock({ id: M1, status: 'paused', winnerSide: null, confirmed: false, revision: 4 });
    await backend.setStatus(OWNER, M1, { action: 'pause', endStatus: null, retiringSide: null }, 3, 'test');
    expect(rpc).toHaveBeenCalledWith('admin_live_match_status', { p_actor: OWNER.userId, p_match: M1, p_record: { action: 'pause', endStatus: null, retiringSide: null }, p_expected_revision: 3, p_reason: 'test' });
    await backend.setSettings(OWNER, { public: true, windowSeconds: 300 }, 'test');
    expect(rpc).toHaveBeenLastCalledWith('admin_set_live_scores', { p_actor: OWNER.userId, p_record: { public: true, windowSeconds: 300 }, p_reason: 'test' });
    expect([...LIVE_SCORING_RPCS]).toEqual(['admin_live_score', 'admin_live_match_status', 'admin_set_live_scores']);
  });
});

describe('schemas and the store contract', () => {
  it('validates taps and status changes like the RPCs', () => {
    expect(liveScoreSchema.safeParse({ matchId: M1, kind: 'rally', side: 'A', key: 'fake-key-0001', expectedSeq: 0 }).success).toBe(true);
    expect(liveScoreSchema.safeParse({ matchId: M1, kind: 'undo', side: 'A', key: 'fake-key-0001', expectedSeq: 0 }).success).toBe(false);
    expect(liveScoreSchema.safeParse({ matchId: M1, kind: 'rally', side: null, key: 'fake-key-0001', expectedSeq: 0 }).success).toBe(false);
    expect(liveScoreSchema.safeParse({ matchId: M1, kind: 'rally', side: 'A', key: 'short', expectedSeq: 0 }).success).toBe(false);
    expect(liveScoreSchema.safeParse({ matchId: M1, kind: 'rally', side: 'A', key: 'fake-key-0001', expectedSeq: 0, phone: '910000000000' }).success).toBe(false);
    const st = { matchId: M1, action: 'end', endStatus: 'retired', retiringSide: 'B', expectedRevision: 1, reason: 'test' };
    expect(liveStatusSchema.safeParse(st).success).toBe(true);
    expect(liveStatusSchema.safeParse({ ...st, retiringSide: null }).success).toBe(false);
    expect(liveStatusSchema.safeParse({ ...st, action: 'start' }).success).toBe(false);
    expect(liveStatusSchema.safeParse({ ...st, endStatus: 'walkover', retiringSide: null }).success).toBe(false);
    expect(saveLiveSettingsSchema.safeParse({ public: true, windowSeconds: 59, reason: 'test' }).success).toBe(false);
  });
  it('every action has a schema and an access level; the store lists every method', () => {
    expect(Object.keys(LIVE_SCORING_SCHEMAS).sort()).toEqual(Object.keys(LIVE_SCORING_ACCESS).sort());
    expect(LIVE_SCORING_ACCESS['competition.saveLiveSettings']).toBe('owner');
    const api = setup().api as unknown as Record<string, unknown>;
    for (const m of LIVE_SCORING_STORE_METHODS) expect(typeof api[m]).toBe('function');
  });
});
