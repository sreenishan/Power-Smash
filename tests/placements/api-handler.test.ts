import { describe, expect, it, vi } from 'vitest';
import { PLACEMENTS_CACHE_CONTROL, createPlacementsHandler, purgePlacementsCache } from '../../src/lib/placements/api-handler';
import type { CacheLike } from '../../src/lib/placements/api-handler';
import { createPlacementsRouteHandler, creativeBaseUrl } from '../../src/lib/placements/runtime';
import { placementFromRow } from '../../src/lib/placements/store';
import { placement } from './helpers';

const BASE = 'https://fakeproject.supabase.co/storage/v1/object/public/creatives';
const NOW = new Date('2026-11-10T04:00:00Z');
const req = (method = 'GET', path = '/api/placements') => new Request(`https://powersmash.example${path}`, { method });

function memoryCache(): CacheLike & { store: Map<string, Response> } {
  const store = new Map<string, Response>();
  return {
    store,
    match: async (r) => store.get(r.url)?.clone(),
    put: async (r, res) => void store.set(r.url, res),
    delete: async (r) => store.delete(r.url),
  };
}

describe('GET /api/placements handler', () => {
  it('serves the public schedule with the cache headers of D-031', async () => {
    const p = placement();
    const handler = createPlacementsHandler({ load: async () => [p], now: () => NOW, creativeBase: BASE });
    const res = await handler(req());
    expect(res.status).toBe(200);
    expect(res.headers.get('cache-control')).toBe(PLACEMENTS_CACHE_CONTROL);
    expect(PLACEMENTS_CACHE_CONTROL).toContain('s-maxage=300');
    expect(PLACEMENTS_CACHE_CONTROL).toContain('stale-while-revalidate=600');
    expect(res.headers.get('content-type')).toContain('application/json');
    const body = (await res.json()) as { v: number; today: string; placements: Array<{ id: string }> };
    expect(body.today).toBe('2026-11-10');
    expect(body.placements.map((x) => x.id)).toEqual([p.id]);
  });

  it('uses the India date, not UTC, for today', async () => {
    const load = vi.fn(async () => []);
    const handler = createPlacementsHandler({ load, now: () => new Date('2026-11-10T19:00:00Z'), creativeBase: BASE });
    await handler(req());
    expect(load).toHaveBeenCalledWith('2026-11-11');
  });

  it('answers from the cache on the second call and ignores the query string', async () => {
    const cache = memoryCache();
    const load = vi.fn(async () => [placement()]);
    const handler = createPlacementsHandler({ load, now: () => NOW, creativeBase: BASE, cache });
    await handler(req());
    await handler(req('GET', '/api/placements?bust=1'));
    expect(load).toHaveBeenCalledTimes(1);
    expect(cache.store.size).toBe(1);
  });

  it('an admin edit purges the cache so the next call reloads', async () => {
    const cache = memoryCache();
    const load = vi.fn(async () => [placement()]);
    const handler = createPlacementsHandler({ load, now: () => NOW, creativeBase: BASE, cache });
    await handler(req());
    expect(await purgePlacementsCache(cache, 'https://powersmash.example/')).toBe(true);
    await handler(req());
    expect(load).toHaveBeenCalledTimes(2);
    expect(await purgePlacementsCache(null, 'https://powersmash.example')).toBe(false);
  });

  it('an empty, short-lived schedule when the database or the creative bucket is not configured', async () => {
    const handler = createPlacementsHandler({ load: async () => null, now: () => NOW, creativeBase: BASE });
    const res = await handler(req());
    expect(res.status).toBe(200);
    expect(res.headers.get('cache-control')).toBe('public, max-age=60');
    expect(((await res.json()) as { placements: unknown[] }).placements).toEqual([]);
    const noBase = createPlacementsHandler({ load: async () => [placement()], now: () => NOW, creativeBase: null });
    expect(((await (await noBase(req())).json()) as { placements: unknown[] }).placements).toEqual([]);
  });

  it('a database failure is a 503 that is never cached', async () => {
    const cache = memoryCache();
    const handler = createPlacementsHandler({
      load: async () => {
        throw new Error('boom: secret detail');
      },
      now: () => NOW,
      creativeBase: BASE,
      cache,
    });
    const res = await handler(req());
    expect(res.status).toBe(503);
    expect(res.headers.get('cache-control')).toBe('no-store');
    expect(await res.text()).not.toContain('boom');
    expect(cache.store.size).toBe(0);
  });

  it('only GET and HEAD; a broken cache never breaks the answer', async () => {
    const handler = createPlacementsHandler({
      load: async () => [],
      now: () => NOW,
      creativeBase: BASE,
      cache: {
        match: async () => {
          throw new Error('cache down');
        },
        put: async () => {
          throw new Error('cache down');
        },
        delete: async () => false,
      },
    });
    expect((await handler(req('POST'))).status).toBe(405);
    expect((await handler(req('GET'))).status).toBe(200);
    const head = await handler(req('HEAD'));
    expect(head.status).toBe(200);
    expect(await head.text()).toBe('');
  });
});

