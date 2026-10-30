// A tournament's details from the admin (0014, D-102): the shared rule, the memory store through the real handler, and the Supabase store
// with a fake PostgREST. Fictional tournaments only. The clock is injected (NOW = 2026-10-22 in India).
import { describe, expect, it } from 'vitest';
import { SEED } from '../../src/lib/admin/memory-store';
import { ADMIN_ACTIONS } from '../../src/lib/admin/policy';
import { createSupabaseAdminStore } from '../../src/lib/admin/supabase-store';
import { changedTournamentFields, TOURNAMENT_MESSAGES, validateTournamentEdit, type TournamentDetails, type TournamentEditInput } from '../../src/lib/admin/tournament-edit';
import { EDITOR_ID, makeHandler, makeKeys, NOW, req, signToken } from './_helpers';

const json = async (r: Response) => (await r.json()) as { ok: boolean; code?: string; errors?: Record<string, string>; data?: any };
const TODAY = '2026-10-22';
const base: TournamentDetails = {
  name: 'Demo Open Cup', level: null, city: null, district: null, venue: null, startDate: null, endDate: null, categories: [], isFeatured: false, featuredUntil: null, coveredByPowerSmash: false,
};
const edit = (over: Partial<TournamentEditInput> = {}): TournamentEditInput => ({ ...base, ...over });

async function setup() {
  const keys = await makeKeys();
  const h = makeHandler(keys);
  const token = await signToken(keys);
  return { ...h, keys, call: (action: string, body: unknown = {}, t = token) => h.handle(req(action, t, body), action) };
}

describe('the tournament edit rule (shared by the schema, both stores and the screen)', () => {
  it('cleans a valid edit: trimmed text, empty = not stated, categories once each in the fixed order', () => {
    const v = validateTournamentEdit(edit({ name: '  Demo Open Championship ', level: 'state', city: ' Demotown ', district: '', venue: 'Demo Indoor Stadium', startDate: '2026-11-14', endDate: '2026-11-16', categories: ['XD', 'MS', 'MS', 'WS'], isFeatured: true, featuredUntil: TODAY, coveredByPowerSmash: true }), TODAY);
    expect(v).toEqual({ ok: true, value: { name: 'Demo Open Championship', level: 'state', city: 'Demotown', district: null, venue: 'Demo Indoor Stadium', startDate: '2026-11-14', endDate: '2026-11-16', categories: ['MS', 'WS', 'XD'], isFeatured: true, featuredUntil: TODAY, coveredByPowerSmash: true } });
  });
  it('not featured = no date, even if one was typed', () => {
    const v = validateTournamentEdit(edit({ isFeatured: false, featuredUntil: '2020-01-01' }), TODAY);
    expect(v.ok && v.value.featuredUntil).toBeNull();
  });
  it('names each bad field in plain words', () => {
    const v = validateTournamentEdit(edit({ name: 'D', level: 'galactic', city: 'c'.repeat(61), venue: 'Demo\nStadium', startDate: '2026-02-30', categories: ['MS', 'U15'], isFeatured: true, featuredUntil: '2026-10-21' }), TODAY);
    expect(v.ok).toBe(false);
    if (v.ok) return;
    expect(v.errors).toEqual({
      name: TOURNAMENT_MESSAGES.name,
      level: TOURNAMENT_MESSAGES.level,
      city: TOURNAMENT_MESSAGES.text(60),
      venue: TOURNAMENT_MESSAGES.text(160),
      startDate: TOURNAMENT_MESSAGES.date,
      categories: TOURNAMENT_MESSAGES.categories,
      featuredUntil: TOURNAMENT_MESSAGES.featuredUntil,
    });
  });
  it('the last day cannot be before the first; featured needs a date today or later', () => {
    expect(validateTournamentEdit(edit({ startDate: '2026-11-16', endDate: '2026-11-14' }), TODAY)).toMatchObject({ ok: false, errors: { endDate: TOURNAMENT_MESSAGES.endBeforeStart } });
    expect(validateTournamentEdit(edit({ isFeatured: true, featuredUntil: null }), TODAY)).toMatchObject({ ok: false, errors: { featuredUntil: TOURNAMENT_MESSAGES.featuredUntil } });
    expect(validateTournamentEdit(edit({ isFeatured: true, featuredUntil: TODAY }), TODAY).ok).toBe(true);
  });
  it('counts characters like PostgreSQL (an emoji is one)', () => {
    expect(validateTournamentEdit(edit({ name: `${'n'.repeat(117)}\u{1F3F8}\u{1F3F8}\u{1F3F8}` }), TODAY).ok).toBe(true);
    expect(validateTournamentEdit(edit({ name: 'Demo\u2028Open' }), TODAY).ok).toBe(false);
  });
  it('reports changed fields by name; the same categories are not a change', () => {
    const a = validateTournamentEdit(edit({ categories: ['MS', 'XD'] }), TODAY);
    const b = validateTournamentEdit(edit({ categories: ['XD', 'MS'], venue: 'Demo Hall' }), TODAY);
    if (!a.ok || !b.ok) throw new Error('setup');
    expect(changedTournamentFields(a.value, b.value)).toEqual(['venue']);
  });
});

