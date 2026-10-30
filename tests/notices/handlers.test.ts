// The email-list endpoints (src/lib/notices/handlers.ts) with a fake store, an in-memory rate store and a mocked fetch (Turnstile,
// Resend). Fictional data only.
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { CONFIRM_ENDPOINT, SUBSCRIBE_ACCEPTED_MESSAGE, SUBSCRIBE_CONSENT, UNSUBSCRIBE_ENDPOINT, type SubscribeErrorResponse } from '../../src/lib/notices/constants';
import { createConfirmHandler, createSubscribeHandler, createUnsubscribeHandler, emailReady, escapeHtml, NOTIFY_RATE_RULES, PAGE_HEADERS } from '../../src/lib/notices/handlers';
import { alertsPageUsesStayUpdated, notifySubscribeSwitchOn } from '../../src/lib/notices/switches';
import { CONFIRM_TOKEN_PATTERN, tokenHash, unsubscribeSignature } from '../../src/lib/notices/tokens';
import { parseHmacKey } from '../../src/lib/security/hash';
import { body, FAKE, fakeSubscribers, form, memoryRateStore, mockFetch, NOW, post, seqBytes, testConfig, uuid } from './helpers';

const SUB = 'https://fake-site.example/api/notify/subscribe';

function setup(o: { enabled?: boolean; subs?: ReturnType<typeof fakeSubscribers>; config?: ReturnType<typeof testConfig>; turnstile?: Record<string, unknown> } = {}) {
  const f = mockFetch(o.turnstile);
  const s = o.subs ?? fakeSubscribers();
  const rate = memoryRateStore();
  const logs: Array<Record<string, unknown>> = [];
  const deps = { config: o.config ?? testConfig(), enabled: o.enabled ?? true, fetch: f.fetch, now: () => NOW, randomBytes: seqBytes(), log: (e: object) => logs.push({ ...e }), store: s.store, rateStore: rate };
  return { subscribe: createSubscribeHandler(deps), confirm: createConfirmHandler(deps), unsubscribe: createUnsubscribeHandler(deps), f, s, rate, logs };
}
const read = async <T>(r: Response): Promise<T> => (await r.json()) as T;
const resend = (t: ReturnType<typeof setup>) => t.f.calls.filter((c) => c.url.includes('api.resend.com'));

describe('switches', () => {
  it('NOTIFY_SUBSCRIBE_ENABLED is on only for exactly "true"', () => {
    const on = { emailNotifications: true };
    expect(notifySubscribeSwitchOn({ NOTIFY_SUBSCRIBE_ENABLED: 'true' }, on)).toBe(true);
    for (const v of [undefined, '', 'TRUE', '1', ' true', 'yes']) expect(notifySubscribeSwitchOn({ NOTIFY_SUBSCRIBE_ENABLED: v }, on)).toBe(false);
    // the legal flag is needed too: the variable alone never opens sign-up (the real flags are off today)
    expect(notifySubscribeSwitchOn({ NOTIFY_SUBSCRIBE_ENABLED: 'true' }, { emailNotifications: false })).toBe(false);
    expect(notifySubscribeSwitchOn({ NOTIFY_SUBSCRIBE_ENABLED: 'true' }, { emailNotifications: 'true' })).toBe(false);
    expect(notifySubscribeSwitchOn({ NOTIFY_SUBSCRIBE_ENABLED: 'true' })).toBe(false);
  });

  it('/alerts/ swaps in "Stay updated" only with the email list on; site notices alone keep the older blocks (never an empty page)', () => {
    expect(alertsPageUsesStayUpdated({ siteNotices: true, emailNotifications: false })).toBe(false);
    expect(alertsPageUsesStayUpdated({ siteNotices: false, emailNotifications: true })).toBe(true);
    expect(alertsPageUsesStayUpdated({})).toBe(false);
    const src = readFileSync(new URL('../../src/pages/alerts.astro', import.meta.url), 'utf8');
    expect(src).toContain('const stayUpdated = alertsPageUsesStayUpdated();');
    expect(src).not.toMatch(/siteNoticesFlag()/);
  });

  it('email is ready only with EMAIL_ENABLED exactly "true", a key, a From address and an https site', () => {
    expect(emailReady(testConfig())).toBe(true);
    expect(emailReady(testConfig({ EMAIL_ENABLED: 'TRUE' }))).toBe(false);
    expect(emailReady(testConfig({ RESEND_API_KEY: '' }))).toBe(false);
    expect(emailReady(testConfig({ EMAIL_FROM: '' }))).toBe(false);
    expect(emailReady(testConfig({ PUBLIC_SITE_URL: 'http://fake-site.example' }))).toBe(false);
  });

  it('off: closed (409) and nothing is read, checked, counted or stored', async () => {
    for (const t of [setup({ enabled: false }), setup({ config: testConfig({ EMAIL_ENABLED: 'false' }) })]) {
      const r = await t.subscribe(post(SUB, '{not json'));
      expect(r.status).toBe(409);
      expect((await read<SubscribeErrorResponse>(r)).code).toBe('closed');
      expect(t.f.calls).toHaveLength(0);
      expect(t.s.subscribed).toHaveLength(0);
      expect(t.rate.hits).toHaveLength(0);
    }
  });
});

