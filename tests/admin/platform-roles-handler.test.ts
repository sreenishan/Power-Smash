// Integration of platform waves 4 and 5 into the admin handler (D-108, D-111 to D-114): organizers and scorers reach only the
// competition and live scoring actions of their own tournaments (the per-tournament check before the store), plus the staff notices;
// the owner is unchanged; every new area answers through the handler. Runs the memory store (fictional seed) and the memory scope.
import { describe, expect, it } from 'vitest';
import { LIVE_SCOPED, SCOPED_ACTION_NEEDS } from '../../src/lib/admin/accounts/access';
import { createMemoryAccountsBackend, emptyAccountsState } from '../../src/lib/admin/accounts/memory-backend';
import { INVITE_MESSAGES } from '../../src/lib/admin/accounts/service';
import { COMP_SEED } from '../../src/lib/admin/competition/memory-backend';
import { LIVE_SCORING_ACCESS } from '../../src/lib/admin/live-scoring/schemas';
import { MemoryAdminStore, MEMORY_PREVIEW_OWNER_ID } from '../../src/lib/admin/memory-store';
import { ADMIN_ACTIONS, SESSION_ROLE_ACTION } from '../../src/lib/admin/policy';
import type { Actor } from '../../src/lib/admin/types';
import { authDeps, EDITOR_ID, makeHandler, makeKeys, NOW, OWNER_ID, req, signToken } from './_helpers';

const ORG = '9c000000-0000-4000-8000-000000000001'; // organizer of T1
const SCO = '9c000000-0000-4000-8000-000000000002'; // scorer of T1
const ORG2 = '9c000000-0000-4000-8000-000000000003'; // organizer of T2
const SCO2 = '9c000000-0000-4000-8000-000000000004'; // scorer of T2
const T1 = '20000000-0000-4000-8000-000000000001'; // the seed's Demo Open Cup (holds the competition sample)
const T2 = '20000000-0000-4000-8000-000000000002';
const R = 'fake reason';
const OWNER: Actor = { userId: OWNER_ID, role: 'owner' };

const ROLES: Record<string, Actor['role']> = { [OWNER_ID]: 'owner', [EDITOR_ID]: 'editor', [ORG]: 'organizer', [SCO]: 'scorer', [ORG2]: 'organizer', [SCO2]: 'scorer' };
const json = async (r: Response) => (await r.json()) as { ok: boolean; code?: string; data?: any; errors?: Record<string, string> };

async function setup(opts: { organizersOn?: boolean; editorsEnabled?: boolean; factorCount?: number } = {}) {
  let n = 0;
  const store = new MemoryAdminStore({ now: () => NOW, newId: () => `93000000-0000-4000-8000-${String(++n).padStart(12, '0')}`, randomSeed: () => 7 });
  const accounts = (store.state.accounts ??= emptyAccountsState(OWNER_ID));
  const backend = createMemoryAccountsBackend({
    state: () => accounts,
    tournaments: () => [{ id: T1, name: 'Demo Open Cup', startDate: null }, { id: T2, name: 'Demo Other Cup', startDate: null }],
    audit: () => undefined,
    now: () => NOW,
    newId: () => `94000000-0000-4000-8000-${String(++n).padStart(12, '0')}`,
  });
  await backend.createAccount(OWNER, ORG, { role: 'organizer', displayName: 'Demo Organizer', tournamentIds: [T1] }, R);
  await backend.createAccount(OWNER, SCO, { role: 'scorer', displayName: 'Demo Scorer', tournamentIds: [T1] }, R);
  await backend.createAccount(OWNER, ORG2, { role: 'organizer', displayName: 'Demo Organizer Two', tournamentIds: [T2] }, R);
  await backend.createAccount(OWNER, SCO2, { role: 'scorer', displayName: 'Demo Scorer Two', tournamentIds: [T2] }, R);
  await backend.setOrganizerAccess(OWNER, true, R);
  const keys = await makeKeys();
  const h = makeHandler(
    keys,
    {
      auth: { ...authDeps(keys, { editorsEnabled: opts.editorsEnabled ?? false }), roles: async (id) => ROLES[id] ?? null, organizerAccountsEnabled: opts.organizersOn ?? true },
      scope: store.scopeDeps(),
      factorCount: async () => opts.factorCount ?? 0,
    },
    store,
  );
  const tokenFor = (sub: string, aal: string = 'aal2') => signToken(keys, { sub, aal });
  const call = async (sub: string, action: string, body: unknown = {}, aal = 'aal2') => h.handle(req(action, await tokenFor(sub, aal), body), action);
  return { store, accounts, call };
}

/** Publishes the seed's men's singles draw as the owner and returns a playable match. */
async function playableMatch(store: MemoryAdminStore) {
  const g = await store.competitionGenerateDraw(OWNER, { eventId: COMP_SEED.eventMs, seed: 42, separateClubs: false, seeds: 2, reason: R });
  if (!g.ok) throw new Error('draw');
  await store.competitionPublishDraw(OWNER, { eventId: COMP_SEED.eventMs, drawId: g.data.drawId, reason: R });
  const d = await store.competitionEvent({ eventId: COMP_SEED.eventMs }, OWNER);
  if (!d.ok) throw new Error('event');
  const m = d.data.matches.find((x) => x.sideA !== null && x.sideB !== null && !x.confirmed);
  if (!m) throw new Error('no playable match');
  return m;
}

