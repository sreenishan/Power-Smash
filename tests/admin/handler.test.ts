import { describe, expect, it } from 'vitest';
import { createGithubDispatch } from '../../src/lib/admin/dispatch';
import { SEED } from '../../src/lib/admin/memory-store';
import { makeHandler, makeKeys, req, signToken, STRANGER_ID, EDITOR_ID } from './_helpers';

const ORIGIN = 'https://admin.example.test';
const json = async (r: Response) => (await r.json()) as { ok: boolean; code?: string; data?: any };

async function setup(over = {}) {
  const keys = await makeKeys();
  const h = makeHandler(keys, over);
  const token = await signToken(keys);
  return { ...h, keys, token, call: async (action: string, body: unknown = {}, t: string | null = token) => h.handle(req(action, t, body), action) };
}

describe('transport rules', () => {
  it('GET is 405, OPTIONS from an allowed origin is 204, from another origin 403', async () => {
    const s = await setup();
    expect((await s.handle(req('dashboard', s.token, {}, { method: 'GET' }), 'dashboard')).status).toBe(405);
    const pre = await s.handle(new Request('https://admin.example.test/api/admin/dashboard', { method: 'OPTIONS', headers: { origin: ORIGIN } }), 'dashboard');
    expect(pre.status).toBe(204);
    expect(pre.headers.get('access-control-allow-origin')).toBe(ORIGIN);
    const bad = await s.handle(new Request('https://admin.example.test/api/admin/dashboard', { method: 'OPTIONS', headers: { origin: 'https://evil.test' } }), 'dashboard');
    expect(bad.status).toBe(403);
    expect(bad.headers.get('access-control-allow-origin')).toBeNull();
  });
  it('a foreign Origin is refused even with a valid token', async () => {
    const s = await setup();
    const r = await s.handle(req('dashboard', s.token, {}, { origin: 'https://evil.test' }), 'dashboard');
    expect(r.status).toBe(403);
  });
  it('responses are no-store and noindex', async () => {
    const s = await setup();
    const r = await s.call('dashboard');
    expect(r.headers.get('cache-control')).toBe('no-store');
    expect(r.headers.get('x-robots-tag')).toContain('noindex');
  });
  it('unknown action is 404 and does not reach the store', async () => {
    const s = await setup();
    expect((await s.call('drop-database')).status).toBe(404);
  });
  it('invalid json, unknown keys, bad ids and oversize bodies are rejected before the store', async () => {
    const s = await setup();
    expect((await s.handle(new Request('https://admin.example.test/api/admin/players.merge', { method: 'POST', headers: { authorization: `Bearer ${s.token}` }, body: '{nope' }), 'players.merge')).status).toBe(400);
    expect((await s.call('players.merge', { keepId: SEED.p1, dropId: SEED.p2, reason: 'ok reason', extra: 1 })).status).toBe(400);
    expect((await s.call('players.merge', { keepId: 'x', dropId: SEED.p2, reason: 'ok reason' })).status).toBe(400);
    expect((await s.call('players.merge', { keepId: SEED.p1, dropId: SEED.p2, reason: '' })).status).toBe(400);
    expect((await s.call('players.rename', { playerId: SEED.p1, newDisplayName: 'x'.repeat(70_000), reason: 'long one' })).status).toBe(413);
    expect(s.store.state.audit).toHaveLength(0);
  });
});

describe('auth in front of every action', () => {
  it('no token 401, aal1 403, editor 403, stranger 403, with identical generic bodies per status', async () => {
    const s = await setup();
    const actions = ['dashboard', 'players.merge', 'settings.setProtectedMode', 'emergency.hide', 'site.syncNow', 'site.publishNow', 'undo'];
    const aal1 = await signToken(s.keys, { aal: 'aal1' });
    const editor = await signToken(s.keys, { sub: EDITOR_ID });
    const stranger = await signToken(s.keys, { sub: STRANGER_ID });
    for (const a of actions) {
      const r401 = await s.call(a, {}, null);
      expect(r401.status).toBe(401);
      expect(await json(r401)).toEqual({ ok: false, code: 'unauthorized' });
      for (const t of [aal1, editor, stranger]) {
        const r = await s.call(a, {}, t);
        expect(r.status).toBe(403);
        expect(await json(r)).toEqual({ ok: false, code: 'forbidden' });
      }
    }
    expect(s.store.state.audit).toHaveLength(0);
  });
});

