import { describe, expect, it } from 'vitest';
import { isDenied, main, MANIFEST, runHarness } from '../../scripts/anon-harness.mjs';

// The harness logic with a mocked fetch. The live run against the dev project waits for OT-03.
const URL = 'https://fakeref.supabase.co';
// Keys are built at run time: no key-shaped literal may sit in the source (the CI secret scan would flag it).
const KEY = ['sb', 'publishable', 'FAKEFAKEFAKEFAKEFAKE'].join('_');

/** A fake REST API. `open` maps `table` -> { select, insert, update, delete } status overrides; everything else is denied (401). */
function fakeApi({ open = {}, specPaths = null, signupDisabled = true, specStatus = 200 } = {}) {
  const calls = [];
  const fetch = async (url, init = {}) => {
    const u = new globalThis.URL(url);
    const method = init.method ?? 'GET';
    calls.push({ path: u.pathname + u.search, method, headers: init.headers ?? {}, body: init.body });
    if (u.pathname === '/auth/v1/settings') return new Response(JSON.stringify({ disable_signup: signupDisabled }), { status: 200 });
    if (u.pathname === '/rest/v1/') {
      if (specPaths === null) return new Response('{}', { status: specStatus === 200 ? 404 : specStatus });
      return new Response(JSON.stringify({ paths: Object.fromEntries(['/', ...specPaths].map((p) => [p, {}])) }), { status: 200 });
    }
    const table = decodeURIComponent(u.pathname.replace('/rest/v1/', ''));
    const op = { GET: 'select', POST: 'insert', PATCH: 'update', DELETE: 'delete' }[method];
    // an `api` view of the manifest (expectSelect) is readable by anon on purpose: select answers 200 unless a test overrides it
    const isApiView = MANIFEST.some((m) => m.name === table && m.expectSelect);
    const status = open[table]?.[op] ?? (isApiView && op === 'select' ? 200 : undefined);
    if (status !== undefined) return new Response(status === 200 ? '[]' : null, { status });
    return new Response(JSON.stringify({ code: '42501', message: 'permission denied' }), { status: 401 });
  };
  return { fetch, calls };
}

