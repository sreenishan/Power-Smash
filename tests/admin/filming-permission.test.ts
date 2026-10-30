// The filming-permission record (0016, D-019, D-105): the shared rule, the memory store through the real handler, and the Supabase store
// with a fake PostgREST. Fictional people and tournaments only; the clock is injected (NOW = 2026-10-22 in India).
import { describe, expect, it } from 'vitest';
import { SEED } from '../../src/lib/admin/memory-store';
import { ADMIN_ACTIONS } from '../../src/lib/admin/policy';
import { createSupabaseAdminStore } from '../../src/lib/admin/supabase-store';
import { coverageGap, NO_PERMISSION, PERMISSION_MESSAGES, permissionAllows, validatePermission, type PermissionInput } from '../../src/lib/admin/filming-permission';
import { EDITOR_ID, makeHandler, makeKeys, NOW, req, signToken } from './_helpers';

const json = async (r: Response) => (await r.json()) as { ok: boolean; code?: string; errors?: Record<string, string>; data?: any };
const TODAY = '2026-10-22';
const granted: PermissionInput = {
  status: 'granted', grantedByName: '  Demo Secretary Person ', grantedByRole: 'Secretary, Demo District Association', grantedOn: '2026-10-20',
  scopeFilming: true, scopeYoutube: true, scopeLiveStream: false, scopeSponsorOverlays: false, exclusivePartner: 'no', documentRef: 'WhatsApp from the demo secretary, saved in Drive',
};

async function setup() {
  const keys = await makeKeys();
  const h = makeHandler(keys);
  const token = await signToken(keys);
  return { ...h, keys, call: (action: string, body: unknown = {}, t = token) => h.handle(req(action, t, body), action) };
}

describe('the permission rule (shared by the schema, both stores and the screen)', () => {
  it('cleans a complete grant', () => {
    expect(validatePermission(granted, TODAY)).toEqual({ ok: true, value: { ...granted, grantedByName: 'Demo Secretary Person' } });
  });
  it('granted needs who, their role, a past date and filming; other statuses need none of it', () => {
    const v = validatePermission({ ...granted, grantedByName: ' ', grantedByRole: null, grantedOn: '2026-10-23', scopeFilming: false }, TODAY);
    expect(v).toEqual({ ok: false, errors: { grantedByName: PERMISSION_MESSAGES.grantedByName, grantedByRole: PERMISSION_MESSAGES.grantedByRole, grantedOn: PERMISSION_MESSAGES.grantedOn, scopeFilming: PERMISSION_MESSAGES.scopeFilming } });
    expect(validatePermission({ ...NO_PERMISSION, status: 'requested' }, TODAY).ok).toBe(true);
    expect(validatePermission({ ...NO_PERMISSION, status: 'refused' }, TODAY).ok).toBe(true);
  });
  it('refuses unknown values, control characters, over-long text and impossible dates', () => {
    expect(validatePermission({ ...granted, status: 'maybe' }, TODAY)).toMatchObject({ ok: false, errors: { status: PERMISSION_MESSAGES.status } });
    expect(validatePermission({ ...granted, exclusivePartner: 'perhaps' }, TODAY)).toMatchObject({ ok: false, errors: { exclusivePartner: PERMISSION_MESSAGES.exclusivePartner } });
    expect(validatePermission({ ...granted, documentRef: 'line one\nline two' }, TODAY).ok).toBe(false);
    expect(validatePermission({ ...granted, grantedByName: 'n'.repeat(121) }, TODAY).ok).toBe(false);
    expect(validatePermission({ ...granted, grantedOn: '2026-02-30' }, TODAY).ok).toBe(false);
  });
  it('fails closed: only granted with that scope allows coverage, a live stream or sponsor overlays', () => {
    expect(permissionAllows(null)).toEqual({ coverage: false, liveStream: false, sponsorOverlays: false });
    expect(permissionAllows({ ...NO_PERMISSION, status: 'requested', scopeFilming: true, scopeLiveStream: true })).toEqual({ coverage: false, liveStream: false, sponsorOverlays: false });
    const ok = validatePermission(granted, TODAY);
    if (!ok.ok) throw new Error('setup');
    expect(permissionAllows(ok.value)).toEqual({ coverage: true, liveStream: false, sponsorOverlays: false });
  });
  it('shows the gap only for a tournament marked "Power Smash films this" without granted permission', () => {
    expect(coverageGap(false, 'unknown')).toBeNull();
    expect(coverageGap(true, 'granted')).toBeNull();
    expect(coverageGap(true, undefined)).toMatch(/permission is not recorded/);
    expect(coverageGap(true, 'refused')).toMatch(/refused filming permission. Do not film/);
    expect(coverageGap(true, 'requested')).toMatch(/has not answered your permission request/);
    // not needed still reminds (fail closed) and never tells the owner to record permission they said is not needed
    expect(coverageGap(true, 'not_required')).toMatch(/recorded permission as not needed/);
    expect(coverageGap(true, 'not_required')).not.toMatch(/Record the organizer/);
  });
});

