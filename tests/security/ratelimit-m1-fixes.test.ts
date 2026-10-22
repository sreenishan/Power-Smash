// Regression tests for the M1 review-fix wave in src/lib/security/ratelimit.ts: B-6 (retry hint, check and record are separate)
// and S-6 (global circuit-breaker rule).
import { describe, expect, it } from 'vitest';
import { DEFAULT_GLOBAL_LEADS_PER_DAY, DEFAULT_GLOBAL_LEADS_PER_HOUR, FLOOD_NOTICE_RULE, GLOBAL_BUCKET, LEAD_RATE_RULES, checkAndRecord, checkRules, createSupabaseRateStore, globalLeadRule, globalLeadRules, recordHit, reserve, type RateStore } from '../../src/lib/security/ratelimit';
import { createSupabaseRest } from '../../src/lib/supabase/rest';
import { createWorld, FAKE, NOW } from '../leads/helpers';

function memoryStore(withTimes = true) {
  const hits: Array<{ bucket: string; key: string; at: number; id?: string }> = [];
  const calls = { hitTimes: 0 };
  const store: RateStore = {
    async count(bucket, key, sinceIso) {
      return hits.filter((h) => h.bucket === bucket && h.key === key && h.at >= new Date(sinceIso).getTime()).length;
    },
    async add(bucket, key, atIso, id) {
      hits.push({ bucket, key, at: new Date(atIso).getTime(), id });
    },
    async release(id) {
      const i = hits.findIndex((h) => h.id === id);
      if (i >= 0) hits.splice(i, 1);
    },
    async purgeBefore() {},
  };
  if (withTimes) {
    store.hitTimes = async (bucket, key, sinceIso, limit) => {
      calls.hitTimes += 1;
      return hits
        .filter((h) => h.bucket === bucket && h.key === key && h.at >= new Date(sinceIso).getTime())
        .map((h) => h.at)
        .sort((a, b) => a - b)
        .slice(0, limit)
        .map((t) => new Date(t).toISOString());
    };
  }
  return { store, hits, calls };
}
const ago = (seconds: number) => new Date(NOW.getTime() - seconds * 1000);

describe('B-6: checking and recording are separate steps', () => {
  it('checkRules never records; recordHit records once per bucket even when the bucket has two rules', async () => {
    const { store, hits } = memoryStore();
    expect(await checkRules(store, LEAD_RATE_RULES.phone, 'k1.a', NOW)).toEqual({ allowed: true, retryAfterSec: 0 });
    expect(hits).toHaveLength(0);
    await recordHit(store, LEAD_RATE_RULES.phone, 'k1.a', NOW);
    expect(hits).toHaveLength(1); // hour and day rules share the bucket lead_phone: one row
    await recordHit(store, LEAD_RATE_RULES.phone, 'k1.a', NOW);
    await recordHit(store, LEAD_RATE_RULES.phone, 'k1.a', NOW);
    expect(await checkRules(store, LEAD_RATE_RULES.phone, 'k1.a', NOW)).toMatchObject({ allowed: false });
  });

  it('checkAndRecord still records only when allowed', async () => {
    const { store, hits } = memoryStore();
    for (let i = 0; i < 5; i += 1) await checkAndRecord(store, LEAD_RATE_RULES.phone, 'k1.b', NOW);
    expect(hits).toHaveLength(3);
  });
});

