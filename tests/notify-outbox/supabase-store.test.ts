// The Supabase outbox store (src/lib/notify/outbox/supabase-store.ts) against a FAKE database that follows the 0023 SQL rules
// (enqueue on conflict do nothing, compare and set on status and attempts, a final state never reopened), the subscriber rules of the
// outbox, the email adapter's list footer and headers, and one full email-list dispatch. Fictional data only.
import { describe, expect, it } from 'vitest';
import { buildLeadConfig } from '../../src/lib/leads/config';
import { ALLOWED_MAIL_HEADERS, sendEmail } from '../../src/lib/notify/email';
import { emailAdapter, listFooter } from '../../src/lib/notify/outbox/adapters';
import { consentDecision } from '../../src/lib/notify/outbox/consent';
import { dispatchOutbox } from '../../src/lib/notify/outbox/dispatcher';
import { idempotencyKey } from '../../src/lib/notify/outbox/keys';
import { MemoryOutboxStore } from '../../src/lib/notify/outbox/store';
import { createSupabaseOutboxStore, OutboxStoreError, rowToRecord, type OutboxRow } from '../../src/lib/notify/outbox/supabase-store';
import type { OutboxRecord, Recipient } from '../../src/lib/notify/outbox/types';
import { createSubscriberDispatch } from '../../src/lib/notices/dispatch';
import { subscriberRecheck } from '../../src/lib/notices/subscriber-store';
import { unsubscribeUrlResolver, verifyUnsubscribe } from '../../src/lib/notices/tokens';
import { parseHmacKey } from '../../src/lib/security/hash';

const SUB1 = '00000000-0000-4000-8000-000000000001';
const SUB2 = '00000000-0000-4000-8000-000000000002';
const T0 = '2026-10-31T00:00:00.000Z';
const FAKE_HMAC = ['k1', 'z'.repeat(40)].join(':');
const FAKE_KEY = ['re', 'FAKE', 'outbox'].join('_');

function rec(over: Partial<OutboxRecord> = {}): OutboxRecord {
  const recipientId = over.recipientId ?? `subscriber:${SUB1}`;
  const eventId = over.eventId ?? 'c0230000-0000-4000-8000-0000000000a1';
  return {
    key: idempotencyKey({ kind: 'announcement', eventId, revision: 0, recipientId, channel: 'email' }),
    kind: 'announcement',
    eventId,
    revision: 0,
    recipientId,
    channel: 'email',
    status: 'queued',
    skipReason: null,
    subject: 'Sample news',
    body: 'Hi there,\n\nSample text.\n\n- Power Smash',
    createdAt: T0,
    notBefore: T0,
    expiresAt: null,
    attempts: 0,
    leaseUntil: null,
    lastError: null,
    sentAt: null,
    ...over,
  };
}

