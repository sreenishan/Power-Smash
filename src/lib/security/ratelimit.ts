// Rate limiting (D-029: "the Workers Rate Limiting binding plus a database counter per email and phone").
//
//  - Per connection: the Workers Rate Limiting binding when configured (cheap, local to a Cloudflare location,
//    "permissive, eventually consistent" per Cloudflare's docs) PLUS a database counter on the salted IP hash.
//  - Per phone and per email: a database counter on the HMAC of the normalised value (the email key also folds `+tag` and
//    Gmail dots, see emailRateKey in ./text.ts: S-6).
//  - Globally (S-6, N-3): a circuit breaker on the number of ACCEPTED enquiries, per hour AND per day, whoever sends them.
//
// The database counter is a soft limit for the per-connection rule (count the hits inside the window, refuse at the limit, otherwise
// record one hit; refused hits are NOT recorded, so hammering cannot grow the table).
//
// The per-phone, per-email and global rules RESERVE their slot (follow-up N-5, N-2, N-3): `reserve` records the hit FIRST, then
// counts (the count includes the request's own hit) and refuses, giving the hit back, when a window is over its maximum. Two
// requests that arrive together can no longer both slip under a cap: of any group, the last one to count has seen every other
// reservation, so the number admitted can never exceed the maximum (a burst above the cap can be refused more than strictly
// needed, never admitted beyond it). A reservation is released (its row deleted by id) when the request does not end with a
// stored lead, so a failed insert never uses up a visitor's allowance (B-6); `release` never throws.
import type { SupabaseRest } from '../supabase/rest';

export interface RateRule {
  bucket: string;
  windowSec: number;
  max: number;
}

/**
 * S-6 circuit breaker: accepted enquiries per hour across ALL visitors before new ones are refused (and the owner is told).
 * An engineering default, not a business fact: a niche media brand gets a handful of enquiries a day, so this only ever trips
 * in a flood. The Worker variable LEAD_GLOBAL_HOURLY_CAP overrides it without a deploy (src/lib/leads/config.ts).
 */
export const DEFAULT_GLOBAL_LEADS_PER_HOUR = 40;
/**
 * N-3: stored enquiries per 24 hours across all visitors (an engineering default, tunable with LEAD_GLOBAL_DAILY_CAP). It bounds the
 * day so the free Resend quota (each enquiry can send mail) cannot be used up by a burst that stays under the hourly cap.
 */
export const DEFAULT_GLOBAL_LEADS_PER_DAY = 100;
/** N-3: once MORE than this many enquiries are stored in the last 24 hours, customer acknowledgement mails stop (the owner alert stays). */
export const ACK_STOP_AFTER_PER_DAY = 80;

/** The one key every global hit is recorded under. */
export const GLOBAL_KEY = 'all';
export const GLOBAL_BUCKET = 'lead_all';
/** One "flood protection is on" notice to the owner per hour (a bucket of its own, so the notice itself is rate limited). */
export const FLOOD_NOTICE_RULE: RateRule = { bucket: 'lead_flood_notice', windowSec: 3600, max: 1 };

/** The hourly breaker rule for a given cap. */
export const globalLeadRule = (cap: number = DEFAULT_GLOBAL_LEADS_PER_HOUR): RateRule => ({ bucket: GLOBAL_BUCKET, windowSec: 3600, max: cap });
/** Both global rules (one hour, one day) for the given caps; they share one bucket, so one reservation row serves both. */
export const globalLeadRules = (hourlyCap: number = DEFAULT_GLOBAL_LEADS_PER_HOUR, dailyCap: number = DEFAULT_GLOBAL_LEADS_PER_DAY): RateRule[] => [
  { bucket: GLOBAL_BUCKET, windowSec: 3600, max: hourlyCap },
  { bucket: GLOBAL_BUCKET, windowSec: 86_400, max: dailyCap },
];

/**
 * Engineering defaults, not business facts. Mobile carriers in India put many people behind one IPv4 address (CGNAT),
 * so the per-IP rule is generous; the per-contact rules are what stop one person flooding the owner.
 */
