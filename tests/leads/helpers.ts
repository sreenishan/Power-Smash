// Shared test helpers for the lead backend: fake config (fake secrets only), a deterministic random source, and an
// in-memory fake of the four services the endpoint talks to (Supabase REST, Turnstile siteverify, Telegram, Resend).
// Nothing here makes a network call.
import { buildLeadConfig, type LeadHandlerConfig } from '../../src/lib/leads/config';
import type { LeadHandlerDeps, LogEntry } from '../../src/lib/leads/handler';
import { CONSENT } from '../../src/content/consent';

export const FAKE = {
  supabaseUrl: 'https://fakeref.supabase.co',
  // Built at run time: no secret-shaped literal may sit in the source (the CI secret scan would flag it).
  supabaseSecret: ['sb', 'secret', 'FAKEFAKEFAKEFAKEFAKEFAKE0000'].join('_'),
  turnstileSecret: 'fake-turnstile-secret-not-real',
  hmacKey: `k1:${'a1b2c3d4'.repeat(6)}`,
  telegramToken: '123456789:FAKE-telegram-token-not-real',
  telegramChat: '5550001',
  resendKey: 're_FAKE_not_a_real_key',
  emailFrom: 'Power Smash <hello@mail.example.test>',
  ownerEmail: 'owner@example.test',
  whatsapp: '919999900000',
  origin: 'https://powersmash.example.test',
  ip: '203.0.113.7',
} as const;

export const NOW = new Date('2026-11-02T10:15:30Z');

export function fakeEnv(overrides: Record<string, string | undefined> = {}) {
  return {
    SUPABASE_URL: FAKE.supabaseUrl,
    SUPABASE_SECRET_KEY: FAKE.supabaseSecret,
    TURNSTILE_SECRET_KEY: FAKE.turnstileSecret,
    TURNSTILE_EXPECTED_HOSTNAMES: 'powersmash.example.test',
    HMAC_KEY: FAKE.hmacKey,
    TELEGRAM_BOT_TOKEN: FAKE.telegramToken,
    TELEGRAM_CHAT_ID: FAKE.telegramChat,
    PUBLIC_WHATSAPP_NUMBER: FAKE.whatsapp,
    PUBLIC_SITE_URL: FAKE.origin,
    ...overrides,
  } as Record<string, string | undefined>;
}

export function fakeConfig(overrides: Record<string, string | undefined> = {}): LeadHandlerConfig {
  const env = fakeEnv(overrides);
  for (const k of Object.keys(env)) if (env[k] === undefined) delete env[k];
  return buildLeadConfig(env);
}

/** Deterministic, never-repeating byte source (so reference codes differ and tests are reproducible). */
export function seqRandom(seed = 1) {
  let c = seed;
  return (n: number): Uint8Array => {
    const out = new Uint8Array(n);
    for (let i = 0; i < n; i += 1) {
      c = (c * 1103515245 + 12345) & 0x7fffffff;
      out[i] = (c >> 16) & 0xff;
    }
    return out;
  };
}

export interface RecordedCall {
  url: string;
  host: string;
  path: string;
  method: string;
  headers: Record<string, string>;
  json: unknown;
  rawBody: string | undefined;
}

type Row = Record<string, unknown>;

export interface FakeWorld {
  fetch: typeof fetch;
  calls: RecordedCall[];
  leads: Row[];
  leadEvents: Row[];
  events: Row[];
  hits: Row[];
  salts: Row[];
  noticeVersions: Row[];
  consentEvents: Row[];
  /** Optional per-call delay in ms for every Supabase call: desynchronises concurrent requests so races show up (tests set it). */
  delayMs: (() => number) | null;
  // behaviour switches
  turnstile: { mode: 'pass' | 'fail' | 'throw' | 'http500'; hostname: string; action: string | undefined };
  telegram: { mode: 'ok' | 'fail' | 'throw' | 'http500' };
  resend: { mode: 'ok' | 'fail' | 'throw' };
  db: { down: boolean; failLeadInsert: boolean; failRateStore: boolean; failChildInsert: boolean; failConsent: boolean; refCollisions: number };
  callsTo(host: string): RecordedCall[];
  telegramMessages(): string[];
  resendMails(): Array<{ to: string; subject: string; text: string; headers: Record<string, string> }>;
}

const json = (body: unknown, status = 200, headers: Record<string, string> = {}): Response =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json', ...headers } });

const pgError = (status: number, code: string, message: string): Response =>
  json({ code, message, details: 'Key (phone)=(919876543210) already exists.', hint: null }, status);

function filterRows(rows: Row[], params: URLSearchParams): Row[] {
  let out = rows;
  for (const [key, value] of params.entries()) {
    if (['select', 'limit', 'on_conflict', 'order'].includes(key)) continue;
    const m = /^(eq|gte|lt)\.(.*)$/.exec(value);
    if (!m) continue;
    const [, op, rhs] = m;
    out = out.filter((r) => {
      const v = r[key];
      if (op === 'eq') return String(v) === rhs;
      if (key.endsWith('_at') || key === 'hit_at') {
        const t = new Date(String(v)).getTime();
        const r2 = new Date(rhs as string).getTime();
        return op === 'gte' ? t >= r2 : t < r2;
      }
      return op === 'gte' ? String(v) >= (rhs as string) : String(v) < (rhs as string);
    });
  }
  return out;
}