/** A fake PostgREST: notification_outbox and notify_subscribers rows, the two outbox RPCs, and select with the filters the store uses. */
function fakeDb(subscribers: Record<string, { email: string; status: string }> = { [SUB1]: { email: 'fake.one@example.test', status: 'active' } }) {
  const rows = new Map<string, OutboxRow>();
  const calls: Array<{ kind: string; name: string; args?: unknown; query?: string }> = [];
  const db = {
    calls,
    rows,
    async rpc<T>(fn: string, args: Record<string, unknown> = {}): Promise<T | null> {
      calls.push({ kind: 'rpc', name: fn, args });
      if (fn === 'notify_outbox_enqueue') {
        let inserted = 0;
        let duplicates = 0;
        for (const r of args.p_rows as Array<Record<string, unknown>>) {
          const key = r.key as string;
          if (rows.has(key)) {
            duplicates += 1;
            continue;
          }
          const [type, id] = (r.recipient as string).split(':');
          rows.set(key, {
            idempotency_key: key,
            kind: r.kind as string,
            channel: r.channel as string,
            recipient_lead_id: type === 'lead' ? (id as string) : null,
            recipient_profile_id: type === 'profile' ? (id as string) : null,
            recipient_subscriber_id: type === 'subscriber' ? (id as string) : null,
            payload: r.payload as Record<string, unknown>,
            status: r.status as OutboxRow['status'],
            skip_reason: (r.skipReason as string | null) ?? null,
            subject: r.subject as string,
            body: r.body as string,
            created_at: (r.createdAt as string).replace('.000Z', '+00:00'),
            not_before: (r.notBefore as string).replace('.000Z', '+00:00'),
            expires_at: (r.expiresAt as string | null) ?? null,
            attempts: 0,
            lease_until: null,
            last_error_code: null,
            sent_at: null,
          });
          inserted += 1;
        }
        return { inserted, duplicates } as T;
      }
      if (fn === 'notify_outbox_cas') {
        const cur = rows.get(args.p_key as string);
        if (!cur || !['queued', 'sending'].includes(args.p_expect_status as string)) return false as T;
        if (cur.status !== args.p_expect_status || cur.attempts !== args.p_expect_attempts) return false as T;
        const n = args.p_next as Record<string, unknown>;
        if (n.lastError !== null && !/^[a-z_]{1,40}$/.test(n.lastError as string)) throw new Error('check violation: last_error_code');
        rows.set(cur.idempotency_key, {
          ...cur,
          status: n.status as OutboxRow['status'],
          attempts: n.attempts as number,
          not_before: (n.notBefore as string) ?? cur.not_before,
          lease_until: n.leaseUntil as string | null,
          last_error_code: n.lastError as string | null,
          skip_reason: n.skipReason as string | null,
          sent_at: n.sentAt as string | null,
        });
        return true as T;
      }
      throw new Error(`unexpected rpc ${fn}`);
    },
    async select<T>(table: string, query: string): Promise<T[]> {
      calls.push({ kind: 'select', name: table, query });
      const q = new URLSearchParams(query);
      if (table === 'notify_subscribers') {
        const id = (q.get('id') ?? '').replace('eq.', '');
        const s = subscribers[id];
        return (s && s.status === 'active' ? [{ email: s.email }] : []) as T[];
      }
      let out = [...rows.values()];
      const status = q.get('status');
      if (status) out = out.filter((r) => r.status === status.replace('eq.', ''));
      const key = q.get('idempotency_key');
      if (key) out = out.filter((r) => r.idempotency_key === key.replace('eq.', ''));
      const nb = q.get('not_before');
      if (nb) out = out.filter((r) => Date.parse(r.not_before) <= Date.parse(nb.replace('lte.', '')));
      const lu = q.get('lease_until');
      if (lu) out = out.filter((r) => r.lease_until !== null && Date.parse(r.lease_until) <= Date.parse(lu.replace('lte.', '')));
      if (q.get('recipient_subscriber_id') === 'not.is.null') out = out.filter((r) => r.recipient_subscriber_id !== null);
      return out.map((r) => ({ ...r })) as T[];
    },
  };
  return db;
}

