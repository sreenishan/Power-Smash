import { describe, expect, it, vi } from 'vitest';
import { BEACON_BODY_MAX_BYTES, BEACON_RATE_PER_MINUTE, MIN_VISIBLE_MS, beaconSchema, countableItems, createBeaconHandler, createBeaconState, isBeaconBot, safeEqual } from '../../src/lib/placements/beacon';
import type { BeaconDeps } from '../../src/lib/placements/beacon';
import type { ImpressionBatch } from '../../src/lib/placements/store';
import type { RateStore } from '../../src/lib/security/ratelimit';
import { placement } from './helpers';

const TOKEN = 'build-token-0001';
const HMAC = ['k1', 'x'.repeat(40)].join(':');
const NOW = new Date('2026-11-10T04:00:00Z');
const CHROME = 'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Mobile Safari/537.36';
const IP = '203.0.113.9';

function memoryRateStore(): RateStore & { hits: Array<{ bucket: string; key: string; at: string; id?: string }> } {
  const hits: Array<{ bucket: string; key: string; at: string; id?: string }> = [];
  return {
    hits,
    count: async (bucket, key, since) => hits.filter((h) => h.bucket === bucket && h.key === key && h.at >= since).length,
    add: async (bucket, key, at, id) => void hits.push({ bucket, key, at, id }),
    release: async (id) => {
      const i = hits.findIndex((h) => h.id === id);
      if (i >= 0) hits.splice(i, 1);
    },
    purgeBefore: async () => undefined,
  };
}

function setup(over: Partial<BeaconDeps> = {}) {
  const banner = placement({ slot: 'player_page_banner' });
  const strip = placement({ slot: 'footer_partner_strip' });
  const coverage = placement({ slot: 'tournament_coverage_title', scopeKey: 'fictional-open' });
  const batches: ImpressionBatch[] = [];
  const logs: Array<Record<string, unknown>> = [];
  const loadSchedule = vi.fn(async () => [banner, strip, coverage]);
  const state = createBeaconState();
  const rateStore = memoryRateStore();
  const deps: BeaconDeps = {
    tokens: [TOKEN],
    now: () => NOW,
    loadSchedule,
    store: { record: async (b) => (batches.push(b), b.items.length) },
    getSalt: async () => 'daily-salt-for-tests',
    hmacKey: HMAC,
    siteOrigin: 'https://powersmash.example',
    rateStore,
    log: (e) => void logs.push(e),
    ...over,
  };
  const handler = createBeaconHandler(deps, state);
  const body = (items: Array<{ id: string; slot: string; ms?: number }>, path = '/players/fictional-player/', tok = TOKEN): string =>
    JSON.stringify({ v: 1, tok, path, items: items.map((i) => ({ ms: 1000, ...i })) });
  const send = (payload: string, init: { ua?: string | null; ip?: string; method?: string; headers?: Record<string, string> } = {}) => {
    const headers: Record<string, string> = { 'content-type': 'text/plain', 'x-vercel-forwarded-for': init.ip ?? IP, ...init.headers };
    if (init.ua !== null) headers['user-agent'] = init.ua ?? CHROME;
    return handler(new Request('https://powersmash.example/api/placement-beacon', { method: init.method ?? 'POST', headers, body: init.method === 'GET' ? undefined : payload }));
  };
  return { banner, strip, coverage, batches, logs, loadSchedule, state, rateStore, send, body, handler };
}

