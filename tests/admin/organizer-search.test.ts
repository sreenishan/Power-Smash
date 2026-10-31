// An organizer's player search, new provisional player and "On the site" preview (D-117/D-122, migration 0024), through the request
// handler with the memory store and the memory scope, and over Supabase with a fake fetch. Also proves the server refuses every area an
// organizer or scorer cannot see in the admin. Fictional data only.
import { describe, expect, it } from 'vitest';
import { competitionUiFor, OWNER_ONLY_COMPETITION_ACTIONS, scopedNeed } from '../../src/lib/admin/accounts/access';
import { createMemoryAccountsBackend, emptyAccountsState } from '../../src/lib/admin/accounts/memory-backend';
import { createScopedCompetitionStore, targetsOf } from '../../src/lib/admin/accounts/scoped-store';
import { COMP_SEED, createMemoryCompetitionBackend, emptyCompetitionState } from '../../src/lib/admin/competition/memory-backend';
import { createCompetitionService } from '../../src/lib/admin/competition/service';
import { createSupabaseCompetitionBackend } from '../../src/lib/admin/competition/supabase-backend';
import { newPlayerNameProblem } from '../../src/lib/admin/competition/validate';
import { MemoryAdminStore, SEED } from '../../src/lib/admin/memory-store';
import { ADMIN_ACTIONS, isActionAllowed } from '../../src/lib/admin/policy';
import { competitionDetail, createSupabaseAdminStore } from '../../src/lib/admin/supabase-store';
import type { Actor } from '../../src/lib/admin/types';
import { authDeps, makeHandler, makeKeys, NOW, OWNER_ID, req, signToken } from './_helpers';

const ORG = '9c000000-0000-4000-8000-000000000001'; // organizer of T1
const SCO = '9c000000-0000-4000-8000-000000000002'; // scorer of T1
const ORG2 = '9c000000-0000-4000-8000-000000000003'; // organizer of T2
const T1 = '20000000-0000-4000-8000-000000000001'; // the seed's Demo Open Cup (holds the competition sample)
const T2 = '20000000-0000-4000-8000-000000000002';
const R = 'fake reason';
const OWNER: Actor = { userId: OWNER_ID, role: 'owner' };
const ROLES: Record<string, Actor['role']> = { [OWNER_ID]: 'owner', [ORG]: 'organizer', [SCO]: 'scorer', [ORG2]: 'organizer' };
const json = async (r: Response) => (await r.json()) as { ok: boolean; code?: string; data?: any; errors?: Record<string, string> };

async function setup() {
  let n = 0;
  const store = new MemoryAdminStore({ now: () => NOW, newId: () => `95000000-0000-4000-8000-${String(++n).padStart(12, '0')}`, randomSeed: () => 7 });
  const accounts = (store.state.accounts ??= emptyAccountsState(OWNER_ID));
  const backend = createMemoryAccountsBackend({
    state: () => accounts,
    tournaments: () => [{ id: T1, name: 'Demo Open Cup', startDate: null }, { id: T2, name: 'Demo Other Cup', startDate: null }],
    audit: () => undefined,
    now: () => NOW,
    newId: () => `96000000-0000-4000-8000-${String(++n).padStart(12, '0')}`,
  });
  await backend.createAccount(OWNER, ORG, { role: 'organizer', displayName: 'Demo Organizer', tournamentIds: [T1] }, R);
  await backend.createAccount(OWNER, SCO, { role: 'scorer', displayName: 'Demo Scorer', tournamentIds: [T1] }, R);
  await backend.createAccount(OWNER, ORG2, { role: 'organizer', displayName: 'Demo Organizer Two', tournamentIds: [T2] }, R);
  await backend.setOrganizerAccess(OWNER, true, R);
  const keys = await makeKeys();
  const h = makeHandler(keys, { auth: { ...authDeps(keys), roles: async (id) => ROLES[id] ?? null, organizerAccountsEnabled: true }, scope: store.scopeDeps() }, store);
  const call = async (sub: string, action: string, body: unknown = {}) => h.handle(req(action, await signToken(keys, { sub, aal: 'aal2' }), body), action);
  return { store, call };
}

