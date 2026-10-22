// Wiring between the Worker environment and the placement handlers (kept out of the route files so tests can build the same
// dependencies from a fake config and a mocked fetch). Pages must never import this file.
import { istDateOf } from './schedule';
import { createBeaconHandler, createBeaconState } from './beacon';
import type { BeaconState } from './beacon';
import { createPlacementsHandler } from './api-handler';
import type { CacheLike } from './api-handler';
import { createPathGate } from './path-gate';
import { createImpressionStore, createRpcClient, loadPlacements } from './store';
import { createSupabaseRest } from '../supabase/rest';
import type { SupabaseRest } from '../supabase/rest';
import { createSupabaseRateStore } from '../security/ratelimit';
import { randomHex } from '../security/hash';
import type { LeadHandlerConfig } from '../leads/config';

/** The public Storage bucket holding sponsor creatives. A convention of this milestone (see docs/m2/business-notes.md). */
export const CREATIVE_BUCKET = 'creatives';

export function creativeBaseUrl(config: Pick<LeadHandlerConfig, 'supabaseUrl'>): string | null {
  return config.supabaseUrl ? `${config.supabaseUrl.replace(/\/+$/, '')}/storage/v1/object/public/${CREATIVE_BUCKET}` : null;
}

type RuntimeConfig = Pick<LeadHandlerConfig, 'supabaseUrl' | 'supabaseSecretKey' | 'supabaseAllowLocalUrl' | 'hmacKey' | 'siteOrigin'>;

function dbOf(config: RuntimeConfig, fetchFn: typeof fetch): SupabaseRest | null {
  return config.supabaseUrl && config.supabaseSecretKey
    ? createSupabaseRest({ url: config.supabaseUrl, secretKey: config.supabaseSecretKey, fetch: fetchFn, allowLocalUrl: config.supabaseAllowLocalUrl })
    : null;
}

export function createPlacementsRouteHandler(config: RuntimeConfig, fetchFn: typeof fetch, extra: { now?: () => Date; cache?: CacheLike | null; waitUntil?: (p: Promise<unknown>) => void } = {}) {
  const db = dbOf(config, fetchFn);
  return createPlacementsHandler({
    load: async (today) => (db ? loadPlacements(db, today) : null),
    now: extra.now ?? (() => new Date()),
    creativeBase: creativeBaseUrl(config),
    cache: extra.cache ?? null,
    waitUntil: extra.waitUntil,
  });
}

/** The daily salt, as /api/event does it: read the day's row, create it if missing, keep two days. Random, not a secret key. */
async function getDailySalt(db: SupabaseRest, cache: Map<string, string>, day: string, randomBytes: (n: number) => Uint8Array, now: Date): Promise<string | null> {
  const cached = cache.get(day);
  if (cached) return cached;
  const read = async (): Promise<string | null> => (await db.select<{ salt: string }>('daily_salts', `day=eq.${day}&select=salt&limit=1`))[0]?.salt ?? null;
  let salt = await read();
  if (!salt) {
    await db.insert('daily_salts', { day, salt: randomHex(randomBytes, 32) }, { onConflict: 'day', ignoreDuplicates: true });
    salt = await read();
    if (!salt) return null;
    await db.remove('daily_salts', `day=lt.${istDateOf(new Date(now.getTime() - 2 * 86_400_000))}`).catch(() => undefined);
  }
  cache.clear();
  cache.set(day, salt);
  return salt;
}

export interface BeaconRouteOptions {
  /** Accepted per-build tokens (PUBLIC_PLACEMENT_BEACON_TOKEN of this build). */
  tokens: readonly string[];
  state?: BeaconState;
  now?: () => Date;
  randomBytes?: (n: number) => Uint8Array;
  limiter?: { limit(options: { key: string }): Promise<{ success: boolean }> };
  isPathProtected?: (path: string) => boolean;
  /** Overrides the default allow-list built from the public archive views (tests). */
  isPathPublic?: (path: string) => Promise<boolean>;
  log?: Parameters<typeof createBeaconHandler>[0]['log'];
}

export function createBeaconRouteHandler(config: RuntimeConfig, fetchFn: typeof fetch, options: BeaconRouteOptions) {
  const db = dbOf(config, fetchFn);
  const state = options.state ?? createBeaconState();
  const now = options.now ?? (() => new Date());
  const randomBytes = options.randomBytes ?? ((n: number) => crypto.getRandomValues(new Uint8Array(n)));
  const rpc =
    config.supabaseUrl && config.supabaseSecretKey
      ? createRpcClient({ url: config.supabaseUrl, secretKey: config.supabaseSecretKey, fetch: fetchFn, allowLocalUrl: config.supabaseAllowLocalUrl })
      : null;
  return createBeaconHandler(
    {
      tokens: options.tokens,
      now,
      loadSchedule: async (today) => (db ? loadPlacements(db, today) : null),
      store: rpc ? createImpressionStore(rpc) : null,
      getSalt: async (day) => (db ? getDailySalt(db, state.saltCache, day, randomBytes, now()) : null),
      hmacKey: config.hmacKey,
      siteOrigin: config.siteOrigin,
      limiter: options.limiter,
      rateStore: db ? createSupabaseRateStore(db) : null,
      isPathProtected: options.isPathProtected,
      isPathPublic: options.isPathPublic ?? (db ? (state.pathGate ??= createPathGate(db)) : async () => false),
      log: options.log,
    },
    state,
  );
}
