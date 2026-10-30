// The competition admin actions on the memory store (fictional seed): the same service runs over Supabase in production.
// Draws are made on the server and reproducible from their seed; a published draw never changes; a winner advances only on a
// CONFIRMED result; impossible scores are refused before the RPC; the ranking needs an approved points table and leaves protected
// players out. Fictional data only.
import { describe, expect, it } from 'vitest';
import { MemoryAdminStore, SEED } from '../../src/lib/admin/memory-store';
import { COMP_SEED, createCompetitionSeed, createMemoryCompetitionBackend } from '../../src/lib/admin/competition/memory-backend';
import { SCHEDULE_INPUT_PROBLEM, rankingProtectedMessage } from '../../src/lib/admin/competition/service';
import { RANKING_DISCLAIMER } from '../../src/lib/competition/stats/ranking';
import type { CompetitionEventDetail } from '../../src/lib/admin/competition/types';
import type { StoreResult } from '../../src/lib/admin/types';

const NOW = new Date('2026-10-22T10:00:00.000Z');
const ACTOR = { userId: '9a000000-0000-4000-8000-000000000001', role: 'owner' as const };
const R = 'demo reason';

function store() {
  let n = 0;
  return new MemoryAdminStore({ now: () => NOW, newId: () => `90000000-0000-4000-8000-${String(++n).padStart(12, '0')}`, randomSeed: () => 12345 });
}
function ok<T>(r: StoreResult<T>): T {
  if (!r.ok) throw new Error(`expected ok, got ${r.code} ${JSON.stringify(r.errors ?? {})}`);
  return r.data;
}
async function eventOf(s: MemoryAdminStore, eventId: string): Promise<CompetitionEventDetail> {
  return ok(await s.competitionEvent({ eventId }, ACTOR));
}
async function publishMs(s: MemoryAdminStore) {
  const draw = ok(await s.competitionGenerateDraw(ACTOR, { eventId: COMP_SEED.eventMs, seed: 42, separateClubs: false, seeds: 2, reason: R }));
  const pub = ok(await s.competitionPublishDraw(ACTOR, { eventId: COMP_SEED.eventMs, drawId: draw.drawId, reason: R }));
  return { draw, pub };
}
const games = (...g: [number, number][]) => g.map(([a, b]) => ({ a, b }));

describe('competition reads (fictional seed)', () => {
  it('lists the sample tournament with its two events and no draw yet', async () => {
    const list = ok(await store().competitionTournaments());
    const t = list.find((x) => x.id === SEED.t1)!;
    expect(t.events.map((e) => [e.category, e.format, e.confirmedEntries, e.drawStatus])).toEqual([
      ['MS', 'knockout', 4, null],
      ['WS', 'round_robin', 3, null],
    ]);
  });
  it('marks the unknown-age player as protected (the owner still sees the name in the admin)', async () => {
    const d = await eventOf(store(), COMP_SEED.eventWs);
    const meena = d.entries.find((e) => e.players[0]!.id === SEED.p3)!;
    expect(meena.isProtected).toBe(true);
    expect(meena.players[0]).toMatchObject({ ageStatus: 'unknown', isProtected: true });
    expect(d.entries.filter((e) => !e.isProtected)).toHaveLength(2);
  });
  it('entries follow the competition naming rule, not age alone: hidden, provisional or suppressed adults read protected', async () => {
    const s = store();
    const named = (await eventOf(s, COMP_SEED.eventWs)).entries.filter((e) => !e.isProtected).map((e) => e.players[0]!.id);
    expect(named).toHaveLength(2);
    const [x, y] = named as [string, string];
    s.state.identity.players.find((p) => p.id === x)!.visibility = 'hidden';
    s.state.suppressions.push({ id: '9b000000-0000-4000-8000-000000000009', kind: 'player_id', key: y, reason: 'demo removal request', releasedAt: null, affectedPlayerIds: [y], affectedVideoIds: [], affectedTournamentIds: [], pairedIds: [] });
    const d = await eventOf(s, COMP_SEED.eventWs);
    expect(d.entries.every((e) => e.isProtected)).toBe(true);
    expect(d.entries.find((e) => e.players[0]!.id === x)!.players[0]).toMatchObject({ ageStatus: 'adult_confirmed', isProtected: true });
  });
  it('without a verified actor every entry reads protected (fail closed)', async () => {
    const d = ok(await store().competitionEvent({ eventId: COMP_SEED.eventWs }));
    expect(d.entries.length).toBeGreaterThan(0);
    expect(d.entries.every((e) => e.isProtected && e.players.every((p) => p.isProtected))).toBe(true);
  });
  it('settings start with no approved points table and the public ranking switch off', async () => {
    const s = ok(await store().competitionSettings());
    expect(s).toMatchObject({ rankingsPublic: false, registrationEnabled: false, pointsTable: null });
    expect(s.pointsTableSummary).toMatch(/No ranking points table is approved/);
  });
});