describe('memory store through the handler', () => {
  const body = (over: object = {}) => ({ id: SEED.t1, ...edit({ name: 'Demo Open Championship', venue: 'Demo Indoor Stadium', startDate: '2026-11-14', categories: ['MS', 'WS'], isFeatured: true, featuredUntil: '2026-11-30', coveredByPowerSmash: true }), reason: 'Tournament details edited by owner', expected: { ...base }, ...over });

  it('the three actions are owner-only, and the write is audited', () => {
    expect(ADMIN_ACTIONS['tournaments.approved']).toMatchObject({ kind: 'read', roles: ['owner'], requiresAal2: true });
    expect(ADMIN_ACTIONS['tournaments.details']).toMatchObject({ kind: 'read', roles: ['owner'], requiresAal2: true });
    expect(ADMIN_ACTIONS['tournaments.update']).toMatchObject({ kind: 'write', roles: ['owner'], requiresAal2: true, audited: true });
  });

  it('saves the details, renames the list entry, audits the field names only and marks the site dirty', async () => {
    const s = await setup();
    s.store.state.siteDirty = false;
    expect((await json(await s.call('tournaments.details', { id: SEED.t1 }))).data).toEqual({ ...base });
    const r = await s.call('tournaments.update', body());
    expect(r.status).toBe(200);
    expect((await json(r)).data.fields).toEqual(['name', 'venue', 'startDate', 'categories', 'isFeatured', 'featuredUntil', 'coveredByPowerSmash']);
    expect((await json(await s.call('tournaments.details', { id: SEED.t1 }))).data).toMatchObject({ name: 'Demo Open Championship', venue: 'Demo Indoor Stadium', featuredUntil: '2026-11-30' });
    expect(s.store.state.tournaments.find((t) => t.id === SEED.t1)!.name).toBe('Demo Open Championship');
    const row = s.store.state.audit[0]!;
    expect(row).toMatchObject({ action: 'tournament.update', entity: 'tournament', entityId: SEED.t1 });
    expect(JSON.stringify(s.store.state.audit)).not.toMatch(/Stadium|Championship/);
    expect(s.store.state.siteDirty).toBe(true);
  });

  it('an unchanged save writes nothing and is not audited', async () => {
    const s = await setup();
    await s.call('tournaments.update', body());
    const n = s.store.state.audit.length;
    s.store.state.siteDirty = false;
    const saved = (await json(await s.call('tournaments.details', { id: SEED.t1 }))).data;
    const again = await s.call('tournaments.update', body({ name: ' Demo Open Championship ', categories: ['WS', 'MS'], expected: saved }));
    expect((await json(again)).data.fields).toEqual([]);
    expect(s.store.state.audit).toHaveLength(n);
    expect(s.store.state.siteDirty).toBe(false);
  });

  it('a form opened before another change is refused (STALE) instead of undoing that change', async () => {
    const s = await setup();
    const opened = (await json(await s.call('tournaments.details', { id: SEED.t1 }))).data;
    // something else changes the tournament after the form was opened
    await s.call('tournaments.update', body({ venue: 'Demo Hall A', expected: opened }));
    const n = s.store.state.audit.length;
    const r = await s.call('tournaments.update', body({ venue: 'Demo Hall B', expected: opened }));
    expect(r.status).toBe(409);
    expect((await json(r)).code).toBe('STALE');
    expect((await json(await s.call('tournaments.details', { id: SEED.t1 }))).data.venue).toBe('Demo Hall A');
    expect(s.store.state.audit).toHaveLength(n);
  });

  it('an ended featuring that is left as it is does not block another edit; moving it to another past date is refused', async () => {
    const s = await setup();
    const ended: TournamentDetails = { ...base, isFeatured: true, featuredUntil: '2026-10-01' };
    s.store.state.tournamentDetails = { [SEED.t1]: ended };
    const ok = await s.call('tournaments.update', { id: SEED.t1, ...ended, venue: 'Demo Hall', reason: 'r fix', expected: ended });
    expect((await json(ok)).data.fields).toEqual(['venue']);
    const moved = await s.call('tournaments.update', { id: SEED.t1, ...ended, venue: 'Demo Hall', featuredUntil: '2026-10-02', reason: 'r fix', expected: { ...ended, venue: 'Demo Hall' } });
    expect((await json(moved)).errors).toEqual({ featuredUntil: TOURNAMENT_MESSAGES.featuredUntil });
  });

  it('uses the injected clock: featured until yesterday (India time) is refused', async () => {
    const s = await setup();
    expect(NOW.toISOString().slice(0, 10)).toBe(TODAY);
    const r = await s.call('tournaments.update', body({ featuredUntil: '2026-10-21' }));
    expect(r.status).toBe(400);
    expect((await json(r)).errors).toEqual({ featuredUntil: TOURNAMENT_MESSAGES.featuredUntil });
    expect(s.store.state.audit).toHaveLength(0);
  });

  it('a suppressed tournament cannot be edited', async () => {
    const s = await setup();
    s.store.state.suppressions.push({ id: 'sup-1', kind: 'tournament_id', key: SEED.t1, reason: 'demo takedown', releasedAt: null, affectedPlayerIds: [], affectedVideoIds: [], affectedTournamentIds: [], pairedIds: [] } as never);
    expect((await json(await s.call('tournaments.update', body()))).code).toBe('SUPPRESSED');
    expect(s.store.state.audit).toHaveLength(0);
  });

  it('the schema refuses unknown keys (region, visibility, slug), a missing reason and a non-uuid id; an unknown id is NOT_FOUND', async () => {
    const s = await setup();
    for (const extra of [{ region: 'international' }, { visibility: 'public' }, { slug: 'x' }, { editionYear: 2027 }]) expect((await s.call('tournaments.update', body(extra))).status, JSON.stringify(extra)).toBe(400);
    const { reason: _r, ...noReason } = body();
    expect((await s.call('tournaments.update', noReason)).status).toBe(400);
    expect((await s.call('tournaments.details', { id: 'nope' })).status).toBe(400);
    expect((await json(await s.call('tournaments.update', body({ id: '20000000-0000-4000-8000-0000000000ff' })))).code).toBe('NOT_FOUND');
    expect(s.store.state.audit).toHaveLength(0);
  });

  it('the Approved list holds only approved tournaments', async () => {
    const s = await setup();
    expect((await json(await s.call('tournaments.approved'))).data).toEqual([]);
    await s.call('tournaments.decide', { id: SEED.t1, decision: 'promote', reason: 'promote by owner' });
    expect((await json(await s.call('tournaments.approved'))).data.map((t: { id: string }) => t.id)).toEqual([SEED.t1]);
  });

  it('an editor token is refused for all three actions', async () => {
    const s = await setup();
    const editor = await signToken(s.keys, { sub: EDITOR_ID });
    expect((await s.call('tournaments.approved', {}, editor)).status).toBe(403);
    expect((await s.call('tournaments.details', { id: SEED.t1 }, editor)).status).toBe(403);
    expect((await s.call('tournaments.update', body(), editor)).status).toBe(403);
  });
});

