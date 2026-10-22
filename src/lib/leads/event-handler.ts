// POST /api/event: first-party analytics events (spec 16, D-028, D-029). No personal data, allow-listed names and props
// (src/lib/contracts/event.ts), a daily-salted session hash (random daily secret kept 48 hours, D-029), no raw IP,
// an `is_bot` flag (D-032), and a rate limit (Workers binding when present, plus a small per-isolate window).
// Analytics must never break the visitor's page: a database failure answers 503 (the client ignores it) and logs a code only.
import { validateEvent } from '../contracts/event';
import { readBodyCapped } from '../security/body';
import { clientIpFromHeaders } from '../security/client-ip';
import { normaliseIp, parseHmacKey, pseudonym, randomHex } from '../security/hash';
import { createSupabaseRest, SupabaseError, type SupabaseRest } from '../supabase/rest';
import type { LeadHandlerConfig } from './config';
import { sameOriginAllowed, type RateLimiterBinding } from './handler';

export const EVENT_BODY_MAX_BYTES = 2048;
/** Per connection per isolate, per minute. A real visitor produces a handful of events a minute. */
export const EVENT_RATE_PER_MINUTE = 60;

export interface EventHandlerDeps {
  config: LeadHandlerConfig;
  fetch: typeof fetch;
  now: () => Date;
  randomBytes: (n: number) => Uint8Array;
  limiter?: RateLimiterBinding;
  log?: (entry: { evt: 'event'; outcome: string; status?: number; code?: string }) => void;
}

const BOT_UA = /bot|crawl|spider|slurp|headless|lighthouse|pagespeed|uptime|monitor|curl|wget|python|java\/|go-http|axios|node-fetch|okhttp|facebookexternalhit|whatsapp|telegram|preview|scanner/i;
export const isBotUserAgent = (ua: string | null): boolean => !ua || ua.trim() === '' || BOT_UA.test(ua);

/** IST calendar date `YYYY-MM-DD` for an instant. */
export function istDate(now: Date): string {
  return new Date(now.getTime() + 5.5 * 3600 * 1000).toISOString().slice(0, 10);
}

const HEADERS = { 'cache-control': 'no-store', 'x-robots-tag': 'noindex, nofollow', 'x-content-type-options': 'nosniff' } as const;
const empty = (status: number, extra: Record<string, string> = {}): Response => new Response(null, { status, headers: { ...HEADERS, ...extra } });
const err = (status: number, code: string): Response =>
  new Response(JSON.stringify({ ok: false, code }), { status, headers: { ...HEADERS, 'content-type': 'application/json; charset=utf-8' } });

async function getDailySalt(db: SupabaseRest, cache: Map<string, string>, now: Date, randomBytes: (n: number) => Uint8Array): Promise<string> {
  const day = istDate(now);
  const cached = cache.get(day);
  if (cached) return cached;
  const read = async (): Promise<string | null> => {
    const rows = await db.select<{ salt: string }>('daily_salts', `day=eq.${day}&select=salt&limit=1`);
    return rows[0]?.salt ?? null;
  };
  let salt = await read();
  if (!salt) {
    await db.insert('daily_salts', { day, salt: randomHex(randomBytes, 32) }, { onConflict: 'day', ignoreDuplicates: true });
    salt = await read();
    if (!salt) throw new SupabaseError(0, null, null);
    // keep the last 48 hours only
    const cutoff = istDate(new Date(now.getTime() - 2 * 86_400_000));
    await db.remove('daily_salts', `day=lt.${cutoff}`).catch(() => undefined);
  }
  cache.clear();
  cache.set(day, salt);
  return salt;
}

/** Mutable state that must outlive one request (per isolate): the cached daily salt and the per-connection windows. No secrets. */
export interface EventState {
  saltCache: Map<string, string>;
  windows: Map<string, { start: number; n: number }>;
}
export const createEventState = (): EventState => ({ saltCache: new Map(), windows: new Map() });

export function createEventHandler(deps: EventHandlerDeps, state: EventState = createEventState()) {
  const { config } = deps;
  const log = deps.log ?? ((e) => console.log(JSON.stringify(e)));
  const hmac = parseHmacKey(config.hmacKey);
  const db =
    config.supabaseUrl && config.supabaseSecretKey
      ? createSupabaseRest({ url: config.supabaseUrl, secretKey: config.supabaseSecretKey, fetch: deps.fetch, allowLocalUrl: config.supabaseAllowLocalUrl })
      : null;
  const { saltCache, windows } = state;

  return async function handleEvent(request: Request, ctx: { clientIp?: string | null } = {}): Promise<Response> {
    try {
      if (request.method !== 'POST') return err(405, 'method');
      if (!sameOriginAllowed(request, config)) return err(403, 'origin');
      // sendBeacon with a string body sends text/plain; a Blob of application/json is also fine.
      const ct = (request.headers.get('content-type') ?? '').toLowerCase();
      if (!ct.startsWith('application/json') && !ct.startsWith('text/plain')) return err(415, 'content_type');
      // S-3: the cap is enforced while the stream is read (a chunked upload without Content-Length is cut off at the cap).
      const body = await readBodyCapped(request, EVENT_BODY_MAX_BYTES);
      if (!body.ok) return body.tooLarge ? err(413, 'too_large') : err(400, 'json');
      const text = body.text;
      let json: unknown;
      try {
        json = JSON.parse(text);
      } catch {
        return err(400, 'json');
      }
      const v = validateEvent(json);
      if (!v.ok) return err(422, 'validation');

      if (!db || !hmac) {
        log({ evt: 'event', outcome: 'unconfigured', status: 503 });
        return err(503, 'unconfigured');
      }
      const now = deps.now();
      const ip = normaliseIp(ctx.clientIp ?? clientIpFromHeaders(request.headers));
      const ipHash = await pseudonym(hmac, 'ip', ip);

      if (deps.limiter) {
        try {
          if (!(await deps.limiter.limit({ key: `ev:${ipHash}` })).success) return err(429, 'rate_limited');
        } catch {
          // binding failure: rely on the local window
        }
      }
      const minute = Math.floor(now.getTime() / 60_000);
      const w = windows.get(ipHash);
      if (!w || w.start !== minute) {
        if (windows.size > 5000) windows.clear();
        windows.set(ipHash, { start: minute, n: 1 });
      } else {
        w.n += 1;
        if (w.n > EVENT_RATE_PER_MINUTE) return err(429, 'rate_limited');
      }

      const ua = (request.headers.get('user-agent') ?? '').slice(0, 200);
      let salt: string;
      try {
        salt = await getDailySalt(db, saltCache, now, deps.randomBytes);
      } catch (e) {
        log({ evt: 'event', outcome: 'salt_error', status: e instanceof SupabaseError ? e.status : 0 });
        return err(503, 'unavailable');
      }
      const sessionHash = await pseudonym(hmac, 'session', `${salt}|${ip}|${ua}`);
      try {
        await db.insert('events', {
          name: v.event.name,
          page_path: v.event.path,
          props: v.event.props,
          session_hash: sessionHash,
          is_bot: isBotUserAgent(ua),
        });
      } catch (e) {
        log({ evt: 'event', outcome: 'db_error', status: e instanceof SupabaseError ? e.status : 0, code: e instanceof SupabaseError ? (e.pgCode ?? undefined) : undefined });
        return err(503, 'unavailable');
      }
      return empty(204);
    } catch {
      log({ evt: 'event', outcome: 'exception', status: 500 });
      return err(500, 'server');
    }
  };
}

