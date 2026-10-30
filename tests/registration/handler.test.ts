// POST /api/register (src/lib/registration/handler.ts) with a fake store, an in-memory rate store and a mocked fetch (Turnstile,
// Telegram). Fictional data only.
import { describe, expect, it } from 'vitest';
import { createRegistrationHandler, registrationSwitchOn, REGISTRATION_RATE_RULES } from '../../src/lib/registration/handler';
import { REGISTRATION_REF_PATTERN, type RegistrationErrorResponse, type RegistrationSuccessResponse } from '../../src/lib/registration/constants';
import { REGISTRATION_CONSENT } from '../../src/lib/registration/consent';
import type { SubmitOutcome } from '../../src/lib/registration/store';
import { body, fakeStore, memoryRateStore, mockFetch, NOW, post, seqBytes, testConfig, uuid } from './helpers';

function setup(o: { enabled?: boolean; store?: ReturnType<typeof fakeStore>; fetch?: ReturnType<typeof mockFetch>; config?: ReturnType<typeof testConfig> } = {}) {
  const f = o.fetch ?? mockFetch();
  const s = o.store ?? fakeStore();
  const rate = memoryRateStore();
  const logs: Array<Record<string, unknown>> = [];
  const handle = createRegistrationHandler({
    config: o.config ?? testConfig(),
    enabled: o.enabled ?? true,
    fetch: f.fetch,
    now: () => NOW,
    randomBytes: seqBytes(),
    log: (e) => logs.push({ ...e }),
    store: s.store,
    rateStore: rate,
  });
  return { handle, f, s, rate, logs };
}
const read = async <T>(r: Response): Promise<T> => (await r.json()) as T;

describe('the switch', () => {
  it('is on only for exactly "true"', () => {
    const on = { registrations: true };
    expect(registrationSwitchOn({ REGISTRATION_ENABLED: 'true' }, on)).toBe(true);
    for (const v of [undefined, '', 'TRUE', 'True', '1', 'yes', ' true', 'true ']) expect(registrationSwitchOn({ REGISTRATION_ENABLED: v }, on)).toBe(false);
    // the legal flag is needed too: the variable alone never opens the endpoint (the real flags are off today)
    expect(registrationSwitchOn({ REGISTRATION_ENABLED: 'true' }, { registrations: false })).toBe(false);
    expect(registrationSwitchOn({ REGISTRATION_ENABLED: 'true' }, { registrations: 'true' })).toBe(false);
    expect(registrationSwitchOn({ REGISTRATION_ENABLED: 'true' })).toBe(false);
  });

  it('off: every POST gets "closed" (409) and nothing is read, verified or stored', async () => {
    const t = setup({ enabled: false });
    const r = await t.handle(post(body()));
    expect(r.status).toBe(409);
    expect((await read<RegistrationErrorResponse>(r)).code).toBe('closed');
    expect(t.f.calls).toHaveLength(0);
    expect(t.s.submitted).toHaveLength(0);
    expect(t.rate.hits).toHaveLength(0);
  });

  it('off: even a malformed body is just "closed" (the body is never parsed)', async () => {
    const t = setup({ enabled: false });
    const r = await t.handle(post('{not json'));
    expect((await read<RegistrationErrorResponse>(r)).code).toBe('closed');
  });
});