export const LEAD_RATE_RULES = {
  ip: [{ bucket: 'lead_ip', windowSec: 3600, max: 20 }],
  phone: [
    { bucket: 'lead_phone', windowSec: 3600, max: 3 },
    { bucket: 'lead_phone', windowSec: 86_400, max: 8 },
  ],
  email: [
    { bucket: 'lead_email', windowSec: 3600, max: 3 },
    { bucket: 'lead_email', windowSec: 86_400, max: 8 },
  ],
} as const satisfies Record<string, readonly RateRule[]>;

/** One confirmation mail per address per 24 hours (D-022, D-029). */
export const ACK_EMAIL_RULE: RateRule = { bucket: 'ack_email', windowSec: 86_400, max: 1 };

export interface RateStore {
  count(bucket: string, keyHash: string, sinceIso: string): Promise<number>;
  /** Record one hit. `id` (a uuid) names the row so a reservation can be given back by `release`; without it the database picks one. */
  add(bucket: string, keyHash: string, atIso: string, id?: string): Promise<void>;
  /** Delete exactly ONE hit by the id it was added with (a reservation that is given back). */
  release(id: string): Promise<void>;
  purgeBefore(beforeIso: string): Promise<void>;
  /**
   * Optional. The hit times (ISO, oldest first) inside the window, at most `limit` of them. Used only to tell a refused visitor
   * when to come back (B-6); a store without it makes the answer the whole window.
   */
  hitTimes?(bucket: string, keyHash: string, sinceIso: string, limit: number): Promise<string[]>;
}

export function createSupabaseRateStore(db: SupabaseRest): RateStore {
  return {
    count: (bucket, keyHash, sinceIso) =>
      db.count('rate_limit_hits', `bucket=eq.${encodeURIComponent(bucket)}&key_hash=eq.${encodeURIComponent(keyHash)}&hit_at=gte.${encodeURIComponent(sinceIso)}&select=id`),
    add: (bucket, keyHash, atIso, id) => db.insert('rate_limit_hits', { ...(id ? { id } : {}), bucket, key_hash: keyHash, hit_at: atIso }),
    release: (id) => db.remove('rate_limit_hits', `id=eq.${encodeURIComponent(id)}`),
    purgeBefore: (beforeIso) => db.remove('rate_limit_hits', `hit_at=lt.${encodeURIComponent(beforeIso)}`),
    hitTimes: async (bucket, keyHash, sinceIso, limit) => {
      const rows = await db.select<{ hit_at: string }>(
        'rate_limit_hits',
        `bucket=eq.${encodeURIComponent(bucket)}&key_hash=eq.${encodeURIComponent(keyHash)}&hit_at=gte.${encodeURIComponent(sinceIso)}&select=hit_at&order=hit_at.asc&limit=${limit}`,
      );
      return rows.map((r) => r.hit_at);
    },
  };
}

export interface RateDecision {
  allowed: boolean;
  retryAfterSec: number;
  /** The rule that refused (the one with the longest wait), when not allowed. */
  blockedBy?: RateRule;
}

/** Seconds until the visitor may try again for one blocking rule: when the hit that must leave the window leaves it. */
async function retryAfterFor(store: RateStore, rule: RateRule, keyHash: string, count: number, now: Date): Promise<number> {
  if (!store.hitTimes) return rule.windowSec;
  try {
    const since = new Date(now.getTime() - rule.windowSec * 1000).toISOString();
    // The hit at this position (oldest first) is the one whose departure brings the count under the maximum.
    const position = Math.max(0, count - rule.max);
    const times = await store.hitTimes(rule.bucket, keyHash, since, position + 1);
    const t = times[position];
    if (t === undefined) return rule.windowSec;
    const leavesAt = new Date(t).getTime() + rule.windowSec * 1000;
    if (!Number.isFinite(leavesAt)) return rule.windowSec;
    return Math.min(rule.windowSec, Math.max(1, Math.ceil((leavesAt - now.getTime()) / 1000)));
  } catch {
    return rule.windowSec; // never let the retry hint fail a request
  }
}

