import { afterEach, describe, expect, it, vi } from 'vitest';
import { CONSENT } from '../../src/content/consent';
import { REF_CODE_PATTERN } from '../../src/lib/contracts/lead-constants';
import { createLeadHandler } from '../../src/lib/leads/handler';
import { coverageBody, createWorld, FAKE, leadRequest, makeDeps, readJson, seqRandom, validUuid, NOW } from './helpers';

const setup = (envOverrides: Record<string, string | undefined> = {}, depsOverrides = {}) => {
  const world = createWorld();
  const h = makeDeps(world, depsOverrides, envOverrides);
  const handle = createLeadHandler(h.deps);
  return { world, h, handle };
};

afterEach(() => vi.restoreAllMocks());

describe('happy path', () => {
  it('stores the lead, alerts the owner on Telegram, returns the reference and a WhatsApp link', async () => {
    const { world, handle } = setup();
    const res = await handle(leadRequest(coverageBody()));
    expect(res.status).toBe(201);
    expect(res.headers.get('cache-control')).toBe('no-store');
    expect(res.headers.get('x-robots-tag')).toContain('noindex');
    const body = await readJson(res);
    expect(body.ok).toBe(true);
    expect(body.ref).toMatch(REF_CODE_PATTERN);
    expect(String(body.waLink)).toContain(`https://wa.me/${FAKE.whatsapp}?text=`);
    expect(String(body.waLink)).toContain(encodeURIComponent(String(body.ref)));

    expect(world.leads).toHaveLength(1);
    const row = world.leads[0] as Record<string, unknown>;
    expect(row).toMatchObject({
      ref_code: body.ref,
      type: 'coverage',
      status: 'new',
      name: 'Ravi Kumar',
      phone: '919876543210',
      whatsapp_ok: false,
      consent_id: CONSENT.leadNotice.id,
      consent_version: CONSENT.leadNotice.version,
      consent_at: NOW.toISOString(),
      idempotency_key: validUuid(1),
      alert_state: 'sent', // inserted as pending, then updated after the Telegram alert
    });
    expect(String(row.ip_hash)).toMatch(/^k1\.[0-9a-f]{32}$/);
    expect(JSON.stringify(row)).not.toContain(FAKE.ip); // raw IP never stored
    expect(row.payload).toMatchObject({ eventName: 'Chennai District Open 2026', startDate: '2026-12-05', district: 'Chennai' });
    expect(world.leadEvents.find((e) => e.event === 'created')).toBeTruthy(); // the DB trigger
    expect(world.leadEvents.find((e) => e.event === 'alert_sent')).toBeTruthy();
    expect(world.leads[0]?.alert_state).toBe('sent');
    expect(world.telegramMessages()).toHaveLength(1);
  });

  it('uses the secret key on the apikey header only, never on Authorization', async () => {
    const { world, handle } = setup();
    await handle(leadRequest(coverageBody()));
    const supabaseCalls = world.callsTo(new URL(FAKE.supabaseUrl).host);
    expect(supabaseCalls.length).toBeGreaterThan(3);
    for (const c of supabaseCalls) {
      expect(c.headers.apikey).toBe(FAKE.supabaseSecret);
      expect(c.headers.authorization).toBeUndefined();
    }
    for (const c of world.calls) {
      for (const [name, value] of Object.entries(c.headers)) {
        if (name !== 'apikey') expect(value, `${name} on ${c.host}`).not.toContain(FAKE.supabaseSecret);
      }
    }
    const insert = supabaseCalls.find((c) => c.method === 'POST' && c.path === '/rest/v1/leads');
    expect(insert?.headers.prefer).toContain('return=minimal');
  });

  it('runs the alert after the response when waitUntil exists', async () => {
    const later: Promise<unknown>[] = [];
    const { world, handle } = setup({}, { waitUntil: (p: Promise<unknown>) => later.push(p) });
    const res = await handle(leadRequest(coverageBody()));
    expect(res.status).toBe(201);
    await Promise.all(later);
    expect(world.telegramMessages()).toHaveLength(1);
  });
});

