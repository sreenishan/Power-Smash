import type { APIRoute } from 'astro';
import { site } from '../../content/site';
import { afterResponseIfAvailable } from '../../lib/after-response';
import { createLeadHandler } from '../../lib/leads/handler';
import { getLeadConfig, getRuntimeEnv } from '../../lib/runtime-env';

// On-demand serverless endpoint (D-001): the only place a lead is created. Thin wrapper; all logic is in src/lib/leads/handler.ts.
export const prerender = false;

export const POST: APIRoute = async ({ request }) => {
  // R-ACK-PROMISE: the acknowledgement email promises a reply time only when the owner has supplied one (site.replyTimePromise).
  const [config, rt] = await Promise.all([getLeadConfig({ replyWindow: site.replyTimePromise }), getRuntimeEnv()]);
  const handler = createLeadHandler({
    config,
    fetch: globalThis.fetch.bind(globalThis),
    now: () => new Date(),
    randomBytes: (n) => crypto.getRandomValues(new Uint8Array(n)),
    ipLimiter: rt.LEAD_RATE_LIMITER,
    // Only when Vercel really provides waitUntil; otherwise the handler awaits the owner alert before answering (lead alert never lost).
    waitUntil: afterResponseIfAvailable(),
  });
  return handler(request);
};

// Any other method: a small JSON 405 (never an HTML error page).
export const ALL: APIRoute = () =>
  new Response(JSON.stringify({ ok: false, code: 'validation', message: 'Use POST.' }), {
    status: 405,
    headers: { 'content-type': 'application/json; charset=utf-8', allow: 'POST', 'cache-control': 'no-store', 'x-robots-tag': 'noindex, nofollow' },
  });
