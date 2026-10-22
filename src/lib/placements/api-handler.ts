// GET /api/placements: ONE global JSON of the live and upcoming schedule (D-031). Worker plus Cache API,
// `s-maxage=300, stale-while-revalidate=600`; an admin edit purges it (`purgePlacementsCache`).
// The handler takes everything as arguments (loader, clock, cache), so tests drive it with plain objects.
import { buildPublicSchedule } from './public';
import { istDateOf } from './schedule';
import type { Placement } from './schedule';

export const PLACEMENTS_CACHE_CONTROL = 'public, max-age=60, s-maxage=300, stale-while-revalidate=600';

/** The part of the Workers Cache API the handler uses (`caches.default`). */
export interface CacheLike {
  match(request: Request): Promise<Response | undefined>;
  put(request: Request, response: Response): Promise<void>;
  delete(request: Request): Promise<boolean>;
}

export interface PlacementsHandlerDeps {
  /** Live and upcoming placements, or null when the database is not configured. A throw means the database failed. */
  load: (today: string) => Promise<Placement[] | null>;
  now: () => Date;
  /** Base URL of the public creative bucket; null = not configured (the list is empty rather than pointing at nothing). */
  creativeBase: string | null;
  cache?: CacheLike | null;
  /** Run after the response (Cache API put). */
  waitUntil?: (p: Promise<unknown>) => void;
}

const BASE_HEADERS = { 'content-type': 'application/json; charset=utf-8', 'x-content-type-options': 'nosniff' } as const;

const EMPTY = (today: string): string => JSON.stringify({ v: 1, today, placements: [] });

export function createPlacementsHandler(deps: PlacementsHandlerDeps) {
  return async function handlePlacements(request: Request): Promise<Response> {
    if (request.method !== 'GET' && request.method !== 'HEAD') {
      return new Response(JSON.stringify({ ok: false, code: 'method' }), { status: 405, headers: { ...BASE_HEADERS, allow: 'GET, HEAD', 'cache-control': 'no-store' } });
    }
    // The cache key ignores the query string, so `?x=1` cannot make a second entry or bypass the cache.
    const url = new URL(request.url);
    const key = new Request(`${url.origin}${url.pathname}`, { method: 'GET' });
    if (deps.cache) {
      try {
        const hit = await deps.cache.match(key);
        if (hit) return request.method === 'HEAD' ? new Response(null, { status: 200, headers: hit.headers }) : hit;
      } catch {
        // the cache is an optimisation only
      }
    }
    const today = istDateOf(deps.now());
    let body: string;
    let cacheControl = PLACEMENTS_CACHE_CONTROL;
    try {
      const placements = deps.creativeBase ? await deps.load(today) : null;
      if (!placements || !deps.creativeBase) {
        body = EMPTY(today);
        cacheControl = 'public, max-age=60'; // not configured yet: an empty schedule, checked again in a minute
      } else {
        body = JSON.stringify(buildPublicSchedule(placements, today, { creativeBase: deps.creativeBase }));
      }
    } catch {
      // A database failure shows no sponsor rather than a stale or broken one; nothing is cached.
      return new Response(JSON.stringify({ ok: false, code: 'unavailable' }), { status: 503, headers: { ...BASE_HEADERS, 'cache-control': 'no-store' } });
    }
    const res = new Response(request.method === 'HEAD' ? null : body, { status: 200, headers: { ...BASE_HEADERS, 'cache-control': cacheControl } });
    if (deps.cache && request.method === 'GET') {
      const put = deps.cache.put(key, res.clone()).catch(() => undefined);
      if (deps.waitUntil) deps.waitUntil(put);
      else await put;
    }
    return res;
  };
}

/** Purge the cached schedule after an admin edit. Only the data centre that serves the call is cleared; the 5-minute s-maxage covers the rest. */
export async function purgePlacementsCache(cache: CacheLike | null | undefined, origin: string): Promise<boolean> {
  if (!cache) return false;
  try {
    return await cache.delete(new Request(`${origin.replace(/\/+$/, '')}/api/placements`, { method: 'GET' }));
  } catch {
    return false;
  }
}
