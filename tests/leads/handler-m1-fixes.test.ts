// Regression tests for the M1 review-fix wave (backend group): S-3, S-6, B-3, B-4, B-6, B-18 (handler side), C-10, R-ELAPSED,
// R-DATE. Each describe names the finding it keeps fixed. Fake services only (tests/leads/helpers.ts).
import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { CONSENT } from '../../src/content/consent';
import { ELAPSED_MS_MAX, addDaysToDate, istToday } from '../../src/lib/contracts/lead-constants';
import { validateLeadRequest } from '../../src/lib/contracts/lead';
import { createLeadHandler } from '../../src/lib/leads/handler';
import { DEFAULT_GLOBAL_LEADS_PER_HOUR, GLOBAL_BUCKET } from '../../src/lib/security/ratelimit';
import { parseHmacKey, pseudonym } from '../../src/lib/security/hash';
import { buildLeadConfig } from '../../src/lib/leads/config';
import { coverageBody, createWorld, FAKE, leadRequest, makeDeps, NOW, readJson, validUuid } from './helpers';

const setup = (envOverrides: Record<string, string | undefined> = {}, depsOverrides = {}) => {
  const world = createWorld();
  const h = makeDeps(world, depsOverrides, envOverrides);
  const handle = createLeadHandler(h.deps);
  return { world, h, handle };
};
const ip = (n: number) => ({ 'x-vercel-forwarded-for': `198.51.100.${n}` });
const sha256 = (text: string) => createHash('sha256').update(text, 'utf8').digest('hex');

describe('B-3: a JSON body that is not an object is a 400 validation error, never a 500', () => {
  for (const raw of ['null', '[]', '[{"kind":"coverage"}]', '"x"', '123', 'true', '0']) {
    it(raw, async () => {
      const { world, h, handle } = setup();
      const res = await handle(leadRequest(null, { rawBody: raw }));
      expect(res.status).toBe(400);
      const body = await readJson(res);
      expect(body).toMatchObject({ ok: false, code: 'validation', fieldErrors: { _: 'invalid' } });
      expect(h.logs.some((l) => l.outcome === 'exception')).toBe(false);
      expect(world.calls).toHaveLength(0);
    });
  }
});

describe('S-3: the byte cap is enforced while the stream is read (no Content-Length needed)', () => {
  function endlessBody(chunkBytes: number, chunks: number) {
    const state = { pulled: 0 };
    const stream = new ReadableStream<Uint8Array>({
      pull(controller) {
        state.pulled += 1;
        if (state.pulled > chunks) return controller.close();
        controller.enqueue(new Uint8Array(chunkBytes).fill(0x20));
      },
    });
    return { state, stream };
  }
  const streamed = (path: string, stream: ReadableStream<Uint8Array>, contentType = 'application/json') =>
    new Request(`${FAKE.origin}${path}`, { method: 'POST', headers: { 'content-type': contentType, origin: FAKE.origin }, body: stream, duplex: 'half' } as RequestInit);

  it('POST /api/lead: a chunked 50 MiB upload with no Content-Length stops after the first chunk past the cap', async () => {
    const { handle, world } = setup();
    const { state, stream } = endlessBody(1024 * 1024, 50);
    const res = await handle(streamed('/api/lead', stream));
    expect(res.status).toBe(413);
    expect(state.pulled).toBeLessThanOrEqual(3);
    expect(world.calls).toHaveLength(0);
  });

  it('a body just under the cap is still accepted and parsed', async () => {
    const { handle } = setup();
    const filler = 'x'.repeat(100);
    const res = await handle(leadRequest(coverageBody({ notes: filler })));
    expect(res.status).toBe(201);
  });
});

