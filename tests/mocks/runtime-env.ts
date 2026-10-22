// Test helper for runtime environment values. Endpoints read `process.env` on Vercel (src/lib/runtime-env.ts), so a test sets
// values through this object: writes go to `process.env`, and only the names written here are ever listed or deleted
// (a loop `for (const k of Object.keys(env)) delete env[k]` clears the test's values and leaves the rest of process.env alone).
// Fake values only, never real secrets.
const touched = new Set<string>();

export const env: Record<string, string | undefined> = new Proxy({} as Record<string, string | undefined>, {
  get: (_t, k) => (typeof k === 'string' ? process.env[k] : undefined),
  set: (_t, k, v) => {
    if (typeof k !== 'string') return false;
    touched.add(k);
    if (v === undefined) delete process.env[k];
    else process.env[k] = String(v);
    return true;
  },
  deleteProperty: (_t, k) => {
    if (typeof k === 'string') {
      touched.delete(k);
      delete process.env[k];
    }
    return true;
  },
  has: (_t, k) => typeof k === 'string' && touched.has(k),
  ownKeys: () => [...touched],
  getOwnPropertyDescriptor: (_t, k) =>
    typeof k === 'string' && touched.has(k) ? { value: process.env[k], enumerable: true, configurable: true, writable: true } : undefined,
});
