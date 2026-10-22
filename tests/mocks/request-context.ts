// Test helper: pretends to be Vercel's request context. `@vercel/functions` (and src/lib/after-response.ts) look for
// `globalThis[Symbol.for('@vercel/request-context')]` and call `.get()?.waitUntil`; this installs one for the length of a test and
// returns the function that removes it again. Without it there is NO context, which is the local-dev and test default.
const KEY = Symbol.for('@vercel/request-context');

export function installRequestContext(waitUntil: (promise: Promise<unknown>) => void = () => undefined): () => void {
  const g = globalThis as Record<symbol, unknown>;
  const previous = Object.getOwnPropertyDescriptor(g, KEY);
  Object.defineProperty(g, KEY, { value: { get: () => ({ waitUntil }) }, configurable: true, writable: true, enumerable: false });
  return () => {
    if (previous) Object.defineProperty(g, KEY, previous);
    else delete g[KEY];
  };
}
