import { describe, expect, it } from 'vitest';
import { TURNSTILE_VERIFY_URL, verifyTurnstile } from '../../src/lib/security/turnstile';
import { buildLeadConfig, leadEndpointConfigured, leadEndpointStatus, TURNSTILE_TEST_SECRETS } from '../../src/lib/leads/config';

const respond = (body: unknown, status = 200) => (async () => new Response(JSON.stringify(body), { status })) as unknown as typeof fetch;
const base = { secret: 'fake-secret', token: 'tok', expectedHostnames: ['site.example.test'], expectedAction: 'lead', testMode: false } as const;

describe('verifyTurnstile (fail closed)', () => {
  it('posts JSON to the documented siteverify endpoint', async () => {
    let seen: { url: string; init: RequestInit | undefined } | undefined;
    const f = (async (url: string, init?: RequestInit) => {
      seen = { url, init };
      return new Response(JSON.stringify({ success: true, hostname: 'site.example.test', action: 'lead' }));
    }) as unknown as typeof fetch;
    expect(await verifyTurnstile({ ...base, fetch: f, remoteIp: '203.0.113.7' })).toEqual({ ok: true });
    expect(seen?.url).toBe(TURNSTILE_VERIFY_URL);
    expect(TURNSTILE_VERIFY_URL).toBe('https://challenges.cloudflare.com/turnstile/v0/siteverify');
    expect(JSON.parse(String(seen?.init?.body))).toEqual({ secret: 'fake-secret', response: 'tok', remoteip: '203.0.113.7' });
  });

  it('every failure path is a refusal', async () => {
    expect(await verifyTurnstile({ ...base, secret: null, fetch: respond({}) })).toEqual({ ok: false, reason: 'unconfigured' });
    expect(await verifyTurnstile({ ...base, fetch: respond({ success: false, 'error-codes': ['timeout-or-duplicate'] }) })).toEqual({ ok: false, reason: 'rejected' });
    expect(await verifyTurnstile({ ...base, fetch: respond({ success: 'true' }) })).toEqual({ ok: false, reason: 'rejected' });
    expect(await verifyTurnstile({ ...base, fetch: respond({}, 500) })).toEqual({ ok: false, reason: 'unavailable' });
    expect(await verifyTurnstile({ ...base, fetch: (async () => { throw new TypeError('x'); }) as unknown as typeof fetch })).toEqual({ ok: false, reason: 'unavailable' });
    expect(await verifyTurnstile({ ...base, fetch: (async () => new Response('<html>', { status: 200 })) as unknown as typeof fetch })).toEqual({ ok: false, reason: 'unavailable' });
    expect(await verifyTurnstile({ ...base, fetch: respond({ success: true, hostname: 'evil.example', action: 'lead' }) })).toEqual({ ok: false, reason: 'hostname_mismatch' });
    expect(await verifyTurnstile({ ...base, fetch: respond({ success: true, action: 'lead' }) })).toEqual({ ok: false, reason: 'hostname_mismatch' });
    expect(await verifyTurnstile({ ...base, fetch: respond({ success: true, hostname: 'site.example.test', action: 'login' }) })).toEqual({ ok: false, reason: 'action_mismatch' });
  });

  it('hostname comparison ignores case; an empty hostname list or a null action skips that check', async () => {
    expect((await verifyTurnstile({ ...base, fetch: respond({ success: true, hostname: 'SITE.example.test', action: 'lead' }) })).ok).toBe(true);
    expect((await verifyTurnstile({ ...base, expectedHostnames: [], expectedAction: null, fetch: respond({ success: true }) })).ok).toBe(true);
  });

  it("Cloudflare's published test mode skips both checks (the dummy answer is hostname localhost, action test)", async () => {
    expect((await verifyTurnstile({ ...base, testMode: true, fetch: respond({ success: true, hostname: 'localhost', action: 'test' }) })).ok).toBe(true);
    expect((await verifyTurnstile({ ...base, testMode: true, fetch: respond({ success: false }) })).ok).toBe(false);
  });
});