describe('anon harness', () => {
  it('passes (exit 0) when every operation on every table is denied', async () => {
    const { fetch } = fakeApi();
    const lines = [];
    const r = await runHarness({ url: URL, key: KEY, fetch, log: (l) => lines.push(l) });
    expect(r.exitCode).toBe(0);
    expect(r.leaks).toEqual([]);
    expect(r.errors).toEqual([]);
    expect(r.results.filter((x) => x.op !== 'signup').length).toBe(MANIFEST.length * 4);
    expect(r.signups).toBe('disabled');
    expect(lines.some((l) => l.startsWith('LEAK'))).toBe(false);
  });

  it('probes select, insert, update and delete on every manifest entry with the right verbs, keys and tx=rollback', async () => {
    const { fetch, calls } = fakeApi();
    await runHarness({ url: URL, key: KEY, fetch });
    for (const t of MANIFEST) {
      const mine = calls.filter((c) => c.path.startsWith(`/rest/v1/${t.name}`));
      expect(mine.map((c) => c.method).sort(), t.name).toEqual(['DELETE', 'GET', 'PATCH', 'POST']);
      for (const c of mine) {
        expect(c.headers.apikey).toBe(KEY);
        expect(c.headers.authorization).toBeUndefined();
        if (c.method !== 'GET') expect(c.headers.prefer).toBe('tx=rollback,return=minimal');
      }
      // writes filter on an impossible primary key value, never on a real row
      const patch = mine.find((c) => c.method === 'PATCH');
      expect(patch.path).toContain(`${t.pk}=eq.`);
    }
  });

  it('reports a leak (exit 1) when select works, even with an empty result: a grant exists and only RLS hides the rows', async () => {
    const { fetch } = fakeApi({ open: { leads: { select: 200 } } });
    const r = await runHarness({ url: URL, key: KEY, fetch });
    expect(r.exitCode).toBe(1);
    expect(r.leaks.map((l) => `${l.target}:${l.op}`)).toEqual(['leads:select']);
  });

  it('reports a leak when a write gets past the permission check (even if it then fails on a constraint)', async () => {
    for (const [op, status] of [['insert', 201], ['insert', 400], ['update', 204], ['delete', 204], ['update', 409]]) {
      const { fetch } = fakeApi({ open: { events: { [op]: status } } });
      const r = await runHarness({ url: URL, key: KEY, fetch });
      expect(r.exitCode, `${op} ${status}`).toBe(1);
      expect(r.leaks[0]).toMatchObject({ target: 'events', op });
    }
  });

  it('treats 401, 403, 404 and 406 as denied', () => {
    for (const s of [401, 403, 404, 406]) expect(isDenied(s)).toBe(true);
    for (const s of [200, 201, 204, 400, 409, 422, 500]) expect(isDenied(s)).toBe(false);
  });

  it('a 5xx or a network failure is an error, never a silent pass', async () => {
    const fetch500 = async (url) => (String(url).includes('/auth/') ? new Response('{}') : new Response('oops', { status: 500 }));
    const a = await runHarness({ url: URL, key: KEY, fetch: fetch500 });
    expect(a.exitCode).toBe(1);
    expect(a.errors.length).toBeGreaterThan(0);
    const down = async () => {
      throw new TypeError('offline');
    };
    const b = await runHarness({ url: URL, key: KEY, fetch: down });
    expect(b.exitCode).toBe(1);
    // an unreachable api view also records the extra "allowed (2xx)" failure of its select
    expect(b.errors.length).toBe(MANIFEST.length * 4 + MANIFEST.filter((m) => m.expectSelect).length);
  });

  it('lists anything else the API exposes (tables and RPCs) as a leak', async () => {
    const { fetch } = fakeApi({ specPaths: ['/leads', '/some_new_table', '/rpc/do_thing'] });
    const r = await runHarness({ url: URL, key: KEY, fetch });
    expect(r.discovery).toBe('ok');
    expect(r.exposed.sort()).toEqual(['leads', 'rpc/do_thing', 'some_new_table']);
    expect(r.exitCode).toBe(1);
  });

  it('an api view marked expectSelect may be read but not written, and may be listed', async () => {
    const manifest = [{ name: 'public_players', pk: 'id', pkSample: '00000000-0000-0000-0000-000000000000', schema: 'api', expectSelect: true }];
    const ok = fakeApi({ open: { public_players: { select: 200 } }, specPaths: ['/public_players'] });
    const r = await runHarness({ url: URL, key: KEY, fetch: ok.fetch, manifest });
    expect(r.exitCode).toBe(0);
    expect(ok.calls.find((c) => c.method === 'GET' && c.path.includes('public_players')).headers['accept-profile']).toBe('api');
    expect(ok.calls.find((c) => c.method === 'POST').headers['content-profile']).toBe('api');
    const leaky = fakeApi({ open: { public_players: { select: 200, insert: 201 } } });
    expect((await runHarness({ url: URL, key: KEY, fetch: leaky.fetch, manifest })).exitCode).toBe(1);
    const broken = fakeApi({ open: { public_players: { select: 400 } } });
    expect((await runHarness({ url: URL, key: KEY, fetch: broken.fetch, manifest })).exitCode).toBe(1);
  });

  it('flags enabled sign-ups using a read-only settings call (never posts a sign-up)', async () => {
    const { fetch, calls } = fakeApi({ signupDisabled: false });
    const r = await runHarness({ url: URL, key: KEY, fetch });
    expect(r.signups).toBe('ENABLED');
    expect(r.exitCode).toBe(1);
    expect(calls.some((c) => c.path.includes('/auth/v1/signup'))).toBe(false);
    expect(calls.filter((c) => c.path.startsWith('/auth/')).every((c) => c.method === 'GET')).toBe(true);
  });

  it('continues without discovery when the API hides its listing', async () => {
    const { fetch } = fakeApi({ specPaths: null });
    const r = await runHarness({ url: URL, key: KEY, fetch });
    expect(r.discovery).toBe('unavailable');
    expect(r.exitCode).toBe(0);
  });
});

describe('harness command line', () => {
  const out = () => {
    const lines = [];
    return { lines, log: (l) => lines.push(l), error: (l) => lines.push(`ERR ${l}`) };
  };

  it('refuses to run without the two variables', async () => {
    const o = out();
    expect(await main({}, o)).toBe(2);
    expect(o.lines[0]).toContain('PUBLIC_SUPABASE_URL');
  });

  it('refuses any key that is not a publishable key, and never prints it', async () => {
    const o = out();
    const secret = ['sb', 'secret', 'SHOULDNEVERBEPRINTED'].join('_');
    expect(await main({ PUBLIC_SUPABASE_URL: URL, PUBLIC_SUPABASE_PUBLISHABLE_KEY: secret }, o)).toBe(2);
    expect(o.lines.join('\n')).not.toContain('SHOULDNEVERBEPRINTED');
    const legacy = out();
    expect(await main({ PUBLIC_SUPABASE_URL: URL, PUBLIC_SUPABASE_PUBLISHABLE_KEY: 'eyJhbGciOi.legacy.jwt' }, legacy)).toBe(2);
  });
});