export function createWorld(): FakeWorld {
  const world: FakeWorld = {
    calls: [],
    leads: [],
    leadEvents: [],
    events: [],
    hits: [],
    salts: [],
    noticeVersions: [],
    consentEvents: [],
    delayMs: null,
    turnstile: { mode: 'pass', hostname: 'powersmash.example.test', action: 'lead' },
    telegram: { mode: 'ok' },
    resend: { mode: 'ok' },
    db: { down: false, failLeadInsert: false, failRateStore: false, failChildInsert: false, failConsent: false, refCollisions: 0 },
    fetch: undefined as unknown as typeof fetch,
    callsTo(host) {
      return world.calls.filter((c) => c.host === host);
    },
    telegramMessages() {
      return world.callsTo('api.telegram.org').map((c) => (c.json as { text: string }).text);
    },
    resendMails() {
      return world.callsTo('api.resend.com').map((c) => {
        const j = c.json as { to: string; subject: string; text: string };
        return { to: j.to, subject: j.subject, text: j.text, headers: c.headers };
      });
    },
  };

  world.fetch = (async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    const url = new URL(typeof input === 'string' ? input : input instanceof URL ? input.href : input.url);
    const method = (init?.method ?? 'GET').toUpperCase();
    const headers: Record<string, string> = {};
    new Headers(init?.headers).forEach((v, k) => {
      headers[k] = v;
    });
    const rawBody = typeof init?.body === 'string' ? init.body : undefined;
    let parsed: unknown;
    try {
      parsed = rawBody ? JSON.parse(rawBody) : undefined;
    } catch {
      parsed = undefined;
    }
    world.calls.push({ url: url.href, host: url.host, path: url.pathname + url.search, method, headers, json: parsed, rawBody });

    // ---- Turnstile
    if (url.host === 'challenges.cloudflare.com') {
      if (world.turnstile.mode === 'throw') throw new TypeError('network');
      if (world.turnstile.mode === 'http500') return json({}, 500);
      if (world.turnstile.mode === 'fail') return json({ success: false, 'error-codes': ['invalid-input-response'] });
      return json({ success: true, hostname: world.turnstile.hostname, action: world.turnstile.action, challenge_ts: NOW.toISOString() });
    }
    // ---- Telegram
    if (url.host === 'api.telegram.org') {
      if (world.telegram.mode === 'throw') throw new TypeError('network');
      if (world.telegram.mode === 'http500') return json({ ok: false }, 500);
      if (world.telegram.mode === 'fail') return json({ ok: false, error_code: 403, description: 'Forbidden: bot was blocked by the user' }, 403);
      return json({ ok: true, result: { message_id: 1 } });
    }
    // ---- Resend
    if (url.host === 'api.resend.com') {
      if (world.resend.mode === 'throw') throw new TypeError('network');
      if (world.resend.mode === 'fail') return json({ message: 'bad' }, 403);
      return json({ id: 'fake-email-id' });
    }
    // ---- Supabase REST
    if (url.host === new URL(FAKE.supabaseUrl).host && url.pathname.startsWith('/rest/v1/')) {
      if (world.delayMs) await new Promise((resolve) => setTimeout(resolve, world.delayMs?.() ?? 0));
      if (world.db.down) return json({ message: 'down' }, 503);
      const table = url.pathname.replace('/rest/v1/', '');
      const params = url.searchParams;
      const prefer = headers.prefer ?? '';
      const body = parsed as Row | undefined;

      if (table === 'leads') {
        if (method === 'POST') {
          if (world.db.failLeadInsert) return json({ code: 'XX000', message: 'boom' }, 500);
          if (world.db.failChildInsert && body?.parent_lead_id) return json({ code: 'XX000', message: 'boom' }, 500);
          const row = body as Row;
          const ignore = prefer.includes('ignore-duplicates');
          if (world.db.refCollisions > 0) {
            world.db.refCollisions -= 1;
            return pgError(409, '23505', 'duplicate key value violates unique constraint "leads_ref_code_uq"');
          }
          if (row.idempotency_key && world.leads.some((l) => l.idempotency_key === row.idempotency_key)) {
            if (ignore) return new Response(null, { status: 201 });
            return pgError(409, '23505', 'duplicate key value violates unique constraint "leads_idempotency_key_uq"');
          }
          if (world.leads.some((l) => l.ref_code === row.ref_code)) return pgError(409, '23505', 'duplicate key value violates unique constraint "leads_ref_code_uq"');
          world.leads.push({ ...row });
          world.leadEvents.push({ lead_id: row.id, event: 'created', meta: { type: row.type } }); // the DB trigger
          return new Response(null, { status: 201 });
        }
        if (method === 'GET') return json(filterRows(world.leads, params).slice(0, 1));
        if (method === 'PATCH') {
          for (const r of filterRows(world.leads, params)) Object.assign(r, body);
          return new Response(null, { status: 204 });
        }
      }
      if (table === 'lead_events' && method === 'POST') {
        world.leadEvents.push({ ...(body as Row) });
        return new Response(null, { status: 201 });
      }
      if (table === 'rate_limit_hits') {
        if (world.db.failRateStore) return json({ code: 'XX000', message: 'boom' }, 500);
        if (method === 'HEAD') {
          const n = filterRows(world.hits, params).length;
          return new Response(null, { status: 200, headers: { 'content-range': n === 0 ? '*/0' : `0-${n - 1}/${n}` } });
        }
        if (method === 'GET') {
          let rows = filterRows(world.hits, params);
          if (params.get('order') === 'hit_at.asc') rows = [...rows].sort((a, b) => new Date(String(a.hit_at)).getTime() - new Date(String(b.hit_at)).getTime());
          return json(rows.slice(0, Number(params.get('limit') ?? rows.length)));
        }
        if (method === 'POST') {
          world.hits.push({ ...(body as Row) });
          return new Response(null, { status: 201 });
        }
        if (method === 'DELETE') {
          const doomed = new Set(filterRows(world.hits, params));
          world.hits = world.hits.filter((h) => !doomed.has(h));
          return new Response(null, { status: 204 });
        }
      }
      if (table === 'daily_salts') {
        if (method === 'GET') return json(filterRows(world.salts, params).slice(0, 1));
        if (method === 'POST') {
          const row = body as Row;
          if (!world.salts.some((s) => s.day === row.day)) world.salts.push({ ...row });
          return new Response(null, { status: 201 });
        }
        if (method === 'DELETE') {
          const doomed = new Set(filterRows(world.salts, params));
          world.salts = world.salts.filter((s) => !doomed.has(s));
          return new Response(null, { status: 204 });
        }
      }
      if (table === 'notice_versions' && method === 'POST') {
        if (world.db.failConsent) return json({ code: 'XX000', message: 'boom' }, 500);
        for (const r of (Array.isArray(parsed) ? parsed : [parsed]) as Row[]) {
          if (!world.noticeVersions.some((n) => n.id === r.id && n.version === r.version)) world.noticeVersions.push({ ...r });
        }
        return new Response(null, { status: 201 });
      }
      if (table === 'consent_events' && method === 'POST') {
        if (world.db.failConsent) return json({ code: 'XX000', message: 'boom' }, 500);
        for (const r of (Array.isArray(parsed) ? parsed : [parsed]) as Row[]) world.consentEvents.push({ ...r });
        return new Response(null, { status: 201 });
      }
      if (table === 'events' && method === 'POST') {
        world.events.push({ ...(body as Row) });
        return new Response(null, { status: 201 });
      }
    }
    return json({ message: `unhandled ${method} ${url.href}` }, 599);
  }) as typeof fetch;

  return world;
}