describe('B-6: the retry hint is the time until the hit that must leave the window leaves it', () => {
  it('hourly: the oldest hit decides', async () => {
    const { store } = memoryStore();
    for (const s of [3590, 1200, 600]) await store.add('lead_phone', 'k1.c', ago(s).toISOString());
    expect(await checkRules(store, LEAD_RATE_RULES.phone, 'k1.c', NOW)).toMatchObject({ allowed: false, retryAfterSec: 10 });
  });

  it('when more hits than the maximum are inside the window (a race), the hit at the right position decides', async () => {
    const { store } = memoryStore();
    for (const s of [3500, 3000, 2000, 1000, 500]) await store.add('lead_phone', 'k1.d', ago(s).toISOString()); // 5 hits, max 3: two must leave
    // the third-oldest (2000 s ago) leaves last of the three that must go: 3600 - 2000 = 1600 s
    expect(await checkRules(store, LEAD_RATE_RULES.phone, 'k1.d', NOW)).toMatchObject({ allowed: false, retryAfterSec: 1600 });
  });

  it('daily: hours, never more than the window, never less than 1 second', async () => {
    const { store } = memoryStore();
    for (let i = 0; i < 8; i += 1) await store.add('lead_phone', 'k1.e', ago(86_000 - i * 1000).toISOString()); // none inside the last hour
    expect(await checkRules(store, LEAD_RATE_RULES.phone, 'k1.e', NOW)).toMatchObject({ allowed: false, retryAfterSec: 400 });
    const edge = memoryStore();
    for (let i = 0; i < 3; i += 1) await edge.store.add('lead_phone', 'k1.f', ago(3600).toISOString()); // exactly leaving now
    const r = await checkRules(edge.store, LEAD_RATE_RULES.phone, 'k1.f', new Date(NOW.getTime() - 1)); // 1 ms before they leave
    expect(r.retryAfterSec).toBeGreaterThanOrEqual(1);
    expect(r.retryAfterSec).toBeLessThanOrEqual(3600);
  });

  it('with both the hourly and the daily rule blocking, the longer wait is reported', async () => {
    const { store } = memoryStore();
    for (let i = 0; i < 8; i += 1) await store.add('lead_phone', 'k1.g', ago(3500 - i * 100).toISOString()); // 8 in the last hour: both rules full
    const r = await checkRules(store, LEAD_RATE_RULES.phone, 'k1.g', NOW);
    expect(r.allowed).toBe(false);
    expect(r.retryAfterSec).toBe(86_400 - 3500); // the day rule (the oldest of the 8 leaves 23 hours later) outlasts the hour rule
  });

  it('falls back to the whole window when the store cannot list hit times, or the listing fails', async () => {
    const plain = memoryStore(false);
    for (let i = 0; i < 3; i += 1) await plain.store.add('lead_phone', 'k1.h', ago(100).toISOString());
    expect(await checkRules(plain.store, LEAD_RATE_RULES.phone, 'k1.h', NOW)).toMatchObject({ allowed: false, retryAfterSec: 3600 });
    const failing = memoryStore();
    for (let i = 0; i < 3; i += 1) await failing.store.add('lead_phone', 'k1.i', ago(100).toISOString());
    failing.store.hitTimes = async () => {
      throw new Error('down');
    };
    expect(await checkRules(failing.store, LEAD_RATE_RULES.phone, 'k1.i', NOW)).toMatchObject({ allowed: false, retryAfterSec: 3600 });
  });

  it('only a blocked rule costs the extra lookup', async () => {
    const m = memoryStore();
    await checkRules(m.store, LEAD_RATE_RULES.phone, 'k1.j', NOW);
    expect(m.calls.hitTimes).toBe(0);
  });
});

describe('S-6: the global rule and the flood-notice rule', () => {
  it('the global rule is one hour with the default cap as a named constant, or a given cap', () => {
    expect(globalLeadRule()).toEqual({ bucket: GLOBAL_BUCKET, windowSec: 3600, max: DEFAULT_GLOBAL_LEADS_PER_HOUR });
    expect(globalLeadRule(5)).toEqual({ bucket: 'lead_all', windowSec: 3600, max: 5 });
    expect(FLOOD_NOTICE_RULE).toEqual({ bucket: 'lead_flood_notice', windowSec: 3600, max: 1 });
    // bucket names must satisfy the table's check constraint
    for (const b of [GLOBAL_BUCKET, FLOOD_NOTICE_RULE.bucket]) expect(b).toMatch(/^[a-z_]{1,40}$/);
  });

  it('the breaker refuses at the cap and reports when the oldest of the counted leads leaves the hour', async () => {
    const { store } = memoryStore();
    const rule = globalLeadRule(3);
    for (const s of [3000, 2000, 1000]) await store.add(GLOBAL_BUCKET, 'all', ago(s).toISOString());
    expect(await checkRules(store, [rule], 'all', NOW)).toMatchObject({ allowed: false, retryAfterSec: 600 });
    expect((await checkRules(store, [rule], 'all', new Date(NOW.getTime() + 11 * 60_000))).allowed).toBe(true);
  });
});

