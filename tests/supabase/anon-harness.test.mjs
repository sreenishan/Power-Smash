import { describe, expect, it, vi } from 'vitest';
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

describe('harness hints (first live run, 2026-10-24)', () => {
  it('says in plain words that the api schema is not exposed when the public views answer 406, and that sign-ups must be switched off', async () => {
    const views = MANIFEST.filter((m) => m.expectSelect).map((m) => m.name);
    const api = fakeApi({ open: Object.fromEntries(views.map((v) => [v, { select: 406 }])), signupDisabled: false });
    vi.stubGlobal('fetch', api.fetch);
    try {
      const lines = [];
      const code = await main({ PUBLIC_SUPABASE_URL: URL, PUBLIC_SUPABASE_PUBLISHABLE_KEY: KEY }, { log: (l) => lines.push(l), error: (l) => lines.push(l) });
      const text = lines.join('\n');
      expect(code).toBe(1);
      expect(text).toMatch(/HINT: \d+ public api view\(s\) answered HTTP 406.*Exposed schemas.*add api next to public/);
      expect(text).toMatch(/HINT: new sign-ups are still switched on.*Allow new users to sign up/);
      expect(text).not.toContain(KEY);
    } finally {
      vi.unstubAllGlobals();
    }
  });
});

describe('harness: public views that cannot be written at all (first live run, 2026-10-24)', () => {
  const manifest = [{ name: 'public_players', pk: 'id', pkSample: '00000000-0000-0000-0000-000000000000', schema: 'api', expectSelect: true }];
  /** The normal fake API, except that every WRITE to public_players answers with the given status and JSON body. */
  const withWriteAnswer = (status, body) => {
    const base = fakeApi({ open: { public_players: { select: 200 } } });
    return async (url, init = {}) => {
      const method = init.method ?? 'GET';
      if (new globalThis.URL(url).pathname.endsWith('/public_players') && method !== 'GET') return new Response(JSON.stringify(body), { status });
      return base.fetch(url, init);
    };
  };

  it('counts Postgres 55000 (view not automatically updatable) on a write as denied by construction, not as an error', async () => {
    const r = await runHarness({ url: URL, key: KEY, fetch: withWriteAnswer(500, { code: '55000', message: 'cannot insert into view' }), manifest });
    expect(r.exitCode).toBe(0);
    expect(r.errors).toEqual([]);
    expect(r.leaks).toEqual([]);
    expect(r.results.filter((x) => x.target === 'public_players' && x.op !== 'select').every((x) => x.ok)).toBe(true);
  });

  it('still reports any other server error as an error, and never accepts 55000 as an answer to a SELECT that should work', async () => {
    const other = await runHarness({ url: URL, key: KEY, fetch: withWriteAnswer(500, { code: 'XX000', message: 'boom' }), manifest });
    expect(other.exitCode).toBe(1);
    expect(other.errors.length).toBe(3);
    const noCode = await runHarness({ url: URL, key: KEY, fetch: withWriteAnswer(500, {}), manifest });
    expect(noCode.errors.length).toBe(3);
    const base = fakeApi({ open: { public_players: { select: 200 } } });
    const brokenSelect = async (url, init = {}) =>
      (init.method ?? 'GET') === 'GET' && new globalThis.URL(url).pathname.endsWith('/public_players')
        ? new Response(JSON.stringify({ code: '55000' }), { status: 500 })
        : base.fetch(url, init);
    const sel = await runHarness({ url: URL, key: KEY, fetch: brokenSelect, manifest });
    expect(sel.exitCode).toBe(1);
  });

  it('a write that succeeds on such a view is still a leak', async () => {
    const r = await runHarness({ url: URL, key: KEY, fetch: withWriteAnswer(201, {}), manifest });
    expect(r.leaks.length).toBeGreaterThan(0);
    expect(r.exitCode).toBe(1);
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