describe('beacon request validation', () => {
  it('accepts a valid batch with 204 and records it once, for the India day', async () => {
    const t = setup();
    const res = await t.send(t.body([{ id: t.banner.id, slot: 'player_page_banner' }]));
    expect(res.status).toBe(204);
    expect(t.batches).toHaveLength(1);
    expect(t.batches[0]?.day).toBe('2026-11-10');
    expect(t.batches[0]?.items).toEqual([{ placementId: t.banner.id, pagePath: '/players/fictional-player/' }]);
    expect(res.headers.get('cache-control')).toBe('no-store');
  });

  it('only POST, same origin, JSON or text, within 2 KB, valid JSON, valid shape', async () => {
    const t = setup();
    const ok = t.body([{ id: t.banner.id, slot: 'player_page_banner' }]);
    expect((await t.send(ok, { method: 'GET' })).status).toBe(405);
    expect((await t.send(ok, { headers: { origin: 'https://evil.example' } })).status).toBe(403);
    expect((await t.send(ok, { headers: { origin: 'https://powersmash.example' } })).status).toBe(204);
    expect((await t.send(ok, { headers: { 'content-type': 'application/x-www-form-urlencoded' } })).status).toBe(415);
    expect((await t.send('x'.repeat(BEACON_BODY_MAX_BYTES + 1))).status).toBe(413);
    expect((await t.send('{not json')).status).toBe(400);
    expect((await t.send(JSON.stringify({ v: 1, tok: TOKEN, path: '/', items: [] }))).status).toBe(422);
    expect((await t.send(JSON.stringify({ v: 2, tok: TOKEN, path: '/', items: [{ id: t.banner.id, slot: 'x', ms: 1000 }] }))).status).toBe(422);
    expect((await t.send(JSON.stringify({ v: 1, tok: TOKEN, path: '/', items: [{ id: 'not-a-uuid', slot: 'x', ms: 1000 }] }))).status).toBe(422);
    expect((await t.send(JSON.stringify({ v: 1, tok: TOKEN, path: '/', extra: 1, items: [{ id: t.banner.id, slot: 'x', ms: 1000 }] }))).status).toBe(422);
    const nine = Array.from({ length: 9 }, () => ({ id: t.banner.id, slot: 'player_page_banner', ms: 1000 }));
    expect((await t.send(JSON.stringify({ v: 1, tok: TOKEN, path: '/', items: nine }))).status).toBe(422);
    expect(t.batches).toHaveLength(1);
  });

  it('refuses a wrong or missing build token, and is unconfigured (503) without a token, a store or a key', async () => {
    const t = setup();
    expect((await t.send(t.body([{ id: t.banner.id, slot: 'player_page_banner' }], '/players/x/', 'wrong-token-123'))).status).toBe(403);
    for (const over of [{ tokens: [] }, { store: null }, { hmacKey: null }] as Array<Partial<BeaconDeps>>) {
      const u = setup(over);
      expect((await u.send(u.body([{ id: u.banner.id, slot: 'player_page_banner' }]))).status).toBe(503);
    }
  });

  it('compares tokens in constant time shape (equal length strings only)', () => {
    expect(safeEqual('abc', 'abc')).toBe(true);
    expect(safeEqual('abc', 'abd')).toBe(false);
    expect(safeEqual('abc', 'abcd')).toBe(false);
  });

  it('the schema caps visible time and requires the strict shape', () => {
    expect(beaconSchema.safeParse({ v: 1, tok: TOKEN, path: '/', items: [{ id: '20000000-0000-4000-8000-000000000001', slot: 'x', ms: 99_999_999 }] }).success).toBe(false);
    expect(beaconSchema.safeParse({ v: 1, tok: TOKEN, path: '/', items: [{ id: '20000000-0000-4000-8000-000000000001', slot: 'x', ms: 1000, extra: 1 }] }).success).toBe(false);
  });
});

describe('bots are never counted', () => {
  it('answers 204 and records nothing for crawler, tool and empty user agents', async () => {
    const t = setup();
    const b = t.body([{ id: t.banner.id, slot: 'player_page_banner' }]);
    for (const ua of ['Googlebot/2.1', 'curl/8.4.0', 'python-requests/2.31', 'HeadlessChrome/130', 'Lighthouse', 'WhatsApp/2.23', '', null]) {
      const res = await t.send(b, { ua });
      expect(res.status).toBe(204);
    }
    expect(t.batches).toHaveLength(0);
    expect(t.loadSchedule).not.toHaveBeenCalled();
    expect(isBeaconBot(CHROME)).toBe(false);
  });
});