describe('events and entries', () => {
  it('refuses a non-canonical age group and a bad ruleset in plain words, before any write', async () => {
    const s = store();
    const before = s.state.audit.length;
    const r = await s.competitionSaveEvent(ACTOR, { id: null, tournamentId: SEED.t1, category: 'WD', ageGroup: 'U-17', format: 'knockout', ruleset: { gamesToWin: 2, pointsToWin: 21, winBy: 2, pointCap: null, intervalAt: 11, changeEndsInDecidingGameAt: 11 }, capacity: null, status: 'draft', reason: R });
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.code).toBe('INVALID');
      expect(r.errors?.['ageGroup']).toMatch(/U15/);
      expect(r.errors?.['ruleset']).toMatch(/point cap/);
    }
    expect(s.state.audit.length).toBe(before);
  });
  it('creates an event, refuses the same category twice, and a junior event is flagged', async () => {
    const s = store();
    const rules = { gamesToWin: 2, pointsToWin: 21, winBy: 2, pointCap: 30, intervalAt: 11, changeEndsInDecidingGameAt: 11 };
    const made = ok(await s.competitionSaveEvent(ACTOR, { id: null, tournamentId: SEED.t1, category: 'BS', ageGroup: 'U15', format: 'knockout', ruleset: rules, capacity: 8, status: 'draft', reason: R }));
    expect(made.created).toBe(true);
    expect((await eventOf(s, made.id)).event.isJunior).toBe(true);
    const again = await s.competitionSaveEvent(ACTOR, { id: null, tournamentId: SEED.t1, category: 'BS', ageGroup: 'U15', format: 'knockout', ruleset: rules, capacity: 8, status: 'draft', reason: R });
    expect(again).toMatchObject({ ok: false, code: 'INVALID', errors: { form: expect.stringMatching(/already has that category/) } });
  });
  it('an entry needs the right number of players, no duplicate player and room in the event', async () => {
    const s = store();
    const pair = await s.competitionAddEntry(ACTOR, { eventId: COMP_SEED.eventMs, players: [COMP_SEED.chitra, COMP_SEED.divya], seed: null, status: 'pending', reason: R });
    expect(pair).toMatchObject({ ok: false, code: 'INVALID', errors: { players: expect.stringMatching(/singles/) } });
    const dup = await s.competitionAddEntry(ACTOR, { eventId: COMP_SEED.eventMs, players: [COMP_SEED.anand], seed: null, status: 'pending', reason: R });
    expect(dup).toMatchObject({ ok: false, code: 'INVALID', errors: { form: expect.stringMatching(/already entered/) } });
    const added = ok(await s.competitionAddEntry(ACTOR, { eventId: COMP_SEED.eventMs, players: [COMP_SEED.chitra], seed: null, status: 'pending', reason: R }));
    expect(added.status).toBe('pending');
    // a pending entry is not in the draw until it is confirmed
    const confirmed = ok(await s.competitionSetEntry(ACTOR, { entryId: added.id, status: 'confirmed', seed: null, reason: R }));
    expect(confirmed).toMatchObject({ status: 'confirmed', draftDrawCleared: false });
  });
});

