// Fictional people, addresses on example.test only, fake secret built at run time.
import { describe, expect, it } from 'vitest';
import {
  backoffMs,
  buildOutboxRecords,
  dispatchOutbox,
  emailAdapter,
  inAppAdapter,
  MemoryInAppInbox,
  MemoryOutboxStore,
  pushAdapter,
  whatsappAdapter,
  type ChannelAdapter,
  type DomainEvent,
  type MessageTransport,
  type OutgoingMessage,
  type Recipient,
} from '../../src/lib/notify/outbox';

const T0 = Date.parse('2026-11-01T04:00:00.000Z');
const GRANT = { granted: true, grantedAt: '2026-10-01T00:00:00.000Z' };
const FAKE_KEY = ['re', 'FAKE', 'test'].join('_');

/** Consent re-check that allows everything (the tests that are not about consent). */
const allow = async (): Promise<null> => null;

function clock(start = T0) {
  let t = start;
  return { now: () => new Date(t), advance: (ms: number) => (t += ms) };
}

const people: Recipient[] = [
  { id: 'u-1', greetingName: 'Arun Fictional', ageStatus: 'adult_confirmed', consent: { in_app: GRANT, email: GRANT, push: GRANT, whatsapp: GRANT } },
  { id: 'u-2', greetingName: 'Bala Madeup', ageStatus: 'minor_confirmed', consent: { in_app: GRANT } },
];
const event: DomainEvent = { tournamentName: 'Fictional Valley Open 2026', kind: 'draw_published', eventId: 'draw-1' };

async function seeded(channels: Parameters<typeof buildOutboxRecords>[2] = ['in_app', 'email', 'push', 'whatsapp']) {
  const store = new MemoryOutboxStore();
  await store.enqueue(buildOutboxRecords(event, people, channels, { now: new Date(T0) }));
  return store;
}

function scripted(channel: ChannelAdapter['channel'], results: Array<Awaited<ReturnType<ChannelAdapter['send']>> | 'throw'>) {
  const calls: OutgoingMessage[] = [];
  const adapter: ChannelAdapter = {
    channel,
    async send(m) {
      calls.push(m);
      const r = results.shift() ?? { status: 'sent' };
      if (r === 'throw') throw new Error('boom');
      return r;
    },
  };
  return { adapter, calls };
}

describe('enqueue is idempotent', () => {
  it('a second enqueue of the same event adds nothing', async () => {
    const store = await seeded();
    const again = await store.enqueue(buildOutboxRecords(event, people, ['in_app', 'email', 'push', 'whatsapp'], { now: new Date(T0 + 5000) }));
    expect(again).toEqual({ inserted: 0, duplicates: 8 });
    expect(store.all()).toHaveLength(8);
  });
});

