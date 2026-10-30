// The /live pin and past streams from the admin (0013, D-101): the shared rule, the memory store through the real handler, and the
// Supabase store with a fake PostgREST. Fictional video ids and titles only.
import { describe, expect, it } from 'vitest';
import { ADMIN_ACTIONS } from '../../src/lib/admin/policy';
import { createSupabaseAdminStore } from '../../src/lib/admin/supabase-store';
import { LIVE_LIMITS, LIVE_MESSAGES, isIsoDate, liveChanges, liveProblems, validateLiveEdit, videoIdFrom } from '../../src/lib/live/rules';
import { EDITOR_ID, makeHandler, makeKeys, req, signToken } from './_helpers';

const json = async (r: Response) => (await r.json()) as { ok: boolean; code?: string; errors?: Record<string, string>; data?: any };
const ID1 = 'FAKEvid0001';
const ID2 = 'FAKEvid0002';
const TITLE = 'Fake Open 2026 Final - a fictional stream';

async function setup() {
  const keys = await makeKeys();
  const h = makeHandler(keys);
  const token = await signToken(keys);
  return { ...h, keys, call: (action: string, body: unknown = {}, t = token) => h.handle(req(action, t, body), action) };
}

describe('the live rule (shared by the build, both stores and the screen)', () => {
  it('reads the video id from a bare id or a YouTube link the owner pastes', () => {
    for (const ok of [
      ID1,
      `  ${ID1}  `,
      `https://www.youtube.com/watch?v=${ID1}`,
      `https://www.youtube.com/watch?v=${ID1}&t=42s&si=abc`,
      `https://m.youtube.com/watch?v=${ID1}`,
      `youtube.com/watch?v=${ID1}`,
      `https://youtu.be/${ID1}?si=share`,
      `https://www.youtube.com/live/${ID1}?feature=share`,
      `https://www.youtube.com/shorts/${ID1}`,
      `https://www.youtube.com/embed/${ID1}`,
    ]) expect(videoIdFrom(ok), ok).toBe(ID1);
  });
  it('refuses anything that is not a YouTube video address', () => {
    for (const bad of [
      '',
      'FAKEvid000',
      'FAKEvid00012',
      `https://evil.test/watch?v=${ID1}`,
      `https://youtube.com.evil.test/watch?v=${ID1}`,
      `https://www.youtube.com/@PowerSmash`,
      `https://www.youtube.com/watch?v=${ID1}x`,
      `https://www.youtube.com/watch/${ID1}`,
      `https://youtu.be/${ID1}/extra`,
      `javascript:alert('${ID1}')`,
      `https://user:pass@www.youtube.com/watch?v=${ID1}`,
      `https://www.youtube.com:8443/watch?v=${ID1}`,
      `ftp://www.youtube.com/watch?v=${ID1}`,
      'FAKEvid0"01',
    ]) expect(videoIdFrom(bad), bad).toBeNull();
  });
  it('dates are real calendar dates written YYYY-MM-DD', () => {
    expect(isIsoDate('2026-10-01')).toBe(true);
    expect(isIsoDate('2028-02-29')).toBe(true);
    for (const bad of ['2026-02-30', '2026-13-01', '1 Oct 2026', '2026-10-1', '']) expect(isIsoDate(bad), bad).toBe(false);
  });
  it('cleans a valid edit: ids from links, trimmed titles, empty date = null, empty pin = nothing pinned', () => {
    const v = validateLiveEdit({ pinned: `https://youtu.be/${ID2}`, past: [{ video: `https://www.youtube.com/watch?v=${ID1}`, title: `  ${TITLE} `, date: ' ' }] });
    expect(v).toEqual({ ok: true, value: { pinnedVideoId: ID2, pastStreams: [{ videoId: ID1, title: TITLE, date: null }] } });
    expect(validateLiveEdit({ pinned: '   ', past: [] })).toEqual({ ok: true, value: { pinnedVideoId: null, pastStreams: [] } });
  });
  it('names each bad field in plain words', () => {
    const v = validateLiveEdit({
      pinned: 'https://evil.test/x',
      past: [
        { video: ID1, title: TITLE, date: null },
        { video: ID1, title: '', date: '2026-02-30' },
        { video: 'nope', title: 'Two\nlines', date: null },
        { video: 'FAKEvid0003', title: 't'.repeat(LIVE_LIMITS.title + 1), date: null },
      ],
    });
    expect(v.ok).toBe(false);
    if (v.ok) return;
    expect(v.errors).toEqual({
      pinned: LIVE_MESSAGES.pinned,
      'past.1.video': LIVE_MESSAGES.twice,
      'past.1.title': LIVE_MESSAGES.title,
      'past.1.date': LIVE_MESSAGES.date,
      'past.2.video': LIVE_MESSAGES.video,
      'past.2.title': LIVE_MESSAGES.title,
      'past.3.title': LIVE_MESSAGES.title,
    });
  });
  it('counts title length like PostgreSQL (an emoji is one character) and refuses every control character the SQL refuses', () => {
    // 97 letters + 3 emoji = 100 characters to PostgreSQL, 103 UTF-16 units to JavaScript
    const emoji = `${'t'.repeat(97)}\u{1F3F8}\u{1F3F8}\u{1F3F8}`;
    expect(emoji.length).toBe(103);
    expect(validateLiveEdit({ pinned: null, past: [{ video: ID1, title: emoji, date: null }] }).ok).toBe(true);
    expect(validateLiveEdit({ pinned: null, past: [{ video: ID1, title: `${emoji}t`, date: null }] }).ok).toBe(false);
    for (const c of ['\u0000', '\u0009', '\u007f', '\u0085', '\u009f', '\u2028', '\u2029']) {
      expect(validateLiveEdit({ pinned: null, past: [{ video: ID1, title: `Fake${c}title`, date: null }] }).ok, JSON.stringify(c)).toBe(false);
      expect(liveProblems({ pinnedVideoId: null, pastStreams: [{ videoId: ID1, title: `Fake${c}title`, date: null }] }), JSON.stringify(c)).toHaveLength(1);
    }
    // ordinary punctuation and Tamil text are fine
    expect(validateLiveEdit({ pinned: null, past: [{ video: ID1, title: 'Fake Open 2026 | QF – பூப்பந்து', date: null }] }).ok).toBe(true);
  });
  it('allows at most 20 past streams', () => {
    const past = Array.from({ length: LIVE_LIMITS.pastStreams + 1 }, (_, i) => ({ video: `FAKEvid${String(i).padStart(4, '0')}`, title: `Fake ${i}`, date: null }));
    const v = validateLiveEdit({ pinned: null, past });
    expect(v.ok).toBe(false);
    if (!v.ok) expect(v.errors.form).toBe(LIVE_MESSAGES.tooMany);
    expect(validateLiveEdit({ pinned: null, past: past.slice(0, LIVE_LIMITS.pastStreams) }).ok).toBe(true);
  });
  it('reports what changed by name, and the order of past streams counts', () => {
    const a = { pinnedVideoId: ID1, pastStreams: [{ videoId: ID1, title: 'A', date: null }, { videoId: ID2, title: 'B', date: null }] };
    expect(liveChanges(a, a)).toEqual([]);
    expect(liveChanges(a, { ...a, pinnedVideoId: null })).toEqual(['pinned']);
    expect(liveChanges(a, { ...a, pastStreams: [...a.pastStreams].reverse() })).toEqual(['past']);
    expect(liveChanges(a, { pinnedVideoId: ID2, pastStreams: [] })).toEqual(['pinned', 'past']);
  });
  it('the build-time check refuses stored values the admin could never save', () => {
    expect(liveProblems({ pinnedVideoId: null, pastStreams: [{ videoId: ID1, title: ' padded', date: null }] })).toHaveLength(1);
    expect(liveProblems({ pinnedVideoId: null, pastStreams: [{ videoId: ID1, title: 'Two\nlines', date: null }] })).toHaveLength(1);
    expect(liveProblems({ pinnedVideoId: null, pastStreams: [{ videoId: ID1, title: 'Fine', date: '2026-02-30' }] })).toHaveLength(1);
  });
});