describe('B-4 / R-ELAPSED: elapsedMs is clamped, never a reason to reject', () => {
  it('the contract clamps into 0..86,400,000 and treats a non-integer as 0', () => {
    const elapsed = (v: unknown) => {
      const r = validateLeadRequest(coverageBody({ elapsedMs: v }), { now: NOW });
      expect(r.ok, JSON.stringify(v)).toBe(true);
      return r.ok ? r.data.elapsedMs : 'rejected';
    };
    expect(ELAPSED_MS_MAX).toBe(86_400_000);
    expect(elapsed(90_000_000)).toBe(ELAPSED_MS_MAX);
    expect(elapsed(86_400_001)).toBe(ELAPSED_MS_MAX);
    expect(elapsed(86_400_000)).toBe(ELAPSED_MS_MAX);
    expect(elapsed(4000)).toBe(4000);
    expect(elapsed(0)).toBe(0);
    expect(elapsed(-5)).toBe(0);
    expect(elapsed(1500.5)).toBe(0);
    expect(elapsed('5000')).toBe(0);
    expect(elapsed({})).toBe(0);
    expect(elapsed(1e30)).toBe(ELAPSED_MS_MAX);
    expect(elapsed(null)).toBeUndefined();
    expect(elapsed(undefined)).toBeUndefined();
  });

  it('a form left open for days still sends: 201, not a 422 on an internal field', async () => {
    const { handle, world } = setup();
    const res = await handle(leadRequest(coverageBody({ elapsedMs: 3 * ELAPSED_MS_MAX })));
    expect(res.status).toBe(201);
    expect(world.leads).toHaveLength(1);
  });

  it('a fractional or negative value counts as 0 (too fast: a retry is asked for, no field error)', async () => {
    const { handle } = setup();
    for (const v of [1500.5, -1, 'abc']) {
      const res = await handle(leadRequest(coverageBody({ elapsedMs: v })));
      expect(res.status, String(v)).toBe(429);
      expect((await readJson(res)).code).toBe('rate_limited');
    }
  });
});

describe('B-6: per-phone and per-email hits are recorded only for stored leads', () => {
  it('three degraded failures do not lock the visitor out once the database is back', async () => {
    const { world, handle } = setup();
    world.db.failLeadInsert = true;
    for (let i = 0; i < 3; i += 1) {
      const res = await handle(leadRequest(coverageBody({ idempotencyKey: validUuid(300 + i), email: 'ravi@example.test' }), { headers: ip(i + 1) }));
      expect(res.status).toBe(503);
    }
    expect(world.hits.filter((h) => h.bucket === 'lead_phone' || h.bucket === 'lead_email' || h.bucket === GLOBAL_BUCKET)).toHaveLength(0);
    world.db.failLeadInsert = false;
    const ok = await handle(leadRequest(coverageBody({ idempotencyKey: validUuid(310), email: 'ravi@example.test' }), { headers: ip(9) }));
    expect(ok.status).toBe(201);
    const buckets = world.hits.map((h) => h.bucket).sort();
    expect(buckets).toContain('lead_phone');
    expect(buckets).toContain('lead_email');
    expect(buckets).toContain(GLOBAL_BUCKET);
  });

  it('a stored lead records one phone, one email and one global hit, as hashes only', async () => {
    const { world, handle } = setup();
    await handle(leadRequest(coverageBody({ email: 'ravi@example.test' })));
    for (const bucket of ['lead_phone', 'lead_email', GLOBAL_BUCKET, 'lead_ip']) expect(world.hits.filter((h) => h.bucket === bucket), bucket).toHaveLength(1);
    expect(JSON.stringify(world.hits)).not.toMatch(/9876543210|ravi@example/);
  });

  it('a replay, a refused request and a validation error record nothing new', async () => {
    const { world, handle } = setup();
    await handle(leadRequest(coverageBody({ email: 'ravi@example.test' })));
    const before = world.hits.length;
    expect((await handle(leadRequest(coverageBody({ email: 'ravi@example.test' })))).status).toBe(200); // replay
    await handle(leadRequest(coverageBody({ name: '' })));
    const contactHits = world.hits.filter((h) => h.bucket !== 'lead_ip');
    expect(contactHits).toHaveLength(3); // phone, email, global: exactly one of each
    expect(world.hits.length - before).toBeLessThanOrEqual(1); // at most the replay's own per-connection hit
  });

  it('retryAfterSec says when the OLDEST counted hit leaves the window, not the whole window', async () => {
    const { world, handle } = setup();
    const hmac = parseHmacKey(FAKE.hmacKey) as NonNullable<ReturnType<typeof parseHmacKey>>;
    const phoneKey = await pseudonym(hmac, 'phone', '919876543210');
    for (const secondsAgo of [3590, 1200, 600]) world.hits.push({ bucket: 'lead_phone', key_hash: phoneKey, hit_at: new Date(NOW.getTime() - secondsAgo * 1000).toISOString() });
    const res = await handle(leadRequest(coverageBody()));
    expect(res.status).toBe(429);
    const body = await readJson(res);
    expect(body.retryAfterSec).toBe(10);
    expect(res.headers.get('retry-after')).toBe('10');
  });

  it('the daily cap gives the wait until the oldest hit of the day leaves (hours, not a fixed 24 hours)', async () => {
    const { world, handle } = setup();
    const hmac = parseHmacKey(FAKE.hmacKey) as NonNullable<ReturnType<typeof parseHmacKey>>;
    const phoneKey = await pseudonym(hmac, 'phone', '919876543210');
    for (let i = 0; i < 8; i += 1) world.hits.push({ bucket: 'lead_phone', key_hash: phoneKey, hit_at: new Date(NOW.getTime() - (86_000 - i * 5000) * 1000).toISOString() });
    const body = await readJson(await handle(leadRequest(coverageBody())));
    expect(body.code).toBe('rate_limited');
    expect(body.retryAfterSec).toBe(400);
  });
});

