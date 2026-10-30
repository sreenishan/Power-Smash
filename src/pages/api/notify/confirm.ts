import type { APIRoute } from 'astro';
import { createConfirmHandler } from '../../../lib/notices/handlers';
import { notifySubscribeSwitchOn } from '../../../lib/notices/switches';
import { getLeadConfig, getRuntimeEnv } from '../../../lib/runtime-env';

// On-demand endpoint (D-114): the confirmation link of the email sign-up. GET shows a page with one button (opening the link changes
// nothing); POST confirms. Same switches as /api/notify/subscribe. Logic in src/lib/notices/handlers.ts.
export const prerender = false;

const handle: APIRoute = async ({ request }) => {
  const [config, rt] = await Promise.all([getLeadConfig(), getRuntimeEnv()]);
  const handler = createConfirmHandler({
    config,
    enabled: notifySubscribeSwitchOn(rt as unknown as Readonly<Record<string, unknown>>),
    fetch: globalThis.fetch.bind(globalThis),
    now: () => new Date(),
    randomBytes: (n) => crypto.getRandomValues(new Uint8Array(n)),
  });
  return handler(request);
};

export const GET = handle;
export const POST = handle;