describe('the policy table carries every wave 4 and 5 action', () => {
  it('accounts, live scoring, registrations, international and notices are all owner-only actions at aal2', () => {
    for (const a of ['accounts.list', 'accounts.invite', 'competition.liveScore', 'competition.saveLiveSettings', 'registrations.convert', 'international.saveHosts', 'notices.save', 'notices.staff', 'notify.dispatch']) {
      expect(ADMIN_ACTIONS[a as keyof typeof ADMIN_ACTIONS], a).toMatchObject({ roles: ['owner'], requiresAal2: true });
    }
    expect(ADMIN_ACTIONS['registrations.list'].kind).toBe('read');
    expect(ADMIN_ACTIONS['notify.dispatch'].kind).toBe('write');
  });
  it('the scoped live map is exactly the non-owner entries of LIVE_SCORING_ACCESS', () => {
    const fromSchemas = Object.fromEntries(Object.entries(LIVE_SCORING_ACCESS).filter(([, v]) => v !== 'owner'));
    expect(LIVE_SCOPED).toEqual(fromSchemas);
    for (const role of ['organizer', 'scorer'] as const) {
      expect(SCOPED_ACTION_NEEDS[role]['competition.liveSettings']).toBeUndefined();
      expect(SCOPED_ACTION_NEEDS[role]['competition.saveLiveSettings']).toBeUndefined();
    }
  });
});

describe('an organizer through the handler (switch on, aal2)', () => {
  it('reads an event of an assigned tournament; refused on another tournament, rankings, accounts and every other area', async () => {
    const { call } = await setup();
    expect((await call(ORG, 'competition.event', { eventId: COMP_SEED.eventMs })).status).toBe(200);
    expect((await call(ORG2, 'competition.event', { eventId: COMP_SEED.eventMs })).status).toBe(403);
    for (const [action, body] of [
      ['competition.rankings', {}],
      ['competition.liveSettings', {}],
      ['accounts.list', {}],
      ['dashboard', {}],
      ['registrations.events', {}],
      ['international.list', {}],
      ['notices.list', {}],
    ] as const) {
      expect((await call(ORG, action, body)).status, action).toBe(403);
    }
  });
  it('the tournament list and the live match list hold only the assigned tournaments', async () => {
    const { call, store } = await setup();
    await playableMatch(store);
    const own = await json(await call(ORG, 'competition.tournaments'));
    expect(own.data.map((t: { id: string }) => t.id)).toEqual([T1]);
    const other = await json(await call(ORG2, 'competition.tournaments'));
    expect(other.data.map((t: { id: string }) => t.id)).not.toContain(T1);
    const live = await json(await call(ORG, 'competition.liveMatches'));
    expect(live.ok).toBe(true);
    expect(live.data.length).toBeGreaterThan(0);
    expect(live.data.every((m: { tournamentId: string }) => m.tournamentId === T1)).toBe(true);
    expect((await json(await call(ORG2, 'competition.liveMatches'))).data).toEqual([]);
  });
  it('reads the published staff notices (no tournament involved)', async () => {
    const { call } = await setup();
    const r = await json(await call(ORG, 'notices.staff'));
    expect(r.ok).toBe(true);
    expect(Array.isArray(r.data)).toBe(true);
  });
  it('switch off, or aal1: refused everywhere', async () => {
    const off = await setup({ organizersOn: false });
    expect((await off.call(ORG, 'competition.event', { eventId: COMP_SEED.eventMs })).status).toBe(403);
    expect((await off.call(ORG, 'notices.staff')).status).toBe(403);
    const on = await setup();
    expect((await on.call(ORG, 'competition.event', { eventId: COMP_SEED.eventMs }, 'aal1')).status).toBe(403);
  });
  it('the database switch off (Accounts screen) refuses the next call', async () => {
    const { call, accounts } = await setup();
    accounts.organizerAccess = false;
    expect((await call(ORG, 'competition.event', { eventId: COMP_SEED.eventMs })).status).toBe(403);
  });
});