describe('S-6: global circuit breaker and email aliases', () => {
  const lead = (n: number, over: Record<string, unknown> = {}) =>
    leadRequest(coverageBody({ idempotencyKey: validUuid(400 + n), phone: `98765 4${String(2000 + n)}`, name: `Anu ${String.fromCharCode(65 + n)}`, ...over }), { headers: ip(n + 1) });

  it('the default cap is a named constant and the env override is a plain whole number', () => {
    expect(buildLeadConfig({}).globalHourlyCap).toBe(DEFAULT_GLOBAL_LEADS_PER_HOUR);
    expect(buildLeadConfig({ LEAD_GLOBAL_HOURLY_CAP: '7' }).globalHourlyCap).toBe(7);
    for (const bad of ['0', '-3', 'abc', '1.5', '99999999', ' ', '']) expect(buildLeadConfig({ LEAD_GLOBAL_HOURLY_CAP: bad }).globalHourlyCap, JSON.stringify(bad)).toBe(DEFAULT_GLOBAL_LEADS_PER_HOUR);
  });

  it('after the cap, new enquiries are refused (429, WhatsApp fallback), Turnstile is not called, and the owner gets ONE flood notice', async () => {
    const { world, handle } = setup({ LEAD_GLOBAL_HOURLY_CAP: '3' });
    for (let i = 0; i < 3; i += 1) expect((await handle(lead(i))).status).toBe(201);
    const turnstileBefore = world.callsTo('challenges.cloudflare.com').length;
    const telegramBefore = world.telegramMessages().length;
    for (let i = 3; i < 6; i += 1) {
      const res = await handle(lead(i));
      expect(res.status).toBe(429);
      const body = await readJson(res);
      expect(body.code).toBe('rate_limited');
      expect(String(body.waLink)).toContain('wa.me');
      expect(body.retryAfterSec).toBeGreaterThan(0);
      expect(body.retryAfterSec).toBeLessThanOrEqual(3600);
    }
    expect(world.leads).toHaveLength(3);
    expect(world.callsTo('challenges.cloudflare.com')).toHaveLength(turnstileBefore);
    const notices = world.telegramMessages().slice(telegramBefore);
    expect(notices).toHaveLength(1);
    expect(notices[0]).toContain('FLOOD PROTECTION IS ON');
    expect(notices[0]).not.toMatch(/\d{10}/); // no visitor data
  });

  it('a retry of an already stored enquiry is still answered while the breaker is on (replay)', async () => {
    const { handle } = setup({ LEAD_GLOBAL_HOURLY_CAP: '1' });
    expect((await handle(lead(0))).status).toBe(201);
    expect((await handle(lead(1))).status).toBe(429);
    const replay = await handle(lead(0));
    expect(replay.status).toBe(200);
    expect((await readJson(replay)).replay).toBe(true);
  });

  it('the breaker lifts when the hour has passed', async () => {
    const world = createWorld();
    let clock = NOW;
    const h = makeDeps(world, { now: () => clock }, { LEAD_GLOBAL_HOURLY_CAP: '2' });
    const handle = createLeadHandler(h.deps);
    expect((await handle(lead(0))).status).toBe(201);
    expect((await handle(lead(1))).status).toBe(201);
    expect((await handle(lead(2))).status).toBe(429);
    clock = new Date(NOW.getTime() + 61 * 60_000);
    expect((await handle(lead(2))).status).toBe(201);
  });

  it('aliases of one mailbox (plus tags, Gmail dots, googlemail) share one per-email limit', async () => {
    const { world, handle } = setup();
    const aliases = ['victim+1@gmail.com', 'v.ictim@gmail.com', 'victim+3@googlemail.com'];
    for (const [i, email] of aliases.entries()) expect((await handle(lead(i, { email }))).status, email).toBe(201);
    const blocked = await handle(lead(3, { email: 'vic.tim+4@gmail.com' }));
    expect(blocked.status).toBe(429);
    expect(world.leads).toHaveLength(3);
    // a different mailbox is unaffected; a provider where dots matter keeps them apart
    expect((await handle(lead(4, { email: 'someone.else@gmail.com' }))).status).toBe(201);
    expect((await handle(lead(5, { email: 'a.b@example.test' }))).status).toBe(201);
    expect((await handle(lead(6, { email: 'ab@example.test' }))).status).toBe(201);
  });

  it('counters being down never blocks a lead and never throws', async () => {
    const { world, handle } = setup({ LEAD_GLOBAL_HOURLY_CAP: '1' });
    world.db.failRateStore = true;
    for (let i = 0; i < 3; i += 1) expect((await handle(lead(i))).status).toBe(201);
  });
});

