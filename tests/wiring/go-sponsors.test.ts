import { beforeEach, describe, expect, it } from 'vitest';
import { mergeGoData, resetGoDataCacheForTests, resolveGoData } from '../../src/lib/infra/go-sponsor-links';

const KEY = ['sb', 'secret', 'FAKE'].join('_');
const env = { SUPABASE_URL: 'https://abcdefgh.supabase.co', SUPABASE_SECRET_KEY: KEY };
const PID = '11111111-1111-4111-8111-111111111111';
const SID = '22222222-2222-4222-8222-222222222222';

function dbFetch(calls: string[] = []): typeof fetch {
  return (async (url: string) => {
    calls.push(url);
    if (url.includes('/placements?'))
      return new Response(
        JSON.stringify([
          {
            id: PID,
            sponsor_id: SID,
            slot: 'home_partner_strip',
            scope_key: null,
            creative_desktop_path: null,
            creative_mobile_path: null,
            alt: 'Fake',
            headline: null,
            go_slug: 'fake-sponsor',
            start_date: '2026-01-01',
            end_date: '2099-12-31',
            priority: 1,
            label: 'Sponsored',
            status: 'active',
            target_url: 'https://shop.fake-sponsor.example/landing',
          },
        ]),
        { status: 200 },
      );
    return new Response(JSON.stringify([{ id: SID, website: 'https://fake-sponsor.example' }]), { status: 200 });
  }) as unknown as typeof fetch;
}

beforeEach(() => resetGoDataCacheForTests());

describe('sponsor /go links from placements', () => {
  it('adds the placement slug and host; static links stay and win on a clash', async () => {
    const statics = {
      links: { 'fake-sponsor': { target: '/partner', label: 'internal' as const }, other: { target: '/book', label: 'internal' as const } },
      allowedHosts: ['keep.example'],
    };
    const out = await resolveGoData(env, statics, { fetchImpl: dbFetch() });
    expect(out.links.other).toBeDefined();
    expect(out.links['fake-sponsor']?.label).toBe('internal');
    expect(out.allowedHosts).toEqual(expect.arrayContaining(['keep.example', 'fake-sponsor.example']));
    resetGoDataCacheForTests();
    const fresh = await resolveGoData(env, { links: {}, allowedHosts: [] }, { fetchImpl: dbFetch() });
    expect(fresh.links['fake-sponsor']?.targetId).toBe(PID);
  });
  it('without settings or on failure it returns the static data only and never throws', async () => {
    const statics = { links: {}, allowedHosts: [] as string[] };
    expect(await resolveGoData({}, statics)).toBe(statics);
    const boom = (async () => {
      throw new Error('x');
    }) as unknown as typeof fetch;
    expect(await resolveGoData(env, statics, { fetchImpl: boom })).toBe(statics);
  });
  it('caches for a minute', async () => {
    const calls: string[] = [];
    const t = new Date('2026-10-22T00:00:00Z');
    await resolveGoData(env, { links: {}, allowedHosts: [] }, { fetchImpl: dbFetch(calls), now: () => t });
    const n = calls.length;
    await resolveGoData(env, { links: {}, allowedHosts: [] }, { fetchImpl: dbFetch(calls), now: () => new Date(t.getTime() + 30_000) });
    expect(calls.length).toBe(n);
  });
  it('mergeGoData keeps both host lists without duplicates', () => {
    expect(mergeGoData({}, ['a.example'], { links: {}, allowedHosts: ['a.example', 'b.example'] }).allowedHosts).toEqual(['a.example', 'b.example']);
  });
});
