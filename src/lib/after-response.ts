// Finish background work after the response is sent (Vercel port, replaces Cloudflare `ctx.waitUntil`).
// `waitUntil` from @vercel/functions keeps the function alive until the promise settles. It does NOTHING, silently, when there is no
// request context (local dev, tests, a runtime that does not set one): the promise just runs on and the function may be frozen
// before it ends. So a handler that must not lose its work (the owner alert of a stored lead) asks `afterResponseIfAvailable()`:
// it returns `afterResponse` only when a real `waitUntil` exists, and `undefined` otherwise, and a handler given `undefined` AWAITS
// the work before answering (the Cloudflare-era behaviour). A failure never reaches the visitor: it is swallowed here (callers
// already log or record their own failures). Pages never import this; it is for `prerender = false` endpoints.
import { waitUntil } from '@vercel/functions';

/** The global slot `@vercel/functions` reads (see node_modules/@vercel/functions/get-context.js). Vercel's runtime fills it per request. */
const REQUEST_CONTEXT = Symbol.for('@vercel/request-context');

/** True only when the current request has a real `waitUntil` (the symbol context exists and `.get()?.waitUntil` is a function). */
export function hasRequestContext(): boolean {
  try {
    const holder = (globalThis as Record<symbol, unknown>)[REQUEST_CONTEXT] as { get?: () => { waitUntil?: unknown } | undefined } | undefined;
    return typeof holder?.get?.()?.waitUntil === 'function';
  } catch {
    return false;
  }
}

export function afterResponse(promise: Promise<unknown>): void {
  const safe = Promise.resolve(promise).catch(() => undefined);
  try {
    waitUntil(safe);
  } catch {
    // no request context: the promise is already running
  }
}

/** `afterResponse` when the runtime can really keep the function alive, otherwise `undefined` so the handler awaits its own work. */
export function afterResponseIfAvailable(): ((promise: Promise<unknown>) => void) | undefined {
  return hasRequestContext() ? afterResponse : undefined;
}
