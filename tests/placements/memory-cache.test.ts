// FIX 3 (security review): on Node there is no `caches.default`, and the Vercel CDN keys by the full URL, so `/api/placements?x=<random>`
// reached the function and the database every time. A small in-memory CacheLike (60 s, few entries) behind the handler's
// query-ignoring key makes those requests share one read per minute.
import { afterEach, describe, expect, it, vi } from 'vitest';
import { PLACEMENTS_CACHE_CONTROL, createPlacementsHandler, purgePlacementsCache } from '../../src/lib/placements/api-handler';
import { PLACEMENTS_MEMORY_TTL_MS, createMemoryCache } from '../../src/lib/placements/memory-cache';
import { env as mockEnv } from '../mocks/runtime-env';
import { placement } from './helpers';

const BASE = 'https://fakeproject.supabase.co/storage/v1/object/public/creatives';
const NOW = new Date('2026-11-10T04:00:00Z');
const req = (path = '/api/placements', method = 'GET') => new Request(`https://powersmash.example${path}`, { method });
const ok = (body = '{"a":1}', headers: Record<string, string> = { 'content-type': 'application/json', 'cache-control': PLACEMENTS_CACHE_CONTROL }) =>
  new Response(body, { status: 200, headers });

function clock(start = 1_000_000) {
  let t = start;
  return { now: () => t, advance: (ms: number) => void (t += ms) };
}

describe('createMemoryCache', () => {
  it('is a hit for the same key: status, headers and body come back, as a fresh Response each time', async () => {
    const cache = createMemoryCache({ now: clock().now });
    const key = req();
    await cache.put(key, ok('{"v":1}'));
    const a = await cache.match(key);
    const b = await cache.match(key);
    expect(a?.status).toBe(200);
    expect(a?.headers.get('cache-control')).toBe(PLACEMENTS_CACHE_CONTROL);
    expect(a?.headers.get('content-type')).toBe('application/json');
    expect(await a?.text()).toBe('{"v":1}');
    expect(await b?.text()).toBe('{"v":1}'); // the second match is not a used-up body
  });

  it('misses for another key and for a non-GET request', async () => {
    const cache = createMemoryCache({ now: clock().now });
    await cache.put(req(), ok());
    expect(await cache.match(req('/api/other'))).toBeUndefined();
    expect(await cache.match(req('/api/placements', 'HEAD'))).toBeUndefined();
  });

  it('expires after the TTL (60 s by default) using the injected clock, and drops the entry', async () => {
    const c = clock();
    const cache = createMemoryCache({ now: c.now });
    expect(PLACEMENTS_MEMORY_TTL_MS).toBe(60_000);
    await cache.put(req(), ok());
    c.advance(59_999);
    expect(await cache.match(req())).toBeDefined();
    c.advance(1);
    expect(await cache.match(req())).toBeUndefined();
    expect(await cache.delete(req())).toBe(false); // already gone
  });

  it('a fresh put restarts the clock', async () => {
    const c = clock();
    const cache = createMemoryCache({ now: c.now, ttlMs: 1000 });
    await cache.put(req(), ok('{"n":1}'));
    c.advance(900);
    await cache.put(req(), ok('{"n":2}'));
    c.advance(900);
    expect(await (await cache.match(req()))?.text()).toBe('{"n":2}');
  });

  it('holds at most maxEntries and drops the oldest first', async () => {
    const cache = createMemoryCache({ now: clock().now, maxEntries: 2 });
    await cache.put(req('/a'), ok('a'));
    await cache.put(req('/b'), ok('b'));
    await cache.put(req('/c'), ok('c'));
    expect(await cache.match(req('/a'))).toBeUndefined();
    expect(await (await cache.match(req('/b')))?.text()).toBe('b');
    expect(await (await cache.match(req('/c')))?.text()).toBe('c');
  });

  it('expired entries are cleared before the cap evicts a live one', async () => {
    const c = clock();
    const cache = createMemoryCache({ now: c.now, maxEntries: 2, ttlMs: 1000 });
    await cache.put(req('/a'), ok('a'));
    c.advance(600);
    await cache.put(req('/b'), ok('b'));
    c.advance(600); // /a expired, /b live
    await cache.put(req('/c'), ok('c'));
    expect(await cache.match(req('/b'))).toBeDefined();
    expect(await cache.match(req('/c'))).toBeDefined();
  });

  it('never stores an error or partial answer, a non-GET key or an oversized body', async () => {
    const cache = createMemoryCache({ now: clock().now, maxBodyChars: 10 });
    await cache.put(req(), new Response('{"ok":false}', { status: 503 }));
    await cache.put(req('/p'), new Response('partial', { status: 206 }));
    await cache.put(req('/h', 'HEAD'), ok());
    await cache.put(req('/big'), ok('x'.repeat(11)));
    for (const p of ['/api/placements', '/p', '/h', '/big']) expect(await cache.match(req(p))).toBeUndefined();
  });

  it('delete removes the entry (purgePlacementsCache works on it)', async () => {
    const cache = createMemoryCache({ now: clock().now });
    await cache.put(req(), ok());
    expect(await purgePlacementsCache(cache, 'https://powersmash.example/')).toBe(true);
    expect(await cache.match(req())).toBeUndefined();
  });
});

