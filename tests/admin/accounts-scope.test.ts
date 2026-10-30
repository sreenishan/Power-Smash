// The per-tournament check before the store (D-108, wave 4): an organizer or scorer reaches only the tournaments assigned to them,
// with the right role; a revoke, an ended account or the switch off takes effect on the very next call; the owner is unchanged.
// Runs the real competition service over the memory store (fictional seed) with the memory scope. Fictional ids and names only.
import { describe, expect, it } from 'vitest';
import {
  OWNER_ONLY_COMPETITION_ACTIONS,
  SCOPED_ACTION_NEEDS,
  competitionUiFor,
  navAreasFor,
  scopedNeed,
} from '../../src/lib/admin/accounts/access';
import { createMemoryAccountsBackend, createMemoryScopeDeps, emptyAccountsState, type MemoryAccountsState } from '../../src/lib/admin/accounts/memory-backend';
import { METHOD_ACTION, PROTECTED_NAME, checkScope, createScopedCompetitionStore, maskForScorer, targetsOf } from '../../src/lib/admin/accounts/scoped-store';
import type { PlatformActor } from '../../src/lib/admin/accounts/types';
import { COMP_SEED } from '../../src/lib/admin/competition/memory-backend';
import { COMPETITION_STORE_METHODS, type CompetitionEventDetail } from '../../src/lib/admin/competition/types';
import { MemoryAdminStore } from '../../src/lib/admin/memory-store';
import { ADMIN_ACTIONS } from '../../src/lib/admin/policy';
import type { StoreResult } from '../../src/lib/admin/types';

const NOW = new Date('2026-10-22T10:00:00.000Z');
const OWNER = { userId: 'preview-owner', role: 'owner' as const };
const T1 = '20000000-0000-4000-8000-000000000001'; // the seed's Demo Open Cup (has the competition sample)
const T2 = '20000000-0000-4000-8000-000000000002';
const ORG: PlatformActor = { userId: '9b000000-0000-4000-8000-000000000001', role: 'organizer' };
const SCO: PlatformActor = { userId: '9b000000-0000-4000-8000-000000000002', role: 'scorer' };
const ORG2: PlatformActor = { userId: '9b000000-0000-4000-8000-000000000003', role: 'organizer' };
const R = 'fake reason';

function ok<T>(r: StoreResult<T>): T {
  if (!r.ok) throw new Error(`expected ok, got ${r.code} ${JSON.stringify(r.errors ?? {})}`);
  return r.data;
}

async function setup() {
  let n = 0;
  const store = new MemoryAdminStore({ now: () => NOW, newId: () => `90000000-0000-4000-8000-${String(++n).padStart(12, '0')}`, randomSeed: () => 7 });
  const accounts: MemoryAccountsState = emptyAccountsState(OWNER.userId);
  const backend = createMemoryAccountsBackend({
    state: () => accounts,
    tournaments: () => [{ id: T1, name: 'Demo Open Cup', startDate: null }, { id: T2, name: 'Demo Other Cup', startDate: null }],
    audit: () => undefined,
    now: () => NOW,
    newId: () => `91000000-0000-4000-8000-${String(++n).padStart(12, '0')}`,
  });
  await backend.createAccount(OWNER, ORG.userId, { role: 'organizer', displayName: 'Demo Organizer', tournamentIds: [T1] }, R);
  await backend.createAccount(OWNER, SCO.userId, { role: 'scorer', displayName: 'Demo Scorer', tournamentIds: [T1] }, R);
  await backend.createAccount(OWNER, ORG2.userId, { role: 'organizer', displayName: 'Demo Organizer Two', tournamentIds: [T2] }, R);
  await backend.setOrganizerAccess(OWNER, true, R);
  const deps = createMemoryScopeDeps(() => accounts, () => store.state.competition!);
  const as = (a: PlatformActor) => createScopedCompetitionStore(store, a, deps);
  return { store, accounts, backend, deps, as };
}

/** Publishes the seed's MS draw (as the owner) and returns the event detail with its matches. */
async function publishedMs(store: MemoryAdminStore): Promise<CompetitionEventDetail> {
  const g = ok(await store.competitionGenerateDraw(OWNER, { eventId: COMP_SEED.eventMs, seed: 42, separateClubs: false, seeds: 2, reason: R }));
  ok(await store.competitionPublishDraw(OWNER, { eventId: COMP_SEED.eventMs, drawId: g.drawId, reason: R }));
  return ok(await store.competitionEvent({ eventId: COMP_SEED.eventMs }, OWNER));
}

