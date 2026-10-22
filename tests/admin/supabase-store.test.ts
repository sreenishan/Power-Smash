import { describe, expect, it } from 'vitest';
import { buildAdminDeps, pickAdminEnv } from '../../src/lib/admin/config';
import { createSupabaseAdminStore, parsedFromResult } from '../../src/lib/admin/supabase-store';

const URL_OK = 'https://fakeref.supabase.co';
const SECRET = ['sb', 'secret', 'FAKE'].join('_');
const ACTOR = { userId: '9a000000-0000-4000-8000-000000000001', role: 'owner' as const };
const P1 = '10000000-0000-4000-8000-000000000001';
const P2 = '10000000-0000-4000-8000-000000000002';
const P4 = '10000000-0000-4000-8000-000000000004';

type Call = { url: string; method: string; headers: Record<string, string>; body: any };

/** Fake PostgREST: answers selects from a table map, records everything. */
function fake(tables: Record<string, unknown[]> = {}, rpcReply: unknown = null, failWith?: { status: number; message: string }) {
  const calls: Call[] = [];
  const f = (async (url: string, init: RequestInit) => {
    const u = new URL(url);
    const call: Call = { url, method: init.method ?? 'GET', headers: init.headers as Record<string, string>, body: init.body ? JSON.parse(init.body as string) : undefined };
    calls.push(call);
    if (failWith) return new Response(JSON.stringify({ message: failWith.message, details: 'Key (phone)=(910000000000) leaked' }), { status: failWith.status });
    if (u.pathname.includes('/rpc/')) return new Response(rpcReply === null ? null : JSON.stringify(rpcReply), { status: rpcReply === null ? 204 : 200 });
    const table = u.pathname.split('/').pop()!;
    if (init.method === 'HEAD') return new Response(null, { status: 200, headers: { 'content-range': `0-0/${(tables[table] ?? []).length}` } });
    if (init.method === 'GET') return new Response(JSON.stringify(tables[table] ?? []), { status: 200, headers: { 'content-range': `0-0/${(tables[table] ?? []).length}` } });
    return new Response(null, { status: 204 });
  }) as unknown as typeof fetch;
  return { calls, f };
}

const player = (id: string, name: string, status: string, over: object = {}) => ({ id, slug: 'p-' + id.slice(-4), display_name: name, age_status: status, age_signal: [], name_key: null, latin_key: null, is_provisional: false, visibility: 'hidden', merged_into: null, ...over });
const store = (f: typeof fetch) => createSupabaseAdminStore({ url: URL_OK, secretKey: SECRET, fetch: f });
const rpcCalls = (calls: Call[]) => calls.filter((c) => c.url.includes('/rpc/'));