describe('the organizer actions in the policy and the role map', () => {
  it('search and new player are owner actions at aal2 in the table, reach organizers only through the per-tournament check, never scorers', () => {
    expect(ADMIN_ACTIONS['competition.searchPlayers']).toEqual({ kind: 'read', roles: ['owner'], requiresAal2: true, audited: false });
    expect(ADMIN_ACTIONS['competition.createPlayer']).toEqual({ kind: 'write', roles: ['owner'], requiresAal2: true, audited: true });
    expect(scopedNeed('organizer', 'competition.searchPlayers')).toBe('run');
    expect(scopedNeed('organizer', 'competition.createPlayer')).toBe('run');
    expect(scopedNeed('scorer', 'competition.searchPlayers')).toBeNull();
    expect(scopedNeed('scorer', 'competition.createPlayer')).toBeNull();
    // the owner's Players search and every player edit stay owner only
    for (const a of ['players.search', 'players.rename', 'players.merge', 'players.updateProfile', 'players.confirmAdult'] as const) {
      expect(scopedNeed('organizer', a)).toBeNull();
      expect(isActionAllowed('editor', a, { editorsEnabled: false })).toBe(false);
    }
    expect(targetsOf('competition.searchPlayers', { tournamentId: T1 })).toEqual([{ kind: 'tournament', id: T1 }]);
    expect(targetsOf('competition.createPlayer', {})).toEqual([{ kind: 'tournament', id: '' }]);
  });
  it('the screens follow the same map: the organizer searches by tournament and may add a new player; the scorer neither', () => {
    expect(competitionUiFor('owner')).toMatchObject({ playerSearch: 'owner', createPlayer: false, rankings: true, venues: true });
    expect(competitionUiFor('organizer')).toMatchObject({ playerSearch: 'tournament', createPlayer: true, rankings: false, venues: false, entries: true });
    expect(competitionUiFor('scorer')).toMatchObject({ playerSearch: null, createPlayer: false, entries: false, draw: false, schedule: false, courts: false, confirmResult: false, recordResult: true });
  });
  it('the new player name rule: a name only, 2 to 80 characters, no phone number or email', () => {
    expect(newPlayerNameProblem('Demo Newcomer Fakely')).toBeNull();
    expect(newPlayerNameProblem(' x ')).not.toBeNull();
    expect(newPlayerNameProblem('Demo 910000000000')).toMatch(/phone number or email/);
    expect(newPlayerNameProblem('fake@example.test')).toMatch(/phone number or email/);
    expect(newPlayerNameProblem('Demo <b>')).not.toBeNull();
  });
});

