// GET /api/live-scores/<event-id> (D-113): the near-live scores of one event, read from api.public_competition_live (0021) with the
// PUBLISHABLE key (like the archive and competition Supabase providers; never the secret key). Pure handler: the route
// (src/pages/api/live-scores/[event].ts) only builds the dependencies.
//   - Switched off (features.liveScores AND LIVE_SCORES_ENABLED exactly "true" are both needed): 200 {"live": false}, nothing read.
//   - A good answer: 200 JSON with LIVE_SCORES_CACHE_CONTROL (public, s-maxage=30, stale-while-revalidate=15).
//   - Cost guards (the data is public; these keep function calls and database reads bounded): a query string is refused (400
//     no-store; every distinct query would miss the edge cache), and an optional per-connection counter (`allow`, kept in the
//     instance's memory by the route) answers 429 no-store when one connection asks too often.
//   - Errors are never cached (no-store): 400 for an address that is not an event id, 405 for another method, 503 when the database
//     cannot be read or is not configured. Error bodies are short codes; nothing from the database is echoed.
// The event is addressed by its id (a uuid; the event page knows it). An event CODE such as "ms-u17" is unique only inside its
// tournament, so it is not accepted on its own.
import { isAcceptableSupabaseUrl } from '../supabase/rest';
import { formatTimeIst } from '../../components/competition/helpers';
import { LIVE_VIEW, LIVE_VIEW_COLUMNS, parseLiveRow, toLiveMatchJson, type LiveScoresResponse } from './public';
import { isUuid, LIVE_SCORES_CACHE_CONTROL, NO_STORE } from './rules';

export interface LiveScoresHandlerDeps {
  /** features.liveScores AND LIVE_SCORES_ENABLED === 'true' (see liveScoresServerOn in ./in-build.ts). */
  enabled: boolean;
  supabaseUrl: string | null | undefined;
  /** The PUBLISHABLE key (PUBLIC_SUPABASE_PUBLISHABLE_KEY). Never the secret key. */
  publishableKey: string | null | undefined;
  fetch: typeof fetch;
  now: () => Date;
  allowLocalUrl?: boolean;
  timeoutMs?: number;
  /** Per-connection counter (the route keys it on src/lib/security/client-ip.ts). false = too many requests. */
  allow?: (request: Request) => boolean;
}

/** A small in-memory counter per connection key for one function instance: at most `max` requests per `windowMs`. */
export function createInstanceLimiter(o: { max: number; windowMs: number; now: () => number; maxKeys?: number }): (key: string) => boolean {
  const hits = new Map<string, { start: number; n: number }>();
  const cap = o.maxKeys ?? 5000;
  return (key) => {
    const t = o.now();
    const h = hits.get(key);
    if (!h || t - h.start >= o.windowMs) {
      if (!h && hits.size >= cap) hits.clear(); // bounded memory: forget everyone rather than grow
      hits.set(key, { start: t, n: 1 });
      return true;
    }
    h.n += 1;
    return h.n <= o.max;
  };
}

/** At most this many matches of one event are read (an event never has this many live at once). */
export const LIVE_ROW_LIMIT = 100;

const BASE_HEADERS = { 'content-type': 'application/json; charset=utf-8', 'x-robots-tag': 'noindex, nofollow' } as const;

function json(body: unknown, status: number, cacheControl: string, head: boolean, extra: Record<string, string> = {}): Response {
  return new Response(head ? null : JSON.stringify(body), { status, headers: { ...BASE_HEADERS, 'cache-control': cacheControl, ...extra } });
}

function hasQuery(url: string): boolean {
  try {
    return new URL(url).search !== '';
  } catch {
    return true;
  }
}

export function createLiveScoresHandler(deps: LiveScoresHandlerDeps): (request: Request, eventKey: string | undefined) => Promise<Response> {
  return async (request, eventKey) => {
    const head = request.method === 'HEAD';
    if (request.method !== 'GET' && !head) return json({ live: false, error: 'method' }, 405, NO_STORE, false, { allow: 'GET, HEAD' });
    if (!deps.enabled) return json({ live: false } satisfies LiveScoresResponse, 200, LIVE_SCORES_CACHE_CONTROL, head);
    if (!isUuid(eventKey) || hasQuery(request.url)) return json({ live: false, error: 'bad_request' }, 400, NO_STORE, head);
    if (deps.allow && !deps.allow(request)) return json({ live: false, error: 'rate_limited' }, 429, NO_STORE, head, { 'retry-after': '60' });
    const url = (deps.supabaseUrl ?? '').trim();
    const key = (deps.publishableKey ?? '').trim();
    if (url === '' || key === '' || !isAcceptableSupabaseUrl(url, deps.allowLocalUrl === true)) {
      return json({ live: false, error: 'unavailable' }, 503, NO_STORE, head);
    }
    const id = eventKey.toLowerCase();
    const query =
      `select=${encodeURIComponent(LIVE_VIEW_COLUMNS.join(','))}&event_id=eq.${encodeURIComponent(id)}` +
      `&order=match_number.asc,match_id.asc&limit=${LIVE_ROW_LIMIT}`;
    let rows: unknown;
    try {
      const signal = typeof AbortSignal !== 'undefined' && 'timeout' in AbortSignal ? AbortSignal.timeout(deps.timeoutMs ?? 5000) : undefined;
      const res = await deps.fetch(`${url.replace(/\/+$/, '')}/rest/v1/${LIVE_VIEW}?${query}`, {
        method: 'GET',
        headers: { apikey: key, accept: 'application/json', 'accept-profile': 'api' },
        signal,
      });
      if (!res.ok) return json({ live: false, error: 'unavailable' }, 503, NO_STORE, head);
      rows = await res.json();
    } catch {
      return json({ live: false, error: 'unavailable' }, 503, NO_STORE, head);
    }
    if (!Array.isArray(rows)) return json({ live: false, error: 'unavailable' }, 503, NO_STORE, head);
    const parsed = rows.map(parseLiveRow).filter((r): r is NonNullable<typeof r> => r !== null && r.event_id === id);
    const matches = parsed.map(toLiveMatchJson);
    const now = deps.now();
    const body: LiveScoresResponse = {
      live: matches.some((m) => m.isLive),
      eventId: id,
      windowSeconds: parsed[0]?.live_window_seconds ?? null,
      checkedAt: now.toISOString(),
      checkedAtText: formatTimeIst(now) ?? '',
      matches,
    };
    return json(body, 200, LIVE_SCORES_CACHE_CONTROL, head);
  };
}
