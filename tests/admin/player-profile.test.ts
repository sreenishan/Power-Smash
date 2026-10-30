// An ADULT player's district, academy and bio (0012, D-012, D-100): the shared rule, the memory store through the real handler, and the
// Supabase store with a fake PostgREST. A protected player (unknown age, suspected or confirmed minor) has no profile anywhere. Fictional data only.
import { describe, expect, it } from 'vitest';
import { SEED } from '../../src/lib/admin/memory-store';
import { ADMIN_ACTIONS } from '../../src/lib/admin/policy';
import { changedProfileFields, PROFILE_ADULT_ONLY, validatePlayerProfile } from '../../src/lib/admin/player-profile';
import { createSupabaseAdminStore } from '../../src/lib/admin/supabase-store';
import { EDITOR_ID, makeHandler, makeKeys, req, signToken } from './_helpers';

const json = async (r: Response) => (await r.json()) as { ok: boolean; code?: string; errors?: Record<string, string>; data?: any };
const BIO = 'Demo bio line one.\nPlays doubles at a fictional club.';

async function setup() {
  const keys = await makeKeys();
  const h = makeHandler(keys);
  const token = await signToken(keys);
  return { ...h, keys, call: (action: string, body: unknown = {}, t = token) => h.handle(req(action, t, body), action) };
}

describe('the profile rule (shared by the schema, both stores and the screen)', () => {
  it('refuses every protected age status with the plain-English reason', () => {
    for (const s of ['unknown', 'minor_suspected', 'minor_confirmed'] as const) {
      expect(validatePlayerProfile({ district: 'Demo District' }, s)).toEqual({ ok: false, errors: { form: PROFILE_ADULT_ONLY } });
    }
  });
  it('trims, turns empty text into "not stated" and keeps line breaks in the bio only', () => {
    const v = validatePlayerProfile({ district: '  Demo District ', academy: '   ', bio: BIO }, 'adult_confirmed');
    expect(v).toEqual({ ok: true, value: { district: 'Demo District', academy: null, bio: BIO } });
    expect(validatePlayerProfile({ district: 'Demo\nDistrict' }, 'adult_confirmed').ok).toBe(false);
    expect(validatePlayerProfile({ bio: 'Demo\u0007bell' }, 'adult_confirmed').ok).toBe(false);
  });
  it('limits district 60, academy 120, bio 600 characters (after trimming)', () => {
    const ok = validatePlayerProfile({ district: 'd'.repeat(60), academy: 'a'.repeat(120), bio: ` ${'b'.repeat(600)} ` }, 'adult_confirmed');
    expect(ok.ok).toBe(true);
    const bad = validatePlayerProfile({ district: 'd'.repeat(61), academy: 'a'.repeat(121), bio: 'b'.repeat(601) }, 'adult_confirmed');
    expect(bad.ok).toBe(false);
    if (!bad.ok) expect(Object.keys(bad.errors).sort()).toEqual(['academy', 'bio', 'district']);
  });
  it('reports the names of changed fields only', () => {
    expect(changedProfileFields({ district: null, academy: 'A', bio: null }, { district: 'D', academy: 'A', bio: null })).toEqual(['district']);
  });
});

describe('memory store through the handler', () => {
  it('both actions are owner-only, and the write is audited', () => {
    expect(ADMIN_ACTIONS['players.getProfile']).toMatchObject({ kind: 'read', roles: ['owner'], requiresAal2: true });
    expect(ADMIN_ACTIONS['players.updateProfile']).toMatchObject({ kind: 'write', roles: ['owner'], requiresAal2: true, audited: true });
  });

  it('an adult: saves, audits the field names only (never the bio text) and marks the site dirty', async () => {
    const s = await setup();
    s.store.state.siteDirty = false;
    expect((await json(await s.call('players.getProfile', { playerId: SEED.p1 }))).data).toEqual({ district: null, academy: null, bio: null });
    const r = await s.call('players.updateProfile', { playerId: SEED.p1, district: 'Demo District', academy: 'Demo Shuttle Club', bio: BIO, reason: 'Profile edited by owner' });
    expect(r.status).toBe(200);
    expect((await json(r)).data).toEqual({ playerId: SEED.p1, fields: ['district', 'academy', 'bio'] });
    expect((await json(await s.call('players.getProfile', { playerId: SEED.p1 }))).data).toEqual({ district: 'Demo District', academy: 'Demo Shuttle Club', bio: BIO });
    const row = s.store.state.audit[0]!;
    expect(row).toMatchObject({ action: 'player.update_profile', entity: 'player', entityId: SEED.p1, reason: 'district, academy, bio' });
    expect(JSON.stringify(s.store.state.audit)).not.toContain('fictional club');
    expect(s.store.state.siteDirty).toBe(true);
  });

  it('an unchanged save writes nothing and is not audited', async () => {
    const s = await setup();
    const body = { playerId: SEED.p1, district: 'Demo District', academy: null, bio: null, reason: 'Profile edited by owner' };
    await s.call('players.updateProfile', body);
    const audits = s.store.state.audit.length;
    s.store.state.siteDirty = false;
    const again = await s.call('players.updateProfile', { ...body, district: '  Demo District  ' });
    expect((await json(again)).data).toEqual({ playerId: SEED.p1, fields: [] });
    expect(s.store.state.audit).toHaveLength(audits);
    expect(s.store.state.siteDirty).toBe(false);
  });

  it('unknown-age and suspected-minor players: no profile is read, a write is refused, nothing is stored or audited', async () => {
    const s = await setup();
    for (const id of [SEED.p2, SEED.p4]) {
      expect((await json(await s.call('players.getProfile', { playerId: id }))).data).toBeNull();
      const r = await s.call('players.updateProfile', { playerId: id, district: 'Demo District', academy: 'Demo Club', bio: 'Demo', reason: 'Profile edited by owner' });
      expect(r.status).toBe(400);
      expect((await json(r)).errors!.form).toBe(PROFILE_ADULT_ONLY);
    }
    expect(s.store.state.playerProfiles ?? {}).toEqual({});
    expect(s.store.state.audit).toHaveLength(0);
  });

  it('an unknown player is NOT_FOUND; the schema refuses missing reasons, extra keys and a non-uuid id', async () => {
    const s = await setup();
    expect((await json(await s.call('players.updateProfile', { playerId: '10000000-0000-4000-8000-0000000000ff', district: null, academy: null, bio: null, reason: 'Profile edited by owner' }))).code).toBe('NOT_FOUND');
    expect((await s.call('players.updateProfile', { playerId: SEED.p1, district: null, academy: null, bio: null })).status).toBe(400);
    expect((await s.call('players.updateProfile', { playerId: SEED.p1, district: null, academy: null, bio: null, reason: 'Profile edited by owner', photo: 'x' })).status).toBe(400);
    expect((await s.call('players.getProfile', { playerId: 'not-a-uuid' })).status).toBe(400);
    expect(s.store.state.audit).toHaveLength(0);
  });

  it('an editor token is refused for both actions', async () => {
    const s = await setup();
    const editor = await signToken(s.keys, { sub: EDITOR_ID });
    expect((await s.call('players.getProfile', { playerId: SEED.p1 }, editor)).status).toBe(403);
    expect((await s.call('players.updateProfile', { playerId: SEED.p1, district: 'Demo District', academy: null, bio: null, reason: 'Profile edited by owner' }, editor)).status).toBe(403);
  });
});

