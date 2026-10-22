// Follow-up fixes N-5 / N-2 / N-3: the global hourly and daily breakers and the per-phone and per-email counters RESERVE their slot
// at check time (the hit is recorded first, counted, and given back when the request does not end with a stored lead), so a
// parallel burst cannot get past a cap. Concurrency is exercised with Promise.all against the mocked store.
import { describe, expect, it, vi } from 'vitest';
import { CONSENT } from '../../src/content/consent';
import { createLeadHandler } from '../../src/lib/leads/handler';
import { ACK_STOP_AFTER_PER_DAY, DEFAULT_GLOBAL_LEADS_PER_DAY, GLOBAL_BUCKET } from '../../src/lib/security/ratelimit';
import { buildLeadConfig } from '../../src/lib/leads/config';
import { coverageBody, createWorld, FAKE, jitter, leadRequest, makeDeps, NOW, readJson, validUuid } from './helpers';

// The jittered bursts take about a second on an idle machine; leave room for a busy one (the whole suite runs on many workers).
vi.setConfig({ testTimeout: 30_000 });

const setup = (envOverrides: Record<string, string | undefined> = {}, depsOverrides = {}) => {
  const world = createWorld();
  const h = makeDeps(world, depsOverrides, envOverrides);
  const handle = createLeadHandler(h.deps);
  return { world, h, handle };
};
/** Same, with every database call delayed by 0 to 4 ms (seeded), so concurrent requests overlap in many different orders. */
const setupJitter = (envOverrides: Record<string, string | undefined> = {}, seed = 7) => {
  const s = setup(envOverrides);
  s.world.delayMs = jitter(4, seed);
  return s;
};
/** The n-th distinct visitor: own idempotency key, phone and connection. */
const lead = (n: number, over: Record<string, unknown> = {}, headers: Record<string, string> = {}) =>
  leadRequest(coverageBody({ idempotencyKey: validUuid(700 + n), phone: `98765 4${String(5000 + n)}`, name: `Anu ${String.fromCharCode(65 + (n % 26))}`, ...over }), {
    headers: { 'x-vercel-forwarded-for': `203.0.${Math.floor(n / 200)}.${(n % 200) + 1}`, ...headers },
  });
const hitsIn = (world: ReturnType<typeof createWorld>, bucket: string) => world.hits.filter((h) => h.bucket === bucket);
const statuses = async (responses: Promise<Response>[]) => (await Promise.all(responses)).map((r) => r.status);

describe('N-5 / N-2: the global hourly breaker holds under a parallel burst', () => {
  it('cap 3, 12 concurrent enquiries: never more than 3 are stored (before the fix all 12 were)', async () => {
    const { world, handle } = setup({ LEAD_GLOBAL_HOURLY_CAP: '3' });
    const codes = await statuses(Array.from({ length: 12 }, (_, i) => handle(lead(i))));
    const stored = codes.filter((c) => c === 201).length;
    expect(stored).toBeLessThanOrEqual(3);
    expect(world.leads).toHaveLength(stored);
    expect(codes.every((c) => c === 201 || c === 429)).toBe(true);
    expect(hitsIn(world, GLOBAL_BUCKET)).toHaveLength(stored); // every refused request gave its reservation back
  });

  it('the same burst with the database answering in different orders (6 seeds): the cap is never exceeded', async () => {
    for (let seed = 1; seed <= 6; seed += 1) {
      const { world, handle } = setupJitter({ LEAD_GLOBAL_HOURLY_CAP: '3' }, seed);
      const codes = await statuses(Array.from({ length: 12 }, (_, i) => handle(lead(i))));
      const stored = codes.filter((c) => c === 201).length;
      expect(stored, 'seed ' + seed).toBeLessThanOrEqual(3);
      expect(world.leads, 'seed ' + seed).toHaveLength(stored);
      expect(hitsIn(world, GLOBAL_BUCKET), 'seed ' + seed).toHaveLength(stored);
    }
  });

  it('a burst that fits under the cap is admitted in full (no over-refusal below the cap)', async () => {
    const { world, handle } = setup({ LEAD_GLOBAL_HOURLY_CAP: '12' });
    const codes = await statuses(Array.from({ length: 12 }, (_, i) => handle(lead(i))));
    expect(codes.filter((c) => c === 201)).toHaveLength(12);
    expect(hitsIn(world, GLOBAL_BUCKET)).toHaveLength(12);
  });

  it('after a burst, slots come back as the refused give theirs up: the next sequential enquiries fill the cap exactly', async () => {
    const { world, handle } = setup({ LEAD_GLOBAL_HOURLY_CAP: '3' });
    await Promise.all(Array.from({ length: 12 }, (_, i) => handle(lead(i))));
    const before = world.leads.length;
    let more = 0;
    for (let i = 100; i < 106; i += 1) if ((await handle(lead(i))).status === 201) more += 1;
    expect(before + more).toBe(3);
    expect(world.leads).toHaveLength(3);
    expect(hitsIn(world, GLOBAL_BUCKET)).toHaveLength(3);
  });

  it('reservations are separate rows even when every hit has the same timestamp (a release removes exactly one)', async () => {
    const { world, handle } = setup({ LEAD_GLOBAL_HOURLY_CAP: '2' });
    await Promise.all(Array.from({ length: 8 }, (_, i) => handle(lead(i))));
    const ids = world.hits.filter((h) => ['lead_all', 'lead_phone', 'lead_email'].includes(String(h.bucket))).map((h) => h.id); // the reservations
    expect(new Set(ids).size).toBe(ids.length);
    expect(ids.every((id) => typeof id === 'string' && id.length > 0)).toBe(true);
  });
});

