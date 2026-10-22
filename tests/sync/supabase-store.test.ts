import { describe, expect, it } from 'vitest';
import { createSupabaseRest } from '../../src/lib/supabase/rest';
import { createSupabaseSyncStore, DB_MODE, PAGE_SIZE } from '../../src/lib/sync/supabase-store';
import { buildFreshRecord } from '../../src/lib/sync/record';
import { EMPTY_COUNTS, type SyncMode, type SyncRunSummary } from '../../src/lib/sync/types';

const KEY = ['sb', 'secret', 'FAKE', 'unit'].join('_');
const URL_BASE = 'https://fakeprojectref.supabase.co';

interface Call {
  method: string;
  path: string;
  query: string;
  apikey: string | undefined;
  prefer: string | undefined;
  body: unknown;
}

function mock(responder: (c: Call) => { status?: number; json?: unknown; headers?: Record<string, string> }) {
  const calls: Call[] = [];
  const fetchFn: typeof fetch = async (input, init) => {
    const u = new URL(String(input));
    const headers = (init?.headers ?? {}) as Record<string, string>;
    const call: Call = { method: String(init?.method), path: u.pathname.replace('/rest/v1/', ''), query: decodeURIComponent(u.search.slice(1)), apikey: headers.apikey, prefer: headers.prefer, body: init?.body ? JSON.parse(String(init.body)) : undefined };
    calls.push(call);
    const r = responder(call);
    return new Response(r.json === undefined ? null : JSON.stringify(r.json), { status: r.status ?? 200, headers: r.headers ?? {} });
  };
  const store = createSupabaseSyncStore(createSupabaseRest({ url: URL_BASE, secretKey: KEY, fetch: fetchFn }), () => 'fake-run-uuid');
  return { calls, store };
}

const NOW = new Date('2026-10-22T06:00:00Z');
const fresh = (id: string, title = 'Fake clip') => buildFreshRecord({ id, snippet: { title, publishedAt: '2026-10-01T00:00:00Z' } }, NOW);

const summary = (over: Partial<SyncRunSummary> = {}): SyncRunSummary => ({
  runId: 'fake-run-uuid',
  mode: 'backfill',
  status: 'ok',
  startedAt: '2026-10-22T06:00:00.000Z',
  finishedAt: '2026-10-22T06:01:00.000Z',
  quotaDay: '2026-10-21',
  quotaUnits: 7,
  counts: { ...EMPTY_COUNTS, pages: 1, fetched: 1, inserted: 1 },
  errorCode: null,
  markedDirty: true,
  resumable: false,
  ...over,
});