describe('supabase store with a fake PostgREST', () => {
  const URL_OK = 'https://fakeref.supabase.co';
  const SECRET = ['sb', 'secret', 'FAKE'].join('_');
  const ACTOR = { userId: '9a000000-0000-4000-8000-000000000001', role: 'owner' as const };
  const P1 = '10000000-0000-4000-8000-000000000001';
  type Call = { url: string; method: string; body: any };

  function fake(row: Record<string, unknown> | null) {
    const calls: Call[] = [];
    const f = (async (url: string, init: RequestInit) => {
      calls.push({ url, method: init.method ?? 'GET', body: init.body ? JSON.parse(init.body as string) : undefined });
      if (url.includes('/rpc/')) return new Response(null, { status: 204 });
      return new Response(JSON.stringify(row ? [row] : []), { status: 200, headers: { 'content-range': `0-0/${row ? 1 : 0}` } });
    }) as unknown as typeof fetch;
    return { calls, store: createSupabaseAdminStore({ url: URL_OK, secretKey: SECRET, fetch: f }) };
  }
  const rpcCalls = (calls: Call[]) => calls.filter((c) => c.url.includes('/rpc/'));

  it('reads a profile only for an adult row; a protected row passes nothing on', async () => {
    const adult = fake({ age_status: 'adult_confirmed', district: 'Demo District', academy: null, bio: BIO });
    expect(await adult.store.getPlayerProfile({ playerId: P1 })).toEqual({ ok: true, data: { district: 'Demo District', academy: null, bio: BIO } });
    expect(adult.calls[0]!.url).toContain('select=age_status,district,academy,bio');
    const minor = fake({ age_status: 'minor_suspected', district: 'Demo District', academy: 'Demo Club', bio: 'Demo' });
    expect(await minor.store.getPlayerProfile({ playerId: P1 })).toEqual({ ok: true, data: null });
    expect(await fake(null).store.getPlayerProfile({ playerId: P1 })).toEqual({ ok: false, code: 'NOT_FOUND' });
  });

  it('never calls the RPC for a protected player', async () => {
    for (const status of ['unknown', 'minor_suspected', 'minor_confirmed']) {
      const { calls, store } = fake({ age_status: status, district: null, academy: null, bio: null });
      const r = await store.updatePlayerProfile(ACTOR, { playerId: P1, district: 'Demo District', academy: null, bio: null, reason: 'Profile edited by owner' });
      expect(r).toMatchObject({ ok: false, code: 'INVALID' });
      expect(rpcCalls(calls)).toHaveLength(0);
    }
  });

  it('sends the cleaned values to admin_update_player_profile with the verified actor; an unchanged save sends nothing', async () => {
    const { calls, store } = fake({ age_status: 'adult_confirmed', district: null, academy: 'Demo Club', bio: null });
    const r = await store.updatePlayerProfile(ACTOR, { playerId: P1, district: ' Demo District ', academy: 'Demo Club', bio: '', reason: 'Profile edited by owner' });
    expect(r).toEqual({ ok: true, data: { playerId: P1, fields: ['district'] } });
    const rpc = rpcCalls(calls);
    expect(rpc).toHaveLength(1);
    expect(rpc[0]!.url).toBe(`${URL_OK}/rest/v1/rpc/admin_update_player_profile`);
    expect(rpc[0]!.body).toEqual({ p_actor: ACTOR.userId, p_player: P1, p_district: 'Demo District', p_academy: 'Demo Club', p_bio: null, p_reason: 'Profile edited by owner' });
    const same = fake({ age_status: 'adult_confirmed', district: 'Demo District', academy: null, bio: null });
    expect(await same.store.updatePlayerProfile(ACTOR, { playerId: P1, district: 'Demo District', academy: '', bio: null, reason: 'Profile edited by owner' })).toEqual({ ok: true, data: { playerId: P1, fields: [] } });
    expect(rpcCalls(same.calls)).toHaveLength(0);
  });
});