describe('request checks', () => {
  it('only POST, JSON, same origin, under 20 KB, valid JSON', async () => {
    const { world, handle } = setup();
    expect((await handle(leadRequest(null, { method: 'GET' }))).status).toBe(405);
    expect((await handle(leadRequest(coverageBody(), { headers: { 'content-type': 'text/plain' } }))).status).toBe(415);
    expect((await handle(leadRequest(coverageBody(), { headers: { origin: 'https://evil.example' } }))).status).toBe(403);
    expect((await handle(leadRequest(coverageBody(), { headers: { origin: 'null' } }))).status).toBe(403);
    const big = await handle(leadRequest(coverageBody({ notes: 'x'.repeat(30_000) })));
    expect(big.status).toBe(413);
    const declared = await handle(leadRequest(null, { rawBody: '{}', headers: { 'content-length': '999999' } }));
    expect(declared.status).toBe(413);
    const bad = await handle(leadRequest(null, { rawBody: '{not json' }));
    expect(bad.status).toBe(400);
    expect((await readJson(bad)).code).toBe('validation');
    expect(world.calls).toHaveLength(0); // nothing reached any service
  });

  it('a request with no Origin header (not a browser) is still subject to Turnstile', async () => {
    const { world, handle } = setup();
    world.turnstile.mode = 'fail';
    const req = new Request(`${FAKE.origin}/api/lead`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(coverageBody()) });
    expect((await readJson(await handle(req))).code).toBe('turnstile');
  });

  it('validation errors return 422 with field codes and never echo input', async () => {
    const { world, handle } = setup();
    const res = await handle(leadRequest(coverageBody({ name: 'www.evil.com', phone: 'abc', email: 'x\r\ny' })));
    expect(res.status).toBe(422);
    const body = await readJson(res);
    expect(body.code).toBe('validation');
    expect(body.fieldErrors).toEqual({ name: 'url_not_allowed', phone: 'invalid_phone', email: 'invalid_email' });
    expect(JSON.stringify(body)).not.toContain('evil');
    expect(typeof body.correlationId).toBe('string');
    expect(world.calls).toHaveLength(0);
  });

  it('a missing or malformed Turnstile token alone is reported as `turnstile`', async () => {
    const { handle } = setup();
    const res = await handle(leadRequest(coverageBody({ token: undefined })));
    expect(res.status).toBe(403);
    expect((await readJson(res)).code).toBe('turnstile');
    // token problem together with another problem is a normal validation error that includes the token
    const both = await readJson(await handle(leadRequest(coverageBody({ token: undefined, name: '' }))));
    expect(both.code).toBe('validation');
    expect(both.fieldErrors).toMatchObject({ name: 'required', token: 'required' });
  });

  it('a honeypot hit returns a normal-looking success and stores nothing', async () => {
    const { world, handle } = setup();
    const res = await handle(leadRequest(coverageBody({ website: 'http://spam.example' })));
    expect(res.status).toBe(201);
    const body = await readJson(res);
    expect(body.ok).toBe(true);
    expect(body.ref).toMatch(REF_CODE_PATTERN);
    expect(world.leads).toHaveLength(0);
    expect(world.calls).toHaveLength(0);
  });

  it('too fast (client-reported fill time) asks the visitor to retry', async () => {
    const { world, handle } = setup();
    const res = await handle(leadRequest(coverageBody({ elapsedMs: 200 })));
    expect(res.status).toBe(429);
    const body = await readJson(res);
    expect(body.code).toBe('rate_limited');
    expect(body.retryAfterSec).toBeGreaterThan(0);
    expect(res.headers.get('retry-after')).toBeTruthy();
    expect(world.leads).toHaveLength(0);
    expect((await handle(leadRequest(coverageBody({ elapsedMs: 4000, idempotencyKey: validUuid(2) })))).status).toBe(201);
  });
});

