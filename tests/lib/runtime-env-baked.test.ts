// FIX 1 (security review): PUBLIC_SUPABASE_URL is a GitHub BUILD variable (inlined into the bundle), not a Vercel runtime variable.
// Code that read only `process.env` (the /go click log, the database sponsor links, the admin API) went dead when only the build
// variable was set, while /api/health still said "lead":"ready" through the baked fallback. `withBakedSupabaseUrl` gives every
// reader the same rule: the baked value fills PUBLIC_SUPABASE_URL ONLY when neither SUPABASE_URL nor PUBLIC_SUPABASE_URL is set at run time.
//
// Vitest note: `vi.stubEnv` writes BOTH `import.meta.env` and `process.env`, so the true build-time/runtime split (a value baked into
// the bundle and absent from the function's environment) cannot be reproduced here. These tests prove the helper and the precedence
// rule with the baked value injected; the split itself can only be proven on a Vercel preview (docs/m3/review-fix-code-notes.md).
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { buildAdminDeps, pickAdminEnv } from '../../src/lib/admin/config';
import { createGoDeps } from '../../src/lib/infra/go-handler';
import { resetGoDataCacheForTests, resolveGoData } from '../../src/lib/infra/go-sponsor-links';
import { buildLeadConfig, leadEndpointStatus } from '../../src/lib/leads/config';
import { isAcceptableSupabaseUrl } from '../../src/lib/supabase/rest';
import { bakedPublicSupabaseUrl, getLeadConfig, getRuntimeEnv, withBakedSupabaseUrl } from '../../src/lib/runtime-env';

const BAKED = 'https://bakedref.supabase.co';
const RUNTIME = 'https://runtimeref.supabase.co';
const FAKE_SECRET = ['sb', 'secret', 'FAKE'].join('_');

afterEach(() => {
  vi.unstubAllEnvs();
  resetGoDataCacheForTests();
});

describe('withBakedSupabaseUrl: the precedence rule', () => {
  it('fills PUBLIC_SUPABASE_URL from the baked value when no runtime URL exists', () => {
    expect(withBakedSupabaseUrl({ SUPABASE_SECRET_KEY: 'x' }, BAKED)).toEqual({ SUPABASE_SECRET_KEY: 'x', PUBLIC_SUPABASE_URL: BAKED });
  });

  it('the baked value is trimmed and still passes isAcceptableSupabaseUrl', () => {
    const out = withBakedSupabaseUrl({}, `  ${BAKED}  `);
    expect(out.PUBLIC_SUPABASE_URL).toBe(BAKED);
    expect(isAcceptableSupabaseUrl(String(out.PUBLIC_SUPABASE_URL))).toBe(true);
  });

  it('never overrides a runtime SUPABASE_URL', () => {
    const out = withBakedSupabaseUrl({ SUPABASE_URL: RUNTIME }, BAKED);
    expect(out.SUPABASE_URL).toBe(RUNTIME);
    expect(out.PUBLIC_SUPABASE_URL).toBeUndefined();
  });

  it('never overrides a runtime PUBLIC_SUPABASE_URL', () => {
    const out = withBakedSupabaseUrl({ PUBLIC_SUPABASE_URL: RUNTIME }, BAKED);
    expect(out.PUBLIC_SUPABASE_URL).toBe(RUNTIME);
  });

  it('a blank runtime value counts as not set', () => {
    expect(withBakedSupabaseUrl({ SUPABASE_URL: '   ' }, BAKED).PUBLIC_SUPABASE_URL).toBe(BAKED);
    expect(withBakedSupabaseUrl({ PUBLIC_SUPABASE_URL: '' }, BAKED).PUBLIC_SUPABASE_URL).toBe(BAKED);
  });

  it('invents nothing when there is no baked value (undefined, empty or blank)', () => {
    for (const baked of [undefined, '', '   ']) {
      const out = withBakedSupabaseUrl({ SUPABASE_SECRET_KEY: 'x' }, baked);
      expect(Object.keys(out)).toEqual(['SUPABASE_SECRET_KEY']);
    }
  });

  it('returns a copy and never writes to the source (process.env must stay untouched)', () => {
    const source: Record<string, unknown> = { A: '1' };
    const out = withBakedSupabaseUrl(source, BAKED);
    expect(out).not.toBe(source);
    expect(source).toEqual({ A: '1' });
  });
});

