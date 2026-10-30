// Shared fakes for the notices and email-list tests. FICTIONAL data only: example.test addresses, invented texts, and secret-shaped
// values built at run time so the gitleaks rules do not flag this file.
import { buildLeadConfig } from '../../src/lib/leads/config';
import type { RateStore } from '../../src/lib/security/ratelimit';
import { SUBSCRIBE_CONSENT } from '../../src/lib/notices/constants';
import type { ConfirmOutcome, SubscribeOutcome, SubscriberStore, UnsubscribeOutcome } from '../../src/lib/notices/subscriber-store';

export const NOW = new Date('2026-10-31T06:00:00.000Z');
export const uuid = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;

export const FAKE = {
  hmac: ['k1', 'y'.repeat(40)].join(':'),
  secretKey: ['sb', 'secret', 'FAKE', 'notices'].join('_'),
  turnstile: ['0x4AAAAAAA', 'FAKE', 'secret'].join(''),
  resend: ['re', 'FAKE', 'key'].join('_'),
};

/** Email ready: EMAIL_ENABLED exactly "true", a key, a From address, an https site. */
export function testConfig(over: Record<string, string> = {}) {
  return buildLeadConfig({
    SUPABASE_URL: 'https://fakeproject.supabase.co',
    SUPABASE_SECRET_KEY: FAKE.secretKey,
    TURNSTILE_SECRET_KEY: FAKE.turnstile,
    HMAC_KEY: FAKE.hmac,
    EMAIL_ENABLED: 'true',
    RESEND_API_KEY: FAKE.resend,
    EMAIL_FROM: 'Power Smash <hello@mail.example.test>',
    PUBLIC_SITE_URL: 'https://fake-site.example',
    ...over,
  });
}

export function body(over: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    email: 'Fake.Reader@Example.test',
    consent: true,
    adult: true,
    consentId: SUBSCRIBE_CONSENT.id,
    consentVersion: SUBSCRIBE_CONSENT.version,
    token: 'fake-turnstile-token',
    website: '',
    elapsedMs: 5000,
    ...over,
  };
}

export function post(url: string, b: unknown, headers: Record<string, string> = {}): Request {
  return new Request(url, {
    method: 'POST',
    headers: { 'content-type': 'application/json', origin: 'https://fake-site.example', 'x-vercel-forwarded-for': '203.0.113.9', ...headers },
    body: typeof b === 'string' ? b : JSON.stringify(b),
  });
}

export function form(url: string, fields: Record<string, string>, headers: Record<string, string> = {}): Request {
  return new Request(url, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded', 'x-vercel-forwarded-for': '203.0.113.9', ...headers },
    body: new URLSearchParams(fields).toString(),
  });
}

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

/** A fake subscriber store following the 0023 SQL rules (enough for the handlers). */
export function fakeSubscribers(o: { subscribe?: SubscribeOutcome; throws?: boolean } = {}) {
  const subscribed: Array<{ email: string; consentId: string; consentVersion: string; tokenHash: string }> = [];
  const confirmed: string[] = [];
  const unsubscribed: string[] = [];
  const store: SubscriberStore = {
    subscribe: async (r) => {
      if (o.throws) throw new Error('db down');
      subscribed.push(r);
      return o.subscribe ?? { outcome: 'send', id: uuid(1) };
    },
    confirm: async (hash): Promise<ConfirmOutcome> => {
      if (o.throws) throw new Error('db down');
      confirmed.push(hash);
      return subscribed.some((s) => s.tokenHash === hash) ? { outcome: 'confirmed', id: uuid(1) } : { outcome: 'invalid' };
    },
    unsubscribe: async (id): Promise<UnsubscribeOutcome> => {
      if (o.throws) throw new Error('db down');
      unsubscribed.push(id);
      return { outcome: 'unsubscribed', skipped: 0 };
    },
    activeAddress: async () => null,
  };
  return { store, subscribed, confirmed, unsubscribed };
}

export function mockFetch(turnstile: Record<string, unknown> = { success: true, hostname: 'fake-site.example', action: 'lead' }) {
  const calls: Array<{ url: string; body: string; headers: Record<string, string> }> = [];
  const fn = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    calls.push({ url, body: typeof init?.body === 'string' ? init.body : '', headers: (init?.headers ?? {}) as Record<string, string> });
    if (url.includes('turnstile')) return new Response(JSON.stringify(turnstile), { status: 200, headers: { 'content-type': 'application/json' } });
    return new Response(JSON.stringify({ id: 'fake' }), { status: 200, headers: { 'content-type': 'application/json' } });
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