describe('SupabaseOutboxStore', () => {
  it('enqueues through notify_outbox_enqueue with references only, idempotent on the key', async () => {
    const db = fakeDb();
    const store = createSupabaseOutboxStore(db);
    expect(await store.enqueue([rec(), rec()])).toEqual({ inserted: 1, duplicates: 1 });
    const call = db.calls.find((c) => c.name === 'notify_outbox_enqueue');
    const row = (call?.args as { p_rows: Array<Record<string, unknown>> }).p_rows[0];
    expect(row).toMatchObject({ recipient: `subscriber:${SUB1}`, payload: { event: 'c0230000-0000-4000-8000-0000000000a1', revision: 0 }, status: 'queued' });
    expect(JSON.stringify(call?.args)).not.toMatch(/@/);
  });

  it('refuses a record the database would refuse, before any call, naming the reason', async () => {
    const db = fakeDb();
    const store = createSupabaseOutboxStore(db);
    await expect(store.enqueue([rec(), rec({ body: 'Call 910000000000' })])).rejects.toBeInstanceOf(OutboxStoreError);
    await expect(store.enqueue([rec({ recipientId: 'fake@example.test' })])).rejects.toThrow(/recipient/);
    expect(db.calls).toHaveLength(0);
  });

  it('reads back the same record (instants normalised), and lists queued and lease-expired records in order', async () => {
    const db = fakeDb();
    const store = createSupabaseOutboxStore(db);
    const a = rec();
    const b = rec({ eventId: 'c0230000-0000-4000-8000-0000000000a2', notBefore: '2026-10-30T00:00:00.000Z' });
    await store.enqueue([a, b]);
    expect(await store.get(a.key)).toEqual(a);
    const due = await store.listDue('2026-10-31T01:00:00.000Z', 10);
    expect(due.map((r) => r.key)).toEqual([b.key, a.key]);
    expect(await store.listDue('2026-10-29T00:00:00.000Z', 10)).toEqual([]);
    expect(db.calls.filter((c) => c.kind === 'select').every((c) => /select=idempotency_key,/.test(c.query ?? ''))).toBe(true);
  });

  it('compare and set changes only the delivery state, once, and never the message', async () => {
    const db = fakeDb();
    const store = createSupabaseOutboxStore(db);
    const a = rec();
    await store.enqueue([a]);
    const claimed = { ...a, status: 'sending' as const, attempts: 1, leaseUntil: '2026-10-31T00:05:00.000Z' };
    expect(await store.compareAndSet(a.key, { status: 'queued', attempts: 0 }, claimed)).toBe(true);
    expect(await store.compareAndSet(a.key, { status: 'queued', attempts: 0 }, claimed)).toBe(false);
    expect(await store.compareAndSet(a.key, { status: 'sending', attempts: 1 }, { ...claimed, body: 'changed text' })).toBe(false);
    expect(await store.compareAndSet(a.key, { status: 'sending', attempts: 1 }, { ...claimed, key: 'other-key-1' })).toBe(false);
    expect(await store.compareAndSet(a.key, { status: 'sending', attempts: 1 }, { ...claimed, status: 'queued', lastError: 'Email_Unavailable', leaseUntil: null })).toBe(true);
    expect((await store.get(a.key))?.lastError).toBe('email_unavailable');
  });

  it('a row without text (0017 reference-only enqueue) is never a sendable record', () => {
    const r = rowToRecord({ ...({} as OutboxRow), idempotency_key: 'fake-outbox-key-1', subject: null, body: null, recipient_profile_id: SUB1, recipient_lead_id: null, recipient_subscriber_id: null });
    expect(r).toBeNull();
  });

  it('the memory store and this store give the dispatcher the same outcome', async () => {
    const run = async (store: ReturnType<typeof createSupabaseOutboxStore> | MemoryOutboxStore) => {
      await store.enqueue([rec(), rec({ eventId: 'c0230000-0000-4000-8000-0000000000a2' })]);
      let n = 0;
      const adapter = { channel: 'email' as const, send: async () => (n++ === 0 ? { status: 'sent' as const } : { status: 'failed' as const, retryable: true, code: 'email_unavailable' }) };
      return dispatchOutbox(store, { email: adapter }, { enabled: true, now: () => new Date('2026-10-31T01:00:00.000Z'), recheck: async () => null });
    };
    expect(await run(createSupabaseOutboxStore(fakeDb()))).toEqual(await run(new MemoryOutboxStore()));
  });
});