describe('competition.searchPlayers through the handler', () => {
  it('an assigned organizer finds players by name and gets only id and display name (no naming flag, D-012)', async () => {
    const { call } = await setup();
    const r = await json(await call(ORG, 'competition.searchPlayers', { tournamentId: T1, q: 'demo comp', limit: 10 }));
    expect(r.ok).toBe(true);
    expect(r.data.items.length).toBeGreaterThanOrEqual(5);
    for (const p of r.data.items) expect(Object.keys(p).sort()).toEqual(['displayName', 'id']);
    expect(Object.keys(r.data).sort()).toEqual(['hasMore', 'items']);
    expect(r.data.items.find((p: any) => p.id === COMP_SEED.anand)).toEqual({ id: COMP_SEED.anand, displayName: 'Demo Comp Anand Mockwell' });
    const unknown = await json(await call(ORG, 'competition.searchPlayers', { tournamentId: T1, q: 'Samplestone' }));
    // a protected player already entered in this tournament is found by part of the name
    expect(unknown.data.items).toEqual([{ id: SEED.p3, displayName: 'Demo Meena Samplestone' }]);
    // no age status, slug or visibility anywhere in the answer
    expect(JSON.stringify(r.data)).not.toMatch(/ageStatus|adult_confirmed|slug|visibility|provisional|named/);
  });
  it('pages: at most 25 at a time and says when there is more', async () => {
    const { call } = await setup();
    const one = await json(await call(ORG, 'competition.searchPlayers', { tournamentId: T1, q: 'demo comp', limit: 1 }));
    expect(one.data.items).toHaveLength(1);
    expect(one.data.hasMore).toBe(true);
    expect((await call(ORG, 'competition.searchPlayers', { tournamentId: T1, q: 'demo comp', limit: 26 })).status).toBe(400);
    expect((await call(ORG, 'competition.searchPlayers', { tournamentId: T1, q: 'de' })).status).toBe(400);
    expect((await call(ORG, 'competition.searchPlayers', { tournamentId: T1, q: 'demo', offset: 501 })).status).toBe(400);
  });
  it('refused for an unassigned tournament, an unknown one, a scorer and another tournament\'s organizer; the owner may search any', async () => {
    const { call } = await setup();
    expect((await call(ORG, 'competition.searchPlayers', { tournamentId: T2, q: 'demo comp' })).status).toBe(403);
    expect((await call(ORG, 'competition.searchPlayers', { tournamentId: '20000000-0000-4000-8000-0000000000ff', q: 'demo comp' })).status).toBe(403);
    expect((await call(SCO, 'competition.searchPlayers', { tournamentId: T1, q: 'demo comp' })).status).toBe(403);
    expect((await call(ORG2, 'competition.searchPlayers', { tournamentId: T1, q: 'demo comp' })).status).toBe(403);
    const owner = await json(await call(OWNER_ID, 'competition.searchPlayers', { tournamentId: T2, q: 'demo comp' }));
    expect(owner.ok).toBe(true);
    expect((await call(OWNER_ID, 'competition.searchPlayers', { tournamentId: '20000000-0000-4000-8000-0000000000ff', q: 'demo comp' })).status).toBe(404);
  });
});

describe('competition.createPlayer through the handler', () => {
  it('an assigned organizer adds a NEW provisional, hidden, unknown-age player scoped to nothing else; it can then be entered', async () => {
    const { call, store } = await setup();
    const r = await json(await call(ORG, 'competition.createPlayer', { tournamentId: T1, name: '  Demo Newcomer Fakely ', reason: R }));
    expect(r).toMatchObject({ ok: true, data: { displayName: 'Demo Newcomer Fakely', named: false } });
    const p = store.state.identity.players.find((x) => x.id === r.data.id)!;
    expect(p).toMatchObject({ ageStatus: 'unknown', provisional: true, visibility: 'hidden', mergedInto: null });
    expect(p.slug).toMatch(/^p-[0-9a-f]{16}$/);
    expect(store.state.audit[0]).toMatchObject({ actor: ORG, action: 'competition_create_player', entity: 'players', entityId: r.data.id });
    // the new player is found by the search and can be entered (doubles needs two; men's singles needs one)
    const found = await json(await call(ORG, 'competition.searchPlayers', { tournamentId: T1, q: 'newcomer' }));
    expect(found.data.items).toEqual([{ id: r.data.id, displayName: 'Demo Newcomer Fakely' }]);
    const add = await json(await call(ORG, 'competition.addEntry', { eventId: COMP_SEED.eventMs, players: [r.data.id], seed: null, status: 'pending', reason: R }));
    expect(add.ok).toBe(true);
  });
  it('never edits an existing player: an existing matching name, contact details or an age are refused', async () => {
    const { call, store } = await setup();
    const before = JSON.stringify(store.state.identity.players);
    const dup = await json(await call(ORG, 'competition.createPlayer', { tournamentId: T1, name: 'Demo Comp Anand Mockwell', reason: R }));
    expect(dup).toMatchObject({ ok: false, code: 'INVALID' });
    expect(dup.errors?.form).toMatch(/cannot be added here/);
    const phone = await json(await call(ORG, 'competition.createPlayer', { tournamentId: T1, name: 'Demo 910000000000', reason: R }));
    expect(phone).toMatchObject({ ok: false, code: 'INVALID', errors: { name: expect.stringMatching(/phone number or email/) } });
    expect((await call(ORG, 'competition.createPlayer', { tournamentId: T1, name: 'Demo Newcomer Fakely', ageStatus: 'adult_confirmed', reason: R })).status).toBe(400);
    expect((await call(ORG, 'competition.createPlayer', { tournamentId: T1, name: 'Demo Newcomer Fakely', playerId: SEED.p1, reason: R })).status).toBe(400);
    expect(JSON.stringify(store.state.identity.players)).toBe(before);
  });
  it('refused for a scorer, an unassigned tournament and another tournament\'s organizer', async () => {
    const { call, store } = await setup();
    const count = store.state.identity.players.length;
    expect((await call(SCO, 'competition.createPlayer', { tournamentId: T1, name: 'Demo Newcomer Fakely', reason: R })).status).toBe(403);
    expect((await call(ORG, 'competition.createPlayer', { tournamentId: T2, name: 'Demo Newcomer Fakely', reason: R })).status).toBe(403);
    expect((await call(ORG2, 'competition.createPlayer', { tournamentId: T1, name: 'Demo Newcomer Fakely', reason: R })).status).toBe(403);
    expect(store.state.identity.players).toHaveLength(count);
  });
});