describe('bakedPublicSupabaseUrl and getRuntimeEnv', () => {
  it('returns the trimmed build value, or undefined when blank or absent', () => {
    vi.stubEnv('PUBLIC_SUPABASE_URL', `  ${BAKED} `);
    expect(bakedPublicSupabaseUrl()).toBe(BAKED);
    vi.stubEnv('PUBLIC_SUPABASE_URL', '   ');
    expect(bakedPublicSupabaseUrl()).toBeUndefined();
    vi.stubEnv('PUBLIC_SUPABASE_URL', undefined);
    expect(bakedPublicSupabaseUrl()).toBeUndefined();
  });

  it('with nothing set, getRuntimeEnv carries no Supabase URL at all', async () => {
    vi.stubEnv('SUPABASE_URL', undefined);
    vi.stubEnv('PUBLIC_SUPABASE_URL', undefined);
    const rt = await getRuntimeEnv();
    expect(rt.SUPABASE_URL).toBeUndefined();
    expect(rt.PUBLIC_SUPABASE_URL).toBeUndefined();
  });

  it('a runtime SUPABASE_URL is kept as it is and the public name is not added next to it', async () => {
    vi.stubEnv('SUPABASE_URL', RUNTIME);
    vi.stubEnv('PUBLIC_SUPABASE_URL', undefined);
    const rt = await getRuntimeEnv();
    expect(rt.SUPABASE_URL).toBe(RUNTIME);
    expect(rt.PUBLIC_SUPABASE_URL).toBeUndefined();
  });

  it('getLeadConfig behaves as before: a good URL is ready, a refused one is reported, SUPABASE_URL wins over the public one', async () => {
    vi.stubEnv('SUPABASE_URL', undefined);
    vi.stubEnv('PUBLIC_SUPABASE_URL', BAKED);
    expect((await getLeadConfig()).supabaseUrl).toBe(BAKED);
    vi.stubEnv('PUBLIC_SUPABASE_URL', 'http://bakedref.supabase.co'); // not https
    const refused = await getLeadConfig();
    expect(refused.supabaseUrl).toBeNull();
    expect(refused.supabaseUrlRefused).toBe(true);
    expect(leadEndpointStatus(refused)).toEqual({ ready: false, reason: 'supabase_url' });
    vi.stubEnv('SUPABASE_URL', RUNTIME);
    vi.stubEnv('PUBLIC_SUPABASE_URL', BAKED);
    expect((await getLeadConfig()).supabaseUrl).toBe(RUNTIME);
    expect(buildLeadConfig({ SUPABASE_URL: RUNTIME }, { publicSupabaseUrl: BAKED }).supabaseUrl).toBe(RUNTIME);
  });
});

describe('the three readers that only looked at process.env now work from the baked value', () => {
  const runtimeOnlySecret = { SUPABASE_SECRET_KEY: FAKE_SECRET };

  it('/go click log: createGoDeps inserts into the baked project', async () => {
    const seen: string[] = [];
    const fetchImpl = (async (url: string) => {
      seen.push(String(url));
      return new Response(null, { status: 201 });
    }) as unknown as typeof fetch;
    const env = withBakedSupabaseUrl(runtimeOnlySecret, BAKED);
    const deps = createGoDeps(env, { links: {}, allowedHosts: [], requestOrigin: 'https://powersmash.example', fetchImpl });
    await deps.logClick({ go_slug: 's', target_type: 'sponsored', target_id: null, page_path: null, utm: '', ua_hash: 'h' });
    expect(seen).toHaveLength(1);
    expect(seen[0]).toContain('bakedref.supabase.co/rest/v1/outbound_clicks');
  });

  it('/go sponsor links: resolveGoData reads the placements from the baked project', async () => {
    const seen: string[] = [];
    const fetchImpl = (async (url: string) => {
      seen.push(String(url));
      return new Response('[]', { status: 200 });
    }) as unknown as typeof fetch;
    await resolveGoData(withBakedSupabaseUrl(runtimeOnlySecret, BAKED), { links: {}, allowedHosts: [] }, { fetchImpl });
    expect(seen[0]).toContain('bakedref.supabase.co/rest/v1/placements?');
  });

  it('the runtime URL still wins for both readers', async () => {
    const seen: string[] = [];
    const fetchImpl = (async (url: string) => {
      seen.push(String(url));
      return new Response('[]', { status: 200 });
    }) as unknown as typeof fetch;
    await resolveGoData(withBakedSupabaseUrl({ ...runtimeOnlySecret, SUPABASE_URL: RUNTIME }, BAKED), { links: {}, allowedHosts: [] }, { fetchImpl });
    expect(seen[0]).toContain('runtimeref.supabase.co');
    expect(seen.join(' ')).not.toContain('bakedref');
  });

  it('admin API: buildAdminDeps is configured from the baked URL, and is null (503) when nothing is set', () => {
    const io = { fetch: (async () => new Response('{}')) as unknown as typeof fetch, now: () => new Date('2026-11-01T00:00:00Z') };
    expect(buildAdminDeps(pickAdminEnv(withBakedSupabaseUrl(runtimeOnlySecret, BAKED)), io)).not.toBeNull();
    expect(buildAdminDeps(pickAdminEnv(withBakedSupabaseUrl(runtimeOnlySecret, undefined)), io)).toBeNull();
  });

  it('admin API: a baked URL that is not an acceptable Supabase URL still gives null (nothing is served from a guess)', () => {
    const io = { fetch: (async () => new Response('{}')) as unknown as typeof fetch, now: () => new Date('2026-11-01T00:00:00Z') };
    expect(buildAdminDeps(pickAdminEnv(withBakedSupabaseUrl(runtimeOnlySecret, 'http://evil.example')), io)).toBeNull();
  });
});

describe('the admin route reads its environment through the same helper (source guard)', () => {
  it('src/pages/api/admin/[action].ts uses withBakedSupabaseUrl in readEnv', () => {
    const src = readFileSync(join(process.cwd(), 'src', 'pages', 'api', 'admin', '[action].ts'), 'utf8');
    expect(src).toMatch(/import \{ withBakedSupabaseUrl \} from '\.\.\/\.\.\/\.\.\/lib\/runtime-env'/);
    expect(src).toMatch(/return withBakedSupabaseUrl\(env\)/);
  });
});