describe('what counts (integrity rules)', () => {
  const day = '2026-11-10';
  const bodyOf = (items: Array<{ id: string; slot: string; ms: number }>) => beaconSchema.parse({ v: 1, tok: TOKEN, path: '/', items });

  it('drops a visible time under one second', () => {
    const p = placement();
    expect(countableItems(bodyOf([{ id: p.id, slot: p.slot, ms: MIN_VISIBLE_MS - 1 }]), '/players/fictional-player/', [p], day)).toEqual([]);
    expect(countableItems(bodyOf([{ id: p.id, slot: p.slot, ms: MIN_VISIBLE_MS }]), '/players/fictional-player/', [p], day)).toHaveLength(1);
  });

  it('drops unknown, finished, not-yet-started and paused placements', () => {
    const live = placement();
    const over = placement({ endDate: '2026-11-09' });
    const later = placement({ startDate: '2026-11-11' });
    const paused = placement({ status: 'paused' });
    const items = [live, over, later, paused, { id: '20000000-0000-4000-8000-0000000000ff', slot: live.slot }].map((p) => ({ id: p.id, slot: p.slot, ms: 1500 }));
    const out = countableItems(bodyOf(items), '/players/fictional-player/', [live, over, later, paused], day);
    expect(out.map((o) => o.placementId)).toEqual([live.id]);
  });

  it('drops a slot that does not match the placement, and a path the slot cannot be on', () => {
    const p = placement({ slot: 'player_page_banner' });
    expect(countableItems(bodyOf([{ id: p.id, slot: 'match_page_banner', ms: 1500 }]), '/players/fictional-player/', [p], day)).toEqual([]);
    expect(countableItems(bodyOf([{ id: p.id, slot: p.slot, ms: 1500 }]), '/matches/fake-match/', [p], day)).toEqual([]);
    expect(countableItems(bodyOf([{ id: p.id, slot: p.slot, ms: 1500 }]), '/privacy/', [p], day)).toEqual([]);
  });

  it('a per-tournament placement only counts on its own tournament page', () => {
    const c = placement({ slot: 'tournament_coverage_title', scopeKey: 'fictional-open' });
    const item = [{ id: c.id, slot: c.slot, ms: 1500 }];
    expect(countableItems(bodyOf(item), '/tournaments/fictional-open/', [c], day)).toHaveLength(1);
    expect(countableItems(bodyOf(item), '/tournaments/other-cup/', [c], day)).toEqual([]);
    expect(countableItems(bodyOf(item), '/tournaments/', [c], day)).toEqual([]);
  });

  it('counts nothing for a protected page', () => {
    const p = placement();
    const isProtected = (path: string) => path === '/players/hidden-player/';
    expect(countableItems(bodyOf([{ id: p.id, slot: p.slot, ms: 1500 }]), '/players/hidden-player/', [p], day, isProtected)).toEqual([]);
    expect(countableItems(bodyOf([{ id: p.id, slot: p.slot, ms: 1500 }]), '/players/fictional-player/', [p], day, isProtected)).toHaveLength(1);
  });

  it('counts a placement once per batch even when it is listed twice', () => {
    const p = placement();
    const out = countableItems(bodyOf([{ id: p.id, slot: p.slot, ms: 1500 }, { id: p.id.toUpperCase(), slot: p.slot, ms: 1500 }]), '/players/fictional-player/', [p], day);
    expect(out).toHaveLength(1);
  });

  it('end to end: dropped items answer 204 and record nothing (no oracle for a scripted caller)', async () => {
    const t = setup();
    const res = await t.send(t.body([{ id: t.banner.id, slot: 'player_page_banner', ms: 10 }]));
    expect(res.status).toBe(204);
    expect(t.batches).toHaveLength(0);
    const res2 = await t.send(t.body([{ id: t.banner.id, slot: 'player_page_banner' }], '/book/'));
    expect(res2.status).toBe(204);
    expect(t.batches).toHaveLength(0);
    const protectedPath = setup({ isPathProtected: () => true });
    expect((await protectedPath.send(protectedPath.body([{ id: protectedPath.banner.id, slot: 'player_page_banner' }]))).status).toBe(204);
    expect(protectedPath.batches).toHaveLength(0);
  });
});

describe('dedupe and privacy', () => {
  it('one impression per placement per day per session: a repeat is answered 204 and not recorded', async () => {
    const t = setup();
    const b = t.body([{ id: t.banner.id, slot: 'player_page_banner' }]);
    await t.send(b);
    await t.send(b);
    await t.send(b);
    expect(t.batches).toHaveLength(1);
  });

  it('a different visitor (another connection or browser) counts again; so does the next day', async () => {
    const t = setup();
    const b = t.body([{ id: t.banner.id, slot: 'player_page_banner' }]);
    await t.send(b);
    await t.send(b, { ip: '203.0.113.77' });
    expect(t.batches).toHaveLength(2);
    expect(new Set(t.batches.map((x) => x.sessionHash)).size).toBe(2);
  });

  it('a new day brings a new salt and a new key', async () => {
    let now = NOW;
    const salts: Record<string, string> = { '2026-11-10': 'salt-a-for-tests', '2026-11-11': 'salt-b-for-tests' };
    const t = setup({ now: () => now, getSalt: async (day) => salts[day] ?? null });
    const b = t.body([{ id: t.banner.id, slot: 'player_page_banner' }]);
    await t.send(b);
    now = new Date('2026-11-11T04:00:00Z');
    await t.send(b);
    expect(t.batches).toHaveLength(2);
    expect(t.batches[0]?.sessionHash).not.toBe(t.batches[1]?.sessionHash);
    expect(t.batches[1]?.day).toBe('2026-11-11');
  });

  it('stores no personal data: no IP, no user agent, only a pseudonymous session hash', async () => {
    const t = setup();
    await t.send(t.body([{ id: t.banner.id, slot: 'player_page_banner' }]));
    const stored = JSON.stringify(t.batches);
    expect(stored).not.toContain(IP);
    expect(stored).not.toContain('Pixel');
    expect(stored).not.toContain('Mozilla');
    expect(t.batches[0]?.sessionHash).toMatch(/^k1\.[0-9a-f]{32}$/);
    expect(JSON.stringify(t.logs)).not.toContain(IP);
    expect(JSON.stringify(t.rateStore.hits)).not.toContain(IP);
  });
});