describe('the placements handler on top of the memory cache', () => {
  const setup = (load = vi.fn(async () => [placement()])) => {
    const c = clock();
    const cache = createMemoryCache({ now: c.now });
    const handler = createPlacementsHandler({ load, now: () => NOW, creativeBase: BASE, cache });
    return { c, cache, load, handler };
  };

  it('ignores the query string: a different ?x= every time still reads the database once', async () => {
    const { handler, load } = setup();
    for (let i = 0; i < 20; i += 1) {
      const res = await handler(req(`/api/placements?x=${Math.random()}&bust=${i}`));
      expect(res.status).toBe(200);
      await res.text();
    }
    expect(load).toHaveBeenCalledTimes(1);
  });

  it('serves the same body and cache headers on a hit', async () => {
    const { handler } = setup();
    const first = await handler(req());
    const firstBody = await first.text();
    const hit = await handler(req('/api/placements?x=1'));
    expect(hit.status).toBe(200);
    expect(hit.headers.get('cache-control')).toBe(PLACEMENTS_CACHE_CONTROL);
    expect(await hit.text()).toBe(firstBody);
  });

  it('reads the database again after the 60 seconds', async () => {
    const { handler, load, c } = setup();
    await (await handler(req())).text();
    c.advance(59_000);
    await (await handler(req('/api/placements?x=2'))).text();
    expect(load).toHaveBeenCalledTimes(1);
    c.advance(1_000);
    await (await handler(req('/api/placements?x=3'))).text();
    expect(load).toHaveBeenCalledTimes(2);
  });

  it('a database failure is a 503 that is never cached; the next call tries the database again', async () => {
    let fail = true;
    const load = vi.fn(async () => {
      if (fail) throw new Error('boom: secret detail');
      return [placement()];
    });
    const { handler, cache } = setup(load);
    const down = await handler(req());
    expect(down.status).toBe(503);
    expect(down.headers.get('cache-control')).toBe('no-store');
    expect(await cache.match(req())).toBeUndefined();
    const down2 = await handler(req('/api/placements?x=1'));
    expect(down2.status).toBe(503);
    expect(load).toHaveBeenCalledTimes(2); // the failure was not served from memory
    fail = false;
    const up = await handler(req('/api/placements?x=2'));
    expect(up.status).toBe(200);
    expect(await cache.match(req())).toBeDefined();
    await handler(req('/api/placements?x=3'));
    expect(load).toHaveBeenCalledTimes(3);
  });

  it('HEAD: answered from the memory cache with its headers and no body; a cold HEAD does not fill the cache', async () => {
    const { handler, load, cache } = setup();
    const cold = await handler(req('/api/placements', 'HEAD'));
    expect(cold.status).toBe(200);
    expect(await cold.text()).toBe('');
    expect(await cache.match(req())).toBeUndefined();
    await (await handler(req())).text(); // a GET fills it
    expect(load).toHaveBeenCalledTimes(2);
    const warm = await handler(req('/api/placements?x=1', 'HEAD'));
    expect(warm.status).toBe(200);
    expect(warm.headers.get('cache-control')).toBe(PLACEMENTS_CACHE_CONTROL);
    expect(await warm.text()).toBe('');
    expect(load).toHaveBeenCalledTimes(2);
  });

  it('other methods are still a 405 and never touch the cache or the database', async () => {
    const { handler, load } = setup();
    expect((await handler(req('/api/placements', 'POST'))).status).toBe(405);
    expect(load).not.toHaveBeenCalled();
  });
});