describe('Supabase sync store (mocked fetch, real schema names)', () => {
  it('paginates list reads at 1,000 rows with explicit columns and never reads retired rows', async () => {
    const { calls, store } = mock((c) => {
      const offset = Number(/offset=(\d+)/.exec(c.query)?.[1] ?? 0);
      const n = offset === 0 ? PAGE_SIZE : 5;
      return { json: Array.from({ length: n }, (_, i) => ({ youtube_id: `fake-${offset + i}` })) };
    });
    const ids = await store.listVideoIds();
    expect(ids).toHaveLength(1005);
    expect(calls).toHaveLength(2);
    expect(calls.map((c) => /offset=(\d+)/.exec(c.query)?.[1])).toEqual(['0', '1000']);
    expect(calls.every((c) => c.path === 'videos' && c.query.includes('select=youtube_id') && c.query.includes('limit=1000') && c.query.includes('order=youtube_id.asc'))).toBe(true);
    expect(calls.every((c) => c.query.includes('title_raw=neq.') && c.apikey === KEY)).toBe(true);
    expect(calls.every((c) => !c.query.includes('select=*'))).toBe(true);
  });

  it('adds a published_at filter for the recent list', async () => {
    const { calls, store } = mock(() => ({ json: [] }));
    await store.listVideoIds({ publishedAfter: '2026-07-24T00:00:00.000Z' });
    expect(calls[0]?.query).toContain('published_at=gte.2026-07-24T00:00:00.000Z');
  });

  it('reads videos with the explicit column list, in batches of 50 with quoted ids', async () => {
    const { calls, store } = mock(() => ({ json: [] }));
    await store.getVideos(Array.from({ length: 120 }, (_, i) => `fake-${i}`));
    expect(calls).toHaveLength(3);
    expect(calls[0]?.query).toContain('select=youtube_id,title_raw,title_normalized');
    expect(calls[0]?.query).toContain('youtube_id=in.("fake-0","fake-1"');
  });

  it('upserts on youtube_id; a new row carries visibility, an existing one NEVER does (separate requests)', async () => {
    const { calls, store } = mock(() => ({ status: 201 }));
    const insert = { ...fresh('fake-new1'), visibility: 'public' as const, hidden_reason: null };
    const { visibility: _v, hidden_reason: _h, ...update } = fresh('fake-old1');
    void _v;
    void _h;
    await store.upsertVideos([insert, update, { ...update, youtube_id: 'fake-old2' }]);
    expect(calls).toHaveLength(2);
    expect(calls.every((c) => c.path === 'videos' && c.query.includes('on_conflict=youtube_id') && c.prefer?.includes('resolution=merge-duplicates'))).toBe(true);
    const [first, second] = calls.map((c) => c.body as Record<string, unknown>[]);
    expect(first).toHaveLength(1);
    expect(first![0]).toHaveProperty('visibility', 'public');
    expect(second).toHaveLength(2);
    for (const row of second!) {
      expect(row).not.toHaveProperty('visibility');
      expect(row).not.toHaveProperty('hidden_reason');
      expect(row).not.toHaveProperty('manual_override'); // owner locks are never written by the sync
      expect(row).not.toHaveProperty('override_stale');
    }
  });

  it('never sends the raw title through a lossy path: the byte-exact title is the body value', async () => {
    const { calls, store } = mock(() => ({ status: 201 }));
    const raw = ' Fake  title  ';
    const { visibility: _v, hidden_reason: _h, ...update } = fresh('fake-raw1', raw);
    void _v;
    void _h;
    await store.upsertVideos([update]);
    expect((calls[0]?.body as { title_raw: string }[])[0]?.title_raw).toBe(raw);
  });

  it('chunks writes at 100 rows', async () => {
    const { calls, store } = mock(() => ({ status: 201 }));
    await store.upsertVideos(Array.from({ length: 250 }, (_, i) => ({ ...fresh(`fake-s${i}`), visibility: 'hidden' as const })));
    expect(calls.map((c) => (c.body as unknown[]).length)).toEqual([100, 100, 50]);
  });

  it('looks suppression up by kind youtube_id and only ACTIVE (not released) tombstones', async () => {
    const { calls, store } = mock((c) => ({ json: c.query.includes('"fake-1"') ? [{ value: 'fake-1' }] : [] }));
    const found = await store.getSuppressedIds(Array.from({ length: 120 }, (_, i) => `fake-${i}`));
    expect(calls).toHaveLength(3);
    expect(calls.every((c) => c.path === 'suppression' && c.query.includes('kind=eq.youtube_id') && c.query.includes('released_at=is.null'))).toBe(true);
    expect([...found]).toEqual(['fake-1']);
  });

  it('refuses to put an unsafe id into a filter', async () => {
    const { calls, store } = mock(() => ({ json: [] }));
    await store.getVideos(['fake-ok', 'bad",youtube_id.neq."x']);
    expect(calls).toHaveLength(1);
    expect(calls[0]?.query).not.toContain('neq."x');
  });

  it('retires rows with PATCH (no DELETE: service_role has no delete on videos): hidden, title and API data blanked', async () => {
    const { calls, store } = mock(() => ({ status: 204 }));
    await store.retireVideos(['fake-a', 'fake-b'], '2026-10-22T06:00:00.000Z');
    expect(calls).toHaveLength(1);
    expect(calls[0]?.method).toBe('PATCH');
    expect(calls[0]?.body).toMatchObject({ title_raw: '', title_normalized: '', description: null, views: null, likes: null, stats_fetched_at: null, thumbnail_url: null, parse_result: null, visibility: 'hidden', hidden_reason: 'removed_from_youtube' });
    expect(calls.some((c) => c.method === 'DELETE')).toBe(false);
  });

  it('clears old statistics: counts first, then patches only when needed', async () => {
    const { calls, store } = mock((c) => (c.method === 'HEAD' ? { headers: { 'content-range': '0-2/3' }, status: 200 } : { status: 204 }));
    expect(await store.clearStatisticsBefore('2026-09-24T00:00:00.000Z')).toBe(3);
    expect(calls.map((c) => c.method)).toEqual(['HEAD', 'PATCH']);
    expect(calls[1]?.body).toEqual({ views: null, likes: null, stats_fetched_at: null });
    const none = mock(() => ({ headers: { 'content-range': '*/0' } }));
    expect(await none.store.clearStatisticsBefore('x')).toBe(0);
    expect(none.calls.map((c) => c.method)).toEqual(['HEAD']);
  });

  it('lists stale ids by last_synced_at, excluding rows already retired', async () => {
    const { calls, store } = mock(() => ({ json: [{ youtube_id: 'fake-x' }] }));
    expect(await store.listIdsNotRefreshedSince('2026-09-23T00:00:00.000Z')).toEqual(['fake-x']);
    expect(calls[0]?.query).toContain('last_synced_at=lt.2026-09-23T00:00:00.000Z');
    expect(calls[0]?.query).toContain('title_raw=neq.');
  });

  it('marks dirty through the admin_mark_dirty RPC with actor "sync" and no urgency', async () => {
    const { calls, store } = mock(() => ({ status: 200, json: { ok: true } }));
    await store.markDirty('2026-10-22T06:00:00.000Z');
    expect(calls[0]?.method).toBe('POST');
    expect(calls[0]?.path).toBe('rpc/admin_mark_dirty');
    expect(calls[0]?.body).toMatchObject({ p_actor: 'sync', p_urgent: false });
  });

  it('maps every sync mode to a mode the table allows and keeps the real mode in `trigger`', async () => {
    const allowed = ['full', 'incremental', 'backfill', 'reparse', 'weekly_check', 'live_status'];
    const modes: SyncMode[] = ['backfill', 'incremental', 'stats_recent', 'stats_all', 'purge', 'reparse'];
    for (const m of modes) expect(allowed).toContain(DB_MODE[m]);
    const { calls, store } = mock(() => ({ status: 201 }));
    await store.startRun('stats_recent', '2026-10-22T06:00:00.000Z');
    expect(calls[0]?.path).toBe('sync_runs');
    expect(calls[0]?.body).toMatchObject({ id: 'fake-run-uuid', mode: 'live_status', status: 'running', trigger: 'sync:stats_recent', counts: { quota_day_key: 20261021 } });
  });

  it('records a finished run: quota_exhausted is stored as partial with the code in `error`, counts keep the quota day', async () => {
    const { calls, store } = mock(() => ({ status: 204 }));
    const id = await store.startRun('backfill', '2026-10-22T06:00:00.000Z');
    await store.finishRun(id, summary({ status: 'quota_exhausted', errorCode: 'youtube_quota_ledger' }));
    const last = calls.at(-1)!;
    expect(last.method).toBe('PATCH');
    expect(last.body).toMatchObject({ status: 'partial', error: 'youtube_quota_ledger', quota_units: 7, finished_at: '2026-10-22T06:01:00.000Z' });
    expect((last.body as { counts: Record<string, unknown> }).counts).toMatchObject({ quota_day_key: 20261021, inserted: 1, marked_dirty: 1, resumable: 0 });
  });

  it('sums quota units for a Pacific quota day from counts->>quota_day_key', async () => {
    const { calls, store } = mock(() => ({ json: [{ id: 'a', quota_units: 7 }, { id: 'b', quota_units: 3 }, { id: 'c', quota_units: null }] }));
    expect(await store.quotaUnitsForDay('2026-10-21')).toBe(10);
    expect(calls[0]?.query).toContain('counts->>quota_day_key=eq.20261021');
  });

  it('loads state: stored parts from the newest run holding sync_state, dirty and build time from site_state, last good sync from the run log', async () => {
    const { store } = mock((c) => {
      if (c.path === 'sync_runs' && c.query.includes('counts->sync_state')) return { json: [{ counts: { sync_state: { uploadsPlaylistId: 'fake-uploads', playlistFirstPageEtag: 'W/"x"', recentKnownIds: ['fake-a'], checkpoint: null } } }] };
      if (c.path === 'site_state') return { json: [{ dirty: true, dirty_since: '2026-10-22T05:00:00Z', last_deploy_requested_at: '2026-10-22T04:00:00Z' }] };
      if (c.path === 'sync_runs') return { json: [{ finished_at: '2026-10-22T03:00:00Z' }] };
      return { json: [] };
    });
    const s = await store.loadState();
    expect(s).toMatchObject({ uploadsPlaylistId: 'fake-uploads', playlistFirstPageEtag: 'W/"x"', recentKnownIds: ['fake-a'], channelEtag: null, dirtySince: '2026-10-22T05:00:00Z', lastBuildStarted: '2026-10-22T04:00:00Z', lastSyncOkAt: '2026-10-22T03:00:00Z' });
  });

  it('a clean site_state (dirty = false) reads as no dirtySince', async () => {
    const { store } = mock((c) => (c.path === 'site_state' ? { json: [{ dirty: false, dirty_since: '2026-10-01T00:00:00Z', last_deploy_requested_at: null }] } : { json: [] }));
    expect((await store.loadState()).dirtySince).toBeNull();
  });

  it('saves state into the current run row (counts.sync_state) and ignores the derived fields', async () => {
    const { calls, store } = mock((c) => (c.method === 'GET' ? { json: [] } : { status: 204 }));
    await store.loadState();
    const id = await store.startRun('backfill', '2026-10-22T06:00:00.000Z');
    calls.length = 0;
    await store.saveState({ lastSyncOkAt: 'x', dirtySince: 'y' }); // derived: nothing is written
    expect(calls).toHaveLength(0);
    await store.saveState({ uploadsPlaylistId: 'fake-uploads', checkpoint: { mode: 'backfill', nextPageToken: 'p2', pagesDone: 1, startedAt: 's' } });
    expect(calls).toHaveLength(1);
    expect(calls[0]?.method).toBe('PATCH');
    expect(calls[0]?.query).toContain(`id=eq.${id}`);
    const counts = (calls[0]?.body as { counts: { sync_state: Record<string, unknown>; quota_day_key: number } }).counts;
    expect(counts.sync_state).toMatchObject({ uploadsPlaylistId: 'fake-uploads', checkpoint: { nextPageToken: 'p2' } });
    expect(counts.quota_day_key).toBe(20261021);
  });

  it('errors carry no response body or key', async () => {
    const { store } = mock(() => ({ status: 500, json: { message: `echo ${KEY}` } }));
    const err = await store.listVideoIds().catch((e: unknown) => e as Error);
    expect(String((err as Error).message)).not.toContain(KEY);
  });
});