describe('sign-up', () => {
  it('stores the normalised address with the notice and only a token HASH, then emails the confirmation link', async () => {
    const t = setup();
    const r = await t.subscribe(post(SUB, body()));
    expect(r.status).toBe(202);
    expect(await read(r)).toEqual({ ok: true, message: SUBSCRIBE_ACCEPTED_MESSAGE });
    const rec = t.s.subscribed[0];
    expect(rec).toMatchObject({ email: 'fake.reader@example.test', consentId: SUBSCRIBE_CONSENT.id, consentVersion: SUBSCRIBE_CONSENT.version });
    expect(rec?.tokenHash).toMatch(/^[0-9a-f]{64}$/);
    const mail = resend(t);
    expect(mail).toHaveLength(1);
    const sent = JSON.parse(mail[0]?.body ?? '{}') as { to: string; text: string; subject: string };
    expect(sent.to).toBe('fake.reader@example.test');
    const link = /https:\/\/fake-site\.example\/api\/notify\/confirm\?t=([A-Za-z0-9_-]+)/.exec(sent.text);
    expect(link).not.toBeNull();
    const token = link?.[1] ?? '';
    expect(token).toMatch(CONFIRM_TOKEN_PATTERN);
    expect(await tokenHash(token)).toBe(rec?.tokenHash);
    expect(sent.text).not.toContain(rec?.tokenHash ?? 'x');
    expect(mail[0]?.headers['idempotency-key']).toMatch(/^nsub-confirm-[0-9a-f]{40}$/);
  });

  it('gives the SAME answer for a new, waiting, already-active or too-soon address, and emails only when the database says send', async () => {
    const answers: string[] = [];
    for (const outcome of [{ outcome: 'send', id: uuid(1) }, { outcome: 'already_active' }, { outcome: 'too_soon' }] as const) {
      const t = setup({ subs: fakeSubscribers({ subscribe: outcome }) });
      const r = await t.subscribe(post(SUB, body()));
      answers.push(`${r.status} ${JSON.stringify(await r.json())}`);
      expect(resend(t)).toHaveLength(outcome.outcome === 'send' ? 1 : 0);
    }
    expect(new Set(answers).size).toBe(1);
  });

  it('the per-address limit also answers like an accepted sign-up (nothing tells that the address was tried before)', async () => {
    const t = setup();
    for (let i = 0; i < NOTIFY_RATE_RULES.email[0].max; i += 1) expect((await t.subscribe(post(SUB, body(), { 'x-vercel-forwarded-for': `203.0.113.${i + 20}` }))).status).toBe(202);
    const r = await t.subscribe(post(SUB, body(), { 'x-vercel-forwarded-for': '203.0.113.99' }));
    expect(r.status).toBe(202);
    expect(t.s.subscribed).toHaveLength(NOTIFY_RATE_RULES.email[0].max);
  });

  it('refuses bad fields with the shared codes, an outdated notice, a missing token and a failed spam check', async () => {
    const t = setup();
    const bad = await read<SubscribeErrorResponse>(await t.subscribe(post(SUB, body({ email: 'nope', consent: false, adult: false }))));
    expect(bad.code).toBe('validation');
    expect(bad.fieldErrors).toEqual({ email: 'invalid', consent: 'required', adult: 'required' });
    expect((await read<SubscribeErrorResponse>(await t.subscribe(post(SUB, body({ consentVersion: 'old' }))))).fieldErrors).toEqual({ consent: 'invalid' });
    expect((await read<SubscribeErrorResponse>(await t.subscribe(post(SUB, body({ token: '' }))))).code).toBe('turnstile');
    expect((await read<SubscribeErrorResponse>(await t.subscribe(post(SUB, body({ extra: 1 }))))).code).toBe('validation');
    const ts = setup({ turnstile: { success: false } });
    expect((await read<SubscribeErrorResponse>(await ts.subscribe(post(SUB, body())))).code).toBe('turnstile');
    expect(ts.s.subscribed).toHaveLength(0);
    expect(t.s.subscribed).toHaveLength(0);
  });

  it('honeypot: the normal answer, nothing stored or sent; too fast: retry', async () => {
    const t = setup();
    const r = await t.subscribe(post(SUB, body({ website: 'http://spam.example' })));
    expect(r.status).toBe(202);
    expect(t.s.subscribed).toHaveLength(0);
    expect(t.f.calls).toHaveLength(0);
    expect((await t.subscribe(post(SUB, body({ elapsedMs: 100 })))).status).toBe(429);
  });

  it('another site cannot post; a wrong content type or a huge body is refused', async () => {
    const t = setup();
    expect((await t.subscribe(post(SUB, body(), { origin: 'https://evil.example' }))).status).toBe(403);
    expect((await t.subscribe(post(SUB, body(), { 'content-type': 'text/plain' }))).status).toBe(415);
    expect((await t.subscribe(post(SUB, JSON.stringify({ ...body(), website: 'x'.repeat(5000) })))).status).toBe(413);
  });

  it('a database failure degrades; the owner switch off in the database answers closed; no address is ever logged', async () => {
    const down = setup({ subs: fakeSubscribers({ throws: true }) });
    expect((await read<SubscribeErrorResponse>(await down.subscribe(post(SUB, body())))).code).toBe('degraded');
    const closed = setup({ subs: fakeSubscribers({ subscribe: { outcome: 'closed' } }) });
    expect((await read<SubscribeErrorResponse>(await closed.subscribe(post(SUB, body())))).code).toBe('closed');
    for (const t of [down, closed]) expect(JSON.stringify(t.logs)).not.toMatch(/example\.test|203\.0\.113|fake-turnstile/i);
  });
});

