// POST /api/placement-beacon: the batched impression beacon (D-031, D-029, spec 8.3). Logic only; the route file wires the Worker.
//
// What an impression is: the slot was at least 50% visible for 1 second (the browser script checks with IntersectionObserver and
// reports the visible milliseconds). The batch is sent once on pagehide.
// Integrity controls, in the order the handler applies them:
//   1. POST only, same origin, JSON or text/plain, body capped at 2 KB while the stream is read.
//   2. A per-build token (build variable PUBLIC_PLACEMENT_BEACON_TOKEN). It is in the page source, so it only stops casual replays
//      and scripts that never loaded the page; it is NOT a secret. Constant-time comparison.
//   3. Bots (user-agent list) are answered 204 and never counted.
//   4. Rate limit per connection: the Workers binding when present, a per-isolate window, and the database counter
//      (src/lib/security/ratelimit.ts `reserve`) only when there is something new to count.
//   5. Each item must name a placement that is live today, for the slot it claims, and the page path must be on the route allow-list
//      for that slot (`slotAllowedOnPath`); a per-tournament placement only counts on its own tournament page. A protected page
//      never counts (`isPathProtected`, wired to the archive when it exists). Visible time must be at least 1,000 ms.
//   6. Dedupe: one impression per placement per IST day per session and page class. The session is a daily-salted HMAC of the
//      connection (IP) and the page class; the user agent is NOT in it (it is attacker-chosen); no raw IP, no cookie, no personal data. Checked in memory first, then atomically in SQL.
// Answers: 204 for everything accepted, including dropped bots, duplicates and unknown placements (no oracle for a scripted caller);
// 4xx for a malformed request; 503 when the database failed (the browser ignores it).
import { z } from 'zod';
import { cleanSitePath } from '../contracts/site-path';
import { readBodyCapped } from '../security/body';
import { clientIpFromHeaders } from '../security/client-ip';
import { normaliseIp, parseHmacKey, pseudonym } from '../security/hash';
import { reserve } from '../security/ratelimit';
import type { RateRule, RateStore } from '../security/ratelimit';
import { MIN_VISIBLE_MS } from './beacon-constants';
import { pathKind, slotAllowedOnPath, tournamentSlugOfPath } from './guard';
import { istDateOf, isLive } from './schedule';
import type { Placement } from './schedule';
import { isSlotKey } from './slots';
import type { ImpressionStore } from './store';

export const BEACON_BODY_MAX_BYTES = 2048;
export const BEACON_MAX_ITEMS = 8;
export { MIN_VISIBLE_MS };
export const MAX_VISIBLE_MS = 3_600_000;
/** Per connection per isolate per minute (a real visitor sends about one beacon per page). */
export const BEACON_RATE_PER_MINUTE = 30;
/** Engineering default, not a business fact: beacons per connection per hour in the database counter. Mobile carriers share addresses (CGNAT), so it is generous. */
export const BEACON_DB_RULES: readonly RateRule[] = [{ bucket: 'beacon_ip', windowSec: 3600, max: 240 }];
export const SCHEDULE_CACHE_MS = 60_000;

const BOT_UA = /bot|crawl|spider|slurp|headless|lighthouse|pagespeed|uptime|monitor|curl|wget|python|java\/|go-http|axios|node-fetch|okhttp|facebookexternalhit|whatsapp|telegram|preview|scanner|phantom|selenium|puppeteer|playwright/i;
export const isBeaconBot = (ua: string | null | undefined): boolean => !ua || ua.trim() === '' || BOT_UA.test(ua);

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export const beaconSchema = z
  .object({
    v: z.literal(1),
    tok: z.string().min(8).max(128),
    path: z.string().min(1).max(200),
    items: z
      .array(
        z
          .object({
            id: z.string().regex(UUID),
            slot: z.string().max(40),
            ms: z.number().int().min(0).max(MAX_VISIBLE_MS),
          })
          .strict(),
      )
      .min(1)
      .max(BEACON_MAX_ITEMS),
  })
  .strict();

export type BeaconBody = z.infer<typeof beaconSchema>;

/** Constant-time string comparison (length is not secret here). */
export function safeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i += 1) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

export interface CountableItem {
  placementId: string;
  pagePath: string;
}

/**
 * Which items of a valid body count, given today's schedule. Pure. Drops (silently): an unknown or not-live placement, a slot that
 * does not match the placement, a path the slot cannot be on, a per-tournament placement on the wrong page, visible time under 1 s,
 * a protected path, and repeats of the same placement inside the batch.
 */