describe('Turnstile fails closed', () => {
  const cases: Array<[string, (w: ReturnType<typeof createWorld>) => void, Record<string, string | undefined>?]> = [
    ['token rejected', (w) => (w.turnstile.mode = 'fail')],
    ['siteverify unreachable', (w) => (w.turnstile.mode = 'throw')],
    ['siteverify HTTP 500', (w) => (w.turnstile.mode = 'http500')],
    ['wrong hostname', (w) => (w.turnstile.hostname = 'evil.example')],
    ['wrong action', (w) => (w.turnstile.action = 'something-else')],
    ['missing action', (w) => (w.turnstile.action = undefined)],
  ];
  for (const [label, arrange] of cases) {
    it(label, async () => {
      const { world, handle } = setup();
      arrange(world);
      const res = await handle(leadRequest(coverageBody()));
      expect(res.status).toBe(403);
      const body = await readJson(res);
      expect(body.code).toBe('turnstile');
      expect(String(body.waLink)).toContain('wa.me');
      expect(world.leads).toHaveLength(0);
      expect(world.telegramMessages()).toHaveLength(0); // an unverified visitor never reaches the owner
    });
  }

  it('sends the secret and token to siteverify, with the client IP, and never logs them', async () => {
    const { world, h, handle } = setup();
    await handle(leadRequest(coverageBody()));
    const call = world.callsTo('challenges.cloudflare.com')[0];
    expect(call?.json).toEqual({ secret: FAKE.turnstileSecret, response: 'XXXX.DUMMY.TOKEN.XXXX', remoteip: FAKE.ip });
    expect(JSON.stringify(h.logs)).not.toContain(FAKE.turnstileSecret);
  });

  it('without a configured secret the endpoint refuses (degraded), it never accepts unverified leads', async () => {
    const { world, handle } = setup({ TURNSTILE_SECRET_KEY: undefined });
    const res = await handle(leadRequest(coverageBody()));
    expect(res.status).toBe(503);
    expect((await readJson(res)).code).toBe('degraded');
    expect(world.leads).toHaveLength(0);
    expect(world.callsTo('api.telegram.org')).toHaveLength(0);
  });

  it('R-TURNSTILE-TEST: with Cloudflare test secrets AND TURNSTILE_ALLOW_TEST_KEYS=true the hostname and action checks are skipped (dummy response says localhost/test)', async () => {
    const { world, handle } = setup({ TURNSTILE_SECRET_KEY: '1x0000000000000000000000000000000AA', TURNSTILE_ALLOW_TEST_KEYS: 'true', TURNSTILE_EXPECTED_HOSTNAMES: undefined });
    world.turnstile.hostname = 'localhost';
    world.turnstile.action = 'test';
    expect((await handle(leadRequest(coverageBody()))).status).toBe(201);
  });

  it('S-1: a Cloudflare test secret WITHOUT the allow variable fails closed (degraded) and never reaches siteverify, the database or the owner', async () => {
    for (const secret of ['1x0000000000000000000000000000000AA', '2x0000000000000000000000000000000AA', '3x0000000000000000000000000000000AA']) {
      const { world, handle } = setup({ TURNSTILE_SECRET_KEY: secret, TURNSTILE_EXPECTED_HOSTNAMES: undefined });
      world.turnstile.hostname = 'localhost';
      world.turnstile.action = 'test';
      const res = await handle(leadRequest(coverageBody({ token: 'anything' })));
      expect(res.status, secret).toBe(503);
      const body = await readJson(res);
      expect(body.code).toBe('degraded');
      expect(String(body.waLink)).toContain('wa.me'); // the visitor still has the WhatsApp fallback
      expect(world.leads).toHaveLength(0);
      expect(world.callsTo('challenges.cloudflare.com')).toHaveLength(0);
      expect(world.callsTo('api.telegram.org')).toHaveLength(0);
    }
  });

  it('with the allow variable but a REAL secret, hostname and action are still checked (never skipped outside test mode)', async () => {
    const { world, handle } = setup({ TURNSTILE_ALLOW_TEST_KEYS: 'true' });
    world.turnstile.hostname = 'localhost';
    world.turnstile.action = 'test';
    expect((await handle(leadRequest(coverageBody()))).status).toBe(403);
  });

  it('with a real secret and no configured hostnames, the request hostname is expected', async () => {
    const { world, handle } = setup({ TURNSTILE_EXPECTED_HOSTNAMES: undefined });
    expect((await handle(leadRequest(coverageBody()))).status).toBe(201);
    world.turnstile.hostname = 'other.example';
    expect((await handle(leadRequest(coverageBody({ idempotencyKey: validUuid(5) })))).status).toBe(403);
  });
});