describe('success', () => {
  it('stores through registration_submit and answers 201 with a PSR reference, the fee and a WhatsApp link without personal data', async () => {
    const t = setup();
    const r = await t.handle(post(body()));
    expect(r.status).toBe(201);
    expect(r.headers.get('cache-control')).toBe('no-store');
    const j = await read<RegistrationSuccessResponse>(r);
    expect(j.ok).toBe(true);
    expect(j.ref).toMatch(REGISTRATION_REF_PATTERN);
    expect(j.feePaise).toBe(50_000);
    expect(j.waLink).toContain('wa.me/910000000000');
    expect(decodeURIComponent(j.waLink ?? '')).not.toMatch(/Alpha|9000000001|example\.test|UTR/i);
    const rec = t.s.submitted[0];
    expect(rec).toMatchObject({
      eventId: 'e0000000-0000-4000-8000-000000000001',
      player1Name: 'Fake Reg Alpha',
      player2Name: null,
      phone: '919000000001',
      email: 'alpha@example.test',
      whatsappOk: true,
      paymentReference: 'UTR0000111122',
      consentId: REGISTRATION_CONSENT.id,
      consentVersion: REGISTRATION_CONSENT.version,
      consentText: REGISTRATION_CONSENT.text,
    });
    expect(rec?.ipHash).toMatch(/^k1\./);
    expect(JSON.stringify(rec)).not.toContain('203.0.113.7');
  });

  it('the owner alert holds kind, reference, initial, event and pointer only: no name, phone, email, reference text or link', async () => {
    const t = setup();
    const j = await read<RegistrationSuccessResponse>(await t.handle(post(body({ player1Name: 'Fake Reg Alpha' }))));
    const tg = t.f.calls.find((c) => c.url.includes('api.telegram.org'));
    expect(tg).toBeDefined();
    const text = JSON.parse(tg?.body ?? '{}').text as string;
    expect(text).toContain(`New registration ${j.ref}`);
    expect(text).toContain('Event: MS');
    expect(text).toContain('Player initial: F');
    expect(text).toContain('Registrations');
    expect(text).not.toMatch(/Fake Reg|Alpha|9000000001|91900|example\.test|UTR0000|wa\.me|https?:/i);
  });

  it('TELEGRAM_ALERT_PHONE_LINK=true does NOT add the phone to a registration alert', async () => {
    const t = setup({ config: testConfig({ TELEGRAM_ALERT_PHONE_LINK: 'true' }) });
    await t.handle(post(body()));
    const text = JSON.parse(t.f.calls.find((c) => c.url.includes('api.telegram.org'))?.body ?? '{}').text as string;
    expect(text).not.toMatch(/9000000001|wa\.me/);
  });

  it('a doubles registration sends both names; the server never sends an age', async () => {
    const t = setup();
    await t.handle(post(body({ player2Name: '  Fake   Reg Bravo ' })));
    expect(t.s.submitted[0]?.player2Name).toBe('Fake Reg Bravo');
    expect(Object.keys(t.s.submitted[0] ?? {})).not.toContain('ageGroup');
  });
});