describe('src/pages/api/placements.ts uses the memory cache when there is no caches.default', () => {
  afterEach(() => {
    for (const k of Object.keys(mockEnv)) delete mockEnv[k];
    vi.unstubAllGlobals();
    vi.resetModules();
  });

  const dbHits = (calls: string[]) => calls.filter((u) => u.includes('/rest/v1/placements'));

  async function loadRoute() {
    vi.resetModules(); // a fresh module-level cache per test
    mockEnv.SUPABASE_URL = 'https://fakeproject.supabase.co';
    mockEnv.SUPABASE_SECRET_KEY = ['sb', 'secret', 'FAKE'].join('_');
    return import('../../src/pages/api/placements');
  }
  const call = (route: Awaited<ReturnType<typeof loadRoute>>, path: string, method: 'GET' | 'HEAD' = 'GET') =>
    (method === 'GET' ? route.GET : route.HEAD)({ request: req(path, method), locals: {} } as unknown as Parameters<typeof route.GET>[0]);

  it('a random query string per request reaches the database once, not every time', async () => {
    const calls: string[] = [];
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: string | URL | Request) => {
        calls.push(typeof input === 'string' ? input : input instanceof URL ? input.href : input.url);
        return new Response('[]', { status: 200, headers: { 'content-type': 'application/json' } });
      }),
    );
    const route = await loadRoute();
    for (let i = 0; i < 10; i += 1) {
      const res = await call(route, `/api/placements?x=${i}-${Math.random()}`);
      expect(res.status).toBe(200);
      await res.text();
    }
    expect(dbHits(calls)).toHaveLength(1);
    const head = await call(route, '/api/placements?x=head', 'HEAD');
    expect(head.status).toBe(200);
    expect(dbHits(calls)).toHaveLength(1);
  });

  it('a database failure answers 503 every time and is not remembered', async () => {
    const calls: string[] = [];
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: string | URL | Request) => {
        calls.push(typeof input === 'string' ? input : input instanceof URL ? input.href : input.url);
        return new Response('{}', { status: 500 });
      }),
    );
    const route = await loadRoute();
    expect((await call(route, '/api/placements?x=1')).status).toBe(503);
    expect((await call(route, '/api/placements?x=2')).status).toBe(503);
    expect(dbHits(calls)).toHaveLength(2);
  });

  it('when the platform does provide caches.default it is used instead of the memory cache', async () => {
    const calls: string[] = [];
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: string | URL | Request) => {
        calls.push(typeof input === 'string' ? input : input instanceof URL ? input.href : input.url);
        return new Response('[]', { status: 200, headers: { 'content-type': 'application/json' } });
      }),
    );
    const store = new Map<string, Response>();
    vi.stubGlobal('caches', {
      default: {
        match: async (r: Request) => store.get(r.url)?.clone(),
        put: async (r: Request, res: Response) => void store.set(r.url, res),
        delete: async (r: Request) => store.delete(r.url),
      },
    });
    const route = await loadRoute();
    await (await call(route, '/api/placements?x=1')).text();
    await (await call(route, '/api/placements?x=2')).text();
    expect(store.size).toBe(1);
    expect(dbHits(calls)).toHaveLength(1);
  });
});