describe('supabase admin store', () => {
  it('refuses a URL that is not the project host', () => {
    expect(() => createSupabaseAdminStore({ url: 'http://fakeref.supabase.co', secretKey: SECRET, fetch })).toThrow('supabase_url_refused');
    expect(() => createSupabaseAdminStore({ url: 'https://evil.test', secretKey: SECRET, fetch })).toThrow();
  });

  it('sends the secret key only on the apikey header and the verified user as p_actor', async () => {
    const { calls, f } = fake({ archive_settings: [{ key: 'unknown_match_mode', value: 'noindex_minimal' }, { key: 'minor_match_mode', value: 'hidden' }] });
    const r = await store(f).setProtectedMode(ACTOR, { key: 'minor_match_mode', value: 'noindex_minimal', reason: 'test' });
    expect(r.ok).toBe(true);
    const rpc = rpcCalls(calls)[0]!;
    expect(rpc.url).toBe(`${URL_OK}/rest/v1/rpc/admin_set_setting`);
    expect(rpc.headers.apikey).toBe(SECRET);
    expect(rpc.headers.authorization).toBeUndefined();
    expect(rpc.body).toMatchObject({ p_actor: ACTOR.userId, p_key: 'minor_match_mode', p_value: 'noindex_minimal' });
    if (r.ok) expect(r.data.undo).toEqual({ kind: 'set_setting', key: 'minor_match_mode', value: 'hidden' });
  });

  it('errors never carry the response body (it can echo phone numbers) and unknown errors map to BACKEND_ERROR', async () => {
    const { f } = fake({}, null, { status: 400, message: 'duplicate key value violates unique constraint' });
    const r = await store(f).getDashboard();
    expect(r).toEqual({ ok: false, code: 'BACKEND_ERROR' });
    expect(JSON.stringify(r)).not.toContain('910000000000');
  });

  it('maps an allow-listed code from an RPC error message', async () => {
    const { f } = fake({}, null, { status: 400, message: 'raise: MINOR_ADULT_MERGE_BLOCKED' });
    const r = await store(f).releaseSuppression(ACTOR, { suppressionId: P1, reason: 'abc' });
    expect(r).toEqual({ ok: false, code: 'MINOR_ADULT_MERGE_BLOCKED' });
  });

  it('a network failure is BACKEND_ERROR', async () => {
    const r = await store((async () => { throw new Error('offline'); }) as unknown as typeof fetch).getDashboard();
    expect(r).toEqual({ ok: false, code: 'BACKEND_ERROR' });
  });

  it('merge pre-validates: minor + adult without override never reaches the RPC', async () => {
    const { calls, f } = fake({ players: [player(P1, 'Demo One', 'adult_confirmed', { visibility: 'public' }), player(P4, 'Demo Four', 'minor_suspected')], player_aliases: [], suppression: [] });
    const r = await store(f).mergePlayers(ACTOR, { keepId: P1, dropId: P4, reason: 'same person' });
    expect(r).toEqual({ ok: false, code: 'MINOR_ADULT_MERGE_BLOCKED' });
    expect(rpcCalls(calls)).toHaveLength(0);
  });

  it('merge with an override passes p_override_age and the reason; a suppressed player is refused', async () => {
    const tables = { players: [player(P1, 'Demo One', 'adult_confirmed', { visibility: 'public' }), player(P4, 'Demo Four', 'minor_suspected')], player_aliases: [], suppression: [] as unknown[] };
    const a = fake(tables);
    const ok = await store(a.f).mergePlayers(ACTOR, { keepId: P1, dropId: P4, reason: 'same person', overrideReason: 'parent confirmed' });
    expect(ok.ok).toBe(true);
    expect(rpcCalls(a.calls)[0]!.body).toMatchObject({ p_from: P4, p_into: P1, p_override_age: true, p_actor: ACTOR.userId });
    tables.suppression.push({ kind: 'player_id', value: P4 });
    const b = fake(tables);
    expect(await store(b.f).mergePlayers(ACTOR, { keepId: P1, dropId: P4, reason: 'same person', overrideReason: 'parent confirmed' })).toEqual({ ok: false, code: 'SUPPRESSED' });
    expect(rpcCalls(b.calls)).toHaveLength(0);
  });

  it('bulk confirm filters out minor_confirmed, merged and already-adult players before the RPC', async () => {
    const { calls, f } = fake({ players: [player(P1, 'A One', 'adult_confirmed'), player(P2, 'B Two', 'unknown'), player(P4, 'C Four', 'minor_confirmed')] });
    const r = await store(f).confirmAdultBulk(ACTOR, { playerIds: [P1, P2, P4], evidence: 'owner knows', reason: 'bulk' });
    expect(r.ok && r.data.result.confirmed).toEqual([P2]);
    expect(r.ok && r.data.result.rejected.map((x) => x.code).sort()).toEqual(['ALREADY_ADULT', 'MINOR_CONFIRMED_NEEDS_AGE_PROOF']);
    expect(rpcCalls(calls)).toHaveLength(1);
    expect(rpcCalls(calls)[0]!.body).toMatchObject({ p_player_ids: [P2], p_status: 'adult_confirmed' });
  });

  it('bulk confirm with nothing eligible makes no RPC call', async () => {
    const { calls, f } = fake({ players: [player(P4, 'C Four', 'minor_confirmed')] });
    await store(f).confirmAdultBulk(ACTOR, { playerIds: [P4], evidence: 'abc', reason: 'bulk' });
    expect(rpcCalls(calls)).toHaveLength(0);
  });

  it('undo of a bulk confirm only ever sets protected statuses', async () => {
    const { calls, f } = fake();
    await store(f).undo(ACTOR, { kind: 'restore_age', entries: [{ id: P1, status: 'unknown' }, { id: P2, status: 'minor_suspected' }] });
    const statuses = rpcCalls(calls).map((c) => c.body.p_status);
    expect(statuses.sort()).toEqual(['minor_suspected', 'unknown']);
  });

  it('review approve does not publish a minor-held video', async () => {
    const { calls, f } = fake({ videos: [{ youtube_id: 'fake-vid-2', minor_hold: true }], matches: [{ id: 'm1' }] });
    await store(f).resolveReview(ACTOR, { videoId: 'fake-vid-2', decision: 'approve', reason: 'checked' });
    const upd = rpcCalls(calls).find((c) => c.url.endsWith('admin_update_video'))!;
    expect(upd.body.p_changes).toEqual({ parse_status: 'parsed' });
    expect(rpcCalls(calls).some((c) => c.url.endsWith('admin_update_match'))).toBe(false);
  });

  it('review approve of a clean video sets visibility public and publishes the match', async () => {
    const { calls, f } = fake({ videos: [{ youtube_id: 'fake-vid-1', minor_hold: false }], matches: [{ id: 'm1' }] });
    await store(f).resolveReview(ACTOR, { videoId: 'fake-vid-1', decision: 'approve', reason: 'checked' });
    expect(rpcCalls(calls).find((c) => c.url.endsWith('admin_update_video'))!.body.p_changes).toEqual({ parse_status: 'parsed', visibility: 'public' });
    expect(rpcCalls(calls).find((c) => c.url.endsWith('admin_update_match'))!.body.p_changes).toEqual({ publish_state: 'published' });
  });

  it('review edits of tournament or participants are refused here (INVALID), category edits go through the RPC', async () => {
    const t = fake({ videos: [{ youtube_id: 'v', minor_hold: false }], matches: [{ id: 'm1' }] });
    expect(await store(t.f).resolveReview(ACTOR, { videoId: 'v', decision: 'approve', changes: { tournament: 'x' }, reason: 'checked' })).toEqual({ ok: false, code: 'INVALID' });
    expect(rpcCalls(t.calls)).toHaveLength(0);
    const c = fake({ videos: [{ youtube_id: 'v', minor_hold: false }], matches: [{ id: 'm1' }] });
    await store(c.f).resolveReview(ACTOR, { videoId: 'v', decision: 'keep_hidden', changes: { category: 'MS' }, reason: 'checked' });
    expect(rpcCalls(c.calls)[0]!.body.p_changes).toEqual({ category: 'MS' });
  });

  it('field lock goes through the audited RPC (a direct PATCH of manual_override is undone by the guard trigger)', async () => {
    const { calls, f } = fake({ matches: [{ id: 'm1', manual_override: { round: true } }] });
    const r = await store(f).setFieldLock(ACTOR, { videoId: 'fake-vid-1', field: 'category', locked: true });
    expect(r.ok).toBe(true);
    expect(calls.find((c) => c.method === 'PATCH')).toBeUndefined();
    const lock = rpcCalls(calls).find((c) => c.url.endsWith('admin_set_match_lock'))!;
    expect(lock.body).toEqual({ p_actor: ACTOR.userId, p_match_id: 'm1', p_field: 'category', p_locked: true, p_reason: 'review.lock' });
  });

  it('emergency hide maps the RPC result and offers release as undo', async () => {
    const { calls, f } = fake({}, { suppression_id: 's1', hidden_at: '2026-10-22T10:00:00Z', videos_hidden: 1, players_hidden: 0, tournaments_hidden: 0, redirects_removed: 2, owner_checklist: ['deploy_now', 'purge_cache_for_urls', 'set_youtube_video_private', 'search_console_removals_request'] });
    const r = await store(f).emergencyHide(ACTOR, { kind: 'youtube_id', value: 'fake-vid-1', reason: 'takedown' });
    expect(r.ok && r.data.result).toMatchObject({ suppressionId: 's1', videosHidden: 1, redirectsRemoved: 2 });
    expect(r.ok && r.data.undo).toEqual({ kind: 'release_suppression', suppressionId: 's1' });
    expect(rpcCalls(calls)[0]!.body).toMatchObject({ p_kind: 'youtube_id', p_value: 'fake-vid-1', p_actor: ACTOR.userId });
  });

  it('merge undo is unavailable against the database', async () => {
    expect(await store(fake().f).undo(ACTOR, { kind: 'merge', token: 'abcdefgh' })).toEqual({ ok: false, code: 'UNDO_UNAVAILABLE' });
  });

  it('rename of an adult computes a collision-free named slug; a protected player passes null', async () => {
    const adult = fake({ players: [player(P1, 'Demo One', 'adult_confirmed', { visibility: 'public', slug: 'demo-one' })], slug_redirects: [] });
    // first call returns the probe list too (same table): empty `taken` besides self filter is applied server side
    await store(adult.f).renamePlayer(ACTOR, { playerId: P1, newDisplayName: 'Demo Uno', reason: 'spelling' });
    expect(rpcCalls(adult.calls)[0]!.body).toMatchObject({ p_player: P1, p_display_name: 'Demo Uno', p_name_normalized: 'demo uno' });
    expect(rpcCalls(adult.calls)[0]!.body.p_new_slug).toMatch(/^demo-uno/);
    const prot = fake({ players: [player(P2, 'Demo Two', 'unknown')] });
    await store(prot.f).renamePlayer(ACTOR, { playerId: P2, newDisplayName: 'Demo Deux', reason: 'spelling' });
    expect(rpcCalls(prot.calls)[0]!.body.p_new_slug).toBeNull();
  });

  it('review queue maps parse_result into labelled fields and manual_override into locks', async () => {
    const { f } = fake({ videos: [{ youtube_id: 'fake-vid-1', title_raw: 'RAW TITLE', published_at: null, review_reasons: ['X'], hard_flags: ['UNEVEN_SIDES'], parse_confidence: 55, minor_hold: false, override_stale: false, parse_result: { tournamentName: 'Demo Cup', year: 2026, category: 'MS', ageGroup: null, round: 'Final', sideA: [{ displayName: 'A One' }], sideB: [{ displayName: 'B Two' }] }, matches: [{ manual_override: { round: true } }] }] });
    const r = await store(f).listReviewQueue({ limit: 10, offset: 0 });
    expect(r.ok && r.data[0]).toMatchObject({ titleRaw: 'RAW TITLE', parsed: { tournament: 'Demo Cup 2026', category: 'MS', participants: 'A One vs B Two', age_group: null }, locks: { round: true }, hardFlags: ['UNEVEN_SIDES'] });
  });

  it('parsedFromResult copes with a null parse_result', () => {
    expect(parsedFromResult(null)).toEqual({ tournament: null, category: null, age_group: null, round: null, participants: null });
  });
});