describe('subscribers in the outbox', () => {
  const sub: Recipient = { id: `subscriber:${SUB1}`, ageStatus: undefined, audience: 'subscriber', consent: { email: { granted: true, grantedAt: T0 } } };
  const now = new Date('2026-10-31T01:00:00.000Z');
  it('get announcements by email only, with a confirmed consent; the player protection rule is not applied to the list', () => {
    expect(consentDecision(sub, 'email', 'announcement', now)).toBeNull();
    expect(consentDecision(sub, 'whatsapp', 'announcement', now)).toBe('no_consent');
    expect(consentDecision(sub, 'email', 'match_reminder', now)).toBe('no_consent');
    expect(consentDecision({ ...sub, consent: {} }, 'email', 'announcement', now)).toBe('no_consent');
    expect(consentDecision({ ...sub, consent: { email: { granted: true, grantedAt: T0, withdrawnAt: T0 } } }, 'email', 'announcement', now)).toBe('consent_withdrawn');
    // a participant with unknown age is still protected (unchanged rule)
    expect(consentDecision({ ...sub, audience: 'participant' }, 'email', 'announcement', now)).toBe('protected_recipient');
  });

  it('the re-check skips an unsubscribed address and anything that is not a list announcement (fail closed)', async () => {
    const check = subscriberRecheck({ activeAddress: async (id) => (id === SUB1 ? 'fake.one@example.test' : null) });
    expect(await check(rec(), now)).toBeNull();
    expect(await check(rec({ recipientId: `subscriber:${SUB2}` }), now)).toBe('consent_withdrawn');
    expect(await check(rec({ kind: 'court_change' }), now)).toBe('no_consent');
    expect(await check(rec({ recipientId: `profile:${SUB1}` }), now)).toBe('consent_changed');
  });
});

describe('list emails carry a working one-click unsubscribe', () => {
  const capture = () => {
    const calls: Array<{ body: Record<string, unknown>; headers: Record<string, string> }> = [];
    const f = (async (_u: RequestInfo | URL, init?: RequestInit) => {
      calls.push({ body: JSON.parse(String(init?.body)), headers: init?.headers as Record<string, string> });
      return new Response('{}', { status: 200 });
    }) as typeof fetch;
    return { f, calls };
  };
  const key = parseHmacKey(FAKE_HMAC);
  const msg = { key: 'ntf1:announcement:x:0:subscriber%3A1:email', kind: 'announcement' as const, recipientId: `subscriber:${SUB1}`, channel: 'email' as const, subject: 'Sample', body: 'Sample text', createdAt: T0 };

  it('adds the footer and the List-Unsubscribe pair; the link verifies', async () => {
    const c = capture();
    const unsub = unsubscribeUrlResolver(key, 'https://fake-site.example');
    const r = await emailAdapter({ enabled: true, apiKey: FAKE_KEY, from: 'Power Smash <hello@mail.example.test>', fetch: c.f, resolveAddress: async () => 'fake.one@example.test', unsubscribeUrl: unsub }).send(msg);
    expect(r).toEqual({ status: 'sent' });
    const body = c.calls[0]?.body as { text: string; headers: Record<string, string> };
    const link = await unsub?.(`subscriber:${SUB1}`);
    expect(body.text).toBe(`Sample text\n\n--\n${listFooter(link ?? '')}`);
    expect(body.headers).toEqual({ 'List-Unsubscribe': `<${link}>`, 'List-Unsubscribe-Post': 'List-Unsubscribe=One-Click' });
    expect(c.calls[0]?.headers['idempotency-key']).toBe(msg.key);
    const u = new URL(link ?? '');
    expect(u.pathname).toBe('/api/notify/unsubscribe');
    if (!key) throw new Error('key');
    expect(await verifyUnsubscribe(key, u.searchParams.get('s') ?? '', u.searchParams.get('t') ?? '')).toBe(true);
  });

  it('without an unsubscribe link a list email is not sent at all', async () => {
    const c = capture();
    const base = { enabled: true, apiKey: FAKE_KEY, from: 'hello@mail.example.test', fetch: c.f, resolveAddress: async () => 'fake.one@example.test' };
    expect(await emailAdapter(base).send(msg)).toEqual({ status: 'not_configured' });
    expect(await emailAdapter({ ...base, unsubscribeUrl: unsubscribeUrlResolver(key, 'http://fake-site.example') }).send(msg)).toEqual({ status: 'not_configured' });
    expect(c.calls).toHaveLength(0);
    // other recipients are unchanged: no footer, no headers
    expect(await emailAdapter(base).send({ ...msg, recipientId: `profile:${SUB1}` })).toEqual({ status: 'sent' });
    expect(c.calls[0]?.body).not.toHaveProperty('headers');
  });

  it('sendEmail allows only the two unsubscribe headers, without line breaks', async () => {
    expect(ALLOWED_MAIL_HEADERS).toEqual(['List-Unsubscribe', 'List-Unsubscribe-Post']);
    const c = capture();
    const m = { from: 'hello@mail.example.test', to: 'fake.one@example.test', subject: 'S', text: 'T' };
    expect(await sendEmail({ fetch: c.f, apiKey: FAKE_KEY, message: { ...m, headers: { 'X-Other': 'x' } } })).toEqual({ ok: false, reason: 'invalid' });
    expect(await sendEmail({ fetch: c.f, apiKey: FAKE_KEY, message: { ...m, headers: { 'List-Unsubscribe': '<https://a.example>\r\nBcc: x@example.test' } } })).toEqual({ ok: false, reason: 'invalid' });
    expect(c.calls).toHaveLength(0);
  });
});