describe('the "On the site" preview for an organizer', () => {
  it('the organizer now sees the same naming as the owner (not everyone protected); the scorer still sees masked names', async () => {
    const { call } = await setup();
    const owner = await json(await call(OWNER_ID, 'competition.event', { eventId: COMP_SEED.eventWs }));
    const org = await json(await call(ORG, 'competition.event', { eventId: COMP_SEED.eventWs }));
    const flags = (d: any) => d.entries.map((e: any) => [e.id, e.isProtected, e.players.map((p: any) => p.isProtected)]);
    expect(flags(org.data)).toEqual(flags(owner.data));
    // the sample has two named adults and one player of unknown age
    expect(org.data.entries.filter((e: any) => e.isProtected)).toHaveLength(1);
    expect(org.data.entries.find((e: any) => e.isProtected).players[0].displayName).toBe('Demo Meena Samplestone');
    const sco = await json(await call(SCO, 'competition.event', { eventId: COMP_SEED.eventWs }));
    expect(sco.data.entries.find((e: any) => e.players[0].id === SEED.p3).players[0].displayName).toBe('Protected player');
    expect((await call(ORG2, 'competition.event', { eventId: COMP_SEED.eventWs })).status).toBe(403);
  });
  it('a failing scoped naming read never breaks the event screen: nobody is named (fail closed)', async () => {
    const st = emptyCompetitionState();
    st.events.push({ id: COMP_SEED.eventMs, tournamentId: T1, category: 'MS', ageGroup: null, isJunior: false, format: 'knockout', ruleset: { gamesToWin: 2, pointsToWin: 21, winBy: 2, pointCap: 30, intervalAt: 11, changeEndsInDecidingGameAt: 11 }, capacity: 8, status: 'open' });
    st.entries.push({ id: '82000000-0000-4000-8000-000000000001', eventId: COMP_SEED.eventMs, players: [COMP_SEED.anand], seed: null, status: 'confirmed' });
    const backend = createMemoryCompetitionBackend({
      state: () => st,
      players: () => [{ id: COMP_SEED.anand, displayName: 'Demo Comp Anand Mockwell', ageStatus: 'adult_confirmed', academy: null }],
      tournaments: () => [{ id: T1, name: 'Demo Open Cup', level: 'district', startDate: null, endDate: null, minorSignal: false, status: 'published' }],
      rankable: (ids) => [...ids],
      audit: () => undefined,
      markDirty: () => undefined,
      now: () => NOW,
      newId: () => 'x',
    });
    const svc = createCompetitionService({ ...backend, eventNamedPlayerIds: async () => { throw new Error('refused'); } });
    const r = await svc.competitionEvent({ eventId: COMP_SEED.eventMs }, { userId: ORG, role: 'organizer' });
    expect(r.ok && r.data.entries[0]!.isProtected).toBe(true);
    const owner = await svc.competitionEvent({ eventId: COMP_SEED.eventMs }, OWNER);
    expect(owner.ok && owner.data.entries[0]!.isProtected).toBe(false);
    const scorer = await svc.competitionEvent({ eventId: COMP_SEED.eventMs }, { userId: SCO, role: 'scorer' });
    expect(scorer.ok && scorer.data.entries[0]!.isProtected).toBe(true);
  });
});