describe('memory store through the handler', () => {
  const body = (over: object = {}) => ({ tournamentId: SEED.t1, ...granted, reason: 'Filming permission recorded by owner', ...over });

  it('both actions are owner-only, and the write is audited', () => {
    expect(ADMIN_ACTIONS['tournaments.permission']).toMatchObject({ kind: 'read', roles: ['owner'], requiresAal2: true });
    expect(ADMIN_ACTIONS['tournaments.setPermission']).toMatchObject({ kind: 'write', roles: ['owner'], requiresAal2: true, audited: true });
  });

  it('starts unknown; a grant is stored, the audit holds the status but never the person or the proof; an unchanged save is not audited', async () => {
    const s = await setup();
    expect((await json(await s.call('tournaments.permission', { tournamentId: SEED.t1 }))).data).toEqual(NO_PERMISSION);
    const r = await s.call('tournaments.setPermission', body());
    expect(r.status).toBe(200);
    expect((await json(await s.call('tournaments.permission', { tournamentId: SEED.t1 }))).data).toMatchObject({ status: 'granted', grantedByName: 'Demo Secretary Person' });
    expect(s.store.state.audit[0]).toMatchObject({ action: 'tournament.set_permission', entityId: SEED.t1 });
    expect(s.store.state.audit[0]!.reason).toContain('unknown -> granted');
    expect(JSON.stringify(s.store.state.audit)).not.toMatch(/Demo Secretary|Demo District Association|WhatsApp/);
    const n = s.store.state.audit.length;
    expect((await json(await s.call('tournaments.setPermission', body()))).data.fields).toEqual([]);
    expect(s.store.state.audit).toHaveLength(n);
  });

  it('the Approved list carries the status and the covered flag, so the screen can show the gap', async () => {
    const s = await setup();
    await s.call('tournaments.decide', { id: SEED.t1, decision: 'promote', reason: 'promote by owner' });
    expect((await json(await s.call('tournaments.approved'))).data[0]).toMatchObject({ id: SEED.t1, filmingPermission: 'unknown', coveredByPowerSmash: false });
    await s.call('tournaments.setPermission', body());
    expect((await json(await s.call('tournaments.approved'))).data[0]).toMatchObject({ filmingPermission: 'granted' });
  });

  it('refuses an incomplete grant in words, an unknown tournament, extra fields and an editor; nothing is stored or audited', async () => {
    const s = await setup();
    const r = await s.call('tournaments.setPermission', body({ grantedOn: null }));
    expect(r.status).toBe(400);
    expect((await json(r)).errors).toEqual({ grantedOn: PERMISSION_MESSAGES.grantedOn });
    expect((await json(await s.call('tournaments.setPermission', body({ tournamentId: '20000000-0000-4000-8000-0000000000ff' })))).code).toBe('NOT_FOUND');
    expect((await s.call('tournaments.setPermission', body({ phone: '910000000000' }))).status).toBe(400);
    const editor = await signToken(s.keys, { sub: EDITOR_ID });
    expect((await s.call('tournaments.permission', { tournamentId: SEED.t1 }, editor)).status).toBe(403);
    expect((await s.call('tournaments.setPermission', body(), editor)).status).toBe(403);
    expect(s.store.state.filmingPermissions ?? {}).toEqual({});
    expect(s.store.state.audit).toHaveLength(0);
  });
});

