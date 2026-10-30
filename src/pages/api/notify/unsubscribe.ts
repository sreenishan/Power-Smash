import type { APIRoute } from 'astro';
import { createUnsubscribeHandler } from '../../../lib/notices/handlers';
import { getLeadConfig } from '../../../lib/runtime-env';

// On-demand endpoint (D-114): the unsubscribe link of every list email, and its one-click form (RFC 8058: a POST of
// List-Unsubscribe=One-Click to the same address). NEVER behind a switch: an unsubscribe always works. GET shows a page with one
// button; POST unsubscribes. Logic in src/lib/notices/handlers.ts.
export const prerender = false;

const handle: APIRoute = async ({ request }) => {
  const config = await getLeadConfig();
  const handler = createUnsubscribeHandler({
    config,
    fetch: globalThis.fetch.bind(globalThis),
    now: () => new Date(),
    randomBytes: (n) => crypto.getRandomValues(new Uint8Array(n)),
  });
  return handler(request);
};

export const GET = handle;
export const POST = handle;