describe('draws (server-side, reproducible, immutable once published)', () => {
  it('makes the same draw from the same seed, records the seed, puts seed 1 on line 1', async () => {
    const a = store();
    const b = store();
    const da = ok(await a.competitionGenerateDraw(ACTOR, { eventId: COMP_SEED.eventMs, seed: 42, separateClubs: false, seeds: 2, reason: R }));
    const db = ok(await b.competitionGenerateDraw(ACTOR, { eventId: COMP_SEED.eventMs, seed: 42, separateClubs: false, seeds: 2, reason: R }));
    expect(da.slots).toEqual(db.slots);
    expect(da.seed).toBe(42);
    const detail = await eventOf(a, COMP_SEED.eventMs);
    expect(detail.draw).toMatchObject({ seed: 42, status: 'draft' });
    const seed1 = detail.entries.find((e) => e.seed === 1)!;
    expect(da.slots.find((x) => x.position === 1)?.entryId).toBe(seed1.id);
  });
  it('without a seed it uses a new random seed and returns it', async () => {
    const d = ok(await store().competitionGenerateDraw(ACTOR, { eventId: COMP_SEED.eventMs, separateClubs: true, seeds: 0, reason: R }));
    expect(d.seed).toBe(12345);
  });
  it('refuses a draw the engine cannot make, in plain words', async () => {
    const r = await store().competitionGenerateDraw(ACTOR, { eventId: COMP_SEED.eventMs, seed: 1, separateClubs: false, seeds: 4, reason: R });
    expect(r).toMatchObject({ ok: false, code: 'INVALID', errors: { form: 'A draw of 4 lines can have at most 2 seeds.' } });
  });
  it('publishing creates the matches; the draw can then never be made again and its entries cannot change', async () => {
    const s = store();
    const { draw, pub } = await publishMs(s);
    expect(pub).toMatchObject({ status: 'published', created: 3, updated: 0, problems: [] });
    const d = await eventOf(s, COMP_SEED.eventMs);
    expect(d.matches.map((m) => [m.roundCode, m.sideA !== null, m.sideB !== null])).toEqual([
      ['SF', true, true],
      ['SF', true, true],
      ['F', false, false],
    ]);
    const again = await s.competitionGenerateDraw(ACTOR, { eventId: COMP_SEED.eventMs, seed: 7, separateClubs: false, seeds: 2, reason: R });
    expect(again).toMatchObject({ ok: false, code: 'INVALID', errors: { form: expect.stringMatching(/already published/) } });
    const change = await s.competitionSetEntry(ACTOR, { entryId: draw.slots[0]!.entryId!, status: 'pending', seed: 1, reason: R });
    expect(change).toMatchObject({ ok: false, code: 'INVALID', errors: { form: expect.stringMatching(/published draw/) } });
    const twice = await s.competitionPublishDraw(ACTOR, { eventId: COMP_SEED.eventMs, drawId: draw.drawId, reason: R });
    expect(twice.ok).toBe(false);
    // syncing again changes nothing (idempotent)
    expect(ok(await s.competitionSyncMatches(ACTOR, { eventId: COMP_SEED.eventMs, reason: R }))).toMatchObject({ created: 0, updated: 0 });
  });
  it('refuses to publish a draw made before the confirmed entries changed', async () => {
    const s = store();
    const draw = ok(await s.competitionGenerateDraw(ACTOR, { eventId: COMP_SEED.eventMs, seed: 42, separateClubs: false, seeds: 2, reason: R }));
    ok(await s.competitionAddEntry(ACTOR, { eventId: COMP_SEED.eventMs, players: [COMP_SEED.chitra], seed: null, status: 'confirmed', reason: R }));
    const r = await s.competitionPublishDraw(ACTOR, { eventId: COMP_SEED.eventMs, drawId: draw.drawId, reason: R });
    expect(r).toMatchObject({ ok: false, code: 'INVALID', errors: { form: expect.stringMatching(/Make the draw again/) } });
  });
  it('confirming an entry removes an out-of-date draft draw', async () => {
    const s = store();
    ok(await s.competitionGenerateDraw(ACTOR, { eventId: COMP_SEED.eventMs, seed: 42, separateClubs: false, seeds: 2, reason: R }));
    const added = ok(await s.competitionAddEntry(ACTOR, { eventId: COMP_SEED.eventMs, players: [COMP_SEED.chitra], seed: null, status: 'pending', reason: R }));
    expect(ok(await s.competitionSetEntry(ACTOR, { entryId: added.id, status: 'confirmed', seed: null, reason: R })).draftDrawCleared).toBe(true);
    expect((await eventOf(s, COMP_SEED.eventMs)).draw).toBeNull();
  });
  it('a round robin draw lists every confirmed entry once and makes every pair meet once', async () => {
    const s = store();
    const d = ok(await s.competitionGenerateDraw(ACTOR, { eventId: COMP_SEED.eventWs, seed: 9, separateClubs: false, seeds: 0, reason: R }));
    expect(d.slots).toHaveLength(3);
    const pub = ok(await s.competitionPublishDraw(ACTOR, { eventId: COMP_SEED.eventWs, drawId: d.drawId, reason: R }));
    expect(pub.created).toBe(3);
    const pairs = (await eventOf(s, COMP_SEED.eventWs)).matches.map((m) => [m.sideA, m.sideB].sort().join('|'));
    expect(new Set(pairs).size).toBe(3);
  });
});

describe('results (validated before the RPC; confirmed results are final; winners advance only when confirmed)', () => {
  it('refuses impossible scores in plain words and changes nothing', async () => {
    const s = store();
    await publishMs(s);
    const sf = (await eventOf(s, COMP_SEED.eventMs)).matches[0]!;
    for (const g of [games([21, 20], [21, 15]), games([31, 29], [21, 0]), games([21, 15]), games([21, 15], [21, 10], [21, 5])]) {
      const r = await s.competitionRecordResult(ACTOR, { matchId: sf.id, expectedRevision: sf.revision, status: 'completed', games: g, walkoverWinner: null, retiringSide: null, reason: R });
      expect(r).toMatchObject({ ok: false, code: 'INVALID' });
      if (!r.ok) expect(r.errors?.['games']).toMatch(/[a-z]/);
    }
    const walk = await s.competitionRecordResult(ACTOR, { matchId: sf.id, expectedRevision: sf.revision, status: 'walkover', games: games([21, 3]), walkoverWinner: 'A', retiringSide: null, reason: R });
    expect(walk.ok).toBe(false);
    expect((await eventOf(s, COMP_SEED.eventMs)).matches[0]).toMatchObject({ status: 'scheduled', revision: sf.revision, games: [] });
  });
  it('an unconfirmed result does not advance the winner; confirming does; a confirmed result cannot change', async () => {
    const s = store();
    await publishMs(s);
    let d = await eventOf(s, COMP_SEED.eventMs);
    const sf1 = d.matches[0]!;
    const rec = ok(await s.competitionRecordResult(ACTOR, { matchId: sf1.id, expectedRevision: sf1.revision, status: 'completed', games: games([21, 15], [19, 21], [22, 20]), walkoverWinner: null, retiringSide: null, reason: R }));
    expect(rec).toMatchObject({ winnerSide: 'A', confirmed: false });
    d = await eventOf(s, COMP_SEED.eventMs);
    expect(d.matches[2]).toMatchObject({ roundCode: 'F', sideA: null, sideB: null });
    expect(d.draw?.status).toBe('locked');
    // a stale form is refused
    const stale = await s.competitionConfirmResult(ACTOR, { matchId: sf1.id, expectedRevision: sf1.revision, reason: R });
    expect(stale).toMatchObject({ ok: false, code: 'STALE' });
    const conf = ok(await s.competitionConfirmResult(ACTOR, { matchId: sf1.id, expectedRevision: rec.revision, reason: R }));
    d = await eventOf(s, COMP_SEED.eventMs);
    const final = d.matches[2]!;
    expect(final.sideA).toBe(sf1.sideA);
    expect(final.sideB).toBeNull();
    expect(conf.advanced).toEqual([{ matchId: final.id, side: 'A', entryId: sf1.sideA }]);
    const again = await s.competitionRecordResult(ACTOR, { matchId: sf1.id, expectedRevision: conf.revision, status: 'completed', games: games([21, 1], [21, 1]), walkoverWinner: null, retiringSide: null, reason: R });
    expect(again).toMatchObject({ ok: false, code: 'INVALID', errors: { form: expect.stringMatching(/confirmed/) } });
  });
  it('a result needs both players known (the final waits for the semi-finals)', async () => {
    const s = store();
    await publishMs(s);
    const final = (await eventOf(s, COMP_SEED.eventMs)).matches[2]!;
    const r = await s.competitionRecordResult(ACTOR, { matchId: final.id, expectedRevision: final.revision, status: 'walkover', games: [], walkoverWinner: 'A', retiringSide: null, reason: R });
    expect(r).toMatchObject({ ok: false, code: 'INVALID', errors: { form: expect.stringMatching(/both sides/) } });
  });
});

