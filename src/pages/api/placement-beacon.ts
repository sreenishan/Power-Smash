import type { APIRoute } from 'astro';
import { createBeaconState } from '../../lib/placements/beacon';
import { createBeaconRouteHandler } from '../../lib/placements/runtime';
import { getLeadConfig, getRuntimeEnv } from '../../lib/runtime-env';

// Batched impression beacon (spec 8.3, D-031). On-demand Worker endpoint; the integrity controls live in
// src/lib/placements/beacon.ts. The per-build token is the build variable PUBLIC_PLACEMENT_BEACON_TOKEN (not a secret).
export const prerender = false;

// Lives for the isolate: the schedule cache, the in-memory dedupe, the per-connection windows and the daily salt.
const state = createBeaconState();

export const POST: APIRoute = async ({ request }) => {
  const [config, rt] = await Promise.all([getLeadConfig(), getRuntimeEnv()]);
  const raw = import.meta.env.PUBLIC_PLACEMENT_BEACON_TOKEN;
  const tokens = typeof raw === 'string' && raw.trim() !== '' ? [raw.trim()] : [];
  const handler = createBeaconRouteHandler(config, globalThis.fetch.bind(globalThis), {
    tokens,
    state,
    limiter: rt.EVENT_RATE_LIMITER, // shares the event limiter binding until a dedicated one is added (docs/m2/business-notes.md)
  });
  return handler(request); // the client address comes from Vercel's x-vercel-forwarded-for header (src/lib/security/client-ip.ts), as in /api/event
};

export const ALL: APIRoute = () =>
  new Response(JSON.stringify({ ok: false, code: 'method' }), {
    status: 405,
    headers: { 'content-type': 'application/json; charset=utf-8', allow: 'POST', 'cache-control': 'no-store', 'x-robots-tag': 'noindex, nofollow' },
  });