describe('idempotency', () => {
  it('the same key and contact returns the same reference and creates one lead', async () => {
    const { world, handle } = setup();
    const first = await readJson(await handle(leadRequest(coverageBody())));
    const turnstileCalls = world.callsTo('challenges.cloudflare.com').length;
    const secondRes = await handle(leadRequest(coverageBody()));
    const second = await readJson(secondRes);
    expect(secondRes.status).toBe(200);
    expect(second.ref).toBe(first.ref);
    expect(second.replay).toBe(true);
    expect(world.leads).toHaveLength(1);
    expect(world.callsTo('challenges.cloudflare.com')).toHaveLength(turnstileCalls); // a spent Turnstile token is not re-verified
    expect(world.telegramMessages()).toHaveLength(1); // no second alert
  });

  it('the same key with a different contact is a `duplicate`', async () => {
    const { world, handle } = setup();
    await handle(leadRequest(coverageBody()));
    const res = await handle(leadRequest(coverageBody({ phone: '99999 88888' })));
    expect(res.status).toBe(409);
    expect((await readJson(res)).code).toBe('duplicate');
    expect(world.leads).toHaveLength(1);
  });

  it('two identical requests racing: the unique constraint decides and the loser returns the winner reference', async () => {
    const { world } = setup();
    // The loser passes the lookup (nothing stored yet) and Turnstile, then loses the insert race.
    const realFetch = world.fetch;
    let injected = false;
    world.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(typeof input === 'string' ? input : input instanceof URL ? input.href : input.url);
      if (!injected && init?.method === 'POST' && url.endsWith('/rest/v1/leads')) {
        injected = true;
        world.leads.push({ id: 'winner', ref_code: 'PS-2026-WINNER', type: 'coverage', phone: '919876543210', email: null, idempotency_key: validUuid(1) });
      }
      return realFetch(input, init);
    }) as typeof fetch;
    const racing = createLeadHandler(makeDeps(world).deps); // picks up the patched world.fetch
    const res = await racing(leadRequest(coverageBody()));
    const body = await readJson(res);
    expect(res.status).toBe(200);
    expect(body.ref).toBe('PS-2026-WINNER');
    expect(body.replay).toBe(true);
  });

  it('a reference collision retries with a new random suffix', async () => {
    const { world, handle } = setup();
    world.db.refCollisions = 2;
    const res = await handle(leadRequest(coverageBody()));
    expect(res.status).toBe(201);
    expect(world.leads).toHaveLength(1);
  });
});

describe('reference codes', () => {
  it('match PS-YYYY-XXXXXX (IST year), are unique and not sequential', async () => {
    const { world, handle } = setup();
    const refs: string[] = [];
    for (let i = 0; i < 12; i += 1) {
      const res = await handle(leadRequest(coverageBody({ idempotencyKey: validUuid(100 + i), phone: `98765 4${String(1000 + i)}`, name: `Ravi ${'ABCDEFGHIJKL'[i]}` }), { headers: { 'x-vercel-forwarded-for': `203.0.113.${i + 1}` } }));
      const b = await readJson(res);
      expect(res.status, JSON.stringify(b)).toBe(201);
      refs.push(String(b.ref));
    }
    expect(new Set(refs).size).toBe(12);
    for (const r of refs) expect(r).toMatch(/^PS-2026-[0-9A-HJKMNP-TV-Z]{6}$/);
    expect(world.leads.map((l) => l.ref_code)).toEqual(refs);
    // not an incrementing sequence in any reading of the suffix
    const suffixes = refs.map((r) => r.slice(-6));
    const sorted = [...suffixes].sort();
    expect(suffixes).not.toEqual(sorted);
  });

  it('uses the IST year at the turn of the year', async () => {
    const world = createWorld();
    const h = makeDeps(world, { now: () => new Date('2026-12-31T19:00:00Z') }); // 2027-01-01 00:30 IST
    const res = await createLeadHandler(h.deps)(leadRequest(coverageBody({ startDate: '2027-02-10' })));
    expect(String((await readJson(res)).ref)).toMatch(/^PS-2027-/);
  });
});