describe('scheduling', () => {
  const windows = [{ date: '2026-11-07', start: '09:00', end: '18:00' }];
  it('places the matches on the courts, the final after both semi-finals, and saves only with the revisions it showed', async () => {
    const s = store();
    await publishMs(s);
    const preview = ok(await s.competitionSchedule(ACTOR, { tournamentId: SEED.t1, windows, durationMinutes: 40, restMinutes: 20, save: false, reason: R }));
    expect(preview.placed).toHaveLength(3);
    expect(preview.unplaced).toEqual([]);
    expect(preview.conflicts).toEqual([]);
    const byRound = (code: string) => preview.placed.filter((p) => p.label.includes(` ${code} `));
    const lastSemi = Math.max(...byRound('SF').map((p) => Date.parse(p.end)));
    expect(Date.parse(byRound('F')[0]!.start)).toBeGreaterThanOrEqual(lastSemi + 20 * 60_000);
    expect(new Set(byRound('SF').map((p) => p.courtLabel)).size).toBe(2);
    expect((await eventOf(s, COMP_SEED.eventMs)).matches.every((m) => m.scheduledAt === null)).toBe(true);

    const noExpected = await s.competitionSchedule(ACTOR, { tournamentId: SEED.t1, windows, durationMinutes: 40, restMinutes: 20, save: true, reason: R });
    expect(noExpected).toMatchObject({ ok: false, code: 'INVALID' });
    const wrong = await s.competitionSchedule(ACTOR, { tournamentId: SEED.t1, windows, durationMinutes: 40, restMinutes: 20, save: true, expected: Object.fromEntries(Object.keys(preview.revisions).map((k) => [k, 99])), reason: R });
    expect(wrong).toMatchObject({ ok: false, code: 'STALE' });
    const saved = ok(await s.competitionSchedule(ACTOR, { tournamentId: SEED.t1, windows, durationMinutes: 40, restMinutes: 20, save: true, expected: preview.revisions, reason: R }));
    expect(saved.saved).toBe(3);
    const after = await eventOf(s, COMP_SEED.eventMs);
    expect(after.matches.every((m) => m.scheduledAt !== null && m.courtLabel !== null)).toBe(true);
  });
  it('reports what does not fit, in plain words', async () => {
    const s = store();
    await publishMs(s);
    const r = ok(await s.competitionSchedule(ACTOR, { tournamentId: SEED.t1, windows: [{ date: '2026-11-07', start: '09:00', end: '10:00' }], durationMinutes: 50, restMinutes: 30, save: false, reason: R }));
    expect(r.unplaced.length).toBeGreaterThan(0);
    expect(r.unplaced[0]!.reason).toMatch(/[a-z]/);
  });
  it('a bad day or time gets one plain sentence, never the engine text with ids', async () => {
    const s = store();
    await publishMs(s);
    for (const w of [{ date: '2026-02-30', start: '09:00', end: '18:00' }, { date: '2026-11-07', start: '9 am', end: '18:00' }]) {
      const r = await s.competitionSchedule(ACTOR, { tournamentId: SEED.t1, windows: [w], durationMinutes: 40, restMinutes: 20, save: false, reason: R });
      expect(r).toEqual({ ok: false, code: 'INVALID', errors: { form: SCHEDULE_INPUT_PROBLEM } });
    }
  });
  it('needs courts', async () => {
    const s = store();
    s.state.competition!.courts = [];
    const r = await s.competitionSchedule(ACTOR, { tournamentId: SEED.t1, windows, durationMinutes: 40, restMinutes: 20, save: false, reason: R });
    expect(r).toMatchObject({ ok: false, code: 'INVALID', errors: { form: expect.stringMatching(/courts/) } });
  });
});