export function countableItems(body: BeaconBody, path: string, schedule: readonly Placement[], today: string, isPathProtected: (p: string) => boolean = () => false): CountableItem[] {
  if (isPathProtected(path)) return [];
  const byId = new Map(schedule.map((p) => [p.id.toLowerCase(), p] as const));
  const slug = tournamentSlugOfPath(path);
  const seen = new Set<string>();
  const out: CountableItem[] = [];
  for (const item of body.items) {
    const id = item.id.toLowerCase();
    if (seen.has(id)) continue;
    seen.add(id);
    const p = byId.get(id);
    if (!p || !isLive(p, today)) continue;
    if (!isSlotKey(item.slot) || p.slot !== item.slot) continue;
    if (item.ms < MIN_VISIBLE_MS) continue;
    if (!slotAllowedOnPath(p.slot, path)) continue;
    if (p.scopeKey !== null && p.scopeKey !== slug) continue;
    out.push({ placementId: p.id, pagePath: path });
  }
  return out;
}

export interface BeaconState {
  schedule: { at: number; day: string; placements: Placement[] } | null;
  /** `day|session|placement` keys already counted by THIS isolate. */
  seen: Set<string>;
  windows: Map<string, { start: number; n: number }>;
  saltCache: Map<string, string>;
  /** The cached public-path allow-list (runtime.ts keeps one per isolate). */
  pathGate?: (path: string) => Promise<boolean>;
}
export const createBeaconState = (): BeaconState => ({ schedule: null, seen: new Set(), windows: new Map(), saltCache: new Map() });

export interface BeaconDeps {
  /** Accepted per-build tokens. Empty = the beacon is not configured (503). */
  tokens: readonly string[];
  now: () => Date;
  loadSchedule: (today: string) => Promise<Placement[] | null>;
  store: ImpressionStore | null;
  /** The daily salt for an IST date (random, kept 48 hours), or null when the database is not configured. */
  getSalt: (day: string) => Promise<string | null>;
  hmacKey: string | null;
  /** Extra origin allowed besides the request's own (the configured site origin). */
  siteOrigin?: string | null;
  limiter?: { limit(options: { key: string }): Promise<{ success: boolean }> };
  rateStore?: RateStore | null;
  isPathProtected?: (path: string) => boolean;
  /**
   * Allow-list of real public pages (S2-3): true only for a page that exists and is neither protected nor minimal. When given, a path
   * it refuses (or a lookup that throws) counts nothing: fail closed. Wired in runtime.ts from the public archive views.
   */
  isPathPublic?: (path: string) => Promise<boolean>;
  log?: (entry: { evt: 'beacon'; outcome: string; status?: number; n?: number }) => void;
}

const HEADERS = { 'cache-control': 'no-store', 'x-robots-tag': 'noindex, nofollow', 'x-content-type-options': 'nosniff' } as const;
const empty = (status: number, extra: Record<string, string> = {}): Response => new Response(null, { status, headers: { ...HEADERS, ...extra } });
const err = (status: number, code: string, extra: Record<string, string> = {}): Response =>
  new Response(JSON.stringify({ ok: false, code }), { status, headers: { ...HEADERS, 'content-type': 'application/json; charset=utf-8', ...extra } });

function originAllowed(request: Request, siteOrigin: string | null | undefined): boolean {
  const origin = request.headers.get('origin');
  if (!origin) return true; // not a cross-site browser request; the token and the limits still apply
  const allowed = new Set<string>();
  try {
    allowed.add(new URL(request.url).origin);
  } catch {
    // ignore
  }
  if (siteOrigin) allowed.add(siteOrigin);
  return allowed.has(origin);
}