describe('Supabase-backed store: hitTimes', () => {
  it('asks for hit_at only, oldest first, with a limit, and returns the times', async () => {
    const world = createWorld();
    const store = createSupabaseRateStore(createSupabaseRest({ url: FAKE.supabaseUrl, secretKey: FAKE.supabaseSecret, fetch: world.fetch }));
    for (const s of [30, 10, 20]) await store.add('lead_ip', 'k1.abc', ago(s).toISOString());
    await store.add('lead_ip', 'k1.other', ago(5).toISOString());
    const since = ago(3600).toISOString();
    const times = await store.hitTimes?.('lead_ip', 'k1.abc', since, 2);
    expect(times).toEqual([ago(30).toISOString(), ago(20).toISOString()]);
    const call = world.calls.find((c) => c.method === 'GET' && c.path.startsWith('/rest/v1/rate_limit_hits'));
    expect(call?.path).toContain('select=hit_at');
    expect(call?.path).toContain('order=hit_at.asc');
    expect(call?.path).toContain('limit=2');
    expect(call?.headers.authorization).toBeUndefined();
  });
});

describe('follow-up N-5 / N-2 / N-3: reserve (record first, count, give back when refused)', () => {
  /** A store whose every call yields to the event loop a few times, so concurrent callers interleave. */
  function slowStore() {
    const m = memoryStore();
    const tick = () => new Promise<void>((r) => setTimeout(r, Math.floor(Math.random() * 2)));
    const wrap = <A extends unknown[], R>(fn: (...a: A) => Promise<R>) => async (...a: A): Promise<R> => {
      await tick();
      const r = await fn(...a);
      await tick();
      return r;
    };
    const s = m.store;
    const slow: RateStore = { ...s, count: wrap(s.count), add: wrap(s.add), release: wrap(s.release), hitTimes: s.hitTimes ? wrap(s.hitTimes) : undefined, purgeBefore: s.purgeBefore };
    return { ...m, store: slow };
  }
  let counter = 0;
  const nextId = () => `id-${(counter += 1)}`;

  it('the global rules are one hour and one day in ONE bucket, with the named defaults', () => {
    expect(DEFAULT_GLOBAL_LEADS_PER_DAY).toBe(100);
    expect(globalLeadRules()).toEqual([
      { bucket: 'lead_all', windowSec: 3600, max: DEFAULT_GLOBAL_LEADS_PER_HOUR },
      { bucket: 'lead_all', windowSec: 86_400, max: 100 },
    ]);
    expect(globalLeadRules(5, 9)).toEqual([
      { bucket: 'lead_all', windowSec: 3600, max: 5 },
      { bucket: 'lead_all', windowSec: 86_400, max: 9 },
    ]);
  });

  it('records its hit first, keeps it when allowed, and refuses (giving the hit back) when over the maximum', async () => {
    const { store, hits } = memoryStore();
    const rule = globalLeadRule(2);
    const a = await reserve(store, [rule], 'all', NOW, nextId);
    const b = await reserve(store, [rule], 'all', NOW, nextId);
    expect([a.allowed, b.allowed]).toEqual([true, true]);
    const [idA, idB] = hits.map((h) => h.id);
    expect(idA).not.toBe(idB);
    expect(hits).toHaveLength(2);
    const c = await reserve(store, [rule], 'all', NOW, nextId);
    expect(c.allowed).toBe(false);
    expect(c.blockedBy).toEqual(rule);
    expect(hits).toHaveLength(2); // the refused request's own hit is already gone
    await a.release();
    expect(hits.map((h) => h.id)).toEqual([idB]);
    expect((await reserve(store, [rule], 'all', NOW, nextId)).allowed).toBe(true);
  });

  it('release is safe to call twice and a refused reservation has nothing to release', async () => {
    const { store, hits } = memoryStore();
    const rule = globalLeadRule(1);
    const a = await reserve(store, [rule], 'all', NOW, nextId);
    await a.release();
    await a.release();
    expect(hits).toHaveLength(0);
    const keep = await reserve(store, [rule], 'all', NOW, nextId);
    const refused = await reserve(store, [rule], 'all', NOW, nextId);
    expect(refused.allowed).toBe(false);
    await refused.release();
    expect(hits).toHaveLength(1);
    expect(keep.allowed).toBe(true);
  });

  it('two windows: the day can refuse while the hour allows, and the longer wait is reported', async () => {
    const { store, hits } = memoryStore();
    const rules = globalLeadRules(10, 3);
    for (const s of [7000, 6000, 5000]) await store.add(GLOBAL_BUCKET, 'all', ago(s).toISOString(), `old-${s}`); // 3 today, none in the last hour
    const r = await reserve(store, rules, 'all', NOW, nextId);
    expect(r.allowed).toBe(false);
    expect(r.blockedBy?.windowSec).toBe(86_400);
    expect(r.retryAfterSec).toBe(86_400 - 7000);
    expect(hits).toHaveLength(3);
  });

  it('NEVER admits more than the maximum when requests overlap (15 randomised rounds of 12 concurrent callers, cap 3)', async () => {
    for (let round = 0; round < 15; round += 1) {
      const { store, hits } = slowStore();
      const rule = globalLeadRule(3);
      const out = await Promise.all(Array.from({ length: 12 }, () => reserve(store, [rule], 'all', NOW)));
      const admitted = out.filter((r) => r.allowed).length;
      expect(admitted, 'round ' + round).toBeLessThanOrEqual(3);
      expect(hits, 'round ' + round).toHaveLength(admitted); // everything refused gave its row back
    }
  });

  it('callers that fit under the maximum are all admitted', async () => {
    const { store, hits } = slowStore();
    const out = await Promise.all(Array.from({ length: 5 }, () => reserve(store, [globalLeadRule(5)], 'all', NOW)));
    expect(out.every((r) => r.allowed)).toBe(true);
    expect(hits).toHaveLength(5);
  });

  it('a counter that fails gives the hit back and rethrows (the caller decides to fail open)', async () => {
    const { store, hits } = memoryStore();
    store.count = async () => {
      throw new Error('down');
    };
    await expect(reserve(store, [globalLeadRule(1)], 'all', NOW, nextId)).rejects.toThrow('down');
    expect(hits).toHaveLength(0);
  });

  it('a release that fails does not throw and can be retried', async () => {
    const { store, hits } = memoryStore();
    const a = await reserve(store, [globalLeadRule(5)], 'all', NOW, nextId);
    const real = store.release;
    let fail = true;
    store.release = async (id) => {
      if (fail) throw new Error('network');
      await real(id);
    };
    await a.release();
    expect(hits).toHaveLength(1);
    fail = false;
    await a.release();
    expect(hits).toHaveLength(0);
  });

  it('rules of two buckets are a programming error', async () => {
    const { store } = memoryStore();
    await expect(reserve(store, [{ bucket: 'a', windowSec: 60, max: 1 }, { bucket: 'b', windowSec: 60, max: 1 }], 'k', NOW)).rejects.toThrow();
    await expect(reserve(store, [], 'k', NOW)).rejects.toThrow();
  });

  it('the Supabase store adds with the given id and releases exactly that row by id', async () => {
    const world = createWorld();
    const store = createSupabaseRateStore(createSupabaseRest({ url: FAKE.supabaseUrl, secretKey: FAKE.supabaseSecret, fetch: world.fetch }));
    const rule = globalLeadRule(5);
    const a = await reserve(store, [rule], 'all', NOW, () => '11111111-1111-4111-8111-111111111111');
    const b = await reserve(store, [rule], 'all', NOW, () => '22222222-2222-4222-8222-222222222222'); // same timestamp, different row
    expect(world.hits.map((h) => h.id)).toEqual(['11111111-1111-4111-8111-111111111111', '22222222-2222-4222-8222-222222222222']);
    await a.release();
    expect(world.hits.map((h) => h.id)).toEqual(['22222222-2222-4222-8222-222222222222']);
    const del = world.calls.find((c) => c.method === 'DELETE' && c.path.includes('id=eq.11111111'));
    expect(del?.path).toBe('/rest/v1/rate_limit_hits?id=eq.11111111-1111-4111-8111-111111111111');
    expect(del?.headers.authorization).toBeUndefined();
    expect(b.allowed).toBe(true);
  });
});