const firstPlayable = (d: CompetitionEventDetail) => {
  const m = d.matches.find((x) => x.sideA !== null && x.sideB !== null && !x.confirmed);
  if (!m) throw new Error('no playable match');
  return m;
};
const WIN = { status: 'completed' as const, games: [{ a: 21, b: 10 }, { a: 21, b: 12 }], walkoverWinner: null, retiringSide: null };

describe('the role-to-action map (shared by the server and the admin app)', () => {
  it('names only real competition actions, and never an owner-only one', () => {
    for (const role of ['organizer', 'scorer'] as const) {
      for (const action of Object.keys(SCOPED_ACTION_NEEDS[role])) {
        expect(Object.keys(ADMIN_ACTIONS), action).toContain(action);
        expect(action.startsWith('competition.'), action).toBe(true);
        expect(OWNER_ONLY_COMPETITION_ACTIONS as readonly string[]).not.toContain(action);
      }
    }
    for (const action of OWNER_ONLY_COMPETITION_ACTIONS) {
      expect(scopedNeed('organizer', action)).toBeNull();
      expect(scopedNeed('scorer', action)).toBeNull();
    }
    // nothing outside competitions, ever
    for (const action of Object.keys(ADMIN_ACTIONS).filter((a) => !a.startsWith('competition.'))) {
      expect(scopedNeed('organizer', action), action).toBeNull();
      expect(scopedNeed('scorer', action), action).toBeNull();
    }
  });
  it('a scorer records but never confirms, publishes, draws or edits', () => {
    expect(scopedNeed('scorer', 'competition.recordResult')).toBe('score');
    for (const a of ['competition.confirmResult', 'competition.publishDraw', 'competition.generateDraw', 'competition.saveMatch', 'competition.schedule', 'competition.saveEvent', 'competition.addEntry', 'competition.syncMatches', 'competition.saveCourt', 'competition.courts']) {
      expect(scopedNeed('scorer', a), a).toBeNull();
    }
    expect(scopedNeed('organizer', 'competition.confirmResult')).toBe('run');
  });
  it('every store method has its action, and every action with an input has its targets', () => {
    expect(Object.keys(METHOD_ACTION).sort()).toEqual([...COMPETITION_STORE_METHODS].sort());
    for (const action of Object.keys(SCOPED_ACTION_NEEDS.organizer)) {
      const t = targetsOf(action, {});
      if (action === 'competition.tournaments' || action === 'competition.liveMatches') expect(t).toBeNull();
      else expect(t?.length ?? 0, action).toBeGreaterThan(0);
    }
  });
  it('navigation and buttons follow the same map', () => {
    expect(navAreasFor('owner')).toBeNull();
    expect(navAreasFor('organizer')).toEqual(['competitions', 'scoring']);
    expect(navAreasFor('scorer')).toEqual(['scoring', 'competitions']);
    expect(navAreasFor('editor')).toEqual([]);
    expect(competitionUiFor('owner').rankings).toBe(true);
    const org = competitionUiFor('organizer');
    expect([org.rankings, org.venues, org.confirmResult, org.draw, org.seesProtectedNames]).toEqual([false, false, true, true, true]);
    const sco = competitionUiFor('scorer');
    expect(sco).toMatchObject({ rankings: false, venues: false, addEvent: false, entries: false, draw: false, schedule: false, courts: false, confirmResult: false, recordResult: true, seesProtectedNames: false });
  });
});

