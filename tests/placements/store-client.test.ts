import { describe, expect, it } from 'vitest';
import { buildBeaconBody, parseSchedule, pickCreative } from '../../src/lib/placements/client';
import { createBeaconState } from '../../src/lib/placements/beacon';
import { createBeaconRouteHandler } from '../../src/lib/placements/runtime';
import { createImpressionStore, createRpcClient } from '../../src/lib/placements/store';
import { placement } from './helpers';

const URL_OK = 'https://fakeproject.supabase.co';
const KEY = ['sb', 'secret', 'FAKE'].join('_');

describe('rpc client and impression store (mocked fetch)', () => {
  it('posts to /rest/v1/rpc/<fn> with the secret key on the apikey header only', async () => {
    const calls: Array<{ url: string; init: RequestInit }> = [];
    const rpc = createRpcClient({
      url: `${URL_OK}/`,
      secretKey: KEY,
      fetch: (async (url: string | URL | Request, init?: RequestInit) => {
        calls.push({ url: String(url), init: init ?? {} });
        return new Response('3', { status: 200 });
      }) as typeof fetch,
    });
    const store = createImpressionStore(rpc);
    const n = await store.record({ day: '2026-11-10', sessionHash: 'k1.abcdef0123456789', items: [{ placementId: placement().id, pagePath: '/' }] });
    expect(n).toBe(3);
    expect(calls[0]?.url).toBe(`${URL_OK}/rest/v1/rpc/record_placement_impressions`);
    const headers = new Headers(calls[0]?.init.headers);
    expect(headers.get('apikey')).toBe(KEY);
    expect(headers.get('authorization')).toBeNull();
    const sent = JSON.parse(String(calls[0]?.init.body)) as { p_day: string; p_items: Array<{ placement_id: string; page_path: string }> };
    expect(sent.p_day).toBe('2026-11-10');
    expect(sent.p_items[0]).toHaveProperty('placement_id');
  });

  it('refuses a database address that is not a Supabase project (the secret key must not go elsewhere)', () => {
    for (const bad of ['http://fakeproject.supabase.co', 'https://evil.example', 'https://fakeproject.supabase.co.evil.example', 'https://fakeproject.supabase.co/path']) {
      expect(() => createRpcClient({ url: bad, secretKey: KEY, fetch: fetch })).toThrow();
    }
    expect(() => createRpcClient({ url: 'http://localhost:54321', secretKey: KEY, fetch: fetch })).toThrow();
    expect(() => createRpcClient({ url: 'http://localhost:54321', secretKey: KEY, fetch: fetch, allowLocalUrl: true })).not.toThrow();
  });

  it('an error never echoes the response body, and a bad function name is refused', async () => {
    const rpc = createRpcClient({ url: URL_OK, secretKey: KEY, fetch: (async () => new Response('secret echo 910000000000', { status: 400 })) as typeof fetch });
    await expect(rpc.call('bump_stat', {})).rejects.toThrow('supabase_400');
    await expect(rpc.call('bump_stat', {})).rejects.not.toThrow(/910000000000/);
    await expect(rpc.call('x; drop table', {})).rejects.toThrow('bad function name');
  });

  it('a non-numeric answer counts as zero new impressions', async () => {
    const rpc = createRpcClient({ url: URL_OK, secretKey: KEY, fetch: (async () => new Response('"x"', { status: 200 })) as typeof fetch });
    expect(await createImpressionStore(rpc).record({ day: '2026-11-10', sessionHash: 'k1.abcdef0123456789', items: [] })).toBe(0);
  });
});

