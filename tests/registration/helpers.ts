// Shared fakes for the registration tests. FICTIONAL data only: invented names, 910000000000-style phones, example.test emails, and
// secret-shaped values built at run time so the gitleaks rules do not flag this file.
import { buildLeadConfig } from '../../src/lib/leads/config';
import type { RateStore } from '../../src/lib/security/ratelimit';
import { REGISTRATION_CONSENT } from '../../src/lib/registration/consent';
import type { LookupOutcome, RegistrationStore, SubmitOutcome, SubmitRecord } from '../../src/lib/registration/store';

export const NOW = new Date('2026-10-31T06:00:00.000Z');
export const EVENT_ID = 'e0000000-0000-4000-8000-000000000001';
export const uuid = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;

export const FAKE = {
  hmac: ['k1', 'x'.repeat(40)].join(':'),
  secretKey: ['sb', 'secret', 'FAKE', 'registration'].join('_'),
  turnstile: ['0x4AAAAAAA', 'FAKE', 'secret'].join(''),
  telegramToken: ['123456', 'FAKEtoken'].join(':'),
};

export function testConfig(over: Record<string, string> = {}) {
  return buildLeadConfig({
    SUPABASE_URL: 'https://fakeproject.supabase.co',
    SUPABASE_SECRET_KEY: FAKE.secretKey,
    TURNSTILE_SECRET_KEY: FAKE.turnstile,
    HMAC_KEY: FAKE.hmac,
    TELEGRAM_BOT_TOKEN: FAKE.telegramToken,
    TELEGRAM_CHAT_ID: '1000001',
    PUBLIC_WHATSAPP_NUMBER: '910000000000',
    PUBLIC_SITE_URL: 'https://fake-site.example',
    ...over,
  });
}

export function body(over: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    eventId: EVENT_ID,
    player1Name: 'Fake Reg Alpha',
    phone: '90000 00001',
    email: 'alpha@example.test',
    whatsappOk: true,
    paymentReference: 'utr 0000 1111 22',
    consent: { id: REGISTRATION_CONSENT.id, version: REGISTRATION_CONSENT.version, given: true },
    idempotencyKey: uuid(1),
    token: 'fake-turnstile-token',
    elapsedMs: 5000,
    ...over,
  };
}

export function post(b: unknown, headers: Record<string, string> = {}): Request {
  return new Request('https://fake-site.example/api/register', {
    method: 'POST',
    headers: { 'content-type': 'application/json', origin: 'https://fake-site.example', 'x-vercel-forwarded-for': '203.0.113.7', ...headers },
    body: typeof b === 'string' ? b : JSON.stringify(b),
  });
}

/** An in-memory RateStore. */
export function memoryRateStore(): RateStore & { hits: Array<{ id: string; bucket: string; key: string; at: string }> } {
  const hits: Array<{ id: string; bucket: string; key: string; at: string }> = [];
  return {
    hits,
    count: async (bucket, key, since) => hits.filter((h) => h.bucket === bucket && h.key === key && h.at >= since).length,
    add: async (bucket, key, at, id) => {
      hits.push({ id: id ?? crypto.randomUUID(), bucket, key, at });
    },
    release: async (id) => {
      const i = hits.findIndex((h) => h.id === id);
      if (i >= 0) hits.splice(i, 1);
    },
    purgeBefore: async () => undefined,
  };
}

/** A fake store that records every submit and answers with the given outcome (or the default "created"). */
export function fakeStore(o: { lookup?: LookupOutcome; submit?: SubmitOutcome | ((r: SubmitRecord) => SubmitOutcome); throws?: boolean } = {}) {
  const submitted: SubmitRecord[] = [];
  const store: RegistrationStore = {
    lookup: async () => {
      if (o.throws) throw new Error('db down');
      return o.lookup ?? { outcome: 'none' };
    },
    submit: async (r) => {
      if (o.throws) throw new Error('db down');
      submitted.push(r);
      const s = o.submit;
      if (typeof s === 'function') return s(r);
      return s ?? { outcome: 'created', id: uuid(900), ref: r.ref, feePaise: 50_000, category: 'MS', ageGroup: null };
    },
  };
  return { store, submitted };
}

/** A mocked fetch: Turnstile answers `turnstile`, Telegram and Resend answer ok; every call is recorded (url and body). */
export function mockFetch(turnstile: Record<string, unknown> = { success: true, hostname: 'fake-site.example', action: 'lead' }) {
  const calls: Array<{ url: string; body: string }> = [];
  const fn = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    const b = typeof init?.body === 'string' ? init.body : '';
    calls.push({ url, body: b });
    if (url.includes('turnstile')) return new Response(JSON.stringify(turnstile), { status: 200, headers: { 'content-type': 'application/json' } });
    return new Response(JSON.stringify({ ok: true }), { status: 200, headers: { 'content-type': 'application/json' } });
  }) as typeof fetch;
  return { fetch: fn, calls };
}

export const seqBytes = () => {
  let n = 0;
  return (len: number) => {
    const out = new Uint8Array(len);
    for (let i = 0; i < len; i += 1) out[i] = (n++ * 7 + 3) & 0xff;
    return out;
  };
};
