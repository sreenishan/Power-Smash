import { describe, expect, it, vi } from 'vitest';
import { EVENT_NAMES } from '../../src/lib/contracts/lead-constants';
import { cleanEventPath, cleanEventProps, EVENT_PROP_KEYS, validateEvent } from '../../src/lib/contracts/event';
import { createEventHandler, createEventState, EVENT_RATE_PER_MINUTE, isBotUserAgent, istDate } from '../../src/lib/leads/event-handler';
import { createWorld, FAKE, fakeConfig, NOW, seqRandom } from './helpers';

const UA = 'Mozilla/5.0 (Linux; Android 14; Pixel 7) AppleWebKit/537.36 Chrome/126.0 Mobile Safari/537.36';

function setup(envOverrides: Record<string, string | undefined> = {}, now = NOW) {
  const world = createWorld();
  const logs: unknown[] = [];
  let clock = now;
  const handler = createEventHandler(
    { config: fakeConfig(envOverrides), fetch: world.fetch, now: () => clock, randomBytes: seqRandom(9), log: (e) => logs.push(e) },
    createEventState(),
  );
  return { world, logs, handler, setNow: (d: Date) => (clock = d) };
}

const post = (body: unknown, headers: Record<string, string> = {}, raw?: string) =>
  new Request(`${FAKE.origin}/api/event`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', origin: FAKE.origin, 'user-agent': UA, 'x-vercel-forwarded-for': FAKE.ip, ...headers },
    body: raw ?? JSON.stringify(body),
  });

describe('event contract', () => {
  it('has the allow-listed names and a prop list for each', () => {
    expect([...EVENT_NAMES]).toEqual(['whatsapp_click', 'share_click', 'form_start', 'form_submit', 'form_error', 'outbound_click']);
    for (const n of EVENT_NAMES) expect(EVENT_PROP_KEYS[n].length).toBeGreaterThan(0);
  });

  it('refuses names that are not on the list', () => {
    for (const name of ['search', 'page_view', 'payment_success', '', 'WHATSAPP_CLICK', 'whatsapp_click ', 42, null]) {
      expect(validateEvent({ name, path: '/x' }).ok, String(name)).toBe(false);
    }
    expect(validateEvent({ name: 'whatsapp_click' }).ok).toBe(true);
  });

  it('keeps only allow-listed props with slug-like values and drops everything else', () => {
    const props = cleanEventProps('whatsapp_click', {
      context: 'sticky',
      page_type: 'book',
      phone: '9876543210',
      email: 'a@example.test',
      name: 'Ravi',
    });
    expect(props).toEqual({ context: 'sticky', page_type: 'book' });
  });

  it('drops values that could carry personal data', () => {
    const bad = ['9876543210', 'ravi@example.test', 'Ravi Kumar', 'x'.repeat(41), '<script>', 'a b', '', 'user-1234567', '+919876543210'];
    for (const v of bad) expect(cleanEventProps('whatsapp_click', { context: v }), v).toEqual({});
    expect(cleanEventProps('form_submit', { form: 'book', ok: true, kind: 'coverage', extra: 'x' })).toEqual({ form: 'book', ok: true, kind: 'coverage' });
    expect(cleanEventProps('form_error', { form: 'book', code: 'validation' })).toEqual({ form: 'book', code: 'validation' });
    expect(cleanEventProps('whatsapp_click', undefined)).toEqual({});
  });

  it('paths are bare: query, fragment and odd characters are removed or refused', () => {
    expect(cleanEventPath('/book?utm_source=x&phone=9876543210#top')).toBe('/book');
    expect(cleanEventPath('/tournaments/salem-cup')).toBe('/tournaments/salem-cup');
    for (const bad of ['book', 'https://evil.example/x', '/a/../b', '/<x>', 42, undefined, '/' + 'a'.repeat(250)]) expect(cleanEventPath(bad), String(bad)).toBeNull();
  });
});