describe('S2-8: enrolment check (the only aal1 route)', () => {
  it('owner at aal1 with no factor: allowed; with a factor, without a counter, or a non-owner: not allowed', async () => {
    const aal1 = async (s: Awaited<ReturnType<typeof setup>>, sub?: string) => signToken(s.keys, { aal: 'aal1', ...(sub ? { sub } : {}) });
    const ask = (s: Awaited<ReturnType<typeof setup>>, t: string | null) => s.call('session.enrolCheck', {}, t);
    const none = await setup({ factorCount: async () => 0 });
    expect(await json(await ask(none, await aal1(none)))).toEqual({ ok: true, data: { allowed: true } });
    const one = await setup({ factorCount: async () => 1 });
    expect(await json(await ask(one, await aal1(one)))).toEqual({ ok: true, data: { allowed: false } });
    const unconfigured = await setup({});
    expect(await json(await ask(unconfigured, await aal1(unconfigured)))).toEqual({ ok: true, data: { allowed: false } });
    expect((await ask(none, await aal1(none, STRANGER_ID))).status).toBe(403); // no owner profile
    expect((await ask(none, await aal1(none, EDITOR_ID))).status).toBe(403); // editors never enrol
    expect((await ask(none, null)).status).toBe(401);
    const broken = await setup({ factorCount: async () => { throw new Error('down'); } });
    expect((await ask(broken, await aal1(broken))).status).toBe(503);
  });
  it('aal1 still cannot reach any other action', async () => {
    const s = await setup({ factorCount: async () => 0 });
    const t = await signToken(s.keys, { aal: 'aal1' });
    for (const a of ['dashboard', 'players.merge', 'undo']) expect((await s.call(a, {}, t)).status).toBe(403);
  });
});

