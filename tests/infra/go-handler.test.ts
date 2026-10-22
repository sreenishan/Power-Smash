import { afterEach, describe, expect, it, vi } from 'vitest';
import { createGoDeps, handleGo } from '../../src/lib/infra/go-handler';
import { createClickLimiter } from '../../src/lib/infra/click-limit';
import type { GoDeps, OutboundClick } from '../../src/lib/infra/go-handler';
import type { GoLinks } from '../../src/lib/infra/go';
import { goAllowedHosts, goLinks } from '../../src/content/go-links';
import { env as mockEnv } from '../mocks/runtime-env';

const CHROME = 'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Mobile Safari/537.36';

const SPONSOR_UUID = '0b6f4c2e-3d1a-4f5b-8a9c-1d2e3f4a5b6c';

const LINKS: GoLinks = {
  'example-sponsor': { target: 'https://sponsor.example/landing?ref=1#top', label: 'sponsored', targetId: SPONSOR_UUID },
  'slug-id': { target: 'https://sponsor.example/slug-id', label: 'sponsored', targetId: 'sp-1' },
  dotted: { target: '/..//evil.example/x', label: 'internal' },
  'old-deal': { target: 'https://sponsor.example/old', label: 'partner', expires: '2020-01-01' },
  'gear-shop': { target: 'https://shop.partner.example/bat', label: 'affiliate' },
  'bad-host': { target: 'https://evil.example/x', label: 'sponsored' },
  'bad-scheme': { target: 'http://sponsor.example/x', label: 'sponsored' },
  'go-partner': { target: '/partner', label: 'internal' },
};

function setup(over: Partial<GoDeps> = {}) {
  const clicks: OutboundClick[] = [];
  const pending: Promise<unknown>[] = [];
  const deps: GoDeps = {
    links: LINKS,
    allowedHosts: ['sponsor.example', 'shop.partner.example'],
    now: () => new Date('2026-10-21T10:00:00Z'),
    logClick: async (c) => void clicks.push(c),
    hashUserAgent: async (ua) => `hash(${ua.length})`,
    waitUntil: (p) => void pending.push(p),
    siteOrigins: ['https://powersmash.in'],
    ...over,
  };
  const call = async (slug: unknown, init: { ua?: string | null; referer?: string; method?: string; headers?: Record<string, string> } = {}) => {
    const headers: Record<string, string> = { ...init.headers };
    if (init.ua !== null) headers['user-agent'] = init.ua ?? CHROME;
    if (init.referer) headers.referer = init.referer;
    const res = await handleGo(slug, new Request(`https://powersmash.in/go/${String(slug)}`, { method: init.method ?? 'GET', headers }), deps);
    await Promise.all(pending);
    return res;
  };
  return { call, clicks, deps };
}

afterEach(() => {
  for (const k of Object.keys(mockEnv)) delete mockEnv[k];
  vi.restoreAllMocks();
});

describe('go: the redirect', () => {
  it('answers 302 to the target with UTM parameters, keeping the query and fragment', async () => {
    const { call } = setup();
    const res = await call('example-sponsor');
    expect(res.status).toBe(302);
    expect(res.headers.get('location')).toBe('https://sponsor.example/landing?ref=1&utm_source=powersmash&utm_medium=sponsor&utm_campaign=example-sponsor#top');
    expect(res.headers.get('cache-control')).toBe('no-store');
    expect(res.headers.get('x-robots-tag')).toBe('noindex, nofollow');
  });

  it('affiliate links use utm_medium=affiliate', async () => {
    const res = await setup().call('gear-shop');
    expect(res.headers.get('location')).toBe('https://shop.partner.example/bat?utm_source=powersmash&utm_medium=affiliate&utm_campaign=gear-shop');
  });

  it('internal links redirect to the path, with no UTM', async () => {
    const res = await setup().call('go-partner');
    expect(res.status).toBe(302);
    expect(res.headers.get('location')).toBe('/partner');
  });

  it('unknown, malformed and prototype-looking slugs are 404', async () => {
    const { call } = setup();
    for (const slug of ['nope', 'UPPER', '../etc', '__proto__', 'constructor', 'toString', '', undefined]) {
      const res = await call(slug);
      expect(res.status, String(slug)).toBe(404);
      expect(res.headers.get('location')).toBeNull();
    }
  });

  it('an expired link is 404', async () => {
    const { call, clicks } = setup();
    expect((await call('old-deal')).status).toBe(404);
    expect(clicks).toEqual([]);
  });

  it('a target that is not https or not on an allowed host is 404 (no open redirect), and the target is not logged', async () => {
    const err = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const { call, clicks } = setup();
    expect((await call('bad-host')).status).toBe(404);
    expect((await call('bad-scheme')).status).toBe(404);
    expect(clicks).toEqual([]);
    expect(err.mock.calls.flat().join(' ')).not.toContain('evil.example');
  });

  it('with the real (empty) map and host list every slug is 404', async () => {
    const { call } = setup({ links: goLinks, allowedHosts: goAllowedHosts });
    expect(Object.keys(goLinks)).toEqual([]);
    expect((await call('example-sponsor')).status).toBe(404);
  });
});