describe('rate limits', () => {
  it('limits one phone number to 3 an hour and says when to retry', async () => {
    const { world, handle } = setup();
    for (let i = 0; i < 3; i += 1) {
      const res = await handle(leadRequest(coverageBody({ idempotencyKey: validUuid(10 + i) }), { headers: { 'x-vercel-forwarded-for': `198.51.100.${i + 1}` } }));
      expect(res.status).toBe(201);
    }
    const blocked = await handle(leadRequest(coverageBody({ idempotencyKey: validUuid(20) }), { headers: { 'x-vercel-forwarded-for': '198.51.100.9' } }));
    expect(blocked.status).toBe(429);
    const body = await readJson(blocked);
    expect(body.code).toBe('rate_limited');
    expect(body.retryAfterSec).toBe(3600);
    expect(String(body.waLink)).toContain('wa.me');
    expect(world.leads).toHaveLength(3);
    // the counters hold hashes, never the phone number
    expect(JSON.stringify(world.hits)).not.toContain('9876543210');
  });

  it('limits one email address too', async () => {
    const { world, handle } = setup();
    for (let i = 0; i < 3; i += 1) {
      const res = await handle(leadRequest(coverageBody({ idempotencyKey: validUuid(30 + i), phone: `98765 4${3000 + i}`, email: 'same@example.test' }), { headers: { 'x-vercel-forwarded-for': `198.51.100.${20 + i}` } }));
      expect(res.status).toBe(201);
    }
    const blocked = await handle(leadRequest(coverageBody({ idempotencyKey: validUuid(40), phone: '98765 49999', email: 'same@example.test' }), { headers: { 'x-vercel-forwarded-for': '198.51.100.30' } }));
    expect(blocked.status).toBe(429);
    expect(world.leads).toHaveLength(3);
  });

  it('limits one connection (salted IP hash) with the database counter', async () => {
    const { world, handle } = setup();
    for (let i = 0; i < 20; i += 1) {
      const res = await handle(leadRequest(coverageBody({ idempotencyKey: validUuid(50 + i), phone: `98765 5${String(1000 + i)}`, name: `Anu ${'ABCDEFGHIJKLMNOPQRST'[i]}` })));
      expect(res.status, `request ${i}`).toBe(201);
    }
    const blocked = await handle(leadRequest(coverageBody({ idempotencyKey: validUuid(90), phone: '98765 59999' })));
    expect(blocked.status).toBe(429);
    expect(world.leads).toHaveLength(20);
    // a different connection is not affected
    expect((await handle(leadRequest(coverageBody({ idempotencyKey: validUuid(91), phone: '98765 58888' }), { headers: { 'x-vercel-forwarded-for': '192.0.2.99' } }))).status).toBe(201);
  });

  it('honours the Workers Rate Limiting binding when present', async () => {
    const limit = vi.fn().mockResolvedValue({ success: false });
    const { world, handle } = setup({}, { ipLimiter: { limit } });
    const res = await handle(leadRequest(coverageBody()));
    expect(res.status).toBe(429);
    expect(limit).toHaveBeenCalledTimes(1);
    const key = (limit.mock.calls[0]?.[0] as { key: string }).key;
    expect(key).toMatch(/^k1\.[0-9a-f]{32}$/);
    expect(key).not.toContain(FAKE.ip);
    expect(world.leads).toHaveLength(0);
  });

  it('the same IPv6 /64 shares one bucket', async () => {
    const world = createWorld();
    const limit = vi.fn().mockResolvedValue({ success: true });
    const h = makeDeps(world, { ipLimiter: { limit } });
    const handle = createLeadHandler(h.deps);
    await handle(leadRequest(coverageBody({ idempotencyKey: validUuid(60) }), { headers: { 'x-vercel-forwarded-for': '2001:db8:1:2:aaaa:bbbb:cccc:dddd' } }));
    await handle(leadRequest(coverageBody({ idempotencyKey: validUuid(61), phone: '98765 40001', name: 'Meena S' }), { headers: { 'x-vercel-forwarded-for': '2001:db8:1:2:1111:2222:3333:4444' } }));
    const keys = limit.mock.calls.map((c) => (c[0] as { key: string }).key);
    expect(keys[0]).toBe(keys[1]);
  });

  it('a counter outage does not block a lead (the database insert decides)', async () => {
    const { world, handle } = setup();
    world.db.failRateStore = true;
    const res = await handle(leadRequest(coverageBody()));
    expect(res.status).toBe(201);
    expect(world.leads).toHaveLength(1);
  });
});