describe('memory store through the handler', () => {
  const body = (over: object = {}) => ({ pinned: `https://www.youtube.com/live/${ID2}`, past: [{ video: `https://youtu.be/${ID1}`, title: TITLE, date: '2026-10-01' }], reason: 'Live page edited by owner', ...over });

  it('both actions are owner-only, and the write is audited', () => {
    expect(ADMIN_ACTIONS['live.get']).toMatchObject({ kind: 'read', roles: ['owner'], requiresAal2: true });
    expect(ADMIN_ACTIONS['live.save']).toMatchObject({ kind: 'write', roles: ['owner'], requiresAal2: true, audited: true });
  });

  it('starts empty; a save stores ids (not links), audits ids and counts but never a title, and marks the site dirty', async () => {
    const s = await setup();
    s.store.state.siteDirty = false;
    expect((await json(await s.call('live.get'))).data).toEqual({ pinnedVideoId: null, pastStreams: [] });
    const r = await s.call('live.save', body());
    expect(r.status).toBe(200);
    expect((await json(r)).data).toEqual({ settings: { pinnedVideoId: ID2, pastStreams: [{ videoId: ID1, title: TITLE, date: '2026-10-01' }] }, fields: ['pinned', 'past'] });
    expect((await json(await s.call('live.get'))).data).toEqual({ pinnedVideoId: ID2, pastStreams: [{ videoId: ID1, title: TITLE, date: '2026-10-01' }] });
    const row = s.store.state.audit[0]!;
    expect(row).toMatchObject({ action: 'live.save', entity: 'live_settings', entityId: '1' });
    expect(row.reason).toContain(ID2);
    expect(JSON.stringify(s.store.state.audit)).not.toContain('fictional stream');
    expect(s.store.state.siteDirty).toBe(true);
  });

  it('an unchanged save writes nothing and is not audited', async () => {
    const s = await setup();
    await s.call('live.save', body());
    const n = s.store.state.audit.length;
    s.store.state.siteDirty = false;
    // the same values, typed differently (a bare id, extra spaces)
    const again = await s.call('live.save', body({ pinned: ` ${ID2} `, past: [{ video: ID1, title: ` ${TITLE}`, date: '2026-10-01' }] }));
    expect((await json(again)).data.fields).toEqual([]);
    expect(s.store.state.audit).toHaveLength(n);
    expect(s.store.state.siteDirty).toBe(false);
  });

  it('a bad edit is refused with the field errors, and nothing is stored or audited', async () => {
    const s = await setup();
    const r = await s.call('live.save', body({ pinned: 'https://evil.test/watch?v=FAKEvid0002' }));
    expect(r.status).toBe(400);
    expect((await json(r)).errors).toEqual({ pinned: LIVE_MESSAGES.pinned });
    expect(s.store.state.live).toBeUndefined();
    expect(s.store.state.audit).toHaveLength(0);
  });

  it('the schema refuses a missing reason, unknown keys and oversize input', async () => {
    const s = await setup();
    const { reason: _r, ...noReason } = body();
    expect((await s.call('live.save', noReason)).status).toBe(400);
    expect((await s.call('live.save', body({ views: 5 }))).status).toBe(400);
    expect((await s.call('live.save', body({ past: [{ video: ID1, title: TITLE, date: null, views: 5 }] }))).status).toBe(400);
    expect((await s.call('live.save', body({ pinned: 'x'.repeat(301) }))).status).toBe(400);
    expect((await s.call('live.save', body({ past: Array.from({ length: 41 }, () => ({ video: ID1, title: 'x', date: null })) }))).status).toBe(400);
    expect((await s.call('live.get', { extra: 1 })).status).toBe(400);
    expect(s.store.state.audit).toHaveLength(0);
  });

  it('an editor token is refused for both actions', async () => {
    const s = await setup();
    const editor = await signToken(s.keys, { sub: EDITOR_ID });
    expect((await s.call('live.get', {}, editor)).status).toBe(403);
    expect((await s.call('live.save', body(), editor)).status).toBe(403);
  });
});

