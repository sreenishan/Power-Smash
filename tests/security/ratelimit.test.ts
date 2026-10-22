import { describe, expect, it } from 'vitest';
import { ACK_EMAIL_RULE, LEAD_RATE_RULES, checkAndRecord, createSupabaseRateStore, type RateStore } from '../../src/lib/security/ratelimit';
import { createSupabaseRest } from '../../src/lib/supabase/rest';
import { createWorld, FAKE, NOW } from '../leads/helpers';

function memoryStore() {
  const hits: Array<{ bucket: string; key: string; at: number; id?: string }> = [];
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
  return { store, hits };
}

describe('checkAndRecord', () => {
  it('allows up to the hourly maximum, then refuses without recording the refused hit', async () => {
    const { store, hits } = memoryStore();
    for (let i = 0; i < 3; i += 1) expect((await checkAndRecord(store, LEAD_RATE_RULES.phone, 'k1.aaa', NOW)).allowed).toBe(true);
    const blocked = await checkAndRecord(store, LEAD_RATE_RULES.phone, 'k1.aaa', NOW);
    expect(blocked).toMatchObject({ allowed: false, retryAfterSec: 3600 });
    expect(hits).toHaveLength(3);
  });

  it('the window slides: later the key is allowed again', async () => {
    const { store } = memoryStore();
    for (let i = 0; i < 3; i += 1) await checkAndRecord(store, LEAD_RATE_RULES.phone, 'k1.bbb', NOW);
    expect((await checkAndRecord(store, LEAD_RATE_RULES.phone, 'k1.bbb', new Date(NOW.getTime() + 30 * 60_000))).allowed).toBe(false);
    expect((await checkAndRecord(store, LEAD_RATE_RULES.phone, 'k1.bbb', new Date(NOW.getTime() + 61 * 60_000))).allowed).toBe(true);
  });

  it('the daily cap applies across hours', async () => {
    const { store } = memoryStore();
    let allowed = 0;
    for (let i = 0; i < 20; i += 1) {
      const at = new Date(NOW.getTime() + i * 61 * 60_000); // one attempt per ~hour for 20 hours
      if ((await checkAndRecord(store, LEAD_RATE_RULES.phone, 'k1.ccc', at)).allowed) allowed += 1;
    }
    expect(allowed).toBe(8);
  });

  it('keys are independent; the ack-mail rule is one per 24 hours', async () => {
    const { store } = memoryStore();
    expect((await checkAndRecord(store, [ACK_EMAIL_RULE], 'k1.x', NOW)).allowed).toBe(true);
    expect((await checkAndRecord(store, [ACK_EMAIL_RULE], 'k1.x', new Date(NOW.getTime() + 3600_000))).allowed).toBe(false);
    expect((await checkAndRecord(store, [ACK_EMAIL_RULE], 'k1.y', NOW)).allowed).toBe(true);
    expect((await checkAndRecord(store, [ACK_EMAIL_RULE], 'k1.x', new Date(NOW.getTime() + 25 * 3600_000))).allowed).toBe(true);
  });
});

describe('Supabase-backed store', () => {
  it('counts with HEAD + count=exact, inserts hashes only, purges by time', async () => {
    const world = createWorld();
    const store = createSupabaseRateStore(createSupabaseRest({ url: FAKE.supabaseUrl, secretKey: FAKE.supabaseSecret, fetch: world.fetch }));
    const since = new Date(NOW.getTime() - 3600_000).toISOString();
    expect(await store.count('lead_ip', 'k1.abc', since)).toBe(0);
    await store.add('lead_ip', 'k1.abc', NOW.toISOString());
    expect(await store.count('lead_ip', 'k1.abc', since)).toBe(1);
    expect(await store.count('lead_ip', 'k1.other', since)).toBe(0);
    await store.purgeBefore(new Date(NOW.getTime() + 1000).toISOString());
    expect(world.hits).toHaveLength(0);
    const head = world.calls.find((c) => c.method === 'HEAD');
    expect(head?.headers.prefer).toBe('count=exact');
    expect(head?.headers.authorization).toBeUndefined();
  });
});
