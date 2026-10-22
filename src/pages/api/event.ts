import type { APIRoute } from 'astro';
import { createEventHandler, createEventState } from '../../lib/leads/event-handler';
import { getLeadConfig, getRuntimeEnv } from '../../lib/runtime-env';

// First-party analytics events (spec 16). On-demand Worker endpoint; logic in src/lib/leads/event-handler.ts.
export const prerender = false;

// Lives for the isolate: the cached daily salt (random, not a secret key) and the per-connection rate windows.
const state = createEventState();

export const POST: APIRoute = async ({ request }) => {
  const [config, rt] = await Promise.all([getLeadConfig(), getRuntimeEnv()]);
  const handler = createEventHandler({
    config,
    fetch: globalThis.fetch.bind(globalThis),
    now: () => new Date(),
    randomBytes: (n) => crypto.getRandomValues(new Uint8Array(n)),
    limiter: rt.EVENT_RATE_LIMITER,
  }, state);
  return handler(request);
};

export const ALL: APIRoute = () =>
  new Response(JSON.stringify({ ok: false, code: 'method' }), {
    status: 405,
    headers: { 'content-type': 'application/json; charset=utf-8', allow: 'POST', 'cache-control': 'no-store', 'x-robots-tag': 'noindex, nofollow' },
  });