describe('the scoped competition store', () => {
  it('the owner gets the store unchanged', async () => {
    const { store, deps } = await setup();
    expect(createScopedCompetitionStore(store, OWNER, deps)).toBe(store);
  });

  it('lists only the assigned tournaments', async () => {
    const { as } = await setup();
    const own = ok(await as(ORG).competitionTournaments());
    expect(own.map((t) => t.id)).toEqual([T1]);
    const other = ok(await as(ORG2).competitionTournaments());
    expect(other.map((t) => t.id)).not.toContain(T1);
    expect(ok(await as(SCO).competitionTournaments()).map((t) => t.id)).toEqual([T1]);
  });

  it('organizer: allowed on an assigned tournament, refused on another, refused for rankings and venues', async () => {
    const { as } = await setup();
    const o = as(ORG);
    expect(ok(await o.competitionEvent({ eventId: COMP_SEED.eventMs })).event.id).toBe(COMP_SEED.eventMs);
    expect((await as(ORG2).competitionEvent({ eventId: COMP_SEED.eventMs })).ok).toBe(false);
    expect(await as(ORG2).competitionEvent({ eventId: COMP_SEED.eventMs })).toEqual({ ok: false, code: 'FORBIDDEN' });
    // a new event in the assigned tournament; not in another
    const ev = { id: null, tournamentId: T1, category: 'MD' as const, ageGroup: null, format: 'knockout' as const, ruleset: { gamesToWin: 2, pointsToWin: 21, winBy: 2, pointCap: 30, intervalAt: 11, changeEndsInDecidingGameAt: 11 }, capacity: 8, status: 'open' as const, reason: R };
    expect((await o.competitionSaveEvent(OWNER, ev)).ok).toBe(true);
    expect(await o.competitionSaveEvent(OWNER, { ...ev, tournamentId: T2, category: 'WD' })).toEqual({ ok: false, code: 'FORBIDDEN' });
    // editing an event of T1 while claiming T2 (and the other way round) is refused
    expect(await as(ORG2).competitionSaveEvent(OWNER, { ...ev, id: COMP_SEED.eventMs, tournamentId: T2 })).toEqual({ ok: false, code: 'FORBIDDEN' });
    for (const call of [
      () => o.competitionRankings(),
      () => o.competitionRanking({ snapshotId: '95000000-0000-4000-8000-000000000001' }),
      () => o.competitionSettings(),
      () => o.competitionComputeRanking(OWNER, { label: 'Demo', category: null, ageGroup: null, asOf: '2026-10-22', reason: R }),
      () => o.competitionPublishRanking(OWNER, { snapshotId: '95000000-0000-4000-8000-000000000001', reason: R }),
      () => o.competitionSaveVenue(OWNER, { id: null, name: 'Demo Hall', city: null, reason: R }),
      () => o.competitionApprovePointsTable(OWNER, { label: 'Demo', levels: {}, windowDays: 364, bestN: 4, reason: R }),
    ]) {
      expect(await call()).toEqual({ ok: false, code: 'FORBIDDEN' });
    }
  });

  it('organizer runs the whole event: entries, draw, courts, schedule, results and confirming', async () => {
    const { as } = await setup();
    const o = as(ORG);
    const d0 = ok(await o.competitionEvent({ eventId: COMP_SEED.eventWs }));
    const entry = d0.entries[0]!;
    expect((await o.competitionSetEntry(OWNER, { entryId: entry.id, status: 'confirmed', seed: null, reason: R })).ok).toBe(true);
    expect((await as(ORG2).competitionSetEntry(OWNER, { entryId: entry.id, status: 'confirmed', seed: null, reason: R }))).toEqual({ ok: false, code: 'FORBIDDEN' });
    expect((await o.competitionSaveCourt(OWNER, { id: null, tournamentId: T1, venueId: null, label: 'Court 9', sort: 9, reason: R })).ok).toBe(true);
    expect(await o.competitionSaveCourt(OWNER, { id: null, tournamentId: T2, venueId: null, label: 'Court 9', sort: 9, reason: R })).toEqual({ ok: false, code: 'FORBIDDEN' });
    expect(await as(ORG2).competitionSaveCourt(OWNER, { id: COMP_SEED.court1, tournamentId: T2, venueId: null, label: 'Court 1', sort: 1, reason: R })).toEqual({ ok: false, code: 'FORBIDDEN' });
    expect(await as(ORG2).competitionCourts({ tournamentId: T1 })).toEqual({ ok: false, code: 'FORBIDDEN' });
    const g = ok(await o.competitionGenerateDraw(OWNER, { eventId: COMP_SEED.eventMs, seed: 42, separateClubs: false, seeds: 2, reason: R }));
    expect(await as(ORG2).competitionPublishDraw(OWNER, { eventId: COMP_SEED.eventMs, drawId: g.drawId, reason: R })).toEqual({ ok: false, code: 'FORBIDDEN' });
    ok(await o.competitionPublishDraw(OWNER, { eventId: COMP_SEED.eventMs, drawId: g.drawId, reason: R }));
    const plan = await o.competitionSchedule(OWNER, { tournamentId: T1, windows: [{ date: '2026-11-02', start: '09:00', end: '18:00' }], durationMinutes: 40, restMinutes: 20, save: false, reason: R });
    expect(plan.ok).toBe(true);
    expect(await as(ORG2).competitionSchedule(OWNER, { tournamentId: T2, eventIds: [COMP_SEED.eventMs], windows: [{ date: '2026-11-02', start: '09:00', end: '18:00' }], durationMinutes: 40, restMinutes: 20, save: false, reason: R })).toEqual({ ok: false, code: 'FORBIDDEN' });
    const d = ok(await o.competitionEvent({ eventId: COMP_SEED.eventMs }));
    const m = firstPlayable(d);
    const rec = ok(await o.competitionRecordResult(OWNER, { matchId: m.id, expectedRevision: m.revision, ...WIN, reason: R }));
    expect(await as(ORG2).competitionConfirmResult(OWNER, { matchId: m.id, expectedRevision: rec.revision, reason: R })).toEqual({ ok: false, code: 'FORBIDDEN' });
    expect((await o.competitionConfirmResult(OWNER, { matchId: m.id, expectedRevision: rec.revision, reason: R })).ok).toBe(true);
  });

  it('scorer: records a result on an assigned match, never confirms, never runs anything else', async () => {
    const { store, as } = await setup();
    const d = await publishedMs(store);
    const m = firstPlayable(d);
    const s = as(SCO);
    expect(await s.competitionConfirmResult(OWNER, { matchId: m.id, expectedRevision: m.revision, reason: R })).toEqual({ ok: false, code: 'FORBIDDEN' });
    const rec = ok(await s.competitionRecordResult(OWNER, { matchId: m.id, expectedRevision: m.revision, ...WIN, reason: R }));
    expect(rec.confirmed).toBe(false);
    expect(await s.competitionConfirmResult(OWNER, { matchId: m.id, expectedRevision: rec.revision, reason: R })).toEqual({ ok: false, code: 'FORBIDDEN' });
    expect(await s.competitionSaveMatch(OWNER, { id: m.id, expectedRevision: rec.revision, eventId: COMP_SEED.eventMs, roundCode: m.roundCode, matchNumber: m.matchNumber, groupLabel: null, sideA: m.sideA, sideB: m.sideB, scheduledAt: null, courtId: null, reason: R })).toEqual({ ok: false, code: 'FORBIDDEN' });
    expect(await s.competitionSyncMatches(OWNER, { eventId: COMP_SEED.eventMs, reason: R })).toEqual({ ok: false, code: 'FORBIDDEN' });
    expect(await s.competitionCourts({ tournamentId: T1 })).toEqual({ ok: false, code: 'FORBIDDEN' });
    expect(await s.competitionAddEntry(OWNER, { eventId: COMP_SEED.eventMs, players: [COMP_SEED.anand], seed: null, status: 'pending', reason: R })).toEqual({ ok: false, code: 'FORBIDDEN' });
    // the owner confirms; the scorer's result was recorded under the scorer (the memory audit keeps the actor id)
    expect((await store.competitionConfirmResult(OWNER, { matchId: m.id, expectedRevision: rec.revision, reason: R })).ok).toBe(true);
  });

  it('scorer sees "Protected player" for anyone not a confirmed adult (D-109); the organizer and the owner see the name', async () => {
    const { store, as } = await setup();
    const owner = ok(await store.competitionEvent({ eventId: COMP_SEED.eventWs }, OWNER));
    const unknown = owner.entries.flatMap((e) => e.players).find((p) => p.ageStatus !== 'adult_confirmed');
    expect(unknown).toBeDefined();
    const sco = ok(await as(SCO).competitionEvent({ eventId: COMP_SEED.eventWs }));
    const seen = sco.entries.flatMap((e) => e.players).find((p) => p.id === unknown!.id)!;
    expect(seen.displayName).toBe(PROTECTED_NAME);
    expect(JSON.stringify(sco)).not.toContain(unknown!.displayName);
    // confirmed adults keep their names for the scorer
    const adult = owner.entries.flatMap((e) => e.players).find((p) => p.ageStatus === 'adult_confirmed')!;
    expect(sco.entries.flatMap((e) => e.players).find((p) => p.id === adult.id)!.displayName).toBe(adult.displayName);
    const org = ok(await as(ORG).competitionEvent({ eventId: COMP_SEED.eventWs }));
    expect(JSON.stringify(org)).toContain(unknown!.displayName);
    // a junior event hides everyone from the scorer
    const junior = maskForScorer({ ...owner, event: { ...owner.event, isJunior: true } });
    expect(junior.entries.flatMap((e) => e.players).every((p) => p.displayName === PROTECTED_NAME)).toBe(true);
    // a masked player carries no age status for the scorer: the browser never learns who is a minor or unconfirmed
    for (const p of sco.entries.flatMap((e) => e.players)) {
      if (p.displayName === PROTECTED_NAME) expect(p.ageStatus).toBe('unknown');
    }
    expect(sco.entries.flatMap((e) => e.players).some((p) => p.ageStatus === 'minor_confirmed' || p.ageStatus === 'minor_suspected')).toBe(false);
  });

  it('a school_college tournament hides every name from the scorer, even a confirmed adult in an event not flagged junior (D-109)', async () => {
    const { store } = await setup();
    const owner = ok(await store.competitionEvent({ eventId: COMP_SEED.eventWs }, OWNER));
    expect(owner.entries.flatMap((e) => e.players).some((p) => p.ageStatus === 'adult_confirmed')).toBe(true);
    const school = maskForScorer({ ...owner, tournament: { ...owner.tournament, level: 'school_college' }, event: { ...owner.event, isJunior: false } });
    const players = school.entries.flatMap((e) => e.players);
    expect(players.every((p) => p.displayName === PROTECTED_NAME && p.ageStatus === 'unknown' && p.isProtected)).toBe(true);
  });

  it('a revoke, an ended account and the switch off take effect on the very next call', async () => {
    const { accounts, backend, as } = await setup();
    const o = as(ORG);
    expect((await o.competitionEvent({ eventId: COMP_SEED.eventMs })).ok).toBe(true);
    const a = accounts.assignments.find((x) => x.profileId === ORG.userId)!;
    await backend.revokeAssignment(OWNER, a.id, R);
    expect(await o.competitionEvent({ eventId: COMP_SEED.eventMs })).toEqual({ ok: false, code: 'FORBIDDEN' });
    expect(ok(await o.competitionTournaments())).toEqual([]);
    await backend.assignTournament(OWNER, ORG.userId, T1, R);
    expect((await o.competitionEvent({ eventId: COMP_SEED.eventMs })).ok).toBe(true);
    await backend.setOrganizerAccess(OWNER, false, R);
    expect(await o.competitionEvent({ eventId: COMP_SEED.eventMs })).toEqual({ ok: false, code: 'FORBIDDEN' });
    await backend.setOrganizerAccess(OWNER, true, R);
    await backend.disableAccount(OWNER, SCO.userId, R);
    expect(await as(SCO).competitionEvent({ eventId: COMP_SEED.eventMs })).toEqual({ ok: false, code: 'FORBIDDEN' });
  });

  it('an unknown id is refused like a foreign one (no hint that it does not exist); a lookup failure is a backend error', async () => {
    const { as, deps } = await setup();
    expect(await as(ORG).competitionWithdrawEntry(OWNER, { entryId: '99000000-0000-4000-8000-000000000001', reason: R })).toEqual({ ok: false, code: 'FORBIDDEN' });
    const broken = createScopedCompetitionStore(new MemoryAdminStore({ now: () => NOW }), ORG, { ...deps, assignments: async () => { throw new Error('down'); } });
    expect(await broken.competitionTournaments()).toEqual({ ok: false, code: 'BACKEND_ERROR' });
    expect(await checkScope(ORG, 'competition.event', { eventId: '' }, deps)).toEqual({ ok: false, why: 'target' });
    expect(await checkScope({ userId: ORG.userId, role: 'editor' }, 'competition.event', { eventId: COMP_SEED.eventMs }, deps)).toEqual({ ok: false, why: 'role' });
    expect(await checkScope(ORG, 'players.merge', {}, deps)).toEqual({ ok: false, why: 'action' });
  });

  it('a scorer assignment never satisfies organizer work, even on the same tournament', async () => {
    const { deps } = await setup();
    const v = await checkScope(SCO, 'competition.recordResult', { matchId: 'x' }, deps);
    expect(v).toEqual({ ok: false, why: 'target' });
    const asOrganizer = await checkScope({ userId: SCO.userId, role: 'organizer' }, 'competition.saveEvent', { tournamentId: T1, id: null }, deps);
    expect(asOrganizer).toEqual({ ok: false, why: 'target' });
  });
});
