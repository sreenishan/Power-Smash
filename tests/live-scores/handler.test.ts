// GET /api/live-scores/<event-id> (D-113): off = {live:false}; reads only the api view with the publishable key; caches a good answer
// about a minute and never caches an error; nobody protected is named. Mocked fetch only; fictional data.
import { describe, expect, it, vi } from 'vitest';
import { createInstanceLimiter, createLiveScoresHandler, type LiveScoresHandlerDeps } from '../../src/lib/live-scores/handler';
import { LIVE_VIEW_COLUMNS } from '../../src/lib/live-scores/public';
import { liveRow } from './fixtures';

const EVENT = 'ab000000-0000-4000-8000-000000000001';
const URL_OK = 'https://abcdefghijklmnop.supabase.co';
const KEY = ['sb', 'publishable', 'FAKE'].join('_');
const NOW = new Date('2026-11-07T05:13:00.000Z');

function setup(over: Partial<LiveScoresHandlerDeps> = {}, rows: unknown = [liveRow()], status = 200) {
  const fetch = vi.fn(async () => new Response(JSON.stringify(rows), { status, headers: { 'content-type': 'application/json' } }));
  const handler = createLiveScoresHandler({ enabled: true, supabaseUrl: URL_OK, publishableKey: KEY, fetch: fetch as unknown as typeof globalThis.fetch, now: () => NOW, ...over });
  const get = (key: string | undefined = EVENT, method = 'GET') => handler(new Request(`https://example.test/api/live-scores/${key ?? ''}`, { method }), key);
  return { fetch, get };
}

describe('switched off', () => {
  it('answers exactly {"live": false}, reads nothing', async () => {
    const { fetch, get } = setup({ enabled: false });
    const res = await get();
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ live: false });
    expect(res.headers.get('cache-control')).toBe('public, s-maxage=30, stale-while-revalidate=15');
    expect(fetch).not.toHaveBeenCalled();
  });
  it('even for a bad address', async () => {
    const { get } = setup({ enabled: false });
    expect(await (await get('nonsense')).json()).toEqual({ live: false });
  });
});

describe('cost guards (public data, bounded function calls)', () => {
  it('a query string is refused 400 no-store before anything is read (each distinct query would miss the edge cache)', async () => {
    const { fetch } = setup();
    const handler = createLiveScoresHandler({ enabled: true, supabaseUrl: URL_OK, publishableKey: KEY, fetch: fetch as unknown as typeof globalThis.fetch, now: () => NOW });
    for (const q of ['?x=1', '?live=true']) {
      const res = await handler(new Request(`https://example.test/api/live-scores/${EVENT}${q}`), EVENT);
      expect(res.status).toBe(400);
      expect(res.headers.get('cache-control')).toBe('no-store');
    }
    expect(fetch).not.toHaveBeenCalled();
  });
  it('one connection asking too often gets 429 no-store; the counter is per key, per window, with bounded memory', async () => {
    let t = 0;
    const limit = createInstanceLimiter({ max: 2, windowMs: 60_000, now: () => t, maxKeys: 3 });
    expect([limit('a'), limit('a'), limit('a')]).toEqual([true, true, false]);
    expect(limit('b')).toBe(true);
    t = 60_000;
    expect(limit('a')).toBe(true);
    const { fetch, get } = setup({ allow: () => false });
    const res = await get();
    expect(res.status).toBe(429);
    expect(res.headers.get('cache-control')).toBe('no-store');
    expect(res.headers.get('retry-after')).toBe('60');
    expect(fetch).not.toHaveBeenCalled();
  });
});