describe('go: click logging', () => {
  it('logs one click for a person, with the label, the campaign, the referring path and a user agent hash', async () => {
    const { call, clicks } = setup();
    await call('example-sponsor', { referer: 'https://powersmash.in/pricing?x=1#frag' });
    expect(clicks).toEqual([
      {
        go_slug: 'example-sponsor',
        target_type: 'sponsored',
        target_id: SPONSOR_UUID,
        page_path: '/pricing',
        utm: 'utm_source=powersmash&utm_medium=sponsor&utm_campaign=example-sponsor',
        ua_hash: `hash(${CHROME.length})`,
      },
    ]);
  });

  it('never stores the raw user agent or any IP address', async () => {
    const { call, clicks } = setup();
    await call('example-sponsor', { headers: { 'x-vercel-forwarded-for': '203.0.113.9', 'x-forwarded-for': '203.0.113.9' } });
    const stored = JSON.stringify(clicks);
    expect(stored).not.toContain('Mozilla');
    expect(stored).not.toContain('203.0.113.9');
    expect(Object.keys(clicks[0] as object).sort()).toEqual(['go_slug', 'page_path', 'target_id', 'target_type', 'ua_hash', 'utm']);
  });

  it('B-16: a targetId that is not a uuid is dropped (the row is still written, without it); a uuid is stored in lower case', async () => {
    const { call, clicks } = setup();
    const err = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    await call('slug-id');
    await call('slug-id', { ua: `${CHROME} second` });
    expect(clicks.map((c) => c.target_id)).toEqual([null, null]);
    expect(err.mock.calls.filter((c) => String(c[0]).includes('"slug-id"'))).toHaveLength(1); // warned once, not per click
    const upper = setup({ links: { up: { target: 'https://sponsor.example/u', label: 'sponsored', targetId: SPONSOR_UUID.toUpperCase() } } });
    await upper.call('up');
    expect(upper.clicks[0]?.target_id).toBe(SPONSOR_UUID);
    const empty = setup({ links: { e: { target: 'https://sponsor.example/e', label: 'sponsored', targetId: '' } } });
    await empty.call('e');
    expect(empty.clicks[0]?.target_id).toBeNull();
  });

  it('B-7: an internal target that dot segments turn into //evil.example is a 404, never a protocol-relative Location', async () => {
    const { call, clicks } = setup();
    const res = await call('dotted');
    expect(res.status).toBe(404);
    expect(res.headers.get('location')).toBeNull();
    expect(clicks).toEqual([]);
  });

  it('drops a referer from another site', async () => {
    const { call, clicks } = setup();
    await call('example-sponsor', { referer: 'https://elsewhere.example/page' });
    expect(clicks[0]?.page_path).toBeNull();
  });

  it('bots are redirected but never counted', async () => {
    const { call, clicks } = setup();
    for (const ua of ['Mozilla/5.0 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)', 'facebookexternalhit/1.1', null, 'curl/8.4.0 extra']) {
      const res = await call('example-sponsor', { ua });
      expect(res.status, String(ua)).toBe(302);
    }
    expect(clicks).toEqual([]);
  });

  it('prefetches and HEAD requests are not counted', async () => {
    const { call, clicks } = setup();
    expect((await call('example-sponsor', { headers: { 'sec-purpose': 'prefetch' } })).status).toBe(302);
    expect((await call('example-sponsor', { method: 'HEAD' })).status).toBe(302);
    expect(clicks).toEqual([]);
  });

  it('logging runs through waitUntil, so the redirect does not wait for it', async () => {
    let release: () => void = () => undefined;
    const slow = new Promise<void>((r) => (release = r));
    const waited: Promise<unknown>[] = [];
    const { deps } = setup();
    const res = await handleGo('example-sponsor', new Request('https://powersmash.in/go/example-sponsor', { headers: { 'user-agent': CHROME } }), {
      ...deps,
      logClick: () => slow,
      waitUntil: (p) => void waited.push(p),
    });
    expect(res.status).toBe(302); // answered while the log call is still pending
    expect(waited).toHaveLength(1);
    release();
    await Promise.all(waited);
  });

  it('with NO waitUntil (no request context) the click is logged BEFORE the redirect is returned', async () => {
    const clicks: OutboundClick[] = [];
    let finished = false;
    const { deps } = setup();
    const res = await handleGo('example-sponsor', new Request('https://powersmash.in/go/example-sponsor', { headers: { 'user-agent': CHROME } }), {
      ...deps,
      waitUntil: undefined,
      logClick: async (c) => {
        await new Promise((r) => setTimeout(r, 5));
        clicks.push(c);
        finished = true;
      },
    });
    expect(res.status).toBe(302);
    expect(res.headers.get('location')).toContain('utm_campaign=example-sponsor');
    expect(finished).toBe(true); // awaited, not left to a function that may be frozen
    expect(clicks).toHaveLength(1);
  });

  it('with NO waitUntil a logging failure still gives the redirect and logs no detail', async () => {
    const err = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const { call } = setup({
      waitUntil: undefined,
      logClick: async () => {
        throw new Error('db down at host with secret detail');
      },
    });
    const res = await call('example-sponsor');
    expect(res.status).toBe(302);
    expect(err.mock.calls.flat().join(' ')).not.toContain('secret detail');
  });

  it('a waitUntil that throws is treated as absent: the click is awaited and the redirect is unchanged', async () => {
    const clicks: OutboundClick[] = [];
    const { call } = setup({
      logClick: async (c) => void clicks.push(c),
      waitUntil: () => {
        throw new Error('no request context');
      },
    });
    const res = await call('example-sponsor');
    expect(res.status).toBe(302);
    expect(clicks).toHaveLength(1);
  });

  it('a logging failure never blocks the redirect and logs no detail', async () => {
    const err = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const { call } = setup({
      logClick: async () => {
        // assembled at run time: a committed connection string with a password would trip the gitleaks rule (S-12)
        throw new Error(`db down at ${['postgresql', '://', 'user', ':', 'secret', '@', 'host/db'].join('')}`);
      },
    });
    const res = await call('example-sponsor');
    expect(res.status).toBe(302);
    expect(err.mock.calls.flat().join(' ')).not.toContain('secret');
  });
});