describe('tournament listing with the coverage box ticked', () => {
  const body = (o: Record<string, unknown> = {}) => ({
    kind: 'tournament_submission',
    name: 'Anitha R',
    organization: 'Salem District Badminton Association',
    phone: '98765 43210',
    tournamentName: 'Salem Summer Cup',
    startDate: '2026-12-20',
    district: 'Salem',
    coverageInterest: true,
    publicContactConsent: { id: CONSENT.tournamentPublicContact.id, version: CONSENT.tournamentPublicContact.version, given: true },
    idempotencyKey: validUuid(70),
    token: 'XXXX.DUMMY.TOKEN.XXXX',
    consent: { id: CONSENT.leadNotice.id, version: CONSENT.leadNotice.version },
    ...o,
  });

  it('also creates a linked coverage lead, with its own reference, once', async () => {
    const { world, handle } = setup();
    const res = await handle(leadRequest(body()));
    expect(res.status).toBe(201);
    const parent = world.leads.find((l) => l.type === 'tournament_submission') as Record<string, unknown>;
    const child = world.leads.find((l) => l.type === 'coverage') as Record<string, unknown>;
    expect(parent && child).toBeTruthy();
    expect(child.parent_lead_id).toBe(parent.id);
    expect(child.ref_code).not.toBe(parent.ref_code);
    expect(child.payload).toMatchObject({ eventName: 'Salem Summer Cup', startDate: '2026-12-20', district: 'Salem', from: 'tournament_submission' });
    expect(parent.payload).toMatchObject({ publicContactConsent: { given: true }, listingType: 'free' });
    expect(world.telegramMessages()[0]).toContain(`Also wants coverage: ${child.ref_code}`);
    // a retry does not create a second child
    await handle(leadRequest(body()));
    expect(world.leads.filter((l) => l.type === 'coverage')).toHaveLength(1);
  });

  it('without the box there is no coverage lead; a failed child never fails the listing', async () => {
    const a = setup();
    await a.handle(leadRequest(body({ coverageInterest: false })));
    expect(a.world.leads).toHaveLength(1);
    const b = setup();
    b.world.db.failChildInsert = true;
    const res = await b.handle(leadRequest(body()));
    expect(res.status).toBe(201);
    expect(b.world.leads).toHaveLength(1);
    expect(b.world.telegramMessages()[0]).toContain('Also wants coverage');
  });
});