describe('refusals are never cached', () => {
  it('a bad event id is 400 no-store', async () => {
    const { fetch, get } = setup();
    for (const k of ['ms-u17', '../x', '', `${EVENT}0`]) {
      const res = await get(k);
      expect(res.status).toBe(400);
      expect(res.headers.get('cache-control')).toBe('no-store');
    }
    expect(fetch).not.toHaveBeenCalled();
  });
  it('another method is 405', async () => {
    const res = await setup().get(EVENT, 'POST');
    expect(res.status).toBe(405);
    expect(res.headers.get('allow')).toBe('GET, HEAD');
    expect(res.headers.get('cache-control')).toBe('no-store');
  });
  it('not configured: 503 no-store', async () => {
    for (const over of [{ supabaseUrl: null }, { publishableKey: '' }, { supabaseUrl: 'http://127.0.0.1:54321' }, { supabaseUrl: 'https://evil.example.test' }]) {
      const res = await setup(over).get();
      expect(res.status).toBe(503);
      expect(res.headers.get('cache-control')).toBe('no-store');
    }
  });
  it('a database error or a bad body: 503 no-store, nothing echoed', async () => {
    for (const [rows, status] of [[{ message: 'secret detail 910000000000' }, 500], [{ not: 'a list' }, 200]] as const) {
      const res = await setup({}, rows, status).get();
      expect(res.status).toBe(503);
      expect(res.headers.get('cache-control')).toBe('no-store');
      expect(await res.text()).not.toContain('910000000000');
    }
    const thrower = setup({ fetch: (async () => { throw new Error('network'); }) as unknown as typeof fetch });
    expect((await thrower.get()).status).toBe(503);
  });
});

describe('a good answer', () => {
  it('reads the api view with the publishable key, explicit columns, this event only', async () => {
    const { fetch, get } = setup();
    const res = await get(EVENT.toUpperCase());
    expect(res.status).toBe(200);
    const [url, init] = fetch.mock.calls[0] as unknown as [string, RequestInit];
    expect(url.startsWith(`${URL_OK}/rest/v1/public_competition_live?select=${encodeURIComponent(LIVE_VIEW_COLUMNS.join(','))}`)).toBe(true);
    expect(url).toContain(`event_id=eq.${EVENT}`);
    expect(url).toContain('limit=100');
    expect(init.headers).toEqual({ apikey: KEY, accept: 'application/json', 'accept-profile': 'api' });
    expect(JSON.stringify(init.headers)).not.toMatch(/secret|authorization/i);
  });
  it('is cached about a minute and holds ready text', async () => {
    const res = await setup().get();
    expect(res.headers.get('cache-control')).toBe('public, s-maxage=30, stale-while-revalidate=15');
    expect(res.headers.get('content-type')).toContain('application/json');
    const body = await res.json();
    expect(body).toMatchObject({ live: true, eventId: EVENT, windowSeconds: 300, checkedAt: NOW.toISOString() });
    expect(body.matches).toHaveLength(1);
    expect(body.matches[0]).toMatchObject({ sideA: 'Demo Arun', statusText: 'Live', current: { a: 7, b: 5 } });
  });
  it('drops rows of another event and rows that do not fit; masks protected sides', async () => {
    const rows = [
      liveRow({ side_a_protected: true, side_a_player1_name: 'Demo Hidden' }),
      liveRow({ match_id: 'aa000000-0000-4000-8000-000000000002', event_id: 'ab000000-0000-4000-8000-000000000009' }),
      liveRow({ match_id: 'aa000000-0000-4000-8000-000000000003', points_a: 99 }),
    ];
    const body = await (await setup({}, rows).get()).json();
    expect(body.matches).toHaveLength(1);
    expect(JSON.stringify(body)).not.toContain('Demo Hidden');
    expect(body.matches[0].sideA).toBe('Protected player');
  });
  it('no live match: live false with an empty list (the page stops asking)', async () => {
    const body = await (await setup({}, []).get()).json();
    expect(body).toMatchObject({ live: false, matches: [], windowSeconds: null });
  });
  it('a paused or stale match is listed but live is false', async () => {
    const body = await (await setup({}, [liveRow({ status: 'paused' })]).get()).json();
    expect(body.live).toBe(false);
    expect(body.matches[0].statusText).toBe('Paused');
  });
  it('HEAD has no body', async () => {
    const res = await setup().get(EVENT, 'HEAD');
    expect(res.status).toBe(200);
    expect(await res.text()).toBe('');
  });
});

describe('the route file', () => {
  it('is on-demand and reads the server switch through runtime-env and the legal switch', async () => {
    const { readFileSync } = await import('node:fs');
    const src = readFileSync('src/pages/api/live-scores/[event].ts', 'utf8');
    expect(src).toContain('export const prerender = false;');
    expect(src).toContain("from '../../../lib/runtime-env'");
    expect(src).toContain('liveScoresServerOn(');
    expect(src).not.toMatch(/process\.env/);
    expect(src).not.toMatch(/SECRET/);
  });
});