describe('the memory backend applies the suppression list to the organizer search', () => {
  it('a suppressed id or matching name is never found, and a suppressed name cannot be added', async () => {
    const backend = createMemoryCompetitionBackend({
      state: emptyCompetitionState,
      players: () => [
        { id: 'a', displayName: 'Demo Keep Fakely', ageStatus: 'adult_confirmed', academy: null },
        { id: 'b', displayName: 'Demo Gone Fakely', ageStatus: 'unknown', academy: null },
      ],
      tournaments: () => [{ id: T1, name: 'Demo Open Cup', level: null, startDate: null, endDate: null, minorSignal: false, status: 'published' }],
      rankable: (ids) => ids.filter((x) => x === 'a'),
      suppressed: (p) => p.id === 'b' || p.nameNormalized === 'demo hidden fakely',
      addPlayer: () => 'new',
      audit: () => undefined,
      markDirty: () => undefined,
      now: () => NOW,
      newId: () => 'x',
    });
    const page = await backend.searchPlayersForTournament(OWNER, T1, 'fakely', 10, 0);
    expect(page).toEqual({ items: [{ id: 'a', displayName: 'Demo Keep Fakely' }], hasMore: false });
    // one neutral refusal for a name on the removal list, a hidden (suppressed) player and an ordinary existing one
    const removal = await backend.createProvisionalPlayer(OWNER, T1, { name: 'Demo Hidden Fakely', nameNormalized: 'demo hidden fakely' }, R).catch((e) => e);
    const hidden = await backend.createProvisionalPlayer(OWNER, T1, { name: 'Demo Gone Fakely', nameNormalized: 'demo gone fakely' }, R).catch((e) => e);
    const existing = await backend.createProvisionalPlayer(OWNER, T1, { name: 'Demo Keep Fakely', nameNormalized: 'demo keep fakely' }, R).catch((e) => e);
    expect(removal).toMatchObject({ code: 'INVALID' });
    expect(hidden.message + hidden.detail).toBe(removal.message + removal.detail);
    expect(existing.message + existing.detail).toBe(removal.message + removal.detail);
    expect(String(removal.detail ?? removal.message)).not.toMatch(/removal|exists|hidden|suppress/);
  });
});

describe('an organizer never lists protected players they never dealt with (D-012)', () => {
  it("part of the name finds only named players and this tournament's own; the exact full name finds anyone unsuppressed", async () => {
    const st = emptyCompetitionState();
    st.events.push({ id: COMP_SEED.eventMs, tournamentId: T1, category: 'MS', ageGroup: null, isJunior: false, format: 'knockout', ruleset: { gamesToWin: 2, pointsToWin: 21, winBy: 2, pointCap: 30, intervalAt: 11, changeEndsInDecidingGameAt: 11 }, capacity: 8, status: 'open' });
    st.entries.push({ id: '82000000-0000-4000-8000-000000000001', eventId: COMP_SEED.eventMs, players: ['c'], seed: null, status: 'confirmed' });
    const players = [
      { id: 'a', displayName: 'Demo Arch Adult', ageStatus: 'adult_confirmed' as const, academy: null },
      { id: 'b', displayName: 'Demo Arch Junior', ageStatus: 'minor_confirmed' as const, academy: null },
      { id: 'c', displayName: 'Demo Arch Entered', ageStatus: 'unknown' as const, academy: null },
    ];
    const backend = createMemoryCompetitionBackend({
      state: () => st,
      players: () => players,
      tournaments: () => [T1, T2].map((id) => ({ id, name: 'Demo Cup', level: null, startDate: null, endDate: null, minorSignal: false, status: 'published' })),
      rankable: (ids) => ids.filter((x) => x === 'a'),
      addPlayer: (p) => {
        players.push({ id: 'n', displayName: p.displayName, ageStatus: 'unknown', academy: null });
        return 'n';
      },
      audit: () => undefined,
      markDirty: () => undefined,
      now: () => NOW,
      newId: () => 'x',
    });
    const org: Actor = { userId: ORG, role: 'organizer' };
    const ids = async (a: Actor, t: string, q: string) => (await backend.searchPlayersForTournament(a, t, q, 25, 0)).items.map((p) => p.id).sort();
    expect(await ids(org, T1, 'demo arch')).toEqual(['a', 'c']);
    expect(await ids(org, T2, 'demo arch')).toEqual(['a']);
    expect(await ids(org, T1, 'arch jun')).toEqual([]);
    expect(await ids(org, T2, 'demo arch junior')).toEqual(['b']);
    expect(await ids(OWNER, T2, 'demo arch')).toEqual(['a', 'b', 'c']);
    // a new player added for T1 is found by part of the name in T1 only
    await backend.createProvisionalPlayer(org, T1, { name: 'Demo Arch Newcomer', nameNormalized: 'demo arch newcomer' }, R);
    expect(await ids(org, T1, 'newcomer')).toEqual(['n']);
    expect(await ids(org, T2, 'newcomer')).toEqual([]);
  });
});