describe('N-3: a DAILY global cap (default 100) next to the hourly one', () => {
  it('the daily default is 100 and is tunable with LEAD_GLOBAL_DAILY_CAP', () => {
    expect(DEFAULT_GLOBAL_LEADS_PER_DAY).toBe(100);
    expect(buildLeadConfig({}).globalDailyCap).toBe(100);
    expect(buildLeadConfig({ LEAD_GLOBAL_DAILY_CAP: '30' }).globalDailyCap).toBe(30);
    for (const bad of ['0', '-1', 'abc', '2.5', '99999999', ' ', '']) expect(buildLeadConfig({ LEAD_GLOBAL_DAILY_CAP: bad }).globalDailyCap, JSON.stringify(bad)).toBe(100);
  });

  it('daily cap 5 with a high hourly cap: 12 concurrent enquiries store at most 5', async () => {
    const { world, handle } = setup({ LEAD_GLOBAL_HOURLY_CAP: '100', LEAD_GLOBAL_DAILY_CAP: '5' });
    const codes = await statuses(Array.from({ length: 12 }, (_, i) => handle(lead(i))));
    expect(codes.filter((c) => c === 201).length).toBeLessThanOrEqual(5);
    expect(world.leads).toHaveLength(codes.filter((c) => c === 201).length);
  });

  it('when the DAY cap trips the owner notice says so (one notice, no visitor data)', async () => {
    const { world, handle } = setup({ LEAD_GLOBAL_HOURLY_CAP: '100', LEAD_GLOBAL_DAILY_CAP: '2' });
    for (let i = 0; i < 2; i += 1) expect((await handle(lead(i))).status).toBe(201);
    const before = world.telegramMessages().length;
    for (let i = 2; i < 5; i += 1) expect((await handle(lead(i))).status).toBe(429);
    const notices = world.telegramMessages().slice(before);
    expect(notices).toHaveLength(1);
    expect(notices[0]).toContain('more than 2 enquiries were saved in the last day');
  });

  it('the hour window passes but the day window still refuses; the wait is the time until the oldest of the day leaves', async () => {
    const world = createWorld();
    let clock = NOW;
    const h = makeDeps(world, { now: () => clock }, { LEAD_GLOBAL_HOURLY_CAP: '100', LEAD_GLOBAL_DAILY_CAP: '4' });
    const handle = createLeadHandler(h.deps);
    for (let i = 0; i < 4; i += 1) {
      expect((await handle(lead(i))).status).toBe(201);
      clock = new Date(clock.getTime() + 20 * 60_000); // one every 20 minutes: never more than 3 in an hour
    }
    const refused = await handle(lead(10));
    expect(refused.status).toBe(429);
    const body = await readJson(refused);
    expect(body.code).toBe('rate_limited');
    // the oldest of the four was stored at NOW; the clock is now NOW + 80 min: it leaves the 24 h window in 24 h - 80 min
    expect(body.retryAfterSec).toBe(86_400 - 80 * 60);
    clock = new Date(NOW.getTime() + 24 * 3600_000 + 1000);
    expect((await handle(lead(11))).status).toBe(201);
  });
});