describe('confirm link', () => {
  it('GET never confirms: it shows a page with one button; POST confirms by the hash', async () => {
    const t = setup();
    await t.subscribe(post(SUB, body()));
    const token = /confirm\?t=([A-Za-z0-9_-]+)/.exec(JSON.parse(resend(t)[0]?.body ?? '{}').text)?.[1] ?? '';
    const page = await t.confirm(new Request(`https://fake-site.example${CONFIRM_ENDPOINT}?t=${token}`));
    expect(page.status).toBe(200);
    expect(page.headers.get('referrer-policy')).toBe('no-referrer');
    expect(page.headers.get('content-security-policy')).toBe(PAGE_HEADERS['content-security-policy']);
    const html = await page.text();
    expect(html).toContain('<form method="post" action="/api/notify/confirm">');
    expect(html).not.toMatch(/<script/i);
    expect(t.s.confirmed).toHaveLength(0);
    const done = await t.confirm(form(`https://fake-site.example${CONFIRM_ENDPOINT}`, { t: token }, { origin: 'https://fake-site.example' }));
    expect(done.status).toBe(200);
    expect(await done.text()).toContain('You are signed up');
    expect(t.s.confirmed).toEqual([await tokenHash(token)]);
  });

  it('a bad, unknown or switched-off link gets a calm page', async () => {
    const t = setup();
    expect((await t.confirm(new Request(`https://fake-site.example${CONFIRM_ENDPOINT}?t=short`))).status).toBe(400);
    const unknown = await t.confirm(form(`https://fake-site.example${CONFIRM_ENDPOINT}`, { t: 'A'.repeat(43) }));
    expect(await unknown.text()).toContain('This link does not work');
    const off = setup({ enabled: false });
    expect(await (await off.confirm(new Request(`https://fake-site.example${CONFIRM_ENDPOINT}?t=${'A'.repeat(43)}`))).text()).toContain('not open');
  });
});

describe('unsubscribe link', () => {
  const key = parseHmacKey(FAKE.hmac);
  if (!key) throw new Error('test key');
  const id = uuid(7);

  it('works even with every switch off; GET asks, POST (one-click form) unsubscribes', async () => {
    const t = setup({ enabled: false, config: testConfig({ EMAIL_ENABLED: 'false' }) });
    const sig = await unsubscribeSignature(key, id);
    const url = `https://fake-site.example${UNSUBSCRIBE_ENDPOINT}?s=${id}&t=${encodeURIComponent(sig)}`;
    const page = await t.unsubscribe(new Request(url));
    expect(page.status).toBe(200);
    expect(await page.text()).toContain('Stop the emails');
    expect(t.s.unsubscribed).toHaveLength(0);
    const r = await t.unsubscribe(form(url, { 'List-Unsubscribe': 'One-Click' }));
    expect(r.status).toBe(200);
    expect(await r.text()).toContain('You are unsubscribed');
    expect(t.s.unsubscribed).toEqual([id]);
  });

  it('a forged or broken signature changes nothing', async () => {
    const t = setup();
    const other = await unsubscribeSignature(key, uuid(8));
    const r = await t.unsubscribe(form(`https://fake-site.example${UNSUBSCRIBE_ENDPOINT}?s=${id}&t=${encodeURIComponent(other)}`, {}));
    expect(r.status).toBe(400);
    expect((await t.unsubscribe(form(`https://fake-site.example${UNSUBSCRIBE_ENDPOINT}`, { s: id, t: 'k1.zz' }))).status).toBe(400);
    expect(t.s.unsubscribed).toHaveLength(0);
  });

  it('a database failure shows a try-again page', async () => {
    const t = setup({ subs: fakeSubscribers({ throws: true }) });
    const sig = await unsubscribeSignature(key, id);
    const r = await t.unsubscribe(form(`https://fake-site.example${UNSUBSCRIBE_ENDPOINT}?s=${id}&t=${encodeURIComponent(sig)}`, {}));
    expect(r.status).toBe(503);
  });
});

describe('pages', () => {
  it('escape everything they print', () => {
    expect(escapeHtml(`<a href="x">'&'</a>`)).toBe('&lt;a href=&quot;x&quot;&gt;&#39;&amp;&#39;&lt;/a&gt;');
  });
});
