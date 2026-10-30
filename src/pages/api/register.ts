import type { APIRoute } from 'astro';
import { afterResponseIfAvailable } from '../../lib/after-response';
import { createRegistrationHandler, registrationSwitchOn } from '../../lib/registration/handler';
import { getLeadConfig, getRuntimeEnv } from '../../lib/runtime-env';

// On-demand serverless endpoint (D-111): the only place a registration is created. Thin wrapper; all logic is in
// src/lib/registration/handler.ts. Closed unless the legal flag features.registrations is on, the runtime variable REGISTRATION_ENABLED is exactly "true" (read only through
// src/lib/runtime-env.ts; until that file lists the name, the endpoint stays closed) AND the owner has switched registration on in
// the admin (the database refuses otherwise).
export const prerender = false;

export const POST: APIRoute = async ({ request }) => {
  const [config, rt] = await Promise.all([getLeadConfig(), getRuntimeEnv()]);
  const handler = createRegistrationHandler({
    config,
    enabled: registrationSwitchOn(rt as unknown as Readonly<Record<string, unknown>>),
    fetch: globalThis.fetch.bind(globalThis),
    now: () => new Date(),
    randomBytes: (n) => crypto.getRandomValues(new Uint8Array(n)),
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