describe('POST /api/event', () => {
  it('stores an allow-listed event with a hashed session, no IP, no query string', async () => {
    const { world, handler } = setup();
    const res = await handler(post({ name: 'whatsapp_click', path: '/book?x=1', props: { context: 'sticky', phone: '9876543210' } }));
    expect(res.status).toBe(204);
    expect(world.events).toHaveLength(1);
    const row = world.events[0] as Record<string, unknown>;
    expect(row).toMatchObject({ name: 'whatsapp_click', page_path: '/book', props: { context: 'sticky' }, is_bot: false });
    expect(String(row.session_hash)).toMatch(/^k1\.[0-9a-f]{32}$/);
    const stored = JSON.stringify(world.events) + JSON.stringify(world.salts);
    expect(stored).not.toContain(FAKE.ip);
    expect(stored).not.toContain('9876543210');
    expect(stored).not.toContain('Mozilla');
  });

  it('rejects names outside the allow-list and bad bodies without touching the database', async () => {
    const { world, handler } = setup();
    expect((await handler(post({ name: 'search', path: '/x' }))).status).toBe(422);
    expect((await handler(post(null, {}, '{nope'))).status).toBe(400);
    expect((await handler(post({ name: 'form_start' }, { 'content-type': 'text/html' }))).status).toBe(415);
    expect((await handler(post({ name: 'form_start' }, { origin: 'https://evil.example' }))).status).toBe(403);
    expect((await handler(post({ name: 'form_start', props: { form: 'x'.repeat(5000) } }))).status).toBe(413);
    expect(world.events).toHaveLength(0);
    expect(world.calls).toHaveLength(0);
    const get = await handler(new Request(`${FAKE.origin}/api/event`, { method: 'GET' }));
    expect(get.status).toBe(405);
  });

  it('accepts navigator.sendBeacon bodies (text/plain)', async () => {
    const { world, handler } = setup();
    const res = await handler(post(undefined, { 'content-type': 'text/plain;charset=UTF-8' }, JSON.stringify({ name: 'form_start', path: '/book', props: { form: 'book' } })));
    expect(res.status).toBe(204);
    expect(world.events).toHaveLength(1);
  });

  it('flags bots', async () => {
    expect(isBotUserAgent('Googlebot/2.1')).toBe(true);
    expect(isBotUserAgent('')).toBe(true);
    expect(isBotUserAgent(null)).toBe(true);
    expect(isBotUserAgent('WhatsApp/2.23')).toBe(true);
    expect(isBotUserAgent(UA)).toBe(false);
    const { world, handler } = setup();
    await handler(post({ name: 'form_start' }, { 'user-agent': 'curl/8.0' }));
    expect(world.events[0]?.is_bot).toBe(true);
  });

  it('is rate limited per connection', async () => {
    const { world, handler } = setup();
    for (let i = 0; i < EVENT_RATE_PER_MINUTE; i += 1) expect((await handler(post({ name: 'form_start' }))).status).toBe(204);
    expect((await handler(post({ name: 'form_start' }))).status).toBe(429);
    expect((await handler(post({ name: 'form_start' }, { 'x-vercel-forwarded-for': '192.0.2.5' }))).status).toBe(204);
    expect(world.events).toHaveLength(EVENT_RATE_PER_MINUTE + 1);
  });

  it('honours the Workers Rate Limiting binding', async () => {
    const world = createWorld();
    const limit = vi.fn().mockResolvedValue({ success: false });
    const handler = createEventHandler({ config: fakeConfig(), fetch: world.fetch, now: () => NOW, randomBytes: seqRandom(), limiter: { limit }, log: () => undefined });
    expect((await handler(post({ name: 'form_start' }))).status).toBe(429);
    expect(world.events).toHaveLength(0);
  });

  it('session hashes use a random daily salt: same visitor, same day = same hash; next day = different; old salts are deleted', async () => {
    const { world, handler, setNow } = setup();
    await handler(post({ name: 'form_start' }));
    await handler(post({ name: 'form_submit', props: { ok: true } }));
    const [a, b] = world.events.map((e) => e.session_hash);
    expect(a).toBe(b);
    expect(world.salts).toHaveLength(1);
    expect(String(world.salts[0]?.salt)).toMatch(/^[0-9a-f]{64}$/);
    // salt fetched once per isolate day (cached), not per event
    expect(world.calls.filter((c) => c.path.startsWith('/rest/v1/daily_salts') && c.method === 'GET').length).toBeLessThanOrEqual(2);

    setNow(new Date(NOW.getTime() + 86_400_000));
    await handler(post({ name: 'form_start' }));
    expect(world.events[2]?.session_hash).not.toBe(a);
    setNow(new Date(NOW.getTime() + 4 * 86_400_000));
    await handler(post({ name: 'form_start' }));
    expect(world.salts.map((s) => s.day)).not.toContain(istDate(NOW)); // older than 48 hours: gone
  });

  it('unconfigured or database trouble answers 503 and never crashes the page', async () => {
    const a = setup({ HMAC_KEY: undefined });
    expect((await a.handler(post({ name: 'form_start' }))).status).toBe(503);
    const b = setup();
    b.world.db.down = true;
    expect((await b.handler(post({ name: 'form_start' }))).status).toBe(503);
    expect(JSON.stringify(b.logs)).not.toContain(FAKE.ip);
  });

  it('IST date rolls over at 18:30 UTC', () => {
    expect(istDate(new Date('2026-11-02T18:29:59Z'))).toBe('2026-11-02');
    expect(istDate(new Date('2026-11-02T18:30:00Z'))).toBe('2026-11-03');
  });
});
