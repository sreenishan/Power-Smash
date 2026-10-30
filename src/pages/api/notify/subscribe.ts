import type { APIRoute } from 'astro';
import { afterResponseIfAvailable } from '../../../lib/after-response';
import { createSubscribeHandler } from '../../../lib/notices/handlers';
import { notifySubscribeSwitchOn } from '../../../lib/notices/switches';
import { getLeadConfig, getRuntimeEnv } from '../../../lib/runtime-env';

// On-demand endpoint (D-114): the email sign-up with double opt-in. Thin wrapper; all logic is in src/lib/notices/handlers.ts.
// Closed unless features.emailNotifications is on, NOTIFY_SUBSCRIBE_ENABLED is exactly "true" (read only through src/lib/runtime-env.ts; until that file lists the name,
// the endpoint stays closed), email can be sent (EMAIL_ENABLED exactly "true") and the owner's switch in the admin is on.
export const prerender = false;

export const POST: APIRoute = async ({ request }) => {
  const [config, rt] = await Promise.all([getLeadConfig(), getRuntimeEnv()]);
  const handler = createSubscribeHandler({
    config,
    enabled: notifySubscribeSwitchOn(rt as unknown as Readonly<Record<string, unknown>>),
    fetch: globalThis.fetch.bind(globalThis),
    now: () => new Date(),
    randomBytes: (n) => crypto.getRandomValues(new Uint8Array(n)),
    waitUntil: afterResponseIfAvailable(),
  });
  return handler(request);
};

export const ALL: APIRoute = () =>
  new Response(JSON.stringify({ ok: false, code: 'validation', message: 'Use POST.' }), {
    status: 405,
    headers: { 'content-type': 'application/json; charset=utf-8', allow: 'POST', 'cache-control': 'no-store', 'x-robots-tag': 'noindex, nofollow' },
  });