describe('R-TURNSTILE-TEST: published test secrets are accepted only with TURNSTILE_ALLOW_TEST_KEYS=true (S-1)', () => {
  const testSecret = TURNSTILE_TEST_SECRETS[0];
  const full = { SUPABASE_URL: 'https://fakeref.supabase.co', SUPABASE_SECRET_KEY: ['sb', 'secret', 'FAKE'].join('_'), HMAC_KEY: `k1:${'a1b2c3d4'.repeat(6)}` };

  it('test mode needs BOTH a published test secret and the variable exactly "true"; the key shape alone never switches it on', () => {
    for (const s of TURNSTILE_TEST_SECRETS) {
      const off = buildLeadConfig({ TURNSTILE_SECRET_KEY: s });
      expect(off.turnstileSecretIsTestValue).toBe(true);
      expect(off.turnstileAllowTestKeys).toBe(false);
      expect(off.turnstileTestMode).toBe(false);
      expect(off.turnstileAction).toBe('lead'); // the checks stay on
      const on = buildLeadConfig({ TURNSTILE_SECRET_KEY: s, TURNSTILE_ALLOW_TEST_KEYS: 'true' });
      expect(on.turnstileTestMode).toBe(true);
      expect(on.turnstileAction).toBeNull();
    }
    for (const v of ['TRUE', 'True', '1', 'yes', 'on', ' ', '']) {
      expect(buildLeadConfig({ TURNSTILE_SECRET_KEY: testSecret, TURNSTILE_ALLOW_TEST_KEYS: v }).turnstileTestMode, JSON.stringify(v)).toBe(false);
    }
  });

  it('a real secret is never put into test mode, with or without the variable; checks stay on', () => {
    for (const allow of [undefined, 'true']) {
      const real = buildLeadConfig({ TURNSTILE_SECRET_KEY: 'a-real-looking-secret', TURNSTILE_ALLOW_TEST_KEYS: allow });
      expect(real.turnstileSecretIsTestValue).toBe(false);
      expect(real.turnstileTestMode).toBe(false);
      expect(real.turnstileAction).toBe('lead');
    }
    expect(buildLeadConfig({ TURNSTILE_SECRET_KEY: 'x', TURNSTILE_EXPECTED_ACTION: '-' }).turnstileAction).toBeNull();
    expect(buildLeadConfig({ TURNSTILE_SECRET_KEY: 'x', TURNSTILE_EXPECTED_HOSTNAMES: 'A.example.test, b.example.test' }).turnstileHostnames).toEqual(['a.example.test', 'b.example.test']);
  });

  it('a test secret without the variable is NOT ready (reason turnstile_test_key); with it, or with a real secret, it is', () => {
    const blocked = leadEndpointStatus(buildLeadConfig({ ...full, TURNSTILE_SECRET_KEY: testSecret }));
    expect(blocked).toEqual({ ready: false, reason: 'turnstile_test_key' });
    expect(leadEndpointConfigured(buildLeadConfig({ ...full, TURNSTILE_SECRET_KEY: testSecret }))).toBe(false);
    expect(leadEndpointStatus(buildLeadConfig({ ...full, TURNSTILE_SECRET_KEY: testSecret, TURNSTILE_ALLOW_TEST_KEYS: 'true' }))).toEqual({ ready: true });
    expect(leadEndpointStatus(buildLeadConfig({ ...full, TURNSTILE_SECRET_KEY: 'a-real-looking-secret' }))).toEqual({ ready: true });
  });

  it('hostname and action are checked in every non-test mode, even with TURNSTILE_ALLOW_TEST_KEYS=true and a real secret', async () => {
    const cfg = buildLeadConfig({ TURNSTILE_SECRET_KEY: 'a-real-looking-secret', TURNSTILE_ALLOW_TEST_KEYS: 'true', TURNSTILE_EXPECTED_HOSTNAMES: 'site.example.test' });
    const run = (body: unknown) =>
      verifyTurnstile({ fetch: respond(body), secret: cfg.turnstileSecret, token: 't', expectedHostnames: cfg.turnstileHostnames, expectedAction: cfg.turnstileAction, testMode: cfg.turnstileTestMode });
    expect(await run({ success: true, hostname: 'localhost', action: 'test' })).toEqual({ ok: false, reason: 'hostname_mismatch' });
    expect(await run({ success: true, hostname: 'site.example.test', action: 'test' })).toEqual({ ok: false, reason: 'action_mismatch' });
    expect((await run({ success: true, hostname: 'site.example.test', action: 'lead' })).ok).toBe(true);
  });
});