describe('supabase store with a fake PostgREST', () => {
  const URL_OK = 'https://fakeref.supabase.co';
  const SECRET = ['sb', 'secret', 'FAKE'].join('_');
  const ACTOR = { userId: '9a000000-0000-4000-8000-000000000001', role: 'owner' as const };
  const T1 = '20000000-0000-4000-8000-000000000001';
  type Call = { url: string; method: string; body: any };

  function fake(permRow: Record<string, unknown> | null, approvedRows: unknown[] = []) {
    const calls: Call[] = [];
    const f = (async (url: string, init: RequestInit) => {
      const u = decodeURIComponent(url);
      calls.push({ url: u, method: init.method ?? 'GET', body: init.body ? JSON.parse(init.body as string) : undefined });
      if (u.includes('/rpc/')) return new Response(JSON.stringify({ fields: [] }), { status: 200 });
      let rows: unknown[] = [];
      if (u.includes('/tournament_permissions?')) rows = permRow ? [permRow] : [];
      else if (u.includes('/tournaments?select=id&')) rows = [{ id: T1 }];
      else if (u.includes('/tournaments?select=id,name')) rows = approvedRows;
      return new Response(JSON.stringify(rows), { status: 200, headers: { 'content-range': `0-0/${rows.length}` } });
    }) as unknown as typeof fetch;
    return { calls, store: createSupabaseAdminStore({ url: URL_OK, secretKey: SECRET, fetch: f, now: () => NOW }) };
  }
  const rpcCalls = (calls: Call[]) => calls.filter((c) => c.url.includes('/rpc/'));

  it('no row is unknown; a refused form makes no network call; a grant goes to admin_set_filming_permission', async () => {
    const empty = fake(null);
    expect(await empty.store.getFilmingPermission({ tournamentId: T1 })).toEqual({ ok: true, data: NO_PERMISSION });
    const refused = fake(null);
    expect(await refused.store.setFilmingPermission(ACTOR, { tournamentId: T1, ...granted, grantedByRole: null, reason: 'r' })).toMatchObject({ ok: false, code: 'INVALID' });
    expect(refused.calls).toHaveLength(0);
    const ok = fake(null);
    expect(await ok.store.setFilmingPermission(ACTOR, { tournamentId: T1, ...granted, reason: 'Filming permission recorded by owner' })).toMatchObject({ ok: true, data: { tournamentId: T1 } });
    const rpc = rpcCalls(ok.calls);
    expect(rpc).toHaveLength(1);
    expect(rpc[0]!.url).toBe(`${URL_OK}/rest/v1/rpc/admin_set_filming_permission`);
    expect(rpc[0]!.body).toEqual({ p_actor: ACTOR.userId, p_tournament: T1, p_record: { ...granted, grantedByName: 'Demo Secretary Person' }, p_reason: 'Filming permission recorded by owner' });
  });

  it('the Approved list reads the embedded status (object, list or none) and never more of the record', async () => {
    const row = (perm: unknown) => ({ id: T1, name: 'Demo Open Cup', series_key: 'demo open cup', edition_year: 2026, region: 'tamil_nadu', is_promoted: true, source: 'parsed', visibility: 'public', status: 'published', covered_by_power_smash: true, matches: [{ count: 2 }], tournament_permissions: perm });
    for (const [perm, want] of [[{ status: 'granted' }, 'granted'], [[{ status: 'refused' }], 'refused'], [null, 'unknown'], [{ status: 'nonsense' }, 'unknown']] as const) {
      const { calls, store } = fake(null, [row(perm)]);
      const r = await store.listApprovedTournaments();
      expect(r.ok && r.data[0]).toMatchObject({ filmingPermission: want, coveredByPowerSmash: true });
      expect(calls[0]!.url).toContain('tournament_permissions(status)');
      expect(calls[0]!.url).not.toMatch(/granted_by|document_ref/);
    }
  });
});