describe('N-2: the per-phone and per-email counters hold under a parallel burst', () => {
  it('8 concurrent enquiries with one phone (3 an hour): at most 3 stored, no leaked reservations', async () => {
    for (let seed = 1; seed <= 6; seed += 1) {
      const j = setupJitter({}, seed);
      const codes = await statuses(Array.from({ length: 8 }, (_, i) => j.handle(lead(i, { phone: '98765 43210' }))));
      const stored = codes.filter((c) => c === 201).length;
      expect(stored, 'seed ' + seed).toBeLessThanOrEqual(3);
      expect(hitsIn(j.world, 'lead_phone'), 'seed ' + seed).toHaveLength(stored);
    }
    const { world, handle } = setup();
    const codes = await statuses(Array.from({ length: 8 }, (_, i) => handle(lead(i, { phone: '98765 43210' }))));
    const stored = codes.filter((c) => c === 201).length;
    expect(stored).toBeLessThanOrEqual(3);
    expect(world.leads).toHaveLength(stored);
    expect(hitsIn(world, 'lead_phone')).toHaveLength(stored);
    expect(hitsIn(world, GLOBAL_BUCKET)).toHaveLength(stored); // a refusal on the phone also gives back the global slot
  });

  it('8 concurrent enquiries with one mailbox (aliases included): at most 3 stored', async () => {
    const { world, handle } = setup();
    const aliases = ['v.ictim@gmail.com', 'victim+1@gmail.com', 'victim@gmail.com', 'victim+2@googlemail.com', 'v.i.c.t.i.m@gmail.com', 'victim+3@gmail.com', 'victim+4@gmail.com', 'victim+5@gmail.com'];
    for (let seed = 1; seed <= 6; seed += 1) {
      const j = setupJitter({}, seed);
      const c = await statuses(aliases.map((email, i) => j.handle(lead(i, { email }))));
      expect(c.filter((x) => x === 201).length, 'seed ' + seed).toBeLessThanOrEqual(3);
    }
    const codes = await statuses(aliases.map((email, i) => handle(lead(i, { email }))));
    const stored = codes.filter((c) => c === 201).length;
    expect(stored).toBeLessThanOrEqual(3);
    expect(hitsIn(world, 'lead_email')).toHaveLength(stored);
    expect(hitsIn(world, GLOBAL_BUCKET)).toHaveLength(stored);
  });

  it('a double tap (two identical requests at once) stores one lead and keeps exactly one reservation of each kind', async () => {
    const { world, handle } = setup();
    const same = () => leadRequest(coverageBody({ email: 'ravi@example.test' }));
    const codes = await statuses([handle(same()), handle(same())]);
    expect(world.leads).toHaveLength(1);
    expect(codes.filter((c) => c === 201)).toHaveLength(1);
    for (const bucket of ['lead_phone', 'lead_email', GLOBAL_BUCKET]) expect(hitsIn(world, bucket), bucket).toHaveLength(1);
  });
});