describe('buildAdminDeps / pickAdminEnv', () => {
  it('returns null without Supabase settings, and ignores unknown names', () => {
    expect(buildAdminDeps({}, { fetch, now: () => new Date() })).toBeNull();
    expect(pickAdminEnv({ ADMIN_ALLOWED_ORIGINS: ' https://a.test ', OTHER: 'x', SUPABASE_URL: '' })).toEqual({ ADMIN_ALLOWED_ORIGINS: 'https://a.test' });
  });
  it('wires dispatch only when token, repo and sync workflow are all set; editors only on exactly true', () => {
    const base = { SUPABASE_URL: URL_OK, SUPABASE_SECRET_KEY: SECRET };
    const a = buildAdminDeps(base, { fetch, now: () => new Date() })!;
    expect(a.dispatch).toBeNull();
    expect(a.auth.editorsEnabled).toBe(false);
    const b = buildAdminDeps({ ...base, REBUILD_DISPATCH_TOKEN: 'x', ADMIN_GITHUB_REPO: 'o/r', ADMIN_SYNC_WORKFLOW: 'sync.yml', ADMIN_EDITORS_ENABLED: 'yes', ADMIN_ALLOWED_ORIGINS: 'https://a.test, https://b.test' }, { fetch, now: () => new Date() })!;
    expect(b.dispatch).not.toBeNull();
    expect(b.auth.editorsEnabled).toBe(false);
    expect(b.allowedOrigins).toEqual(['https://a.test', 'https://b.test']);
    expect(buildAdminDeps({ ...base, ADMIN_EDITORS_ENABLED: 'true' }, { fetch, now: () => new Date() })!.auth.editorsEnabled).toBe(true);
  });
  it('the profiles lookup reads only the role and accepts only owner or editor', async () => {
    const seen: string[] = [];
    const f = (async (url: string, init: RequestInit) => {
      seen.push(url);
      expect((init.headers as Record<string, string>).apikey).toBe(SECRET);
      return new Response(JSON.stringify([{ role: 'superadmin' }]), { status: 200 });
    }) as unknown as typeof fetch;
    const deps = buildAdminDeps({ SUPABASE_URL: URL_OK, SUPABASE_SECRET_KEY: SECRET }, { fetch: f, now: () => new Date() })!;
    expect(await deps.auth.roles(P1)).toBeNull();
    expect(seen[0]).toBe(`${URL_OK}/rest/v1/profiles?select=role&id=eq.${P1}&limit=1`);
  });
  it('a failing profiles lookup throws (the guard turns it into 503)', async () => {
    const deps = buildAdminDeps({ SUPABASE_URL: URL_OK, SUPABASE_SECRET_KEY: SECRET }, { fetch: (async () => new Response('x', { status: 500 })) as unknown as typeof fetch, now: () => new Date() })!;
    await expect(deps.auth.roles(P1)).rejects.toThrow();
  });
});