describe('go: default Worker dependencies', () => {
  const fakeFetch = () => vi.fn(async (_url: string | URL | Request, _init?: RequestInit) => new Response(null, { status: 201 }));
  const parts = (fetchImpl: ReturnType<typeof fakeFetch>) => ({ links: LINKS, allowedHosts: ['sponsor.example'], waitUntil: () => undefined, requestOrigin: 'https://powersmash.in', fetchImpl: fetchImpl as unknown as typeof fetch });
  const fakeKey = ['sb', 'secret', 'x'.repeat(24)].join('_');

  it('inserts into outbound_clicks through PostgREST with the secret key in the apikey header only', async () => {
    const f = fakeFetch();
    const deps = createGoDeps({ PUBLIC_SUPABASE_URL: 'https://abcdefgh.supabase.co', SUPABASE_SECRET_KEY: fakeKey }, parts(f));
    const click: OutboundClick = { go_slug: 's', target_type: 'sponsored', target_id: null, page_path: '/', utm: 'utm_source=powersmash', ua_hash: 'h' };
    await deps.logClick(click);
    expect(f).toHaveBeenCalledTimes(1);
    const [url, init] = f.mock.calls[0] as [string, RequestInit];
    expect(url).toBe('https://abcdefgh.supabase.co/rest/v1/outbound_clicks');
    expect(init.method).toBe('POST');
    const headers = init.headers as Record<string, string>;
    expect(headers.apikey).toBe(fakeKey);
    expect(Object.keys(headers).map((k) => k.toLowerCase())).not.toContain('authorization');
    expect(JSON.parse(init.body as string)).toEqual(click);
  });

  it('without a Supabase URL or key the click is simply not stored (no request, no error)', async () => {
    const f = fakeFetch();
    await createGoDeps({}, parts(f)).logClick({ go_slug: 's', target_type: 'sponsored', target_id: null, page_path: null, utm: '', ua_hash: 'h' });
    await createGoDeps({ PUBLIC_SUPABASE_URL: 'https://abcdefgh.supabase.co' }, parts(f)).logClick({ go_slug: 's', target_type: 'sponsored', target_id: null, page_path: null, utm: '', ua_hash: 'h' });
    expect(f).not.toHaveBeenCalled();
  });

  it('hashes the user agent with the HMAC key when there is one, and never returns the raw value', async () => {
    const f = fakeFetch();
    const withKey = createGoDeps({ HMAC_KEY: `k1:${'a'.repeat(40)}` }, parts(f));
    const a = await withKey.hashUserAgent(CHROME);
    const b = await withKey.hashUserAgent(CHROME);
    expect(a).toBe(b);
    expect(a).toMatch(/^k1\.[0-9a-f]{32}$/);
    expect(a).not.toContain('Mozilla');
    const other = createGoDeps({ HMAC_KEY: `k1:${'b'.repeat(40)}` }, parts(f));
    expect(await other.hashUserAgent(CHROME)).not.toBe(a);
    const plain = await createGoDeps({}, parts(f)).hashUserAgent(CHROME);
    expect(plain).toMatch(/^sha256\.[0-9a-f]{32}$/);
  });

  it('accepts referers from the request origin and from PUBLIC_SITE_URL', () => {
    const deps = createGoDeps({ PUBLIC_SITE_URL: 'https://powersmash.in/' }, { ...parts(fakeFetch()), requestOrigin: 'https://power-smash.account.workers.dev' });
    expect(deps.siteOrigins).toEqual(['https://power-smash.account.workers.dev', 'https://powersmash.in']);
  });
});