describe('B-6 still holds: a lead that is not stored never keeps a reservation', () => {
  it('12 concurrent enquiries while the insert fails: all 503, no phone, email or global hit left; the visitor is not locked out afterwards', async () => {
    const { world, handle } = setup({ LEAD_GLOBAL_HOURLY_CAP: '3' });
    world.db.failLeadInsert = true;
    const codes = await statuses(Array.from({ length: 12 }, (_, i) => handle(lead(i, { phone: '98765 43210', email: 'ravi@example.test' }))));
    expect(codes.every((c) => c === 503 || c === 429)).toBe(true);
    expect(world.leads).toHaveLength(0);
    for (const bucket of ['lead_phone', 'lead_email', GLOBAL_BUCKET]) expect(hitsIn(world, bucket), bucket).toHaveLength(0);
    world.db.failLeadInsert = false;
    const ok = await handle(lead(50, { phone: '98765 43210', email: 'ravi@example.test' }));
    expect(ok.status).toBe(201);
  });

  it('sequential degraded failures leave nothing behind either', async () => {
    const { world, handle } = setup();
    world.db.failLeadInsert = true;
    for (let i = 0; i < 3; i += 1) expect((await handle(lead(i, { phone: '98765 43210' }))).status).toBe(503);
    expect(world.hits.filter((h) => h.bucket !== 'lead_ip')).toHaveLength(0);
  });

  it('a Turnstile failure reserves nothing (unauthenticated requests cannot trip a breaker)', async () => {
    const { world, handle } = setup({ LEAD_GLOBAL_HOURLY_CAP: '2' });
    world.turnstile.mode = 'fail';
    await Promise.all(Array.from({ length: 10 }, (_, i) => handle(lead(i))));
    expect(world.hits.filter((h) => h.bucket !== 'lead_ip')).toHaveLength(0);
    world.turnstile.mode = 'pass';
    expect((await handle(lead(20))).status).toBe(201);
  });

  it('the child coverage lead of a tournament listing does not take a second slot', async () => {
    const { world, handle } = setup({ LEAD_GLOBAL_HOURLY_CAP: '1' });
    const res = await handle(
      leadRequest({
        kind: 'tournament_submission',
        name: 'Anitha R',
        phone: '98765 43210',
        tournamentName: 'Salem Summer Cup',
        startDate: '2026-12-20',
        coverageInterest: true,
        idempotencyKey: validUuid(900),
        token: 'XXXX.DUMMY.TOKEN.XXXX',
        consent: { id: CONSENT.leadNotice.id, version: CONSENT.leadNotice.version },
      }),
    );
    expect(res.status).toBe(201);
    expect(world.leads).toHaveLength(2);
    expect(hitsIn(world, GLOBAL_BUCKET)).toHaveLength(1);
  });

  it('a counter that fails while reserving never blocks a lead (fail open) and leaves no reservation behind', async () => {
    const { world, handle } = setup({ LEAD_GLOBAL_HOURLY_CAP: '1' });
    world.db.failRateStore = true;
    for (let i = 0; i < 3; i += 1) expect((await handle(lead(i))).status).toBe(201);
    expect(world.hits).toHaveLength(0);
  });
});

describe('N-3: acknowledgement mails stop once the day count passes 80 (the owner alert stays)', () => {
  const EMAIL_ON = { EMAIL_ENABLED: 'true', RESEND_API_KEY: FAKE.resendKey, EMAIL_FROM: FAKE.emailFrom, OWNER_EMAIL: FAKE.ownerEmail };
  const seedDay = (world: ReturnType<typeof createWorld>, n: number) => {
    for (let i = 0; i < n; i += 1) world.hits.push({ id: `seed-${i}`, bucket: GLOBAL_BUCKET, key_hash: 'all', hit_at: new Date(NOW.getTime() - 2 * 3600_000 - i * 60_000).toISOString() }); // 2 to 3.5 hours ago: inside the day, outside the hour
  };

  it('the threshold is a named constant of 80', () => {
    expect(ACK_STOP_AFTER_PER_DAY).toBe(80);
  });

  it('with 79 earlier enquiries today (80 with this one) the customer still gets the acknowledgement', async () => {
    const { world, handle } = setup(EMAIL_ON);
    seedDay(world, 79);
    expect((await handle(lead(1, { email: 'ravi@example.test' }))).status).toBe(201);
    expect(world.resendMails().map((m) => m.to).sort()).toEqual(['ravi@example.test', FAKE.ownerEmail].sort());
  });

  it('with 80 earlier enquiries today (81 with this one) the acknowledgement is skipped but the owner is still alerted by Telegram and email', async () => {
    const { world, handle } = setup(EMAIL_ON);
    seedDay(world, 80);
    const res = await handle(lead(2, { email: 'ravi@example.test' }));
    expect(res.status).toBe(201);
    expect(world.resendMails().map((m) => m.to)).toEqual([FAKE.ownerEmail]);
    expect(world.telegramMessages()).toHaveLength(1);
    expect(world.leads[0]?.alert_state).toBe('sent');
  });

  it('when the day count cannot be read the acknowledgement is not sent (the quota cannot be proved)', async () => {
    const { world, handle } = setup(EMAIL_ON);
    world.db.failRateStore = true;
    expect((await handle(lead(3, { email: 'ravi@example.test' }))).status).toBe(201);
    expect(world.resendMails().map((m) => m.to)).toEqual([FAKE.ownerEmail]);
  });
});