describe('refusals before the database', () => {
  it('wrong method, origin and content type', async () => {
    const t = setup();
    expect((await t.handle(new Request('https://fake-site.example/api/register', { method: 'GET' }))).status).toBe(405);
    expect((await t.handle(post(body(), { origin: 'https://evil.example' }))).status).toBe(403);
    expect((await t.handle(post(body(), { 'content-type': 'text/plain' }))).status).toBe(415);
    expect((await t.handle(post('x'.repeat(9000)))).status).toBe(413);
    expect((await t.handle(post('[1,2]'))).status).toBe(400);
    expect(t.s.submitted).toHaveLength(0);
  });

  it('a self-claimed age group, a card field or any unknown key is refused (strict shape)', async () => {
    const t = setup();
    for (const extra of [{ ageGroup: 'U19' }, { dateOfBirth: '2010-01-01' }, { cardNumber: '4111111111111111' }, { upiPin: '1234' }]) {
      const r = await t.handle(post(body(extra)));
      expect(r.status).toBe(422);
      expect((await read<RegistrationErrorResponse>(r)).code).toBe('validation');
    }
    expect(t.s.submitted).toHaveLength(0);
  });

  it('a card number as the payment reference is refused with its own code and never stored or echoed', async () => {
    const t = setup();
    const r = await t.handle(post(body({ paymentReference: '4111 1111 1111 1111' })));
    const j = await read<RegistrationErrorResponse>(r);
    expect(j.fieldErrors).toEqual({ paymentReference: 'card_not_allowed' });
    expect(JSON.stringify(j)).not.toContain('4111');
    expect(t.s.submitted).toHaveLength(0);
  });

  it('bad fields come back as codes only (never the values)', async () => {
    const t = setup();
    const j = await read<RegistrationErrorResponse>(await t.handle(post(body({ player1Name: '<b>x', phone: '12', email: 'not-an-email', consent: { id: 'registration-notice', version: 'old', given: true } }))));
    expect(j.fieldErrors).toEqual({ player1Name: 'invalid', phone: 'invalid_phone', email: 'invalid_email', consent: 'consent_required' });
    expect(JSON.stringify(j)).not.toMatch(/not-an-email|<b>/);
  });

  it('the tick box is checked on the server: given false is consent_required, a body without given is refused, nothing stored', async () => {
    const t = setup();
    const notTicked = await read<RegistrationErrorResponse>(await t.handle(post(body({ consent: { id: REGISTRATION_CONSENT.id, version: REGISTRATION_CONSENT.version, given: false } }))));
    expect(notTicked.ok).toBe(false);
    expect(notTicked.fieldErrors).toEqual({ consent: 'consent_required' });
    const noField = await read<RegistrationErrorResponse>(await t.handle(post(body({ consent: { id: REGISTRATION_CONSENT.id, version: REGISTRATION_CONSENT.version } }))));
    expect(noField.ok).toBe(false);
    expect(noField.code).toBe('validation');
    expect(t.s.submitted).toHaveLength(0);
  });

  it('a missing token is a spam-check failure', async () => {
    const t = setup();
    const j = await read<RegistrationErrorResponse>(await t.handle(post(body({ token: '' }))));
    expect(j.code).toBe('turnstile');
  });

  it('honeypot: a normal-looking success, nothing stored, no alert', async () => {
    const t = setup();
    const r = await t.handle(post(body({ website: 'http://spam.example' })));
    expect(r.status).toBe(201);
    expect((await read<RegistrationSuccessResponse>(r)).ref).toMatch(REGISTRATION_REF_PATTERN);
    expect(t.s.submitted).toHaveLength(0);
    expect(t.f.calls).toHaveLength(0);
  });

  it('too fast: rate_limited with a retry time', async () => {
    const t = setup();
    const r = await t.handle(post(body({ elapsedMs: 200 })));
    expect(r.status).toBe(429);
    expect(r.headers.get('retry-after')).toBe('5');
  });

  it('unconfigured (no secret key): degraded with the WhatsApp fallback, nothing sent anywhere', async () => {
    const f = mockFetch();
    const handle = createRegistrationHandler({ config: testConfig({ SUPABASE_SECRET_KEY: '' }), enabled: true, fetch: f.fetch, now: () => NOW, randomBytes: seqBytes(), log: () => undefined });
    const r = await handle(post(body()));
    expect(r.status).toBe(503);
    const j = await read<RegistrationErrorResponse>(r);
    expect(j.code).toBe('degraded');
    expect(j.waLink).toContain('wa.me/');
    expect(f.calls).toHaveLength(0);
  });

  it('a Turnstile failure stores nothing', async () => {
    const t = setup({ fetch: mockFetch({ success: false }) });
    const r = await t.handle(post(body()));
    expect(r.status).toBe(403);
    expect(t.s.submitted).toHaveLength(0);
  });

  it('the Turnstile hostname and action are checked (the lead widget action)', async () => {
    expect((await setup({ fetch: mockFetch({ success: true, hostname: 'other.example', action: 'lead' }) }).handle(post(body()))).status).toBe(403);
    expect((await setup({ fetch: mockFetch({ success: true, hostname: 'fake-site.example', action: 'other' }) }).handle(post(body()))).status).toBe(403);
  });
});

