// A cheap in-memory brake for the `/go/[slug]` click log (review finding S-15). No imports, no I/O: the handler and the tests share it.
//
// Without it, `curl -A "Mozilla/5.0 (X11)" /go/slug` in a loop writes one `outbound_clicks` row per request, which can inflate the click
// counts of the monthly sponsor proof pack and grow the table. Two limits, both per Worker isolate (best effort, not a security boundary):
//   1. DEDUPE: the same user agent opening the same slug again within `dedupeMs` is not counted twice (a double tap, a reload, a loop).
//   2. FLOOD CAP: at most `slugMax` rows per slug per `slugWindowMs`, whatever the user agents are (a loop that rotates user agents).
// The redirect itself is never affected: a limited request is still sent on, it just does not write a row.
//
// The user agent is used only as an in-memory key (cut to 256 characters, never stored or logged). Shared phone user agents are common, so
// the dedupe window is short; the flood cap is what bounds abuse. A WAF rate-limit rule on /go/* (owner task, Cloudflare dashboard) is the
// stronger control and is recommended before sponsor links go live.

export interface ClickLimiterOptions {
  /** Same slug + same user agent inside this window counts once. Default 5,000 ms. */
  dedupeMs?: number;
  /** Length of the flood window. Default 60,000 ms. */
  slugWindowMs?: number;
  /** Maximum counted clicks per slug per window. Default 120. */
  slugMax?: number;
  /** Maximum remembered (slug, user agent) pairs; the oldest are dropped first. Default 2,000. */
  maxKeys?: number;
}

export interface ClickLimiter {
  /** True when this click should be written; false when it is a duplicate or over the cap. Records the click when it returns true. */
  allow(slug: string, userAgent: string, nowMs: number): boolean;
  /** Number of remembered pairs (for tests and memory checks). */
  size(): number;
}

export const CLICK_LIMIT_DEFAULTS = { dedupeMs: 5_000, slugWindowMs: 60_000, slugMax: 120, maxKeys: 2_000 } as const;

export function createClickLimiter(options: ClickLimiterOptions = {}): ClickLimiter {
  const dedupeMs = options.dedupeMs ?? CLICK_LIMIT_DEFAULTS.dedupeMs;
  const slugWindowMs = options.slugWindowMs ?? CLICK_LIMIT_DEFAULTS.slugWindowMs;
  const slugMax = options.slugMax ?? CLICK_LIMIT_DEFAULTS.slugMax;
  const maxKeys = options.maxKeys ?? CLICK_LIMIT_DEFAULTS.maxKeys;

  // key -> time of the last counted click. A Map keeps insertion order, so the first entries are the oldest.
  const seen = new Map<string, number>();
  const windows = new Map<string, { start: number; count: number }>();

  const prune = (nowMs: number): void => {
    if (seen.size <= maxKeys) return;
    for (const [key, at] of seen) {
      if (nowMs - at >= dedupeMs) seen.delete(key);
    }
    // still too many: drop the oldest first
    while (seen.size > maxKeys) {
      const oldest = seen.keys().next();
      if (oldest.done) break;
      seen.delete(oldest.value);
    }
    if (windows.size > maxKeys) {
      for (const [slug, w] of windows) {
        if (nowMs - w.start >= slugWindowMs) windows.delete(slug);
      }
    }
  };

  return {
    allow(slug, userAgent, nowMs) {
      const key = `${slug}|${userAgent.slice(0, 256)}`;
      const last = seen.get(key);
      if (last !== undefined && nowMs - last >= 0 && nowMs - last < dedupeMs) return false; // duplicate: not counted, not extended

      let w = windows.get(slug);
      if (!w || nowMs - w.start >= slugWindowMs || nowMs < w.start) {
        w = { start: nowMs, count: 0 };
        windows.set(slug, w);
      }
      if (w.count >= slugMax) return false; // flood cap reached for this slug in this window
      w.count++;

      seen.delete(key); // re-insert so the Map order stays oldest first
      seen.set(key, nowMs);
      prune(nowMs);
      return true;
    },
    size: () => seen.size,
  };
}