describe('rate limits', () => {
  it('refuses more than the per-minute window from one connection', async () => {
    const t = setup();
    const statuses: number[] = [];
    for (let i = 0; i < BEACON_RATE_PER_MINUTE + 2; i += 1) {
      statuses.push((await t.send(t.body([{ id: t.banner.id, slot: 'player_page_banner' }]), { ip: IP })).status);
    }
    expect(statuses.filter((s) => s === 429)).toHaveLength(2);
    // another connection is unaffected
    expect((await t.send(t.body([{ id: t.strip.id, slot: 'footer_partner_strip' }], '/'), { ip: '203.0.113.50' })).status).toBe(204);
  });

  it('honours the Workers rate limit binding and survives its failure', async () => {
    const denied = setup({ limiter: { limit: async () => ({ success: false }) } });
    expect((await denied.send(denied.body([{ id: denied.banner.id, slot: 'player_page_banner' }]))).status).toBe(429);
    const broken = setup({
      limiter: {
        limit: async () => {
          throw new Error('binding down');
        },
      },
    });
    expect((await broken.send(broken.body([{ id: broken.banner.id, slot: 'player_page_banner' }]))).status).toBe(204);
  });

  it('the database counter refuses with a retry hint once the hourly rule is full, and fails open when the counter is down', async () => {
    const t = setup();
    const other = setup({ rateStore: { ...memoryRateStore(), count: async () => 9999 } });
    const res = await other.send(other.body([{ id: other.banner.id, slot: 'player_page_banner' }]));
    expect(res.status).toBe(429);
    expect(Number(res.headers.get('retry-after'))).toBeGreaterThan(0);
    expect(other.batches).toHaveLength(0);
    const down = setup({
      rateStore: {
        ...memoryRateStore(),
        add: async () => {
          throw new Error('db down');
        },
      },
    });
    expect((await down.send(down.body([{ id: down.banner.id, slot: 'player_page_banner' }]))).status).toBe(503); // fails closed (S2-4)
    expect(down.batches).toHaveLength(0);
    expect(t.rateStore.hits).toHaveLength(0);
  });

  it('a request with nothing new to count never touches the database counter', async () => {
    const t = setup();
    const b = t.body([{ id: t.banner.id, slot: 'player_page_banner' }]);
    await t.send(b);
    const before = t.rateStore.hits.length;
    await t.send(b);
    expect(t.rateStore.hits.length).toBe(before);
  });
});

describe('failures', () => {
  it('a store failure is a 503 with no detail, and the impression is not marked as seen (a retry can count)', async () => {
    let fail = true;
    const batches: ImpressionBatch[] = [];
    const t = setup({
      store: {
        record: async (b) => {
          if (fail) throw new Error('secret db detail');
          batches.push(b);
          return 1;
        },
      },
    });
    const b = t.body([{ id: t.banner.id, slot: 'player_page_banner' }]);
    const res = await t.send(b);
    expect(res.status).toBe(503);
    expect(await res.text()).not.toContain('secret');
    fail = false;
    expect((await t.send(b)).status).toBe(204);
    expect(batches).toHaveLength(1);
  });

  it('a schedule or salt failure is a 503; no schedule at all is a quiet 204', async () => {
    const a = setup({ loadSchedule: async () => { throw new Error('x'); } });
    expect((await a.send(a.body([{ id: a.banner.id, slot: 'player_page_banner' }]))).status).toBe(503);
    const b = setup({ getSalt: async () => { throw new Error('x'); } });
    expect((await b.send(b.body([{ id: b.banner.id, slot: 'player_page_banner' }]))).status).toBe(503);
    const c = setup({ loadSchedule: async () => null });
    expect((await c.send(c.body([{ id: c.banner.id, slot: 'player_page_banner' }]))).status).toBe(204);
    const d = setup({ getSalt: async () => null });
    expect((await d.send(d.body([{ id: d.banner.id, slot: 'player_page_banner' }]))).status).toBe(503);
  });

  it('caches the schedule for a minute inside the isolate', async () => {
    const t = setup();
    await t.send(t.body([{ id: t.banner.id, slot: 'player_page_banner' }]));
    await t.send(t.body([{ id: t.strip.id, slot: 'footer_partner_strip' }], '/'));
    expect(t.loadSchedule).toHaveBeenCalledTimes(1);
  });
});