describe('local ranking (D-110: approved points only, protected players left out)', () => {
  const table = { label: 'Demo district table', levels: { district: { W: 100, F: 60, SF: 30, league: 10 } }, windowDays: 364, bestN: 4, reason: R };
  async function finishMs(s: MemoryAdminStore) {
    await publishMs(s);
    for (let i = 0; i < 3; i += 1) {
      const m = (await eventOf(s, COMP_SEED.eventMs)).matches[i]!;
      const rec = ok(await s.competitionRecordResult(ACTOR, { matchId: m.id, expectedRevision: m.revision, status: 'completed', games: games([21, 10], [21, 12]), walkoverWinner: null, retiringSide: null, reason: R }));
      ok(await s.competitionConfirmResult(ACTOR, { matchId: m.id, expectedRevision: rec.revision, reason: R }));
    }
  }
  function withLevel(s: MemoryAdminStore, level: 'district' | 'school_college' = 'district') {
    s.state.tournamentDetails = { [SEED.t1]: { name: 'Demo Open Cup', level, city: null, district: null, venue: null, startDate: '2026-10-09', endDate: '2026-10-10', categories: [], isFeatured: false, featuredUntil: null, coveredByPowerSmash: false } };
    approve(s);
  }
  function approve(s: MemoryAdminStore) {
    s.state.tournaments.find((t) => t.id === SEED.t1)!.status = 'published';
  }
  /** The player of the losing finalist's entry (the runner-up, in the middle of the ranking). */
  async function runnerUp(s: MemoryAdminStore): Promise<string> {
    const d = await eventOf(s, COMP_SEED.eventMs);
    const final = d.matches.find((m) => m.roundCode === 'F')!;
    const loser = final.winnerSide === 'A' ? final.sideB : final.sideA;
    return d.entries.find((e) => e.id === loser)!.players[0]!.id;
  }
  const ms = { label: 'Demo MS ranking', category: 'MS' as const, ageGroup: null, asOf: '2026-10-22', reason: R };
  it('refuses without an approved points table (never example points)', async () => {
    const r = await store().competitionComputeRanking(ACTOR, { label: 'Demo ranking', category: 'MS', ageGroup: null, asOf: '2026-10-22', reason: R });
    expect(r).toMatchObject({ ok: false, code: 'INVALID', errors: { form: expect.stringMatching(/No ranking points table is approved/) } });
  });
  it('refuses a malformed points table and a junior ranking', async () => {
    const s = store();
    const bad = await s.competitionApprovePointsTable(ACTOR, { ...table, levels: { galaxy: { W: 5 } } });
    expect(bad).toMatchObject({ ok: false, code: 'INVALID', errors: { levels: expect.stringMatching(/not a tournament level/) } });
    ok(await s.competitionApprovePointsTable(ACTOR, table));
    const junior = await s.competitionComputeRanking(ACTOR, { label: 'Demo juniors', category: 'BS', ageGroup: 'U15', asOf: '2026-10-22', reason: R });
    expect(junior).toMatchObject({ ok: false, code: 'INVALID', errors: { form: expect.stringMatching(/junior/) } });
  });
  it('says why there is nothing to rank when the tournament has no level', async () => {
    const s = store();
    approve(s);
    ok(await s.competitionApprovePointsTable(ACTOR, table));
    await finishMs(s);
    const r = await s.competitionComputeRanking(ACTOR, { label: 'Demo ranking', category: 'MS', ageGroup: null, asOf: '2026-10-22', reason: R });
    expect(r).toMatchObject({ ok: false, code: 'INVALID', errors: { form: expect.stringMatching(/no level set/) } });
  });
  it('ranks from confirmed results with the approved points, as an unpublished snapshot', async () => {
    const s = store();
    withLevel(s);
    ok(await s.competitionApprovePointsTable(ACTOR, table));
    await finishMs(s);
    const r = ok(await s.competitionComputeRanking(ACTOR, { label: 'Demo MS ranking', category: 'MS', ageGroup: null, asOf: '2026-10-22', reason: R }));
    expect(r).toMatchObject({ rows: 4, protectedLeftOut: 0, published: false });
    expect(r.disclaimer).toBe(RANKING_DISCLAIMER);
    const detail = ok(await s.competitionRanking({ snapshotId: r.snapshotId }));
    expect(detail.disclaimer).toBe(RANKING_DISCLAIMER);
    expect(detail.rows.map((x) => [x.rank, x.points])).toEqual([
      [1, 100],
      [2, 60],
      [3, 30],
      [3, 30],
    ]);
    expect(detail.publiclyVisible).toBe(false);
    const pub = ok(await s.competitionPublishRanking(ACTOR, { snapshotId: r.snapshotId, reason: R }));
    expect(pub).toEqual({ id: r.snapshotId, published: true, publiclyVisible: false });
    expect((await s.competitionPublishRanking(ACTOR, { snapshotId: r.snapshotId, reason: R })).ok).toBe(false);
  });
  it('leaves a protected runner-up out BEFORE ranking: the stored ranks run 1, 2, 2 with no gap where they were', async () => {
    const s = store();
    withLevel(s);
    ok(await s.competitionApprovePointsTable(ACTOR, table));
    await finishMs(s);
    const middle = await runnerUp(s);
    s.state.identity.players.find((p) => p.id === middle)!.ageStatus = 'unknown';
    const r = ok(await s.competitionComputeRanking(ACTOR, ms));
    expect(r).toMatchObject({ rows: 3, protectedLeftOut: 1 });
    const detail = ok(await s.competitionRanking({ snapshotId: r.snapshotId }));
    expect(detail.rows.map((x) => [x.rank, x.points])).toEqual([
      [1, 100],
      [2, 30],
      [2, 30],
    ]);
    expect(detail.rows.some((x) => x.playerId === middle)).toBe(false);
  });
  for (const [why, change] of [
    ['hidden', (p: { visibility: string }) => void (p.visibility = 'hidden')],
    ['provisional', (p: { provisional: boolean }) => void (p.provisional = true)],
  ] as const) {
    it(`leaves out an adult whose player page is ${why} (not in app.eligible_players), with no gap and a plain note`, async () => {
      const s = store();
      withLevel(s);
      ok(await s.competitionApprovePointsTable(ACTOR, table));
      await finishMs(s);
      const middle = await runnerUp(s);
      (change as (p: unknown) => void)(s.state.identity.players.find((p) => p.id === middle)!);
      const r = ok(await s.competitionComputeRanking(ACTOR, ms));
      expect(r).toMatchObject({ rows: 3, protectedLeftOut: 1 });
      expect(r.excluded.join(' ')).toMatch(/1 adult player is left out because the site cannot show their name yet/);
      const detail = ok(await s.competitionRanking({ snapshotId: r.snapshotId }));
      expect(detail.rows.map((x) => x.rank)).toEqual([1, 2, 2]);
      expect(detail.rows.some((x) => x.playerId === middle)).toBe(false);
    });
  }
  it('leaves out an adult who asked to be removed (an active suppression), with no gap', async () => {
    const s = store();
    withLevel(s);
    ok(await s.competitionApprovePointsTable(ACTOR, table));
    await finishMs(s);
    const middle = await runnerUp(s);
    s.state.suppressions.push({ id: '9b000000-0000-4000-8000-000000000001', kind: 'player_id', key: middle, reason: 'demo removal request', releasedAt: null, affectedPlayerIds: [middle], affectedVideoIds: [], affectedTournamentIds: [], pairedIds: [] });
    const r = ok(await s.competitionComputeRanking(ACTOR, ms));
    const detail = ok(await s.competitionRanking({ snapshotId: r.snapshotId }));
    expect(detail.rows.map((x) => x.rank)).toEqual([1, 2, 2]);
    expect(detail.rows.some((x) => x.playerId === middle)).toBe(false);
  });
  it('leaves the unknown-age player out of a league and says a league counts only as taking part', async () => {
    const s = store();
    withLevel(s);
    ok(await s.competitionApprovePointsTable(ACTOR, table));
    const d = ok(await s.competitionGenerateDraw(ACTOR, { eventId: COMP_SEED.eventWs, seed: 3, separateClubs: false, seeds: 0, reason: R }));
    ok(await s.competitionPublishDraw(ACTOR, { eventId: COMP_SEED.eventWs, drawId: d.drawId, reason: R }));
    for (const m of (await eventOf(s, COMP_SEED.eventWs)).matches) {
      const rec = ok(await s.competitionRecordResult(ACTOR, { matchId: m.id, expectedRevision: m.revision, status: 'completed', games: games([21, 9], [21, 9]), walkoverWinner: null, retiringSide: null, reason: R }));
      ok(await s.competitionConfirmResult(ACTOR, { matchId: m.id, expectedRevision: rec.revision, reason: R }));
    }
    const r = ok(await s.competitionComputeRanking(ACTOR, { label: 'Demo WS ranking', category: 'WS', ageGroup: null, asOf: '2026-10-22', reason: R }));
    expect(r).toMatchObject({ rows: 2, protectedLeftOut: 1 });
    expect(r.excluded).toContain('League and group events count only as taking part: every player in them gets the same points, whatever their place.');
    const detail = ok(await s.competitionRanking({ snapshotId: r.snapshotId }));
    expect(detail.rows.map((x) => x.playerId).sort()).toEqual([COMP_SEED.chitra, COMP_SEED.divya].sort());
    expect(JSON.stringify(detail)).not.toContain('Meena');
  });
  it('a tournament that is not approved (pending) or cancelled earns no points, and the owner is told why', async () => {
    for (const status of ['pending', 'cancelled'] as const) {
      const s = store();
      withLevel(s);
      s.state.tournaments.find((t) => t.id === SEED.t1)!.status = status;
      ok(await s.competitionApprovePointsTable(ACTOR, table));
      await finishMs(s);
      const r = await s.competitionComputeRanking(ACTOR, ms);
      expect(r).toMatchObject({ ok: false, code: 'INVALID', errors: { form: expect.stringMatching(status === 'pending' ? /Demo Open Cup is not approved yet/ : /Demo Open Cup is cancelled/) } });
    }
  });
  it('a minor-signal tournament (school or college, or the flag) counts as junior: its events are junior and its players never ranked', async () => {
    for (const setup of ['flag', 'level'] as const) {
      const s = store();
      withLevel(s, setup === 'level' ? 'school_college' : 'district');
      if (setup === 'flag') s.state.tournaments.find((t) => t.id === SEED.t1)!.isMinorSignal = true;
      const list = ok(await s.competitionTournaments());
      expect(list.find((t) => t.id === SEED.t1)!.events.every((e) => e.isJunior)).toBe(true);
      expect((await eventOf(s, COMP_SEED.eventMs)).entries.every((e) => e.isProtected)).toBe(true);
      ok(await s.competitionApprovePointsTable(ACTOR, { ...table, levels: { district: { W: 100, F: 60, SF: 30 }, school_college: { W: 100, F: 60, SF: 30 } } }));
      await finishMs(s);
      const r = await s.competitionComputeRanking(ACTOR, ms);
      expect(r).toMatchObject({ ok: false, code: 'INVALID', errors: { form: expect.stringMatching(/no confirmed results to rank/) } });
    }
  });
  it('marks each ranking row with the CURRENT profile, and refuses to publish once a row became protected (with the count)', async () => {
    const s = store();
    withLevel(s);
    ok(await s.competitionApprovePointsTable(ACTOR, table));
    await finishMs(s);
    const r = ok(await s.competitionComputeRanking(ACTOR, ms));
    let detail = ok(await s.competitionRanking({ snapshotId: r.snapshotId }, ACTOR));
    expect(detail.rows.map((x) => x.isProtected)).toEqual([false, false, false, false]);
    // after the ranking was worked out, one player is hidden and another asks to be removed
    const middle = await runnerUp(s);
    s.state.identity.players.find((p) => p.id === middle)!.visibility = 'hidden';
    const other = detail.rows.find((x) => x.playerId !== middle)!.playerId;
    s.state.suppressions.push({ id: '9b000000-0000-4000-8000-000000000002', kind: 'player_id', key: other, reason: 'demo removal request', releasedAt: null, affectedPlayerIds: [other], affectedVideoIds: [], affectedTournamentIds: [], pairedIds: [] });
    detail = ok(await s.competitionRanking({ snapshotId: r.snapshotId }, ACTOR));
    expect(detail.rows.filter((x) => x.isProtected).map((x) => x.playerId).sort()).toEqual([middle, other].sort());
    const refused = await s.competitionPublishRanking(ACTOR, { snapshotId: r.snapshotId, reason: R });
    expect(refused).toMatchObject({ ok: false, code: 'INVALID', errors: { form: rankingProtectedMessage(2) } });
    expect(rankingProtectedMessage(2)).toBe('2 players in this ranking are now protected (age not confirmed, hidden, provisional, merged or removed on request), so it cannot be published. Work the ranking out again.');
    expect(rankingProtectedMessage(1)).toMatch(/^1 player in this ranking is now protected/);
    expect(ok(await s.competitionRankings()).find((x) => x.id === r.snapshotId)!.published).toBe(false);
    // a merged or unknown-age player reads protected too; an unknown player id is protected (fail closed)
    s.state.identity.players.find((p) => p.id === other)!.ageStatus = 'unknown';
    expect(ok(await s.competitionRanking({ snapshotId: r.snapshotId }, ACTOR)).rows.filter((x) => x.isProtected)).toHaveLength(2);
    // no verified actor: nobody is named (fail closed, like the Supabase backend)
    expect(ok(await s.competitionRanking({ snapshotId: r.snapshotId })).rows.every((x) => x.isProtected)).toBe(true);
  });
  it('the memory backend refuses a protected row and a junior ranking on its own, like the SQL', async () => {
    const t1 = SEED.t1;
    const state = createCompetitionSeed(t1, SEED.p1, SEED.p3);
    let n = 0;
    const adults = [SEED.p1, COMP_SEED.anand, COMP_SEED.bala];
    const b = createMemoryCompetitionBackend({
      state: () => state,
      players: () => adults.map((id) => ({ id, displayName: 'Demo Player', ageStatus: 'adult_confirmed' as const, academy: null })),
      tournaments: () => [{ id: t1, name: 'Demo Open Cup', level: null, startDate: null, endDate: null, minorSignal: false, status: 'published' }],
      rankable: (ids) => ids.filter((id) => id !== COMP_SEED.bala),
      audit: () => undefined,
      markDirty: () => undefined,
      now: () => NOW,
      newId: () => `9e000000-0000-4000-8000-${String(++n).padStart(12, '0')}`,
    });
    const rows = adults.map((playerId, i) => ({ playerId, rank: i + 1, points: 100 - i, eventsCounted: 1 }));
    const one = await b.saveRankingSnapshot(ACTOR, { label: 'Demo ranking', category: 'MS', ageGroup: null, asOf: '2026-10-22', entries: rows }, R);
    await expect(b.publishRankingSnapshot(ACTOR, one.id, R)).rejects.toMatchObject({ code: 'INVALID', detail: rankingProtectedMessage(1) });
    const junior = await b.saveRankingSnapshot(ACTOR, { label: 'Demo juniors', category: 'BS', ageGroup: null, asOf: '2026-10-22', entries: rows.slice(0, 2) }, R);
    await expect(b.publishRankingSnapshot(ACTOR, junior.id, R)).rejects.toMatchObject({ code: 'INVALID', detail: rankingProtectedMessage(2) });
    const fine = await b.saveRankingSnapshot(ACTOR, { label: 'Demo named', category: 'MS', ageGroup: null, asOf: '2026-10-22', entries: rows.slice(0, 2) }, R);
    expect(await b.publishRankingSnapshot(ACTOR, fine.id, R)).toMatchObject({ published: true });
    expect(state.snapshots.filter((x) => x.published).map((x) => x.id)).toEqual([fine.id]);
  });
  it('a ranking older than the newest ones is still found by its id', async () => {
    const s = store();
    withLevel(s);
    ok(await s.competitionApprovePointsTable(ACTOR, table));
    await finishMs(s);
    const first = ok(await s.competitionComputeRanking(ACTOR, ms));
    for (let i = 0; i < 3; i += 1) ok(await s.competitionComputeRanking(ACTOR, { ...ms, label: `Demo MS ranking ${i}` }));
    expect(ok(await s.competitionRanking({ snapshotId: first.snapshotId })).snapshot.id).toBe(first.snapshotId);
    expect(await s.competitionRanking({ snapshotId: '9c000000-0000-4000-8000-000000000001' })).toMatchObject({ ok: false, code: 'NOT_FOUND' });
  });
});