describe('C-10 (D-028): consent evidence is recorded per lead', () => {
  it('writes the notice text with its SHA-256 once and an append-only event with id, version, hash (and no IP hash)', async () => {
    const { world, handle } = setup();
    const res = await handle(leadRequest(coverageBody()));
    expect(res.status).toBe(201);
    const lead = world.leads[0] as Record<string, unknown>;
    expect(world.noticeVersions).toEqual([
      { id: CONSENT.leadNotice.id, version: CONSENT.leadNotice.version, sha256: sha256(CONSENT.leadNotice.text), text: CONSENT.leadNotice.text },
    ]);
    expect(world.consentEvents).toHaveLength(1);
    expect(world.consentEvents[0]).toMatchObject({
      lead_id: lead.id,
      notice_id: CONSENT.leadNotice.id,
      notice_version: CONSENT.leadNotice.version,
      notice_sha256: sha256(CONSENT.leadNotice.text),
      given: true,
      channel: 'web_form',
    });
    expect(world.consentEvents[0]).not.toHaveProperty('ip_hash'); // N-4: the evidence row holds no IP hash (the leads row does)
    expect(String(world.leads[0]?.ip_hash)).toMatch(/^k1.[0-9a-f]{32}$/);
    expect(JSON.stringify(world.consentEvents)).not.toContain(FAKE.ip);
    // a second lead does not duplicate the notice row
    await handle(leadRequest(coverageBody({ idempotencyKey: validUuid(501), phone: '98765 40001', name: 'Meena S' }), { headers: ip(5) }));
    expect(world.noticeVersions).toHaveLength(1);
    expect(world.consentEvents).toHaveLength(2);
  });

  it('a version this server does not know (an old open tab) is recorded as supplied, with no hash', async () => {
    const { world, handle } = setup();
    const res = await handle(leadRequest(coverageBody({ consent: { id: CONSENT.leadNotice.id, version: '2020-01-01-old' } })));
    expect(res.status).toBe(201);
    expect(world.consentEvents[0]).toMatchObject({ notice_version: '2020-01-01-old', notice_sha256: null, given: true });
    expect(world.noticeVersions).toHaveLength(0);
  });

  it('a tournament listing records the public-contact box (given or not) and the linked coverage lead gets its own event', async () => {
    const body = (given: boolean) => ({
      kind: 'tournament_submission',
      name: 'Anitha R',
      phone: '98765 43210',
      tournamentName: 'Salem Summer Cup',
      startDate: '2026-12-20',
      coverageInterest: true,
      publicContactConsent: { id: CONSENT.tournamentPublicContact.id, version: CONSENT.tournamentPublicContact.version, given },
      idempotencyKey: validUuid(520),
      token: 'XXXX.DUMMY.TOKEN.XXXX',
      consent: { id: CONSENT.leadNotice.id, version: CONSENT.leadNotice.version },
    });
    for (const given of [true, false]) {
      const { world, handle } = setup();
      expect((await handle(leadRequest(body(given)))).status).toBe(201);
      const parent = world.leads.find((l) => l.type === 'tournament_submission') as Record<string, unknown>;
      const child = world.leads.find((l) => l.type === 'coverage') as Record<string, unknown>;
      const forParent = world.consentEvents.filter((e) => e.lead_id === parent.id);
      expect(forParent.map((e) => [e.notice_id, e.given]).sort()).toEqual([[CONSENT.leadNotice.id, true], [CONSENT.tournamentPublicContact.id, given]].sort());
      expect(world.consentEvents.filter((e) => e.lead_id === child.id)).toHaveLength(1);
      expect(world.noticeVersions.map((n) => n.id).sort()).toEqual([CONSENT.leadNotice.id, CONSENT.tournamentPublicContact.id].sort());
    }
  });

  it('a failure to write the evidence never fails the visitor; it is logged for the owner (no personal data)', async () => {
    const { world, h, handle } = setup();
    world.db.failConsent = true;
    const res = await handle(leadRequest(coverageBody()));
    expect(res.status).toBe(201);
    expect(world.leads).toHaveLength(1);
    expect(h.logs.some((l) => l.outcome === 'consent_unrecorded')).toBe(true);
    expect(JSON.stringify(h.logs)).not.toMatch(/Ravi|9876543210/);
  });

  it('nothing is recorded for a refused or not-stored enquiry (no lead, no evidence)', async () => {
    const { world, handle } = setup();
    world.db.failLeadInsert = true;
    await handle(leadRequest(coverageBody()));
    await handle(leadRequest(coverageBody({ name: '' })));
    expect(world.consentEvents).toHaveLength(0);
    expect(world.noticeVersions).toHaveLength(0);
  });
});

describe('B-18 / R-DATE through the handler', () => {
  it('a start date before yesterday (IST) or more than 1,095 days ahead is a 422 with its own code', async () => {
    const { world, handle } = setup();
    const today = istToday(NOW);
    expect(today).toBe('2026-11-02');
    const tooOld = addDaysToDate(today, -2);
    const tooFar = addDaysToDate(today, 1096);
    for (const startDate of [tooOld, tooFar, '2000-01-01', '2001-05-05']) {
      const res = await handle(leadRequest(coverageBody({ startDate })));
      expect(res.status, startDate).toBe(422);
      expect((await readJson(res)).fieldErrors).toEqual({ startDate: 'date_out_of_range' });
    }
    expect(world.calls).toHaveLength(0);
    for (const [i, startDate] of [addDaysToDate(today, -1), today, addDaysToDate(today, 1095)].entries()) {
      const res = await handle(leadRequest(coverageBody({ startDate, idempotencyKey: validUuid(600 + i), phone: `98765 4${3000 + i}`, name: `Anu ${'ABC'[i]}` }), { headers: ip(i + 1) }));
      expect(res.status, startDate).toBe(201);
    }
  });
});