describe('supabase store with a fake PostgREST', () => {
  const URL_OK = 'https://fakeref.supabase.co';
  const SECRET = ['sb', 'secret', 'FAKE'].join('_');
  const ACTOR = { userId: '9a000000-0000-4000-8000-000000000001', role: 'owner' as const };
  const T1 = '20000000-0000-4000-8000-000000000001';
  type Call = { url: string; method: string; body: any };
  // the stored row as the form shows it (categories in the fixed order)
  const shown = { ...base, district: 'Demodistrict', categories: ['MS', 'XD'] as ('MS' | 'XD')[] };
  const stored = { name: 'Demo Open Cup', level: null, city: null, district: 'Demodistrict', venue: null, start_date: null, end_date: null, categories: ['XD', 'MS'], is_featured: false, featured_until: null, covered_by_power_smash: false };

  function fake(row: Record<string, unknown> | null) {
    const calls: Call[] = [];
    const f = (async (url: string, init: RequestInit) => {
      calls.push({ url, method: init.method ?? 'GET', body: init.body ? JSON.parse(init.body as string) : undefined });
      if (url.includes('/rpc/')) return new Response(JSON.stringify({ fields: [] }), { status: 200 });
      return new Response(JSON.stringify(row ? [row] : []), { status: 200, headers: { 'content-range': `0-0/${row ? 1 : 0}` } });
    }) as unknown as typeof fetch;
    return { calls, store: createSupabaseAdminStore({ url: URL_OK, secretKey: SECRET, fetch: f, now: () => NOW }) };
  }
  const rpcCalls = (calls: Call[]) => calls.filter((c) => c.url.includes('/rpc/'));

  it('reads the details with categories in the fixed order', async () => {
    const { calls, store } = fake(stored);
    expect(await store.getTournamentDetails({ id: T1 })).toEqual({ ok: true, data: { ...base, district: 'Demodistrict', categories: ['MS', 'XD'] } });
    expect(calls[0]!.url).toBe(`${URL_OK}/rest/v1/tournaments?select=name,level,city,district,venue,start_date,end_date,categories,is_featured,featured_until,covered_by_power_smash&id=eq.${T1}&limit=1`);
    expect(await fake(null).store.getTournamentDetails({ id: T1 })).toEqual({ ok: false, code: 'NOT_FOUND' });
  });

  it('refuses a stale form (the row changed since it was shown) before calling the RPC', async () => {
    const { calls, store } = fake(stored);
    const r = await store.updateTournamentDetails(ACTOR, { id: T1, ...edit({ venue: 'Demo Hall' }), reason: 'r', expected: { ...shown, categories: ['MS'] } });
    expect(r).toEqual({ ok: false, code: 'STALE' });
    expect(rpcCalls(calls)).toHaveLength(0);
  });

  it('a refused edit makes no network call at all', async () => {
    const { calls, store } = fake(stored);
    expect(await store.updateTournamentDetails(ACTOR, { id: T1, ...edit({ name: 'D' }), reason: 'r', expected: shown })).toMatchObject({ ok: false, code: 'INVALID' });
    expect(calls).toHaveLength(0);
  });

  it('sends the cleaned record to admin_update_tournament; the same values send nothing', async () => {
    const { calls, store } = fake(stored);
    const r = await store.updateTournamentDetails(ACTOR, { id: T1, ...edit({ district: 'Demodistrict', categories: ['MS', 'XD'], venue: ' Demo Hall ' }), reason: 'Tournament details edited by owner', expected: shown });
    expect(r).toMatchObject({ ok: true, data: { id: T1, fields: ['venue'] } });
    const rpc = rpcCalls(calls);
    expect(rpc).toHaveLength(1);
    expect(rpc[0]!.url).toBe(`${URL_OK}/rest/v1/rpc/admin_update_tournament`);
    expect(rpc[0]!.body).toEqual({
      p_actor: ACTOR.userId,
      p_id: T1,
      p_record: { ...base, district: 'Demodistrict', categories: ['MS', 'XD'], venue: 'Demo Hall' },
      p_expected: shown,
      p_reason: 'Tournament details edited by owner',
    });
    // the SQL's allowed keys, exactly
    expect(Object.keys(rpc[0]!.body.p_record).sort()).toEqual(['categories', 'city', 'coveredByPowerSmash', 'district', 'endDate', 'featuredUntil', 'isFeatured', 'level', 'name', 'startDate', 'venue']);

    const same = fake(stored);
    expect(await same.store.updateTournamentDetails(ACTOR, { id: T1, ...edit({ district: 'Demodistrict', categories: ['XD', 'MS'] }), reason: 'r', expected: shown })).toMatchObject({ ok: true, data: { fields: [] } });
    expect(rpcCalls(same.calls)).toHaveLength(0);
  });
});
