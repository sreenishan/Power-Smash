// S-17: the SECRET key is only ever sent to the project's own host (https and <ref>.supabase.co), unless an explicit
// local-development override variable is set.
import { describe, expect, it, vi } from 'vitest';
import { buildLeadConfig, leadEndpointStatus } from '../../src/lib/leads/config';
import { createLeadHandler } from '../../src/lib/leads/handler';
import { createSupabaseRest, isAcceptableSupabaseUrl } from '../../src/lib/supabase/rest';
import { coverageBody, createWorld, FAKE, fakeEnv, leadRequest, makeDeps, readJson } from '../leads/helpers';

const GOOD = ['https://abcdefghij.supabase.co', 'https://abcdefghij.supabase.co/', 'https://ABCDEFGHIJ.supabase.co', 'https://fakeref.supabase.co:443', 'https://a1-b2.supabase.co'];
const BAD = [
  'http://abcdefghij.supabase.co',
  'https://supabase.co',
  'https://evil.example',
  'https://abcdefghij.supabase.co.evil.example',
  'https://evilsupabase.co',
  'https://x.y.supabase.co',
  'https://abcdefghij.supabase.com',
  'https://user:pw@abcdefghij.supabase.co',
  'https://abcdefghij.supabase.co:8443',
  'https://abcdefghij.supabase.co/rest/v1',
  'https://abcdefghij.supabase.co?x=1',
  'ftp://abcdefghij.supabase.co',
  'abcdefghij.supabase.co',
  'https://127.0.0.1',
  'https://localhost',
  'http://localhost:54321',
  '',
  '   ',
  'not a url',
];

describe('isAcceptableSupabaseUrl', () => {
  it('accepts only https://<ref>.supabase.co', () => {
    for (const u of GOOD) expect(isAcceptableSupabaseUrl(u), u).toBe(true);
    for (const u of BAD) expect(isAcceptableSupabaseUrl(u), JSON.stringify(u)).toBe(false);
  });

  it('the local-development override accepts a loopback host over http or https, and nothing else new', () => {
    for (const u of ['http://127.0.0.1:54321', 'http://localhost:54321', 'https://localhost:8443', 'http://[::1]:54321']) {
      expect(isAcceptableSupabaseUrl(u, false), u).toBe(false);
      expect(isAcceptableSupabaseUrl(u, true), u).toBe(true);
    }
    for (const u of ['http://abcdefghij.supabase.co', 'https://evil.example', 'http://192.168.1.10:54321', 'http://localhost.evil.example', 'http://127.0.0.1.evil.example', 'http://user@localhost:54321']) {
      expect(isAcceptableSupabaseUrl(u, true), u).toBe(false);
    }
  });
});

describe('createSupabaseRest refuses an unacceptable URL before any request', () => {
  it('throws a plain error that does not echo the URL, and never calls fetch', () => {
    const fetchSpy = vi.fn();
    for (const url of BAD) {
      let message = '';
      try {
        createSupabaseRest({ url, secretKey: FAKE.supabaseSecret, fetch: fetchSpy as unknown as typeof fetch });
      } catch (e) {
        message = (e as Error).message;
      }
      expect(message, JSON.stringify(url)).toBe('supabase_url_refused');
    }
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('accepts the project URL, and a loopback URL only with allowLocalUrl', async () => {
    const world = createWorld();
    expect(() => createSupabaseRest({ url: FAKE.supabaseUrl, secretKey: FAKE.supabaseSecret, fetch: world.fetch })).not.toThrow();
    expect(() => createSupabaseRest({ url: 'http://127.0.0.1:54321', secretKey: FAKE.supabaseSecret, fetch: world.fetch })).toThrow('supabase_url_refused');
    const calls: string[] = [];
    const local = createSupabaseRest({
      url: 'http://127.0.0.1:54321/',
      secretKey: FAKE.supabaseSecret,
      allowLocalUrl: true,
      fetch: (async (url: string) => {
        calls.push(url);
        return new Response('[]', { status: 200 });
      }) as unknown as typeof fetch,
    });
    await local.select('leads', 'select=id');
    expect(calls).toEqual(['http://127.0.0.1:54321/rest/v1/leads?select=id']);
  });
});

describe('the config and the handler never send the secret key to a refused URL', () => {
  it('buildLeadConfig drops a refused URL (from any of the three sources) and the endpoint is not ready', () => {
    for (const url of ['http://fakeref.supabase.co', 'https://evil.example']) {
      for (const source of [{ SUPABASE_URL: url }, { PUBLIC_SUPABASE_URL: url, SUPABASE_URL: undefined }]) {
        const c = buildLeadConfig(fakeEnv({ ...source }));
        expect(c.supabaseUrl, url).toBeNull();
        expect(c.supabaseUrlRefused).toBe(true);
        expect(leadEndpointStatus(c)).toEqual({ ready: false, reason: 'supabase_url' });
      }
      const viaFallback = buildLeadConfig(fakeEnv({ SUPABASE_URL: undefined }), { publicSupabaseUrl: url });
      expect(viaFallback.supabaseUrl).toBeNull();
      expect(viaFallback.supabaseUrlRefused).toBe(true);
    }
    expect(buildLeadConfig(fakeEnv({ SUPABASE_URL: undefined })).supabaseUrlRefused).toBe(false); // nothing given is "missing", not "refused"
    expect(leadEndpointStatus(buildLeadConfig(fakeEnv({ SUPABASE_URL: undefined })))).toEqual({ ready: false, reason: 'missing_secrets' });
  });

  it('SUPABASE_ALLOW_LOCAL_URL is exactly "true" and only unlocks loopback', () => {
    const local = { SUPABASE_URL: 'http://127.0.0.1:54321' };
    expect(buildLeadConfig(fakeEnv(local)).supabaseUrl).toBeNull();
    for (const v of ['TRUE', '1', 'yes', ' ']) expect(buildLeadConfig(fakeEnv({ ...local, SUPABASE_ALLOW_LOCAL_URL: v })).supabaseUrl, JSON.stringify(v)).toBeNull();
    const c = buildLeadConfig(fakeEnv({ ...local, SUPABASE_ALLOW_LOCAL_URL: 'true' }));
    expect(c.supabaseUrl).toBe('http://127.0.0.1:54321');
    expect(c.supabaseAllowLocalUrl).toBe(true);
    expect(buildLeadConfig(fakeEnv({ SUPABASE_URL: 'https://evil.example', SUPABASE_ALLOW_LOCAL_URL: 'true' })).supabaseUrl).toBeNull();
  });

  it('a lead sent while SUPABASE_URL is wrong makes no outbound call at all and answers with the WhatsApp fallback', async () => {
    for (const url of ['http://fakeref.supabase.co', 'https://evil.example']) {
      const world = createWorld();
      const h = makeDeps(world, {}, { SUPABASE_URL: url });
      const res = await createLeadHandler(h.deps)(leadRequest(coverageBody()));
      expect(res.status, url).toBe(503);
      expect((await readJson(res)).code).toBe('degraded');
      expect(world.calls, url).toHaveLength(0);
      expect(JSON.stringify(h.logs)).not.toContain('evil');
    }
  });
});
