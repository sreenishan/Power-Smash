// /go/[slug] route with the link map replaced by one fictional link: with NO Vercel request context the click is written before the
// redirect is returned; with a context it is handed to waitUntil. Env through process.env (tests/mocks/runtime-env.ts). Fake values only.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { env as mockEnv } from '../mocks/runtime-env';
import { installRequestContext } from '../mocks/request-context';

vi.mock('../../src/content/go-links', () => ({
  goLinks: { 'fake-sponsor': { target: 'https://sponsor.example/landing', label: 'sponsored' } },
  goAllowedHosts: ['sponsor.example'],
}));

import { GET } from '../../src/pages/go/[slug]';
import { resetGoDataCacheForTests } from '../../src/lib/infra/go-sponsor-links';

const CHROME = 'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Mobile Safari/537.36';
const FAKE_SECRET = ['sb', 'secret', 'FAKE'].join('_');

let calls: Array<{ url: string; method: string }> = [];
let removeContext: (() => void) | null = null;

function stubFetch(): void {
  calls = [];
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
      const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
      calls.push({ url, method: (init?.method ?? 'GET').toUpperCase() });
      if (url.includes('/rest/v1/placements')) return new Response('[]', { status: 200, headers: { 'content-type': 'application/json' } });
      return new Response(null, { status: 201 });
    }),
  );
}

const call = (ua: string) =>
  GET({
    params: { slug: 'fake-sponsor' },
    request: new Request('https://powersmash.example/go/fake-sponsor', { headers: { 'user-agent': ua } }),
    locals: {},
  } as unknown as Parameters<typeof GET>[0]);

const clickInserts = () => calls.filter((c) => c.method === 'POST' && c.url.includes('/rest/v1/outbound_clicks'));

beforeEach(() => {
  resetGoDataCacheForTests();
  mockEnv.SUPABASE_URL = 'https://fakeref.supabase.co';
  mockEnv.SUPABASE_SECRET_KEY = FAKE_SECRET;
  stubFetch();
});

afterEach(() => {
  for (const k of Object.keys(mockEnv)) delete mockEnv[k];
  vi.unstubAllGlobals();
  removeContext?.();
  removeContext = null;
});

describe('/go/[slug] route: waitUntil only when Vercel provides one', () => {
  it('with NO request context the click is awaited: it is already written when the redirect comes back', async () => {
    const res = await call(`${CHROME} nocontext`);
    expect(res.status).toBe(302);
    expect(res.headers.get('location')).toContain('https://sponsor.example/landing');
    expect(clickInserts()).toHaveLength(1);
  });

  it('with a request context the click is handed to waitUntil and the redirect is the same', async () => {
    const handed: Array<Promise<unknown>> = [];
    removeContext = installRequestContext((p) => void handed.push(p));
    const res = await call(`${CHROME} withcontext`);
    expect(res.status).toBe(302);
    expect(res.headers.get('location')).toContain('https://sponsor.example/landing');
    expect(handed).toHaveLength(1);
    await Promise.all(handed);
    expect(clickInserts()).toHaveLength(1);
  });

  it('a database failure with no request context still gives the redirect', async () => {
    const err = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: string | URL | Request) => {
        const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
        if (url.includes('/rest/v1/placements')) return new Response('[]', { status: 200 });
        throw new TypeError('network down');
      }),
    );
    const res = await call(`${CHROME} dbdown`);
    expect(res.status).toBe(302);
    expect(err.mock.calls.flat().join(' ')).not.toContain(FAKE_SECRET);
    err.mockRestore();
  });
});
