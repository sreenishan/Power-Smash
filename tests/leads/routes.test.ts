import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
vi.mock('@vercel/functions', () => ({ waitUntil: vi.fn() })); // after-response.ts calls waitUntil from @vercel/functions
import { waitUntil as vercelWaitUntil } from '@vercel/functions';
import { env as mockEnv } from '../mocks/runtime-env';
import { installRequestContext } from '../mocks/request-context';
import { hasRequestContext } from '../../src/lib/after-response';
import { getLeadConfig, getRuntimeEnv } from '../../src/lib/runtime-env';
import { ALL as eventAll, POST as eventPost } from '../../src/pages/api/event';
import { GET as healthGet, HEAD as healthHead } from '../../src/pages/api/health';
import { ALL as leadAll, POST as leadPost, prerender as leadPrerender } from '../../src/pages/api/lead';
import { coverageBody, createWorld, fakeEnv, FAKE, leadRequest, readJson } from './helpers';

// Values are set through tests/mocks/runtime-env.ts (writes to process.env).
const setEnv = (values: Record<string, string | undefined>) => {
  for (const k of Object.keys(mockEnv)) delete mockEnv[k];
  for (const [k, v] of Object.entries(values)) if (v !== undefined) mockEnv[k] = v;
};

let removeContext: (() => void) | null = null;

beforeEach(() => setEnv({}));
afterEach(() => {
  setEnv({});
  vi.unstubAllGlobals();
  removeContext?.();
  removeContext = null;
});

describe('runtime env', () => {
  it('reads the runtime environment (process.env) and ignores unknown or blank names', async () => {
    setEnv({ ...fakeEnv(), RESEND_API_KEY: '   ', SOMETHING_ELSE: 'x' });
    const rt = await getRuntimeEnv();
    expect(rt.SUPABASE_SECRET_KEY).toBe(FAKE.supabaseSecret);
    expect(rt.RESEND_API_KEY).toBeUndefined();
    expect((rt as Record<string, unknown>).SOMETHING_ELSE).toBeUndefined();
  });

  it('builds a typed config; email stays off unless EMAIL_ENABLED is exactly "true"', async () => {
    setEnv({ ...fakeEnv(), EMAIL_ENABLED: 'yes', RESEND_API_KEY: FAKE.resendKey });
    expect((await getLeadConfig()).emailEnabled).toBe(false);
    setEnv({ ...fakeEnv(), EMAIL_ENABLED: 'true', RESEND_API_KEY: FAKE.resendKey });
    expect((await getLeadConfig()).emailEnabled).toBe(true);
    setEnv({});
    const empty = await getLeadConfig();
    expect(empty.supabaseSecretKey).toBeNull();
    expect(empty.emailEnabled).toBe(false);
  });

  it('has no rate limiting bindings on Vercel: strings in the environment never become bindings', async () => {
    (mockEnv as Record<string, unknown>).LEAD_RATE_LIMITER = 'not a binding';
    (mockEnv as Record<string, unknown>).EVENT_RATE_LIMITER = { limit: async () => ({ success: true }) };
    const rt = await getRuntimeEnv();
    expect(rt.LEAD_RATE_LIMITER).toBeUndefined();
    expect(rt.EVENT_RATE_LIMITER).toBeUndefined();
  });
});

describe('src/pages/api/lead.ts (thin wrapper)', () => {
  it('is an on-demand route', () => {
    expect(leadPrerender).toBe(false);
  });

  it('POST builds the handler from the runtime environment and stores a lead end to end (mocked services), the alert running after the response when Vercel provides waitUntil', async () => {
    setEnv(fakeEnv());
    const world = createWorld();
    vi.stubGlobal('fetch', world.fetch);
    const waitUntil = vi.mocked(vercelWaitUntil);
    waitUntil.mockClear();
    removeContext = installRequestContext(); // a request context with a waitUntil, as on Vercel
    const res = await leadPost({ request: leadRequest(coverageBody()) } as never);
    expect(res.status).toBe(201);
    expect((await readJson(res)).ok).toBe(true);
    expect(world.leads).toHaveLength(1);
    expect(waitUntil).toHaveBeenCalled(); // the alert runs after the response
    await Promise.all(waitUntil.mock.calls.map((c) => c[0]));
    expect(world.telegramMessages()).toHaveLength(1);
  });

  it('POST with NO request context awaits the owner alert before answering (the alert is never left to a frozen function)', async () => {
    setEnv(fakeEnv());
    const world = createWorld();
    vi.stubGlobal('fetch', world.fetch);
    const waitUntil = vi.mocked(vercelWaitUntil);
    waitUntil.mockClear();
    expect(hasRequestContext()).toBe(false);
    const res = await leadPost({ request: leadRequest(coverageBody()) } as never);
    expect(res.status).toBe(201);
    expect(world.leads).toHaveLength(1);
    expect(waitUntil).not.toHaveBeenCalled();
    // nothing awaited after the response: the alert is already out
    expect(world.telegramMessages()).toHaveLength(1);
  });

  it('POST with no configuration degrades to the WhatsApp fallback instead of throwing', async () => {
    setEnv({});
    vi.stubGlobal('fetch', createWorld().fetch);
    const res = await leadPost({ request: leadRequest(coverageBody()), locals: {} } as never);
    expect(res.status).toBe(503);
    expect((await readJson(res)).code).toBe('degraded');
  });

  it('any other method gets a small JSON 405', async () => {
    const res = await leadAll({ request: new Request('https://x.test/api/lead') } as never);
    expect(res.status).toBe(405);
    expect(res.headers.get('allow')).toBe('POST');
    expect((await readJson(res)).ok).toBe(false);
  });
});

describe('src/pages/api/event.ts and health.ts', () => {
  it('event POST stores an event; other methods get 405', async () => {
    setEnv(fakeEnv());
    const world = createWorld();
    vi.stubGlobal('fetch', world.fetch);
    const req = new Request(`${FAKE.origin}/api/event`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', origin: FAKE.origin, 'user-agent': 'Mozilla/5.0 Chrome', 'x-vercel-forwarded-for': FAKE.ip },
      body: JSON.stringify({ name: 'whatsapp_click', path: '/services', props: { context: 'header' } }),
    });
    expect((await eventPost({ request: req } as never)).status).toBe(204);
    expect(world.events).toHaveLength(1);
    expect((await eventAll({ request: new Request('https://x.test/api/event') } as never)).status).toBe(405);
  });

  it('health GET and HEAD answer 200 with no network access', async () => {
    setEnv(fakeEnv());
    const spy = vi.fn();
    vi.stubGlobal('fetch', spy);
    const res = await healthGet({ request: new Request('https://x.test/api/health') } as never);
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ ok: true, lead: 'ready' });
    const head = await healthHead({ request: new Request('https://x.test/api/health', { method: 'HEAD' }) } as never);
    expect(head.status).toBe(200);
    expect(spy).not.toHaveBeenCalled();
  });
});
