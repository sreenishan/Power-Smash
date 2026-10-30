import type { APIRoute } from 'astro';
import { env as buildEnv } from '../../../config/env';
import { createInstanceLimiter, createLiveScoresHandler } from '../../../lib/live-scores/handler';
import { clientIpFromHeaders } from '../../../lib/security/client-ip';
import { liveScoresServerOn } from '../../../lib/live-scores/in-build';
import { getRuntimeEnv } from '../../../lib/runtime-env';

// GET /api/live-scores/<event-id> (D-113): near-live scores of one event. Thin wrapper; logic and tests in src/lib/live-scores/handler.ts.
// Off unless features.liveScores is true AND the runtime variable LIVE_SCORES_ENABLED is exactly "true" (read only through
// src/lib/runtime-env.ts; until that file lists the name the endpoint answers {"live": false}). Reads the public api view with the
// PUBLISHABLE key (a public build variable); never the secret key.
export const prerender = false;

// One connection may ask at most 30 times a minute on this instance (a page asks once a minute); the edge cache answers most visits
// before they reach the function. The key lives in this instance's memory only and is never logged.
const limiter = createInstanceLimiter({ max: 30, windowMs: 60_000, now: () => Date.now() });

const handle: APIRoute = async ({ request, params }) => {
  const rt = await getRuntimeEnv();
  const handler = createLiveScoresHandler({
    enabled: liveScoresServerOn(rt as unknown as Readonly<Record<string, unknown>>),
    supabaseUrl: rt.SUPABASE_URL ?? rt.PUBLIC_SUPABASE_URL ?? buildEnv.supabaseUrl,
    publishableKey: buildEnv.supabasePublishableKey,
    allowLocalUrl: rt.SUPABASE_ALLOW_LOCAL_URL === 'true',
    fetch: globalThis.fetch.bind(globalThis),
    now: () => new Date(),
    allow: (req) => limiter(clientIpFromHeaders(req.headers) ?? 'unknown'),
  });
  return handler(request, params.event);
};

export const GET: APIRoute = handle;
export const HEAD: APIRoute = handle;
// Any other method: a small JSON 405 (never an HTML error page).
export const ALL: APIRoute = handle;
