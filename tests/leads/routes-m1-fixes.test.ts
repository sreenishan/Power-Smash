// Route-level regression tests for the M1 review-fix wave: S-1 (health and lead with a test Turnstile secret), the new Worker
// variable names, R-ACK-PROMISE plumbing (the route passes site.replyTimePromise), R-TELEGRAM-PHONE through the real route.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
vi.mock('@vercel/functions', () => ({ waitUntil: vi.fn() })); // after-response.ts calls waitUntil from @vercel/functions
import { waitUntil as vercelWaitUntil } from '@vercel/functions';
import { env as mockEnv } from '../mocks/runtime-env';
import { site } from '../../src/content/site';
import { getLeadConfig, getRuntimeEnv } from '../../src/lib/runtime-env';
import { GET as healthGet } from '../../src/pages/api/health';
import { POST as leadPost } from '../../src/pages/api/lead';
import { coverageBody, createWorld, fakeEnv, FAKE, leadRequest, readJson } from './helpers';

const setEnv = (values: Record<string, string | undefined>) => {
  for (const k of Object.keys(mockEnv)) delete mockEnv[k];
  for (const [k, v] of Object.entries(values)) if (v !== undefined) mockEnv[k] = v;
};
const TEST_SECRET = '1x0000000000000000000000000000000AA';

beforeEach(() => setEnv({}));
afterEach(() => {
  setEnv({});
  vi.unstubAllGlobals();
});

describe('runtime env: the new Worker variable names are read (and nothing else is invented)', () => {
  it('reads TURNSTILE_ALLOW_TEST_KEYS, TELEGRAM_ALERT_PHONE_LINK, SUPABASE_ALLOW_LOCAL_URL and LEAD_GLOBAL_HOURLY_CAP', async () => {
    setEnv({ ...fakeEnv(), TURNSTILE_ALLOW_TEST_KEYS: 'true', TELEGRAM_ALERT_PHONE_LINK: 'true', SUPABASE_ALLOW_LOCAL_URL: 'true', LEAD_GLOBAL_HOURLY_CAP: '12', LEAD_GLOBAL_DAILY_CAP: '30' });
    const rt = await getRuntimeEnv();
    expect(rt).toMatchObject({ TURNSTILE_ALLOW_TEST_KEYS: 'true', TELEGRAM_ALERT_PHONE_LINK: 'true', SUPABASE_ALLOW_LOCAL_URL: 'true', LEAD_GLOBAL_HOURLY_CAP: '12', LEAD_GLOBAL_DAILY_CAP: '30' });
    const c = await getLeadConfig();
    expect(c.turnstileAllowTestKeys).toBe(true);
    expect(c.telegramPhoneLink).toBe(true);
    expect(c.globalHourlyCap).toBe(12);
    expect(c.globalDailyCap).toBe(30);
  });

  it('defaults are all off: no test keys, no phone in alerts, no local Supabase URL, default cap, no reply promise', async () => {
    setEnv(fakeEnv());
    const c = await getLeadConfig();
    expect(c).toMatchObject({ turnstileAllowTestKeys: false, telegramPhoneLink: false, supabaseAllowLocalUrl: false, replyWindow: null });
    expect(c.globalHourlyCap).toBeGreaterThan(0);
  });

  it('getLeadConfig passes the caller-supplied reply window through', async () => {
    setEnv(fakeEnv());
    expect((await getLeadConfig({ replyWindow: '2 working days' })).replyWindow).toBe('2 working days');
    expect((await getLeadConfig({ replyWindow: '  ' })).replyWindow).toBeNull();
    expect((await getLeadConfig({ replyWindow: null })).replyWindow).toBeNull();
  });
});

describe('S-1 through the real routes', () => {
  it('/api/health reports ready:false with a reason for a test secret without the allow variable', async () => {
    setEnv({ ...fakeEnv(), TURNSTILE_SECRET_KEY: TEST_SECRET });
    const body = (await (await healthGet({ request: new Request('https://x.test/api/health') } as never)).json()) as Record<string, unknown>;
    expect(body).toEqual({ ok: true, service: 'power-smash', lead: 'unconfigured', ready: false, reason: 'turnstile_test_key' });
    setEnv({ ...fakeEnv(), TURNSTILE_SECRET_KEY: TEST_SECRET, TURNSTILE_ALLOW_TEST_KEYS: 'true' });
    expect(await (await healthGet({ request: new Request('https://x.test/api/health') } as never)).json()).toMatchObject({ lead: 'ready', ready: true, testMode: true });
  });

  it('/api/lead with a test secret and no allow variable fails closed (503 degraded), whatever token is sent', async () => {
    setEnv({ ...fakeEnv(), TURNSTILE_SECRET_KEY: TEST_SECRET, TURNSTILE_EXPECTED_HOSTNAMES: undefined });
    const world = createWorld();
    vi.stubGlobal('fetch', world.fetch);
    const res = await leadPost({ request: leadRequest(coverageBody({ token: 'anything' })), locals: {} } as never);
    expect(res.status).toBe(503);
    expect((await readJson(res)).code).toBe('degraded');
    expect(world.calls).toHaveLength(0);
  });
});

describe('R-TELEGRAM-PHONE and R-ACK-PROMISE through /api/lead', () => {
  const emailOn = { EMAIL_ENABLED: 'true', RESEND_API_KEY: FAKE.resendKey, EMAIL_FROM: FAKE.emailFrom, OWNER_EMAIL: FAKE.ownerEmail };

  it('the Telegram alert has no phone by default; the acknowledgement promises no time while site.replyTimePromise is not set', async () => {
    expect(site.replyTimePromise).toBeNull(); // owner input still outstanding (OT-30); this test documents the default
    setEnv({ ...fakeEnv(), ...emailOn });
    const world = createWorld();
    vi.stubGlobal('fetch', world.fetch);
    const waitUntil = vi.mocked(vercelWaitUntil);
    waitUntil.mockClear();
    const res = await leadPost({ request: leadRequest(coverageBody({ email: 'ravi@example.test', source: { path: '/book/' } })) } as never);
    expect(res.status).toBe(201);
    await Promise.all(waitUntil.mock.calls.map((c) => c[0]));
    const telegram = world.telegramMessages()[0] as string;
    expect(telegram).not.toMatch(/wa\.me|9876543210|ravi@example/);
    expect(telegram).toContain('Page: /book/');
    const ack = world.resendMails().find((m) => m.to === 'ravi@example.test');
    expect(ack?.text).toContain('We will get back to you as soon as we can.');
    expect(ack?.text).not.toMatch(/24 hours|within/i);
  });

  it('TELEGRAM_ALERT_PHONE_LINK=true brings the WhatsApp reply link back', async () => {
    setEnv({ ...fakeEnv(), TELEGRAM_ALERT_PHONE_LINK: 'true' });
    const world = createWorld();
    vi.stubGlobal('fetch', world.fetch);
    const waitUntil = vi.mocked(vercelWaitUntil);
    waitUntil.mockClear();
    await leadPost({ request: leadRequest(coverageBody()) } as never);
    await Promise.all(waitUntil.mock.calls.map((c) => c[0]));
    expect(world.telegramMessages()[0]).toContain('https://wa.me/919876543210?text=');
  });
});
