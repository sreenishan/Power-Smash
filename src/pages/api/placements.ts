import type { APIRoute } from 'astro';
import { afterResponseIfAvailable } from '../../lib/after-response';
import { createPlacementsRouteHandler } from '../../lib/placements/runtime';
import type { CacheLike } from '../../lib/placements/api-handler';
import { createMemoryCache } from '../../lib/placements/memory-cache';
import { getLeadConfig } from '../../lib/runtime-env';

// The live and upcoming sponsor schedule (spec 8.3, D-031): one global JSON, function plus CDN cache
// (`s-maxage=300, stale-while-revalidate=600` for the Vercel CDN; no Cache API on Vercel). Logic and tests: src/lib/placements/api-handler.ts.
export const prerender = false;

// Node has no `caches.default`, and the Vercel CDN keys by the full URL, so `?x=<random>` would reach the function (and the database)
// every time. This small per-instance cache (60 s, a few entries) sits behind the handler's query-ignoring cache key, so such
// requests share one database read per minute. Module level on purpose: it lives as long as the function instance.
const memoryCache = createMemoryCache();

export const GET: APIRoute = async ({ request }) => {
  const config = await getLeadConfig();
  const cache = (globalThis as { caches?: { default?: CacheLike } }).caches?.default ?? memoryCache;
  const handler = createPlacementsRouteHandler(config, globalThis.fetch.bind(globalThis), {
    cache,
    waitUntil: afterResponseIfAvailable(), // undefined = the handler awaits the cache write itself
  });
  return handler(request);
};

export const HEAD = GET;

export const ALL: APIRoute = () =>
  new Response(JSON.stringify({ ok: false, code: 'method' }), {
    status: 405,
    headers: { 'content-type': 'application/json; charset=utf-8', allow: 'GET, HEAD', 'cache-control': 'no-store' },
  });