describe('privileged actions', () => {
  it('merge: audited, undo token returned, undo restores', async () => {
    const s = await setup();
    const r = await s.call('players.merge', { keepId: SEED.p1, dropId: SEED.p2, reason: 'Same person' });
    expect(r.status).toBe(200);
    const body = await json(r);
    expect(body.data.result).toEqual({ keepId: SEED.p1, dropId: SEED.p2 });
    expect(s.store.state.audit[0]).toMatchObject({ action: 'player.merge', actor: expect.any(String), reason: 'Same person' });
    const undo = await s.call('undo', { descriptor: body.data.undo });
    expect(undo.status).toBe(200);
    expect(s.store.state.identity.players.find((p) => p.id === SEED.p2)!.mergedInto).toBeNull();
  });
  it('merge of a minor with a confirmed adult is blocked (409) and passes only with a written override', async () => {
    const s = await setup();
    const blocked = await s.call('players.merge', { keepId: SEED.p1, dropId: SEED.p4, reason: 'Same person' });
    expect(blocked.status).toBe(409);
    expect((await json(blocked)).code).toBe('MINOR_ADULT_MERGE_BLOCKED');
    const ok = await s.call('players.merge', { keepId: SEED.p1, dropId: SEED.p4, reason: 'Same person', overrideReason: 'Parent confirmed in writing' });
    expect(ok.status).toBe(200);
    expect(s.store.state.identity.players.find((p) => p.id === SEED.p1)!.ageStatus).toBe('minor_suspected');
    expect(s.store.state.audit.map((a) => a.action)).toContain('player.merge.age_override');
  });
  it('protected modes toggle is audited with old and new value and undoable', async () => {
    const s = await setup();
    const r = await s.call('settings.setProtectedMode', { key: 'minor_match_mode', value: 'noindex_minimal', reason: 'Owner test' });
    expect(r.status).toBe(200);
    expect(s.store.state.modes.minor_match_mode).toBe('noindex_minimal');
    expect(s.store.state.audit[0]).toMatchObject({ action: 'settings.protected_mode', entityId: 'minor_match_mode' });
    expect(s.store.state.audit[0]!.reason).toContain('hidden -> noindex_minimal');
    const body = await json(r);
    await s.call('undo', { descriptor: body.data.undo });
    expect(s.store.state.modes.minor_match_mode).toBe('hidden');
    expect((await s.call('settings.setProtectedMode', { key: 'minor_match_mode', value: 'full', reason: 'Owner test' })).status).toBe(400);
    expect((await s.call('settings.setProtectedMode', { key: 'non_tn_tournament_pages', value: 'on', reason: 'Owner test' })).status).toBe(400);
  });
  it('confirm adult: skips minor_confirmed and merged players, undo only restores protected statuses', async () => {
    const s = await setup();
    s.store.state.identity.players.find((p) => p.id === SEED.p4)!.ageStatus = 'minor_confirmed';
    const r = await s.call('players.confirmAdult', { playerIds: [SEED.p3, SEED.p4, SEED.p1], evidence: 'Known to the owner', reason: 'Bulk review' });
    const body = await json(r);
    expect(body.data.result.confirmed).toEqual([SEED.p3]);
    expect(body.data.result.rejected).toEqual(expect.arrayContaining([{ id: SEED.p4, code: 'MINOR_CONFIRMED_NEEDS_AGE_PROOF' }, { id: SEED.p1, code: 'ALREADY_ADULT' }]));
    expect(body.data.undo.entries).toEqual([{ id: SEED.p3, status: 'unknown' }]);
    const bad = await s.call('undo', { descriptor: { kind: 'restore_age', entries: [{ id: SEED.p3, status: 'adult_confirmed' }] } });
    expect(bad.status).toBe(400);
    await s.call('undo', { descriptor: body.data.undo });
    expect(s.store.state.identity.players.find((p) => p.id === SEED.p3)!.ageStatus).toBe('unknown');
    expect((await s.call('players.confirmAdult', { playerIds: Array.from({ length: 201 }, (_, i) => `00000000-0000-4000-8000-${String(i).padStart(12, '0')}`), evidence: 'abc', reason: 'abc' })).status).toBe(400);
  });
  it('split inherits protection and keeps the new person hidden', async () => {
    const s = await setup();
    const r = await s.call('players.split', { playerId: SEED.p5, newDisplayName: 'Demo Other Person', participantIds: ['50000000-0000-4000-8000-000000000002'], reason: 'Different people' });
    expect(r.status).toBe(200);
    const id = (await json(r)).data.newPlayerId;
    const child = s.store.state.identity.players.find((p) => p.id === id)!;
    expect(child).toMatchObject({ ageStatus: 'unknown', visibility: 'hidden', provisional: true });
    expect(s.store.state.participants.find((p) => p.id === '50000000-0000-4000-8000-000000000002')!.playerId).toBe(id);
  });
  it('rename of a protected player never changes the slug', async () => {
    const s = await setup();
    const r = await s.call('players.rename', { playerId: SEED.p3, newDisplayName: 'Demo Meena Renamed', reason: 'Spelling fix' });
    expect((await json(r)).data.slug).toBe('p-0000000000000003');
  });
  it('review resolve: approve publishes, minor hold stays hidden, lock is stored, every call audited', async () => {
    const s = await setup();
    await s.call('review.resolve', { videoId: 'fake-vid-1', decision: 'approve', changes: { round: 'Semi Final' }, lockFields: ['round'], reason: 'Looks right' });
    const v1 = s.store.state.videos.find((v) => v.youtubeId === 'fake-vid-1')!;
    expect(v1).toMatchObject({ visibility: 'public', parseStatus: 'parsed' });
    expect(v1.parsed.round).toBe('Semi Final');
    expect(v1.locks.round).toBe(true);
    await s.call('review.resolve', { videoId: 'fake-vid-2', decision: 'approve', reason: 'Looks right' });
    expect(s.store.state.videos.find((v) => v.youtubeId === 'fake-vid-2')!.visibility).toBe('hidden');
    expect((await s.call('review.resolve', { videoId: 'nope-id', decision: 'approve', reason: 'Looks right' })).status).toBe(404);
    expect(s.store.state.audit).toHaveLength(2);
  });
  it('tournament promote: a non-Tamil-Nadu event stays listed without a page (D-018)', async () => {
    const s = await setup();
    await s.call('tournaments.decide', { id: SEED.t2, decision: 'promote', reason: 'Owner choice' });
    expect(s.store.state.tournaments.find((t) => t.id === SEED.t2)!.visibility).toBe('listed_no_player_pages');
    await s.call('tournaments.decide', { id: SEED.t1, decision: 'promote', reason: 'Owner choice' });
    expect(s.store.state.tournaments.find((t) => t.id === SEED.t1)!.visibility).toBe('public');
  });
});