describe('idempotency and the database outcomes', () => {
  it('a retry with the same key gets the same reference back before Turnstile is asked again', async () => {
    const t = setup({ store: fakeStore({ lookup: { outcome: 'same', ref: 'PSR-2026-ABCDEF' } }) });
    const r = await t.handle(post(body()));
    expect(r.status).toBe(200);
    expect(await read<RegistrationSuccessResponse>(r)).toMatchObject({ ok: true, ref: 'PSR-2026-ABCDEF', replay: true });
    expect(t.f.calls.some((c) => c.url.includes('turnstile'))).toBe(false);
  });

  it('a key reused for other details: duplicate (409)', async () => {
    const t = setup({ store: fakeStore({ lookup: { outcome: 'different' } }) });
    expect((await read<RegistrationErrorResponse>(await t.handle(post(body())))).code).toBe('duplicate');
  });

  const cases: Array<[SubmitOutcome, number, string]> = [
    [{ outcome: 'closed' }, 409, 'closed'],
    [{ outcome: 'full' }, 409, 'full'],
    [{ outcome: 'already_registered' }, 409, 'already_registered'],
    [{ outcome: 'conflict' }, 409, 'duplicate'],
    [{ outcome: 'partner_required' }, 422, 'validation'],
    [{ outcome: 'partner_not_allowed' }, 422, 'validation'],
  ];
  for (const [outcome, status, code] of cases) {
    it(`database "${outcome.outcome}" -> ${status} ${code}, and the counters are given back`, async () => {
      const t = setup({ store: fakeStore({ submit: outcome }) });
      const r = await t.handle(post(body()));
      expect(r.status).toBe(status);
      const j = await read<RegistrationErrorResponse>(r);
      expect(j.code).toBe(code);
      if (outcome.outcome.startsWith('partner')) expect(j.fieldErrors).toEqual({ player2Name: outcome.outcome });
      expect(t.rate.hits.filter((h) => h.bucket !== 'reg_ip')).toHaveLength(0);
      expect(t.f.calls.some((c) => c.url.includes('api.telegram.org'))).toBe(false);
    });
  }

  it('a reference collision retries with a new reference', async () => {
    let n = 0;
    const t = setup({ store: fakeStore({ submit: (r) => (n++ === 0 ? { outcome: 'ref_taken' } : { outcome: 'created', id: uuid(5), ref: r.ref, feePaise: null, category: 'XD', ageGroup: null }) }) });
    const r = await t.handle(post(body({ player2Name: 'Fake Reg Bravo' })));
    expect(r.status).toBe(201);
    expect(t.s.submitted).toHaveLength(2);
    expect(t.s.submitted[0]?.ref).not.toBe(t.s.submitted[1]?.ref);
  });

  it('database down: degraded with a provisional reference, the owner is told it was NOT saved (no contact details)', async () => {
    const t = setup({ store: fakeStore({ throws: true }) });
    const r = await t.handle(post(body()));
    expect(r.status).toBe(503);
    const j = await read<RegistrationErrorResponse>(r);
    expect(j.code).toBe('degraded');
    expect(j.ref).toMatch(REGISTRATION_REF_PATTERN);
    expect(decodeURIComponent(j.waLink ?? '')).toContain(j.ref as string);
    const text = JSON.parse(t.f.calls.find((c) => c.url.includes('api.telegram.org'))?.body ?? '{}').text as string;
    expect(text).toContain('NOT SAVED');
    expect(text).not.toMatch(/Fake Reg|9000000001|example\.test|UTR/);
    expect(t.rate.hits.filter((h) => h.bucket !== 'reg_ip')).toHaveLength(0);
  });

  it('the counters fail closed: when they cannot be read, nothing is stored and the answer is degraded with the WhatsApp fallback', async () => {
    const f = mockFetch();
    const s = fakeStore();
    const broken = { ...memoryRateStore(), add: async () => { throw new Error('down'); }, count: async () => { throw new Error('down'); } };
    const handle = createRegistrationHandler({ config: testConfig(), enabled: true, fetch: f.fetch, now: () => NOW, randomBytes: seqBytes(), log: () => undefined, store: s.store, rateStore: broken });
    const r = await handle(post(body()));
    expect(r.status).toBe(503);
    expect((await read<RegistrationErrorResponse>(r)).code).toBe('degraded');
    expect(s.submitted).toHaveLength(0);
  });

  it('the per-phone limit refuses the sixth registration from one phone within an hour', async () => {
    const t = setup();
    const codes: number[] = [];
    for (let i = 0; i < REGISTRATION_RATE_RULES.phone[0].max + 1; i += 1) {
      codes.push((await t.handle(post(body({ idempotencyKey: uuid(100 + i), player1Name: `Fake Reg ${String.fromCharCode(65 + i)}` }), { 'x-vercel-forwarded-for': `203.0.113.${i + 10}` }))).status);
    }
    expect(codes.slice(0, -1).every((c) => c === 201)).toBe(true);
    expect(codes.at(-1)).toBe(429);
  });

  it('logs never hold a name, phone, email, token or payment reference', async () => {
    const t = setup();
    await t.handle(post(body()));
    await t.handle(post(body({ paymentReference: '4111111111111111' })));
    expect(JSON.stringify(t.logs)).not.toMatch(/Fake Reg|9000000001|example\.test|UTR|4111|fake-turnstile|203\.0\.113/);
  });
});