export function createBeaconHandler(deps: BeaconDeps, state: BeaconState = createBeaconState()) {
  const log = deps.log ?? ((e) => console.log(JSON.stringify(e)));
  const hmac = parseHmacKey(deps.hmacKey);

  async function scheduleFor(today: string, nowMs: number): Promise<Placement[] | null> {
    const c = state.schedule;
    if (c && c.day === today && nowMs - c.at < SCHEDULE_CACHE_MS) return c.placements;
    const placements = await deps.loadSchedule(today);
    if (placements) state.schedule = { at: nowMs, day: today, placements };
    return placements;
  }

  return async function handleBeacon(request: Request, ctx: { clientIp?: string | null } = {}): Promise<Response> {
    try {
      if (request.method !== 'POST') return err(405, 'method', { allow: 'POST' });
      if (!originAllowed(request, deps.siteOrigin)) return err(403, 'origin');
      const ct = (request.headers.get('content-type') ?? '').toLowerCase();
      if (!ct.startsWith('application/json') && !ct.startsWith('text/plain')) return err(415, 'content_type');
      const body = await readBodyCapped(request, BEACON_BODY_MAX_BYTES);
      if (!body.ok) return body.tooLarge ? err(413, 'too_large') : err(400, 'json');
      let json: unknown;
      try {
        json = JSON.parse(body.text);
      } catch {
        return err(400, 'json');
      }
      const parsed = beaconSchema.safeParse(json);
      if (!parsed.success) return err(422, 'validation');
      const data = parsed.data;

      if (deps.tokens.length === 0 || !deps.store || !hmac) {
        log({ evt: 'beacon', outcome: 'unconfigured', status: 503 });
        return err(503, 'unconfigured');
      }
      if (!deps.tokens.some((t) => safeEqual(t, data.tok))) return err(403, 'token');
      const path = cleanSitePath(data.path);
      if (!path) return err(422, 'validation');

      const ua = (request.headers.get('user-agent') ?? '').slice(0, 200);
      if (isBeaconBot(ua)) return empty(204); // bots are answered and never counted

      const now = deps.now();
      const ip = normaliseIp(ctx.clientIp ?? clientIpFromHeaders(request.headers));
      const ipHash = await pseudonym(hmac, 'ip', ip);

      // 4a. cheap limits first
      if (deps.limiter) {
        try {
          if (!(await deps.limiter.limit({ key: `pb:${ipHash}` })).success) return err(429, 'rate_limited');
        } catch {
          // binding failure: the local window and the database counter remain
        }
      }
      const minute = Math.floor(now.getTime() / 60_000);
      const w = state.windows.get(ipHash);
      if (!w || w.start !== minute) {
        if (state.windows.size > 5000) state.windows.clear();
        state.windows.set(ipHash, { start: minute, n: 1 });
      } else {
        w.n += 1;
        if (w.n > BEACON_RATE_PER_MINUTE) return err(429, 'rate_limited');
      }

      // 5. what counts
      const day = istDateOf(now);
      let schedule: Placement[] | null;
      try {
        schedule = await scheduleFor(day, now.getTime());
      } catch {
        log({ evt: 'beacon', outcome: 'schedule_error', status: 503 });
        return err(503, 'unavailable');
      }
      if (!schedule) return empty(204);
      const items = countableItems(data, path, schedule, day, deps.isPathProtected);
      if (items.length === 0) return empty(204);
      if (deps.isPathPublic) {
        let pub = false;
        try {
          pub = await deps.isPathPublic(path);
        } catch {
          pub = false; // fail closed: nothing is stored for a page that cannot be vouched for
        }
        if (!pub) return empty(204);
      }

      // 6a. session and in-memory dedupe
      let salt: string | null;
      try {
        salt = await deps.getSalt(day);
      } catch {
        log({ evt: 'beacon', outcome: 'salt_error', status: 503 });
        return err(503, 'unavailable');
      }
      if (!salt) return err(503, 'unavailable');
      // S2-4: the key is the daily-salted connection hash + page class (+ day and placement in the dedupe key). The user agent is
      // attacker-chosen and is NOT part of it, so varying it cannot mint new sessions.
      const sessionHash = await pseudonym(hmac, 'beacon-session', `${salt}|${ip}|${pathKind(path) ?? 'x'}`);
      const fresh = items.filter((i) => !state.seen.has(`${day}|${sessionHash}|${i.placementId}`));
      if (fresh.length === 0) return empty(204);

      // 4b. the database counter, only for a request that has something new to count
      if (deps.rateStore) {
        try {
          const r = await reserve(deps.rateStore, BEACON_DB_RULES, ipHash, now);
          if (!r.allowed) return err(429, 'rate_limited', { 'retry-after': String(Math.max(1, r.retryAfterSec)) });
        } catch {
          // fail closed (S2-4): without the counter an attacker could inflate impressions, so nothing is counted; the browser ignores 503
          log({ evt: 'beacon', outcome: 'limiter_error', status: 503 });
          return err(503, 'unavailable');
        }
      }

      try {
        const counted = await deps.store.record({ day, sessionHash, items: fresh });
        if (state.seen.size > 50_000) state.seen.clear();
        for (const i of fresh) state.seen.add(`${day}|${sessionHash}|${i.placementId}`);
        log({ evt: 'beacon', outcome: 'ok', status: 204, n: counted });
      } catch {
        log({ evt: 'beacon', outcome: 'db_error', status: 503 });
        return err(503, 'unavailable');
      }
      return empty(204);
    } catch {
      log({ evt: 'beacon', outcome: 'exception', status: 500 });
      return err(500, 'server');
    }
  };
}