describe('go: duplicate and flood brake for the click log (S-15)', () => {
  const FLOOD_UA = (i: number): string => `Mozilla/5.0 (X11; Linux x86_64) Browser/${i}.0 Gecko/20100101`;

  it('a loop from one user agent writes one row, but every request is still redirected', async () => {
    const { call, clicks } = setup({ limiter: createClickLimiter() });
    const statuses: number[] = [];
    for (let i = 0; i < 500; i++) statuses.push((await call('example-sponsor')).status);
    expect(new Set(statuses)).toEqual(new Set([302]));
    expect(clicks).toHaveLength(1);
  });

  it('a loop that rotates user agents is capped per slug per window, then counting resumes in the next window', async () => {
    let now = new Date('2026-10-21T10:00:00Z').getTime();
    const { call, clicks } = setup({ limiter: createClickLimiter({ slugMax: 25, slugWindowMs: 60_000 }), now: () => new Date(now) });
    for (let i = 0; i < 400; i++) await call('example-sponsor', { ua: FLOOD_UA(i) });
    expect(clicks).toHaveLength(25);
    now += 60_001;
    await call('example-sponsor', { ua: FLOOD_UA(9999) });
    expect(clicks).toHaveLength(26);
  });

  it('the cap is per slug: a flood on one link does not stop the counting of another', async () => {
    const { call, clicks } = setup({ limiter: createClickLimiter({ slugMax: 3 }) });
    for (let i = 0; i < 20; i++) await call('example-sponsor', { ua: FLOOD_UA(i) });
    await call('gear-shop', { ua: FLOOD_UA(1) });
    expect(clicks.filter((c) => c.go_slug === 'example-sponsor')).toHaveLength(3);
    expect(clicks.filter((c) => c.go_slug === 'gear-shop')).toHaveLength(1);
  });

  it('the same user agent is counted again after the dedupe window', async () => {
    let now = new Date('2026-10-21T10:00:00Z').getTime();
    const { call, clicks } = setup({ limiter: createClickLimiter({ dedupeMs: 5_000 }), now: () => new Date(now) });
    await call('example-sponsor');
    now += 4_999;
    await call('example-sponsor');
    now += 2;
    await call('example-sponsor');
    expect(clicks).toHaveLength(2);
  });

  it('bots, prefetch and HEAD never reach the limiter (they are not counted and do not use up the cap)', async () => {
    const limiter = createClickLimiter({ slugMax: 2 });
    const spy = vi.spyOn(limiter, 'allow');
    const { call, clicks } = setup({ limiter });
    await call('example-sponsor', { ua: 'Googlebot/2.1 (+http://www.google.com/bot.html)' });
    await call('example-sponsor', { method: 'HEAD' });
    expect(spy).not.toHaveBeenCalled();
    await call('example-sponsor', { ua: FLOOD_UA(1) });
    await call('example-sponsor', { ua: FLOOD_UA(2) });
    expect(clicks).toHaveLength(2);
  });

  it('createGoDeps takes waitUntil as optional: absent stays absent (handleGo then awaits the click log)', () => {
    const noWait = { links: LINKS, allowedHosts: [] as string[], requestOrigin: 'https://powersmash.in' };
    expect(createGoDeps({}, noWait).waitUntil).toBeUndefined();
  });

  it('createGoDeps always installs a limiter, shared by every request of the isolate', () => {
    const base = { links: LINKS, allowedHosts: [], waitUntil: () => undefined, requestOrigin: 'https://powersmash.in' };
    const a = createGoDeps({}, base);
    const b = createGoDeps({}, base);
    expect(a.limiter).toBeDefined();
    expect(a.limiter).toBe(b.limiter);
    const own = createClickLimiter();
    expect(createGoDeps({}, { ...base, limiter: own }).limiter).toBe(own);
  });
});

describe('go: the route file (env through process.env)', () => {
  it('is on-demand and answers 404 for any slug while the link map is empty', async () => {
    const route = await import('../../src/pages/go/[slug]');
    expect(route.prerender).toBe(false);
    const res = await route.GET({
      params: { slug: 'anything' },
      request: new Request('https://powersmash.in/go/anything', { headers: { 'user-agent': CHROME } }),
      locals: {},
    } as unknown as Parameters<typeof route.GET>[0]);
    expect(res.status).toBe(404);
  });
});