describe('dispatchOutbox', () => {
  it('does nothing at all unless enabled is exactly true', async () => {
    const store = await seeded();
    const before = store.all();
    const { adapter, calls } = scripted('in_app', []);
    const s = await dispatchOutbox(store, { in_app: adapter }, { enabled: false, now: clock().now, recheck: allow });
    expect(s).toMatchObject({ enabled: false, considered: 0 });
    expect(calls).toHaveLength(0);
    expect(store.all()).toEqual(before);
  });

  it('with no configured channel, marks everything skipped and never sent', async () => {
    const store = await seeded();
    const s = await dispatchOutbox(store, { in_app: inAppAdapter(null), email: emailAdapter(null), push: pushAdapter(), whatsapp: whatsappAdapter() }, { enabled: true, now: clock().now, recheck: allow });
    expect(s.sent).toBe(0);
    for (const r of store.all()) {
      expect(r.status).toBe('skipped');
      expect(r.sentAt).toBeNull();
    }
    expect(store.all().filter((r) => r.skipReason === 'channel_not_configured')).toHaveLength(4); // u-1 x4 channels
    expect(store.all().filter((r) => r.skipReason === 'protected_recipient')).toHaveLength(4); // the junior, no guardian contact
  });

  it('a missing adapter or one for another channel counts as not configured', async () => {
    const store = await seeded(['in_app', 'email']);
    const { adapter, calls } = scripted('push', [{ status: 'sent' }]);
    await dispatchOutbox(store, { email: adapter }, { enabled: true, now: clock().now, recheck: allow });
    expect(calls).toHaveLength(0);
    expect(store.all().filter((r) => r.recipientId === 'u-1').map((r) => r.skipReason)).toEqual(['channel_not_configured', 'channel_not_configured']);
  });

  it('marks sent only on an exact sent result, and ignores a malformed result', async () => {
    const store = await seeded(['in_app', 'email']);
    const inbox = new MemoryInAppInbox();
    const weird: ChannelAdapter = { channel: 'email', send: async () => ({ status: 'SENT' }) as never };
    const c = clock();
    const s = await dispatchOutbox(store, { in_app: inAppAdapter(inbox), email: weird }, { enabled: true, now: c.now, recheck: allow });
    expect(s).toMatchObject({ sent: 1, failed: 1 });
    const inApp = store.all().find((r) => r.recipientId === 'u-1' && r.channel === 'in_app');
    expect(inApp).toMatchObject({ status: 'sent', attempts: 1, sentAt: new Date(T0).toISOString() });
    expect(store.all().find((r) => r.recipientId === 'u-1' && r.channel === 'email')).toMatchObject({ status: 'failed', lastError: 'bad_adapter_result' });
    expect(inbox.forRecipient('u-1')).toHaveLength(1);
    expect(inbox.forRecipient('u-2')).toHaveLength(0);
    // A second run sends nothing more.
    const again = await dispatchOutbox(store, { in_app: inAppAdapter(inbox) }, { enabled: true, now: c.now, recheck: allow });
    expect(again.considered).toBe(0);
  });

  it('retries a retryable failure with doubling backoff, then fails after maxAttempts', async () => {
    const store = await seeded(['in_app']);
    const { adapter, calls } = scripted('in_app', [
      { status: 'failed', retryable: true, code: 'x' },
      { status: 'failed', retryable: true, code: 'x' },
      { status: 'failed', retryable: true, code: 'x' },
    ]);
    const c = clock();
    const opts = { enabled: true, now: c.now, maxAttempts: 3, baseBackoffMs: 1000, recheck: allow };
    await dispatchOutbox(store, { in_app: adapter }, opts);
    let rec = store.all().find((r) => r.recipientId === 'u-1');
    expect(rec).toMatchObject({ status: 'queued', attempts: 1, notBefore: new Date(T0 + 1000).toISOString(), lastError: 'x' });
    // Not due yet.
    expect((await dispatchOutbox(store, { in_app: adapter }, opts)).considered).toBe(0);
    c.advance(1000);
    await dispatchOutbox(store, { in_app: adapter }, opts);
    rec = store.all().find((r) => r.recipientId === 'u-1');
    expect(rec).toMatchObject({ status: 'queued', attempts: 2, notBefore: new Date(T0 + 1000 + 2000).toISOString() });
    c.advance(2000);
    await dispatchOutbox(store, { in_app: adapter }, opts);
    rec = store.all().find((r) => r.recipientId === 'u-1');
    expect(rec).toMatchObject({ status: 'failed', attempts: 3 });
    expect(calls).toHaveLength(3);
    expect(new Set(calls.map((m) => m.key)).size).toBe(1); // every retry uses the same idempotency key
  });

  it('fails at once on a non-retryable failure, and treats a thrown adapter as retryable', async () => {
    const store = await seeded(['in_app', 'email']);
    const a = scripted('in_app', ['throw']);
    const b = scripted('email', [{ status: 'failed', retryable: false, code: 'email_rejected' }]);
    const s = await dispatchOutbox(store, { in_app: a.adapter, email: b.adapter }, { enabled: true, now: clock().now, recheck: allow });
    expect(s).toMatchObject({ retrying: 1, failed: 1 });
    expect(store.all().find((r) => r.channel === 'in_app' && r.recipientId === 'u-1')).toMatchObject({ status: 'queued', lastError: 'adapter_threw' });
  });

  it('skips an expired record instead of sending it late', async () => {
    const store = new MemoryOutboxStore();
    const rem: DomainEvent = { tournamentName: 'Fictional Valley Open 2026', kind: 'match_reminder', eventId: 'm-1', matchLabel: 'Match 1', start: new Date(T0 + 60_000).toISOString() };
    await store.enqueue(buildOutboxRecords(rem, [people[0] as Recipient], ['in_app'], { now: new Date(T0) }));
    const c = clock();
    c.advance(60_000);
    const { adapter, calls } = scripted('in_app', []);
    await dispatchOutbox(store, { in_app: adapter }, { enabled: true, now: c.now, recheck: allow });
    expect(calls).toHaveLength(0);
    expect(store.all()[0]).toMatchObject({ status: 'skipped', skipReason: 'expired' });
  });

  it('re-checks consent before sending, failing closed when the check throws', async () => {
    const store = await seeded(['in_app', 'email']);
    const { adapter, calls } = scripted('in_app', []);
    const e = scripted('email', []);
    await dispatchOutbox(store, { in_app: adapter, email: e.adapter }, {
      enabled: true,
      now: clock().now,
      recheck: async (r) => {
        if (r.channel === 'email') throw new Error('db down');
        return 'consent_withdrawn';
      },
    });
    expect(calls).toHaveLength(0);
    expect(e.calls).toHaveLength(0);
    const u1 = store.all().filter((r) => r.recipientId === 'u-1');
    expect(u1.map((r) => r.skipReason).sort()).toEqual(['consent_changed', 'consent_withdrawn']);
  });

  it('sends nothing when no consent recheck is supplied (fail closed)', async () => {
    const store = await seeded(['in_app', 'email']);
    const { adapter, calls } = scripted('in_app', []);
    const e = scripted('email', []);
    const opts = { enabled: true, now: clock().now } as unknown as Parameters<typeof dispatchOutbox>[2];
    const s = await dispatchOutbox(store, { in_app: adapter, email: e.adapter }, opts);
    expect(calls).toHaveLength(0);
    expect(e.calls).toHaveLength(0);
    expect(s.sent).toBe(0);
    expect(s.considered).toBeGreaterThan(0);
    expect(s.skipped).toBe(s.considered);
    expect(store.all().filter((r) => r.skipReason === 'consent_changed')).toHaveLength(s.considered);
    expect(store.all().some((r) => r.status === 'sent' || r.status === 'sending')).toBe(false);
  });

  it('picks up a crashed attempt after its lease, and never double-sends a claimed record', async () => {
    const store = await seeded(['in_app']);
    const rec = store.all().find((r) => r.recipientId === 'u-1');
    if (!rec) throw new Error('missing');
    // Simulate a dispatcher that claimed and then crashed.
    await store.compareAndSet(rec.key, { status: 'queued', attempts: 0 }, { ...rec, status: 'sending', attempts: 1, leaseUntil: new Date(T0 + 300_000).toISOString() });
    const c = clock();
    const { adapter, calls } = scripted('in_app', []);
    expect((await dispatchOutbox(store, { in_app: adapter }, { enabled: true, now: c.now, recheck: allow })).considered).toBe(0);
    c.advance(300_000);
    await dispatchOutbox(store, { in_app: adapter }, { enabled: true, now: c.now, recheck: allow });
    expect(calls).toHaveLength(1);
    expect(await store.get(rec.key)).toMatchObject({ status: 'sent', attempts: 2 });
  });

  it('a lost compare-and-set race is counted and leaves the record alone', async () => {
    const store = await seeded(['in_app']);
    const racing = new (class extends MemoryOutboxStore {})();
    await racing.enqueue(store.all());
    const orig = racing.compareAndSet.bind(racing);
    racing.compareAndSet = async (key, expect_, next) => (next.status === 'sending' ? false : orig(key, expect_, next));
    const { adapter, calls } = scripted('in_app', []);
    const s = await dispatchOutbox(racing, { in_app: adapter }, { enabled: true, now: clock().now, recheck: allow });
    expect(s.raced).toBe(1);
    expect(calls).toHaveLength(0);
  });
});