describe('a scorer through the handler', () => {
  it('records a result on an assigned tournament, never confirms it; a scorer of another tournament is refused', async () => {
    const { call, store } = await setup();
    const m = await playableMatch(store);
    const win = { status: 'completed', games: [{ a: 21, b: 10 }, { a: 21, b: 12 }], walkoverWinner: null, retiringSide: null };
    expect((await call(SCO2, 'competition.recordResult', { matchId: m.id, expectedRevision: m.revision, ...win, reason: R })).status).toBe(403);
    const rec = await call(SCO, 'competition.recordResult', { matchId: m.id, expectedRevision: m.revision, ...win, reason: R });
    expect(rec.status).toBe(200);
    const after = await store.competitionEvent({ eventId: COMP_SEED.eventMs }, OWNER);
    const m2 = after.ok ? after.data.matches.find((x) => x.id === m.id)! : null;
    expect((await call(SCO, 'competition.confirmResult', { matchId: m.id, expectedRevision: m2!.revision, reason: R })).status).toBe(403);
    expect((await call(ORG, 'competition.confirmResult', { matchId: m.id, expectedRevision: m2!.revision, reason: R })).status).toBe(200);
  });
  it('opens the live console of an assigned match only; the live switch stays the owner\'s', async () => {
    const { call, store } = await setup();
    const m = await playableMatch(store);
    expect((await call(SCO, 'competition.liveMatch', { matchId: m.id })).status).toBe(200);
    expect((await call(SCO2, 'competition.liveMatch', { matchId: m.id })).status).toBe(403);
    expect((await call(SCO, 'competition.saveLiveSettings', { public: true, windowSeconds: 300, reason: R })).status).toBe(403);
    expect((await call(OWNER_ID, 'competition.liveSettings')).status).toBe(200);
  });
  it('sees "Protected player" for anyone who is not a confirmed adult', async () => {
    const { call } = await setup();
    const r = await json(await call(SCO, 'competition.event', { eventId: COMP_SEED.eventWs }));
    expect(r.ok).toBe(true);
    const names = r.data.entries.flatMap((e: { players: { displayName: string; ageStatus: string }[] }) => e.players).filter((p: { ageStatus: string }) => p.ageStatus !== 'adult_confirmed');
    expect(names.length).toBeGreaterThan(0);
    for (const p of names) expect(p.displayName).toBe('Protected player');
  });
});

describe('the session role and the first-factor check for the wider roles', () => {
  it('answers the caller\'s own role at aal2, only for a role that may use the admin now', async () => {
    const on = await setup();
    expect((await json(await on.call(OWNER_ID, SESSION_ROLE_ACTION))).data).toEqual({ role: 'owner' });
    expect((await json(await on.call(SCO, SESSION_ROLE_ACTION))).data).toEqual({ role: 'scorer' });
    expect((await on.call(SCO, SESSION_ROLE_ACTION, {}, 'aal1')).status).toBe(403);
    expect((await on.call(EDITOR_ID, SESSION_ROLE_ACTION)).status).toBe(403);
    expect((await on.call('9c000000-0000-4000-8000-0000000000ff', SESSION_ROLE_ACTION)).status).toBe(403);
    const off = await setup({ organizersOn: false });
    expect((await off.call(ORG, SESSION_ROLE_ACTION)).status).toBe(403);
  });
  it('an invited organizer may enrol a first factor at aal1 only while organizer accounts are on', async () => {
    const on = await setup();
    expect((await json(await on.call(ORG, 'session.enrolCheck', {}, 'aal1'))).data).toEqual({ allowed: true });
    const off = await setup({ organizersOn: false });
    expect((await off.call(ORG, 'session.enrolCheck', {}, 'aal1')).status).toBe(403);
  });
});

describe('the owner reaches every new area through the handler', () => {
  it('accounts, registrations, international, notices and live scoring answer', async () => {
    const { call } = await setup();
    for (const action of ['accounts.list', 'registrations.settings', 'registrations.events', 'international.list', 'notices.list', 'notices.staff', 'notify.summary', 'competition.liveMatches', 'competition.liveSettings']) {
      const r = await json(await call(OWNER_ID, action));
      expect(r.ok, action).toBe(true);
    }
  });
  it('the memory store never sends an invitation (the preview says so)', async () => {
    const { call } = await setup();
    const r = await json(await call(OWNER_ID, 'accounts.invite', { email: 'fake@example.test', role: 'scorer', displayName: 'Demo Person', tournamentIds: [T1], reason: R }));
    expect(r.ok).toBe(false);
    expect(Object.values(r.errors ?? {}).join(' ')).toContain(INVITE_MESSAGES.not_available);
  });
  it('strict schemas: an unknown field is refused before the store', async () => {
    const { call } = await setup();
    expect((await call(OWNER_ID, 'registrations.list', { eventId: COMP_SEED.eventMs, phone: '910000000000' })).status).toBe(400);
    expect((await call(OWNER_ID, 'notices.publish', { id: 'x', published: true, expectedRevision: 1, reason: R })).status).toBe(400);
  });
  it('an editor (even with editors on) is refused registrations, accounts and notices', async () => {
    const { call } = await setup({ editorsEnabled: true });
    expect((await call(EDITOR_ID, 'registrations.convert', { registrationId: COMP_SEED.eventMs, players: [{ newName: 'Demo New' }], status: 'pending', expectedRevision: 1, reason: R })).status).toBe(403);
    expect((await call(EDITOR_ID, 'accounts.list')).status).toBe(403);
    expect((await call(EDITOR_ID, 'notices.save', {})).status).toBe(403);
  });
  it('the preview owner id is the memory accounts owner', () => {
    expect(MEMORY_PREVIEW_OWNER_ID).toBe('preview-owner');
  });
});