describe('the organizer RPCs over Supabase (fake fetch)', () => {
  const URL_OK = 'https://fakeref.supabase.co';
  const SECRET = ['sb', 'secret', 'FAKE'].join('_');
  it('search and new player call the 0024 RPCs with the verified actor; extra fields from the database never reach the screen', async () => {
    const calls: [string, Record<string, unknown>][] = [];
    const b = createSupabaseCompetitionBackend({
      select: async () => [],
      rpc: async <T,>(name: string, args: Record<string, unknown>) => {
        calls.push([name, args]);
        if (name === 'admin_competition_search_players') return { items: [{ id: 'p1', displayName: 'Demo One', named: true, ageStatus: 'adult_confirmed', phone: '910000000000' }, { id: 7 }], hasMore: 'yes' } as T;
        if (name === 'admin_competition_event_naming') return [{ playerId: 'p1', named: true }, { playerId: 'p2', named: false }, { playerId: 3, named: true }] as T;
        return { id: 'n1', displayName: 'Demo New', named: false, extra: 1 } as T;
      },
    });
    const actor: Actor = { userId: ORG, role: 'organizer' };
    expect(await b.searchPlayersForTournament(actor, T1, 'demo', 10, 0)).toEqual({ items: [{ id: 'p1', displayName: 'Demo One' }], hasMore: false });
    expect(await b.createProvisionalPlayer(actor, T1, { name: 'Demo New', nameNormalized: 'demo new' }, R)).toEqual({ id: 'n1', displayName: 'Demo New', named: false });
    expect(await b.eventNamedPlayerIds(actor, COMP_SEED.eventMs)).toEqual(['p1']);
    expect(calls).toEqual([
      ['admin_competition_search_players', { p_actor: ORG, p_tournament: T1, p_query: 'demo', p_limit: 10, p_offset: 0 }],
      ['admin_competition_create_player', { p_actor: ORG, p_tournament: T1, p_record: { name: 'Demo New', nameNormalized: 'demo new' }, p_reason: R }],
      ['admin_competition_event_naming', { p_actor: ORG, p_event: COMP_SEED.eventMs }],
    ]);
  });
  it('the database\'s own refusal sentences of the new RPCs reach the organizer; the naming read is not on that list', () => {
    expect(competitionDetail('rpc/admin_competition_create_player', 'INVALID: this name cannot be added here; choose the player from the list, or ask the owner')).toMatch(/cannot be added here/);
    expect(competitionDetail('rpc/admin_competition_search_players', 'INVALID: type at least 3 letters of the name')).toMatch(/3 letters/);
    expect(competitionDetail('rpc/admin_competition_event_naming', 'NOT_FOUND: event not found')).toBeUndefined();
  });
  it('the service normalises the query and the name before the database sees them', async () => {
    const calls: { url: string; body: any }[] = [];
    const f = (async (url: string, init: RequestInit) => {
      calls.push({ url, body: init.body ? JSON.parse(init.body as string) : undefined });
      if (url.includes('/rpc/admin_competition_search_players')) return new Response(JSON.stringify({ items: [], hasMore: false }), { status: 200 });
      if (url.includes('/rpc/')) return new Response(JSON.stringify({ id: 'n1', displayName: 'Demo New' }), { status: 200 });
      return new Response(JSON.stringify([{ id: T1, name: 'Demo Open Cup', level: null, start_date: null, end_date: null, is_minor_signal: false, status: 'published' }]), { status: 200 });
    }) as unknown as typeof fetch;
    const store = createSupabaseAdminStore({ url: URL_OK, secretKey: SECRET, fetch: f, now: () => NOW });
    const actor: Actor = { userId: ORG, role: 'organizer' };
    expect((await store.competitionSearchPlayers(actor, { tournamentId: T1, q: '  DEMO.Comp ', limit: 10, offset: 0 })).ok).toBe(true);
    expect((await store.competitionCreatePlayer(actor, { tournamentId: T1, name: ' Demo  New ', reason: R })).ok).toBe(true);
    const rpcs = calls.filter((c) => c.url.includes('/rpc/'));
    expect(rpcs[0]!.body).toMatchObject({ p_query: 'demo comp' });
    expect(rpcs[1]!.body).toMatchObject({ p_record: { name: 'Demo  New', nameNormalized: 'demo new' } });
    // too short after normalising: refused before the database
    const short = await store.competitionSearchPlayers(actor, { tournamentId: T1, q: 'A...', limit: 10, offset: 0 });
    expect(short).toMatchObject({ ok: false, code: 'INVALID', errors: { q: expect.any(String) } });
  });
});