describe('backoffMs', () => {
  it('doubles and caps', () => {
    expect([1, 2, 3, 4].map((n) => backoffMs(n, 1000, 5000))).toEqual([1000, 2000, 4000, 5000]);
    expect(backoffMs(100, 1000, 5000)).toBe(5000);
  });
});

describe('emailAdapter', () => {
  const msg: OutgoingMessage = { key: 'ntf1:draw_published:d:0:u-1:email', kind: 'draw_published', recipientId: 'u-1', channel: 'email', subject: 'Draw published', body: 'Hi there', createdAt: new Date(T0).toISOString() };
  function capture(status = 200) {
    const calls: Array<{ headers: Record<string, string>; body: Record<string, unknown> }> = [];
    const f = (async (_url: string, init?: RequestInit) => {
      const headers: Record<string, string> = {};
      new Headers(init?.headers).forEach((v, k) => (headers[k] = v));
      calls.push({ headers, body: JSON.parse(String(init?.body)) });
      return new Response('{}', { status });
    }) as unknown as typeof fetch;
    return { calls, f };
  }
  const cfg = (f: typeof fetch, over: Record<string, unknown> = {}) => ({ enabled: true, apiKey: FAKE_KEY, from: 'Power Smash <hello@mail.example.test>', fetch: f, resolveAddress: async () => 'arun@example.test', ...over });

  it('is not configured without the switch, key, sender or lookup, and calls nothing', async () => {
    const { calls, f } = capture();
    for (const over of [{ enabled: false }, { apiKey: null }, { from: null }, { resolveAddress: null }]) {
      expect(await emailAdapter(cfg(f, over)).send(msg)).toEqual({ status: 'not_configured' });
    }
    expect(calls).toHaveLength(0);
  });

  it('sends with the record key as the idempotency key and maps failures', async () => {
    const ok = capture(200);
    expect(await emailAdapter(cfg(ok.f)).send(msg)).toEqual({ status: 'sent' });
    expect(ok.calls[0]?.headers['idempotency-key']).toBe(msg.key);
    expect(ok.calls[0]?.body).toMatchObject({ to: 'arun@example.test', subject: 'Draw published', text: 'Hi there' });
    expect(await emailAdapter(cfg(capture(429).f)).send(msg)).toEqual({ status: 'failed', retryable: true, code: 'email_rate_limited' });
    expect(await emailAdapter(cfg(capture(503).f)).send(msg)).toEqual({ status: 'failed', retryable: true, code: 'email_unavailable' });
    expect(await emailAdapter(cfg(capture(422).f)).send(msg)).toEqual({ status: 'failed', retryable: false, code: 'email_rejected' });
  });

  it('skips with no_address and keeps the address out of error codes', async () => {
    const { f } = capture();
    expect(await emailAdapter(cfg(f, { resolveAddress: async () => null })).send(msg)).toEqual({ status: 'skipped', reason: 'no_address' });
    const r = await emailAdapter(cfg(f, { resolveAddress: async () => { throw new Error('arun@example.test'); } })).send(msg);
    expect(r).toEqual({ status: 'failed', retryable: true, code: 'address_lookup_failed' });
  });
});

describe('push and whatsapp adapters (vendor unverified)', () => {
  it('are not configured by default and only report sent on ok:true', async () => {
    const m = { key: 'k', kind: 'announcement', recipientId: 'u-1', channel: 'push', subject: 's', body: 'b', createdAt: new Date(T0).toISOString() } as const;
    expect(await pushAdapter().send(m)).toEqual({ status: 'not_configured' });
    expect(await whatsappAdapter().send({ ...m, channel: 'whatsapp' })).toEqual({ status: 'not_configured' });
    const t: MessageTransport = { deliver: async () => ({ ok: false, retryable: false, code: 'bad +910000000000 body' }) };
    expect(await pushAdapter(t).send(m)).toEqual({ status: 'failed', retryable: false, code: 'badbody' });
    const yes: MessageTransport = { deliver: async () => ({ ok: true }) };
    expect(await whatsappAdapter(yes).send({ ...m, channel: 'whatsapp' })).toEqual({ status: 'sent' });
  });
});