describe('one email-list dispatch run', () => {
  const config = (over: Record<string, string> = {}) =>
    buildLeadConfig({
      SUPABASE_URL: 'https://fakeproject.supabase.co',
      SUPABASE_SECRET_KEY: ['sb', 'secret', 'FAKE', 'dispatch'].join('_'),
      HMAC_KEY: FAKE_HMAC,
      EMAIL_ENABLED: 'true',
      RESEND_API_KEY: FAKE_KEY,
      EMAIL_FROM: 'Power Smash <hello@mail.example.test>',
      PUBLIC_SITE_URL: 'https://fake-site.example',
      ...over,
    });

  it('sends to the active subscriber, skips the one who left, touches no other recipient, and sends nothing twice', async () => {
    const db = fakeDb({ [SUB1]: { email: 'fake.one@example.test', status: 'active' }, [SUB2]: { email: 'fake.two@example.test', status: 'unsubscribed' } });
    const store = createSupabaseOutboxStore(db);
    const profileRecord = rec({ recipientId: `profile:${SUB1}`, channel: 'in_app' });
    await store.enqueue([rec(), rec({ recipientId: `subscriber:${SUB2}` }), { ...profileRecord, key: idempotencyKey({ kind: 'announcement', eventId: profileRecord.eventId, revision: 0, recipientId: profileRecord.recipientId, channel: 'in_app' }) }]);
    const sent: string[] = [];
    const f = (async (_u: RequestInfo | URL, init?: RequestInit) => {
      sent.push(JSON.parse(String(init?.body)).to as string);
      return new Response('{}', { status: 200 });
    }) as typeof fetch;
    const d = createSubscriberDispatch({ config: config(), fetch: f, now: () => new Date('2026-10-31T01:00:00.000Z'), db });
    expect(d.emailReady()).toBe(true);
    const s1 = await d.dispatch();
    expect(s1).toMatchObject({ considered: 2, sent: 1, skipped: 1 });
    expect(sent).toEqual(['fake.one@example.test']);
    expect([...db.rows.values()].find((r) => r.recipient_profile_id)?.status).toBe('queued');
    const s2 = await d.dispatch();
    expect(s2).toMatchObject({ considered: 0, sent: 0 });
    expect(sent).toHaveLength(1);
  });

  it('is not set up (null, nothing read) without email or the HMAC key', async () => {
    const overs: Array<Record<string, string>> = [{ EMAIL_ENABLED: 'false' }, { HMAC_KEY: '' }, { PUBLIC_SITE_URL: 'http://fake-site.example' }];
    for (const over of overs) {
      const db = fakeDb();
      const d = createSubscriberDispatch({ config: config(over), fetch: fetch, now: () => new Date(), db });
      expect(d.emailReady()).toBe(false);
      expect(await d.dispatch()).toBeNull();
      expect(db.calls).toHaveLength(0);
    }
  });
});