describe('degraded modes never lose a lead silently', () => {
  it('database insert fails: 503 degraded, WhatsApp fallback with a provisional reference, owner told "NOT SAVED"', async () => {
    const { world, handle } = setup();
    world.db.failLeadInsert = true;
    const res = await handle(leadRequest(coverageBody()));
    expect(res.status).toBe(503);
    const b = await readJson(res);
    expect(b.code).toBe('degraded');
    expect(b.ref).toMatch(REF_CODE_PATTERN);
    expect(String(b.waLink)).toContain(encodeURIComponent(String(b.ref)));
    expect(b.correlationId).toMatch(/^c-[0-9a-f]{8}$/);
    expect(world.leads).toHaveLength(0);
    const msgs = world.telegramMessages();
    expect(msgs).toHaveLength(1);
    expect(msgs[0]).toContain('LEAD NOT SAVED');
    expect(msgs[0]).toContain(String(b.ref));
    // R-TELEGRAM-PHONE: by default the alert holds no contact details; the owner watches WhatsApp for the visitor's message with the reference
    expect(msgs[0]).not.toContain('wa.me');
    expect(msgs[0]).toContain('watch your WhatsApp');
  });

  it('with TELEGRAM_ALERT_PHONE_LINK=true the NOT SAVED alert carries the customer WhatsApp link', async () => {
    const { world, handle } = setup({ TELEGRAM_ALERT_PHONE_LINK: 'true' });
    world.db.failLeadInsert = true;
    await handle(leadRequest(coverageBody()));
    expect(world.telegramMessages()[0]).toContain('wa.me/919876543210');
  });

  it('database completely down: degraded, owner alerted by Telegram', async () => {
    const { world, handle } = setup();
    world.db.down = true;
    const res = await handle(leadRequest(coverageBody()));
    expect(res.status).toBe(503);
    expect((await readJson(res)).code).toBe('degraded');
    expect(world.telegramMessages().some((m) => m.includes('LEAD NOT SAVED'))).toBe(true);
  });

  it('database down AND Telegram down: still a clear degraded response with the WhatsApp link, and a log line the monitor can see', async () => {
    const { world, h, handle } = setup();
    world.db.down = true;
    world.telegram.mode = 'throw';
    const res = await handle(leadRequest(coverageBody()));
    expect(res.status).toBe(503);
    const b = await readJson(res);
    expect(b.code).toBe('degraded');
    expect(String(b.waLink)).toContain('wa.me');
    expect(h.logs.some((l) => l.outcome === 'degraded_unalerted')).toBe(true);
  });

  it('Telegram fails but the database works: the lead is saved, the visitor gets success, the row is marked alert_state=failed', async () => {
    const { world, h, handle } = setup();
    world.telegram.mode = 'fail';
    const res = await handle(leadRequest(coverageBody()));
    expect(res.status).toBe(201);
    expect(world.leads).toHaveLength(1);
    expect(world.leads[0]?.alert_state).toBe('failed');
    expect(world.leadEvents.find((e) => e.event === 'alert_failed')).toBeTruthy();
    expect(h.logs.some((l) => l.outcome === 'owner_not_alerted')).toBe(true);
  });

  it('Telegram unreachable is retried once, then marked failed', async () => {
    const { world, handle } = setup();
    world.telegram.mode = 'throw';
    await handle(leadRequest(coverageBody()));
    expect(world.callsTo('api.telegram.org')).toHaveLength(2);
    expect(world.leads[0]?.alert_state).toBe('failed');
  });

  it('with email enabled, an email alert covers a Telegram failure', async () => {
    const { world, handle } = setup({ EMAIL_ENABLED: 'true', RESEND_API_KEY: FAKE.resendKey, EMAIL_FROM: FAKE.emailFrom, OWNER_EMAIL: FAKE.ownerEmail });
    world.telegram.mode = 'fail';
    await handle(leadRequest(coverageBody()));
    expect(world.leads[0]?.alert_state).toBe('sent');
    expect(world.resendMails().some((m) => m.to === FAKE.ownerEmail)).toBe(true);
  });

  it('an unconfigured endpoint (no HMAC key, no database) is degraded with the fallback, not a crash', async () => {
    for (const missing of ['HMAC_KEY', 'SUPABASE_SECRET_KEY', 'SUPABASE_URL']) {
      const { world, handle } = setup({ [missing]: undefined });
      const res = await handle(leadRequest(coverageBody()));
      expect(res.status, missing).toBe(503);
      expect((await readJson(res)).code).toBe('degraded');
      expect(world.leads).toHaveLength(0);
    }
  });

  it('an unexpected exception becomes a `server` error with a correlation id, not a stack trace', async () => {
    const { world } = setup();
    world.fetch = (async () => {
      throw new Error(`kaboom with secret ${['sb', 'secret', 'xyz'].join('_')}`);
    }) as typeof fetch;
    const h = makeDeps(world);
    const res = await createLeadHandler({ ...h.deps, fetch: world.fetch })(leadRequest(coverageBody()));
    // all upstream calls fail: Turnstile unreachable first, which fails closed
    expect([403, 503, 500]).toContain(res.status);
    const text = await res.text();
    expect(text).not.toContain('kaboom');
    expect(text).not.toContain('sb_secret');
  });
});