describe('the memory backend refuses an out-of-date draw on its own (a second admin tab skips the screen check)', () => {
  it('publishDraw checks that the draw holds exactly the confirmed entries', async () => {
    const t1 = SEED.t1;
    const state = createCompetitionSeed(t1, SEED.p1, SEED.p3);
    let n = 0;
    const adults = [SEED.p1, COMP_SEED.anand, COMP_SEED.bala, COMP_SEED.eswar, COMP_SEED.chitra];
    const b = createMemoryCompetitionBackend({
      state: () => state,
      players: () => adults.map((id) => ({ id, displayName: 'Demo Player', ageStatus: 'adult_confirmed' as const, academy: null })),
      tournaments: () => [{ id: t1, name: 'Demo Open Cup', level: null, startDate: null, endDate: null, minorSignal: false, status: 'published' }],
      rankable: (ids) => [...ids],
      audit: () => undefined,
      markDirty: () => undefined,
      now: () => NOW,
      newId: () => `9d000000-0000-4000-8000-${String(++n).padStart(12, '0')}`,
    });
    const confirmed = state.entries.filter((e) => e.eventId === COMP_SEED.eventMs).map((e) => e.id);
    const draw = await b.saveDraw(ACTOR, COMP_SEED.eventMs, { seed: 1, slots: confirmed.map((entryId, i) => ({ position: i + 1, entryId, group: null })) }, R);
    // tab 2 adds a confirmed entry after the draw was made
    await b.addEntry(ACTOR, COMP_SEED.eventMs, { players: [COMP_SEED.chitra], seed: null, status: 'confirmed' }, R);
    await expect(b.publishDraw(ACTOR, draw.id, R)).rejects.toMatchObject({ code: 'INVALID' });
    expect(state.draws.find((x) => x.id === draw.id)!.status).toBe('draft');
  });
});