describe('dispatch (sync-now / publish-now / emergency hide)', () => {
  function recorder(status = 204) {
    const calls: { url: string; init: RequestInit }[] = [];
    const f = (async (url: string, init: RequestInit) => {
      calls.push({ url, init });
      return new Response(status === 204 ? null : 'secret github body', { status });
    }) as unknown as typeof fetch;
    return { calls, f };
  }
  const cfg = (f: typeof fetch) => ({ token: ['ghp', 'FAKE', 'token'].join('_'), repo: 'fake-owner/fake-repo', workflows: { sync: 'sync.yml', publish: 'deploy.yml' }, ref: 'main', fetch: f });

  it('publish-now calls workflow_dispatch on the deploy workflow with an Actions token, records the audit row', async () => {
    const rec = recorder();
    const s = await setup({ dispatch: createGithubDispatch(cfg(rec.f)) });
    const r = await s.call('site.publishNow');
    expect(r.status).toBe(200);
    expect(rec.calls).toHaveLength(1);
    expect(rec.calls[0]!.url).toBe('https://api.github.com/repos/fake-owner/fake-repo/actions/workflows/deploy.yml/dispatches');
    const h = rec.calls[0]!.init.headers as Record<string, string>;
    expect(h.authorization).toBe(`Bearer ${cfg(rec.f).token}`);
    expect(JSON.parse(rec.calls[0]!.init.body as string)).toEqual({ ref: 'main' });
    expect(s.store.state.audit[0]!.action).toBe('site.publish_now');
    expect(s.store.state.siteDirty).toBe(false);
  });
  it('sync-now uses the sync workflow', async () => {
    const rec = recorder();
    const s = await setup({ dispatch: createGithubDispatch(cfg(rec.f)) });
    await s.call('site.syncNow');
    expect(rec.calls[0]!.url).toContain('/workflows/sync.yml/dispatches');
  });
  it('a rejected dispatch is a 502 with a generic body, audited as failed, and never leaks the token or GitHub body', async () => {
    const rec = recorder(403);
    const s = await setup({ dispatch: createGithubDispatch(cfg(rec.f)) });
    const r = await s.call('site.publishNow');
    expect(r.status).toBe(502);
    const text = JSON.stringify(await json(r));
    expect(text).not.toContain('ghp');
    expect(text).not.toContain('secret github body');
    expect(s.store.state.audit[0]!.reason).toBe('failed');
  });
  it('no dispatch configured: 503 not_configured, never a silent success', async () => {
    const s = await setup({ dispatch: null });
    const r = await s.call('site.publishNow');
    expect(r.status).toBe(503);
    expect((await json(r)).code).toBe('not_configured');
  });
  it('invalid dispatch settings (bad repo, bad workflow, bad ref) never call the network', async () => {
    const rec = recorder();
    for (const bad of [{ repo: 'not a repo' }, { workflows: { sync: '../x.yml', publish: 'deploy.yml' } }, { ref: 'main; rm -rf' }, { token: ' ' }]) {
      const out = await createGithubDispatch({ ...cfg(rec.f), ...bad })('publish');
      expect(out).toEqual({ ok: false, reason: 'not_configured' });
    }
    expect(rec.calls).toHaveLength(0);
  });
  it('emergency hide hides the player, removes redirects, blocks later merge, requests a publish and returns the owner checklist', async () => {
    const rec = recorder();
    const s = await setup({ dispatch: createGithubDispatch(cfg(rec.f)) });
    s.store.state.identity.redirects.push({ fromSlug: 'old-arvind', toSlug: 'demo-arvind-testwell', type: 301 });
    const r = await s.call('emergency.hide', { kind: 'player_id', value: SEED.p1, reason: 'Takedown request' });
    const body = await json(r);
    expect(r.status).toBe(200);
    expect(body.data).toMatchObject({ deploy: 'requested', result: { playersHidden: 1, redirectsRemoved: 1 } });
    expect(body.data.result.ownerChecklist).toEqual(['deploy_now', 'purge_cache_for_urls', 'set_youtube_video_private', 'search_console_removals_request']);
    expect(rec.calls).toHaveLength(1);
    const p = s.store.state.identity.players.find((x) => x.id === SEED.p1)!;
    expect(p.visibility).toBe('hidden');
    expect(s.store.state.identity.redirects).toEqual([{ fromSlug: 'demo-arvind-testwell', toSlug: null, type: 410 }]);
    const merge = await s.call('players.merge', { keepId: SEED.p2, dropId: SEED.p1, reason: 'Try to resurrect' });
    expect(merge.status).toBe(409);
    expect((await json(merge)).code).toBe('SUPPRESSED');
    // undo releases it
    const undo = await s.call('undo', { descriptor: body.data.undo });
    expect(undo.status).toBe(200);
    const merge2 = await s.call('players.merge', { keepId: SEED.p2, dropId: SEED.p1, reason: 'Allowed again' });
    expect(merge2.status).not.toBe(409);
  });
  it('emergency hide without a dispatch token still hides and reports not_configured', async () => {
    const s = await setup({ dispatch: null });
    const body = await json(await s.call('emergency.hide', { kind: 'youtube_id', value: 'fake-vid-1', reason: 'Takedown request' }));
    expect(body.data).toMatchObject({ deploy: 'not_configured', result: { videosHidden: 1 } });
  });
});