describe('placement rows and the route wiring', () => {
  const row = {
    id: '20000000-0000-4000-8000-000000000001',
    sponsor_id: '10000000-0000-4000-8000-00000000000a',
    slot: 'home_partner_strip',
    scope_key: null,
    creative_desktop_path: 'a/d.png',
    creative_mobile_path: null,
    alt: 'Fictional logo',
    headline: null,
    go_slug: 'fictional-logo',
    start_date: '2026-11-01',
    end_date: '2026-11-30',
    priority: 2,
    label: 'Partner',
    status: 'active',
  };

  it('maps a good row and refuses a broken one (it is skipped, never shown)', () => {
    expect(placementFromRow(row)).toMatchObject({ slot: 'home_partner_strip', goSlug: 'fictional-logo', label: 'Partner', priority: 2 });
    expect(placementFromRow({ ...row, slot: 'sidebar' })).toBeNull();
    expect(placementFromRow({ ...row, label: 'Ad' })).toBeNull();
    expect(placementFromRow({ ...row, status: 'live' })).toBeNull();
    expect(placementFromRow({ ...row, priority: '2' })).toBeNull();
    expect(placementFromRow({ ...row, id: null })).toBeNull();
  });

  it('the creative base is the project Storage path, or null without a project', () => {
    expect(creativeBaseUrl({ supabaseUrl: 'https://fakeproject.supabase.co' })).toBe(BASE);
    expect(creativeBaseUrl({ supabaseUrl: null })).toBeNull();
  });

  it('the route handler reads the database with the secret key on the apikey header and publishes only live rows', async () => {
    const seen: Array<{ url: string; apikey: string | null }> = [];
    const fetchMock = (async (url: string | URL | Request, init?: RequestInit) => {
      seen.push({ url: String(url), apikey: new Headers(init?.headers).get('apikey') });
      return new Response(JSON.stringify([row]), { status: 200, headers: { 'content-type': 'application/json' } });
    }) as typeof fetch;
    const handler = createPlacementsRouteHandler(
      { supabaseUrl: 'https://fakeproject.supabase.co', supabaseSecretKey: ['sb', 'secret', 'FAKE'].join('_'), supabaseAllowLocalUrl: false, hmacKey: null, siteOrigin: null },
      fetchMock,
      { now: () => NOW },
    );
    const res = await handler(req());
    const body = (await res.json()) as { placements: Array<{ id: string; href: string }> };
    expect(body.placements).toHaveLength(1);
    expect(body.placements[0]?.href).toBe('/go/fictional-logo');
    expect(seen[0]?.url).toContain('/rest/v1/placements?');
    expect(seen[0]?.url).toContain('status=eq.active');
    expect(seen[0]?.apikey).toBe(['sb', 'secret', 'FAKE'].join('_'));
    expect(seen[0]?.url).not.toContain('select=*');
  });
});