describe('venues, courts and the audit trail', () => {
  it('saves a court, refuses a duplicate name, and audits every write with the actor', async () => {
    const s = store();
    const before = s.state.audit.length;
    const c = ok(await s.competitionSaveCourt(ACTOR, { id: null, tournamentId: SEED.t1, venueId: COMP_SEED.venue, label: 'Court 3', sort: 3, reason: R }));
    expect(c.created).toBe(true);
    const dup = await s.competitionSaveCourt(ACTOR, { id: null, tournamentId: SEED.t1, venueId: null, label: 'Court 1', sort: 4, reason: R });
    expect(dup).toMatchObject({ ok: false, code: 'INVALID', errors: { form: expect.stringMatching(/already has a court/) } });
    const v = await s.competitionSaveVenue(ACTOR, { id: null, name: 'X', city: null, reason: R });
    expect(v).toMatchObject({ ok: false, code: 'INVALID', errors: { name: expect.any(String) } });
    expect(s.state.audit.length).toBe(before + 1);
    expect(s.state.audit[0]).toMatchObject({ actor: ACTOR.userId, action: 'competition.save_court', entity: 'courts' });
    const courts = ok(await s.competitionCourts({ tournamentId: SEED.t1 }));
    expect(courts.courts.map((x) => x.label)).toEqual(['Court 1', 'Court 2', 'Court 3']);
  });
  it('reads never write an audit row', async () => {
    const s = store();
    const before = s.state.audit.length;
    await s.competitionTournaments();
    await s.competitionEvent({ eventId: COMP_SEED.eventMs });
    await s.competitionCourts({ tournamentId: SEED.t1 });
    await s.competitionRankings();
    await s.competitionSettings();
    expect(s.state.audit.length).toBe(before);
  });
});