export interface Harness {
  deps: LeadHandlerDeps;
  logs: LogEntry[];
  later: Promise<unknown>[];
}

export function makeDeps(world: FakeWorld, overrides: Partial<LeadHandlerDeps> = {}, envOverrides: Record<string, string | undefined> = {}): Harness {
  const logs: LogEntry[] = [];
  const later: Promise<unknown>[] = [];
  const deps: LeadHandlerDeps = {
    config: fakeConfig(envOverrides),
    fetch: world.fetch,
    now: () => NOW,
    randomBytes: seqRandom(),
    log: (e) => logs.push(e),
    ...overrides,
  };
  return { deps, logs, later };
}

export const validUuid = (n = 1): string => `3f0c1d2e-5a6b-4c7d-8e9f-${String(n).padStart(12, '0')}`;

export function coverageBody(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    kind: 'coverage',
    name: 'Ravi Kumar',
    phone: '98765 43210',
    eventName: 'Chennai District Open 2026',
    startDate: '2026-12-05',
    district: 'Chennai',
    idempotencyKey: validUuid(1),
    token: 'XXXX.DUMMY.TOKEN.XXXX',
    consent: { id: CONSENT.leadNotice.id, version: CONSENT.leadNotice.version },
    ...overrides,
  };
}

export function leadRequest(body: unknown, init: { headers?: Record<string, string>; method?: string; rawBody?: string } = {}): Request {
  return new Request(`${FAKE.origin}/api/lead`, {
    method: init.method ?? 'POST',
    headers: {
      'content-type': 'application/json',
      origin: FAKE.origin,
      'x-vercel-forwarded-for': FAKE.ip,
      ...(init.headers ?? {}),
    },
    body: init.method === 'GET' ? undefined : (init.rawBody ?? JSON.stringify(body)),
  });
}

export async function readJson(res: Response): Promise<Record<string, unknown>> {
  return (await res.json()) as Record<string, unknown>;
}

/** A small deterministic pseudo-random delay source (0 to maxMs milliseconds) for FakeWorld.delayMs. */
export function jitter(maxMs: number, seed = 7): () => number {
  let c = seed;
  return () => {
    c = (c * 1103515245 + 12345) & 0x7fffffff;
    return (c >> 8) % (maxMs + 1);
  };
}