describe('beacon route wiring with a mocked database', () => {
  it('serves a beacon end to end: schedule read, daily salt, rate counter and the rpc call', async () => {
    const p = placement({ slot: 'player_page_banner' });
    const row = {
      id: p.id, sponsor_id: p.sponsorId, slot: p.slot, scope_key: null, creative_desktop_path: 'a/d.png', creative_mobile_path: null, alt: 'Fictional logo', headline: null,
      go_slug: 'fictional-wire', start_date: '2026-11-01', end_date: '2026-11-30', priority: 0, label: 'Sponsored', status: 'active',
    };
    const urls: string[] = [];
    let salt: string | null = null;
    const fetchMock = (async (input: string | URL | Request, init?: RequestInit) => {
      const url = String(input);
      urls.push(`${init?.method ?? 'GET'} ${url.replace(URL_OK, '')}`);
      if (url.includes('/rest/v1/public_players')) return new Response(JSON.stringify([{ slug: 'fictional-player' }]), { status: 200 });
      if (url.includes('/rest/v1/public_tournaments')) return new Response('[]', { status: 200 });
      if (url.includes('/rest/v1/placements')) return new Response(JSON.stringify([row]), { status: 200 });
      if (url.includes('/rest/v1/daily_salts') && (init?.method ?? 'GET') === 'GET') return new Response(JSON.stringify(salt ? [{ salt }] : []), { status: 200 });
      if (url.includes('/rest/v1/daily_salts') && init?.method === 'POST') {
        salt = 'f'.repeat(64);
        return new Response(null, { status: 201 });
      }
      if (url.includes('/rest/v1/daily_salts')) return new Response(null, { status: 204 });
      if (url.includes('/rest/v1/rate_limit_hits')) return new Response(init?.method === 'HEAD' ? null : '[]', { status: 200, headers: { 'content-range': '0-0/1' } });
      if (url.includes('/rest/v1/rpc/record_placement_impressions')) return new Response('1', { status: 200 });
      return new Response('unexpected', { status: 500 });
    }) as typeof fetch;
    const handler = createBeaconRouteHandler(
      { supabaseUrl: URL_OK, supabaseSecretKey: KEY, supabaseAllowLocalUrl: false, hmacKey: ['k1', 'y'.repeat(40)].join(':'), siteOrigin: null },
      fetchMock,
      { tokens: ['build-token-0001'], state: createBeaconState(), now: () => new Date('2026-11-10T04:00:00Z'), randomBytes: (n) => new Uint8Array(n).fill(7), log: () => undefined },
    );
    const res = await handler(
      new Request('https://powersmash.example/api/placement-beacon', {
        method: 'POST',
        headers: { 'content-type': 'text/plain', 'user-agent': 'Mozilla/5.0 (Linux; Android 14) Chrome/130.0 Mobile Safari/537.36', 'x-vercel-forwarded-for': '203.0.113.9' },
        body: JSON.stringify({ v: 1, tok: 'build-token-0001', path: '/players/fictional-player/', items: [{ id: p.id, slot: 'player_page_banner', ms: 1200 }] }),
      }),
    );
    expect(res.status).toBe(204);
    expect(urls.some((u) => u.includes('/rest/v1/rpc/record_placement_impressions'))).toBe(true);
    expect(urls.some((u) => u.includes('/rest/v1/daily_salts'))).toBe(true);
  });

  it('without a database it answers 503 unconfigured', async () => {
    const handler = createBeaconRouteHandler({ supabaseUrl: null, supabaseSecretKey: null, supabaseAllowLocalUrl: false, hmacKey: null, siteOrigin: null }, fetch, { tokens: ['build-token-0001'] });
    const res = await handler(new Request('https://powersmash.example/api/placement-beacon', { method: 'POST', headers: { 'content-type': 'text/plain', 'user-agent': 'Chrome' }, body: JSON.stringify({ v: 1, tok: 'build-token-0001', path: '/', items: [{ id: placement().id, slot: 'footer_partner_strip', ms: 1000 }] }) }));
    expect(res.status).toBe(503);
  });
});

describe('browser script helpers', () => {
  it('builds the beacon body the endpoint accepts', () => {
    const body = JSON.parse(buildBeaconBody('build-token-0001', '/players/fictional-player/', [{ id: placement().id, slot: 'player_page_banner', ms: 1000 }])) as { v: number; items: unknown[] };
    expect(body.v).toBe(1);
    expect(body.items).toHaveLength(1);
    const many = Array.from({ length: 12 }, () => ({ id: placement().id, slot: 's', ms: 1000 }));
    expect((JSON.parse(buildBeaconBody('t', '/', many)) as { items: unknown[] }).items).toHaveLength(8);
  });

  it('picks the mobile image on a phone and falls back to the other one', () => {
    const both = { creativeDesktopPath: 'd', creativeMobilePath: 'm' };
    expect(pickCreative(both, true)).toBe('m');
    expect(pickCreative(both, false)).toBe('d');
    expect(pickCreative({ creativeDesktopPath: 'd', creativeMobilePath: null }, true)).toBe('d');
    expect(pickCreative({ creativeDesktopPath: null, creativeMobilePath: 'm' }, false)).toBe('m');
    expect(pickCreative({ creativeDesktopPath: null, creativeMobilePath: null }, false)).toBeNull();
  });

  it('only a well-formed schedule is used: a bad href, slot or version shows nothing', () => {
    const good = { id: 'x', slot: 'home_partner_strip', href: '/go/ok-slug', alt: 'a', start: '2026-11-01', end: '2026-11-30', priority: 0, label: 'Partner', desktop: null, mobile: null, headline: null, scope: null };
    expect(parseSchedule({ v: 1, today: '2026-11-10', placements: [good] })?.placements).toHaveLength(1);
    expect(parseSchedule({ v: 1, today: '', placements: [{ ...good, href: 'https://evil.example/' }] })?.placements).toHaveLength(0);
    expect(parseSchedule({ v: 1, today: '', placements: [{ ...good, href: '/go/../x' }] })?.placements).toHaveLength(0);
    expect(parseSchedule({ v: 1, today: '', placements: [{ ...good, slot: 'sidebar' }] })?.placements).toHaveLength(0);
    expect(parseSchedule({ v: 2, placements: [] })).toBeNull();
    expect(parseSchedule(null)).toBeNull();
    expect(parseSchedule('x')).toBeNull();
  });
});