describe('the server refuses every area the admin hides from an organizer or scorer', () => {
  const OWNER_AREAS = ['dashboard', 'review.list', 'players.search', 'players.rename', 'tournaments.approved', 'leads.list', 'payments.list', 'submissions.list', 'placements.list', 'products.list', 'products.save', 'live.get', 'posters.list', 'settings.get', 'audit.list', 'accounts.list', 'accounts.invite', 'registrations.list', 'international.list', 'notices.list', 'notices.save', 'competition.liveSettings', 'competition.saveLiveSettings'];
  it('an organizer: rankings, the points table, venues, settings and every non-competition area are refused', async () => {
    const { call } = await setup();
    for (const a of [...OWNER_ONLY_COMPETITION_ACTIONS, ...OWNER_AREAS].filter((x) => x in ADMIN_ACTIONS)) {
      expect((await call(ORG, a, {})).status, a).toBe(403);
    }
  });
  it('a scorer: also every organizer job (entries, draws, matches, courts, schedule, confirming, players)', async () => {
    const { call } = await setup();
    const organizerJobs = ['competition.saveEvent', 'competition.addEntry', 'competition.withdrawEntry', 'competition.setEntry', 'competition.generateDraw', 'competition.publishDraw', 'competition.syncMatches', 'competition.saveMatch', 'competition.schedule', 'competition.confirmResult', 'competition.saveCourt', 'competition.courts', 'competition.searchPlayers', 'competition.createPlayer'];
    for (const a of [...OWNER_ONLY_COMPETITION_ACTIONS, ...OWNER_AREAS, ...organizerJobs].filter((x) => x in ADMIN_ACTIONS)) {
      expect((await call(SCO, a, {})).status, a).toBe(403);
    }
  });
  it('the scoped store refuses the owner-only methods even when called directly', async () => {
    const { store } = await setup();
    const scoped = createScopedCompetitionStore(store, { userId: ORG, role: 'organizer' }, store.scopeDeps());
    expect(await scoped.competitionRankings()).toMatchObject({ ok: false, code: 'FORBIDDEN' });
    expect(await scoped.competitionSaveVenue(OWNER, { id: null, name: 'Demo Hall', city: null, reason: R })).toMatchObject({ ok: false, code: 'FORBIDDEN' });
    expect((await scoped.competitionSearchPlayers(OWNER, { tournamentId: T1, q: 'demo comp', limit: 5, offset: 0 })).ok).toBe(true);
  });
});