describe('no personal data in logs or errors', () => {
  it('console and the structured log carry only outcomes and references', async () => {
    const spies = (['log', 'error', 'warn', 'info', 'debug'] as const).map((m) => vi.spyOn(console, m).mockImplementation(() => undefined));
    const world = createWorld();
    // use the default logger (console) on purpose
    const h = makeDeps(world);
    const handler = createLeadHandler({ ...h.deps, log: undefined });
    await handler(leadRequest(coverageBody({ name: 'Ravi Kumar', email: 'ravi.private@example.test', notes: 'secret note text' })));
    world.db.failLeadInsert = true;
    await handler(leadRequest(coverageBody({ idempotencyKey: validUuid(80), phone: '99887 76655', name: 'Meena Private' })));
    world.telegram.mode = 'throw';
    await handler(leadRequest(coverageBody({ idempotencyKey: validUuid(81), phone: '99887 76644', name: 'Karthik Private' }), { headers: { 'x-vercel-forwarded-for': '203.0.113.99' } }));
    await handler(leadRequest(coverageBody({ name: 'www.evil.com', phone: '12' })));
    const logged = spies.flatMap((s) => s.mock.calls.map((c) => c.map(String).join(' '))).join('\n');
    expect(logged.length).toBeGreaterThan(0);
    for (const forbidden of ['Ravi', 'Kumar', 'Meena', 'Karthik', 'Private', '9876543210', '919876543210', '9988776655', 'ravi.private', 'example.test', 'secret note', FAKE.ip, '203.0.113', FAKE.turnstileSecret, FAKE.telegramToken, FAKE.supabaseSecret, 'XXXX.DUMMY', 'evil.com', 'api.telegram.org', 'bot123456789']) {
      expect(logged, forbidden).not.toContain(forbidden);
    }
    for (const line of logged.split('\n')) expect(() => JSON.parse(line)).not.toThrow();
  });

  it('error responses never contain the secret key, the token, or raw database details', async () => {
    const { world, handle } = setup();
    world.db.failLeadInsert = true;
    const text = await (await handle(leadRequest(coverageBody()))).text();
    for (const forbidden of [FAKE.supabaseSecret, FAKE.telegramToken, FAKE.turnstileSecret, 'XX000', 'boom', '9876543210']) expect(text).not.toContain(forbidden);
  });

  it('a unique-violation error from the database (which echoes values) is reduced to a code', async () => {
    const { world, h, handle } = setup();
    world.db.refCollisions = 10; // every attempt collides: the response must not echo the "details" text
    const res = await handle(leadRequest(coverageBody()));
    const text = JSON.stringify(await readJson(res)) + JSON.stringify(h.logs);
    expect(text).not.toContain('already exists');
    expect(text).not.toContain('919876543210');
  });
});

describe('determinism helpers', () => {
  it('seqRandom never repeats a pair of 6-byte draws in a short run', () => {
    const r = seqRandom(3);
    const seen = new Set<string>();
    for (let i = 0; i < 200; i += 1) seen.add(Array.from(r(6)).join(','));
    expect(seen.size).toBe(200);
  });
});
