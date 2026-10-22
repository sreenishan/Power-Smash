// A tiny in-memory `CacheLike` for /api/placements on Node (Vercel functions have no `caches.default`).
//
// Why: the Vercel CDN keys by the FULL URL, so `/api/placements?x=<random>` makes every request reach the function, and with no
// cache the function read the database each time. The handler's own cache key ignores the query string (api-handler.ts), so giving it
// any cache makes `?x=...` hit one shared entry. This cache lives for the function instance (one module-level instance in the route),
// keeps an entry for 60 seconds, holds at most a few entries and never stores an error: a bypass attempt costs at most one database
// read per instance per minute. The clock is injected so tests do not wait.
//
// Only the Response parts the handler uses are kept (status, headers, text body); `match` builds a fresh Response each time because
// a Response body can be read only once.
import type { CacheLike } from './api-handler';

export const PLACEMENTS_MEMORY_TTL_MS = 60_000;
const DEFAULT_MAX_ENTRIES = 8;
const DEFAULT_MAX_BODY_CHARS = 256 * 1024;

export interface MemoryCacheOptions {
  /** Epoch milliseconds. Default `Date.now`. */
  now?: () => number;
  /** How long an entry is served. Default 60 seconds. */
  ttlMs?: number;
  /** At most this many entries; the oldest is dropped first. Default 8 (the key is origin plus path, so there is normally one). */
  maxEntries?: number;
  /** A body longer than this many characters is not stored. Default 262,144. */
  maxBodyChars?: number;
}

interface Entry {
  expiresAt: number;
  status: number;
  statusText: string;
  headers: Array<[string, string]>;
  body: string;
}

export function createMemoryCache(options: MemoryCacheOptions = {}): CacheLike {
  const now = options.now ?? Date.now;
  const ttlMs = options.ttlMs ?? PLACEMENTS_MEMORY_TTL_MS;
  const maxEntries = Math.max(1, options.maxEntries ?? DEFAULT_MAX_ENTRIES);
  const maxBodyChars = options.maxBodyChars ?? DEFAULT_MAX_BODY_CHARS;
  // Map keeps insertion order: the first key is always the oldest entry (all entries share one TTL).
  const store = new Map<string, Entry>();

  const dropExpired = (): void => {
    const t = now();
    for (const [key, entry] of store) if (entry.expiresAt <= t) store.delete(key);
  };

  return {
    async match(request) {
      if (request.method !== 'GET') return undefined;
      const entry = store.get(request.url);
      if (!entry) return undefined;
      if (entry.expiresAt <= now()) {
        store.delete(request.url);
        return undefined;
      }
      return new Response(entry.body, { status: entry.status, statusText: entry.statusText, headers: entry.headers });
    },

    async put(request, response) {
      if (request.method !== 'GET' || response.status !== 200) return; // errors and partial answers are never kept
      const body = await response.text();
      if (body.length > maxBodyChars) return;
      dropExpired();
      store.delete(request.url); // a fresh put of the same key moves to the newest position
      while (store.size >= maxEntries) {
        const oldest = store.keys().next();
        if (oldest.done) break;
        store.delete(oldest.value);
      }
      store.set(request.url, {
        expiresAt: now() + ttlMs,
        status: response.status,
        statusText: response.statusText,
        headers: [...response.headers.entries()],
        body,
      });
    },

    async delete(request) {
      return store.delete(request.url);
    },
  };
}