/** Check every rule for one key WITHOUT recording anything. The retry hint is the longest wait among the rules that block. */
export async function checkRules(store: RateStore, rules: readonly RateRule[], keyHash: string, now: Date): Promise<RateDecision> {
  let retryAfterSec = 0;
  let blockedBy: RateRule | undefined;
  for (const rule of rules) {
    const since = new Date(now.getTime() - rule.windowSec * 1000).toISOString();
    const n = await store.count(rule.bucket, keyHash, since);
    if (n >= rule.max) {
      const wait = await retryAfterFor(store, rule, keyHash, n, now);
      if (blockedBy === undefined || wait > retryAfterSec) {
        retryAfterSec = wait;
        blockedBy = rule;
      }
    }
  }
  return blockedBy ? { allowed: false, retryAfterSec, blockedBy } : { allowed: true, retryAfterSec: 0 };
}

/** Record one hit for the key under each distinct bucket of the rules. */
export async function recordHit(store: RateStore, rules: readonly RateRule[], keyHash: string, now: Date): Promise<void> {
  const at = now.toISOString();
  // The same (bucket, key) appears in several rules of one bucket: record it once.
  const buckets = new Set(rules.map((r) => r.bucket));
  for (const bucket of buckets) await store.add(bucket, keyHash, at);
}

/** Check every rule for one key; record a hit under each rule only when all of them allow it. */
export async function checkAndRecord(store: RateStore, rules: readonly RateRule[], keyHash: string, now: Date): Promise<RateDecision> {
  const decision = await checkRules(store, rules, keyHash, now);
  if (decision.allowed) await recordHit(store, rules, keyHash, now);
  return decision;
}

export interface Reservation extends RateDecision {
  /** Give the slot back (delete the reserved hit). Safe to call twice; never throws. A no-op when the request was refused. */
  release(): Promise<void>;
}

/**
 * Reserve a slot under all the rules of ONE bucket for the key: record the hit first, then count each window (the count includes
 * this hit) and refuse when any window is over its maximum, giving the hit back. When the counter fails part-way the hit is given
 * back as well and the error is rethrown (the caller decides: the lead handler fails open, as it always did).
 */
export async function reserve(store: RateStore, rules: readonly RateRule[], keyHash: string, now: Date, newId: () => string = () => crypto.randomUUID()): Promise<Reservation> {
  const bucket = rules[0]?.bucket;
  if (bucket === undefined || rules.some((r) => r.bucket !== bucket)) throw new Error('reserve needs rules of exactly one bucket');
  const id = newId();
  await store.add(bucket, keyHash, now.toISOString(), id);
  let gone = false;
  const release = async (): Promise<void> => {
    if (gone) return;
    try {
      await store.release(id);
      gone = true;
    } catch {
      // the row stays until the periodic purge; it only ever makes a limit a little stricter
    }
  };
  let counted: Array<{ rule: RateRule; n: number }>;
  try {
    counted = [];
    for (const rule of rules) {
      const since = new Date(now.getTime() - rule.windowSec * 1000).toISOString();
      counted.push({ rule, n: await store.count(rule.bucket, keyHash, since) });
    }
  } catch (e) {
    await release();
    throw e;
  }
  const over = counted.filter((c) => c.n > c.rule.max);
  if (over.length === 0) return { allowed: true, retryAfterSec: 0, release };
  await release();
  let retryAfterSec = 0;
  let blockedBy: RateRule | undefined;
  for (const { rule, n } of over) {
    const wait = await retryAfterFor(store, rule, keyHash, n - 1, now); // n - 1: the count without this request's own hit
    if (blockedBy === undefined || wait > retryAfterSec) {
      retryAfterSec = wait;
      blockedBy = rule;
    }
  }
  return { allowed: false, retryAfterSec, blockedBy, release: async () => undefined };
}

/** Rows older than this are useless for any rule (the longest window is 24 hours). */
export const RATE_ROW_TTL_SEC = 2 * 86_400;