describe('supabase store with a fake PostgREST', () => {
  const URL_OK = 'https://fakeref.supabase.co';
  const SECRET = ['sb', 'secret', 'FAKE'].join('_');
  const ACTOR = { userId: '9a000000-0000-4000-8000-000000000001', role: 'owner' as const };
  type Call = { url: string; method: string; body: any };

  function fake(pinned: string | null, past: { video_id: string; title: string; streamed_on: string | null; position: number }[]) {
    const calls: Call[] = [];
    const f = (async (url: string, init: RequestInit) => {
      calls.push({ url, method: init.method ?? 'GET', body: init.body ? JSON.parse(init.body as string) : undefined });
      if (url.includes('/rpc/')) return new Response(JSON.stringify({ fields: [] }), { status: 200 });
      const rows = url.includes('/live_settings?') ? [{ pinned_video_id: pinned }] : url.includes('/live_past_streams?') ? past : [];
      return new Response(JSON.stringify(rows), { status: 200, headers: { 'content-range': `0-0/${rows.length}` } });
    }) as unknown as typeof fetch;
    return { calls, store: createSupabaseAdminStore({ url: URL_OK, secretKey: SECRET, fetch: f }) };
  }
  const rpcCalls = (calls: Call[]) => calls.filter((c) => c.url.includes('/rpc/'));

  it('reads the one settings row and the list in the stored order', async () => {
    const { calls, store } = fake(ID2, [{ video_id: ID1, title: TITLE, streamed_on: '2026-10-01', position: 0 }]);
    expect(await store.getLive()).toEqual({ ok: true, data: { pinnedVideoId: ID2, pastStreams: [{ videoId: ID1, title: TITLE, date: '2026-10-01' }] } });
    expect(calls.map((c) => c.url)).toEqual([
      `${URL_OK}/rest/v1/live_settings?select=pinned_video_id&id=eq.1&limit=1`,
      `${URL_OK}/rest/v1/live_past_streams?select=video_id,title,streamed_on,position&order=position.asc&limit=100`,
    ]);
  });

  it('a refused edit makes no network call at all', async () => {
    const { calls, store } = fake(null, []);
    const r = await store.saveLive(ACTOR, { pinned: 'not a link', past: [], reason: 'Live page edited by owner' });
    expect(r).toMatchObject({ ok: false, code: 'INVALID', errors: { pinned: LIVE_MESSAGES.pinned } });
    expect(calls).toHaveLength(0);
  });

  it('sends the cleaned ids to admin_save_live with the verified actor; an unchanged save sends nothing', async () => {
    const { calls, store } = fake(null, []);
    const r = await store.saveLive(ACTOR, { pinned: `https://youtu.be/${ID2}`, past: [{ video: `https://www.youtube.com/watch?v=${ID1}`, title: ` ${TITLE} `, date: '' }], reason: 'Live page edited by owner' });
    expect(r).toEqual({ ok: true, data: { settings: { pinnedVideoId: ID2, pastStreams: [{ videoId: ID1, title: TITLE, date: null }] }, fields: ['pinned', 'past'] } });
    const rpc = rpcCalls(calls);
    expect(rpc).toHaveLength(1);
    expect(rpc[0]!.url).toBe(`${URL_OK}/rest/v1/rpc/admin_save_live`);
    expect(rpc[0]!.body).toEqual({ p_actor: ACTOR.userId, p_pinned: ID2, p_past: [{ videoId: ID1, title: TITLE, date: null }], p_reason: 'Live page edited by owner' });

    const same = fake(ID2, [{ video_id: ID1, title: TITLE, streamed_on: null, position: 0 }]);
    const again = await same.store.saveLive(ACTOR, { pinned: ID2, past: [{ video: ID1, title: TITLE, date: null }], reason: 'Live page edited by owner' });
    expect(again).toMatchObject({ ok: true, data: { fields: [] } });
    expect(rpcCalls(same.calls)).toHaveLength(0);
  });
});
