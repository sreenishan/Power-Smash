import { afterEach, describe, expect, it, vi } from 'vitest';
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import { attributesOf, cspHash, finalizeConfig, inlineCodeOf } from '../../scripts/lib/headers-file.ts';
import { finalizeFolder } from '../../scripts/finalize-headers.ts';
import { buildPageCsp } from '../../src/lib/infra/headers';
import {
  MANAGED_BEGIN_SRC,
  MANAGED_END_SRC,
  ROUTE_SRC,
  VERCEL_MAX_ROUTES,
  applyManagedRoutes,
  buildHeaderRoutes,
  buildRedirectRoutes,
  checkRouteLimits,
  managedBlock,
  managedRoutesOf,
  parseHostSuffixes,
  routeHeader,
  stripManaged,
} from '../../src/lib/infra/vercel-routes';
import type { VercelConfig } from '../../src/lib/infra/vercel-routes';
import { cleanupTemp, makeDist, page, runScript } from './helpers';

afterEach(cleanupTemp);
// Some tests start Node child processes (the way npm runs the scripts): allow for a busy PC.
vi.setConfig({ testTimeout: 30_000 });

// Shape of what the Astro Vercel adapter writes: its own routes come after ours.
const ADAPTER_CONFIG = (): VercelConfig => ({ version: 3, routes: [{ handle: 'filesystem' }, { src: '/(.*)', dest: '/_render' }] });
const base = { csp: buildPageCsp({ turnstile: true }), allowIndexing: false, hstsMaxAge: null, canonicalHost: 'powersmash.in', noindexHostSuffixes: ['.vercel.app'] };
const managed = (c: VercelConfig) => managedRoutesOf(c);
const all = (c: VercelConfig, name: string) => routeHeader(managed(c), ROUTE_SRC.everywhere, name);

describe('header routes in config.json', () => {
  it('carry the base security headers on every path and the CSP on pages only', () => {
    const c = finalizeConfig(ADAPTER_CONFIG(), base);
    expect(all(c, 'X-Content-Type-Options')).toBe('nosniff');
    expect(all(c, 'Referrer-Policy')).toBe('strict-origin-when-cross-origin');
    expect(all(c, 'Permissions-Policy')).toContain('camera=()');
    expect(all(c, 'X-Frame-Options')).toBe('DENY');
    expect(routeHeader(managed(c), ROUTE_SRC.pages, 'Content-Security-Policy')).toBe(base.csp);
    const re = new RegExp(ROUTE_SRC.pages);
    for (const p of ['/', '/book/', '/_astro/a.js', '/admin/leads']) expect(re.test(p), p).toBe(true);
    for (const p of ['/api/lead', '/go/x', '/cdn-cgi/rum', '/api']) expect(re.test(p), p).toBe(false);
  });

  it('api, go and cdn-cgi get the locked-down CSP and no-store; hashed assets get a long immutable cache', () => {
    const c = finalizeConfig(ADAPTER_CONFIG(), base);
    expect(routeHeader(managed(c), ROUTE_SRC.api, 'Content-Security-Policy')).toContain("default-src 'none'");
    expect(routeHeader(managed(c), ROUTE_SRC.noStore, 'Cache-Control')).toBe('no-store');
    expect(routeHeader(managed(c), ROUTE_SRC.api, 'Cache-Control')).toBeNull();
    // /api/placements keeps its own public cache header; every other function path is no-store.
    const re = new RegExp(ROUTE_SRC.noStore);
    expect(re.test('/api/placements')).toBe(false);
    expect(re.test('/api/placements/')).toBe(false);
    for (const p of ['/api/lead', '/api/health', '/api/placementsx', '/api/placements/x', '/go/sponsor', '/cdn-cgi/x']) expect(re.test(p)).toBe(true);
    expect(routeHeader(managed(c), ROUTE_SRC.astro, 'Cache-Control')).toBe('public, max-age=31536000, immutable');
    expect(all(c, 'Cache-Control')).toBeNull();
  });

  it('all header routes continue routing (they add headers, they never answer)', () => {
    const c = finalizeConfig(ADAPTER_CONFIG(), { ...base, allowIndexing: true });
    for (const r of managed(c).filter((x) => x.headers)) expect(r.continue, String(r.src)).toBe(true);
  });

  it('the managed block is first, the adapter routes follow untouched', () => {
    const c = finalizeConfig(ADAPTER_CONFIG(), base);
    expect(c.routes?.[0]?.src).toBe(MANAGED_BEGIN_SRC);
    expect(c.routes?.slice(-2)).toEqual(ADAPTER_CONFIG().routes);
    expect(managed(c).at(-1)?.src).toBe(MANAGED_END_SRC);
    expect(c.version).toBe(3);
  });

  it('indexing off: noindex on every response (one rule); no host rules needed', () => {
    const c = finalizeConfig(ADAPTER_CONFIG(), base);
    expect(all(c, 'X-Robots-Tag')).toBe('noindex, nofollow');
    expect(managed(c).filter((r) => r.has || r.missing)).toHaveLength(0);
  });

  it('indexing on: no global noindex, but noindex on api/go/admin paths, *.vercel.app, configured suffixes and any non-canonical host', () => {
    const c = finalizeConfig(ADAPTER_CONFIG(), { ...base, allowIndexing: true, noindexHostSuffixes: parseHostSuffixes('.preview.example.org') });
    expect(all(c, 'X-Robots-Tag')).toBeNull();
    expect(routeHeader(managed(c), ROUTE_SRC.noindexPaths, 'X-Robots-Tag')).toBe('noindex, nofollow');
    const hostRules = managed(c).filter((r) => r.has || r.missing);
    expect(hostRules.flatMap((r) => r.has ?? []).map((h) => (h.value as { suf: string }).suf)).toEqual(['.vercel.app', '.preview.example.org']);
    const missing = hostRules.find((r) => r.missing);
    expect(missing?.missing).toEqual([{ type: 'host', value: { eq: 'powersmash.in' } }]);
    expect(hostRules.every((r) => r.headers?.['X-Robots-Tag'] === 'noindex, nofollow')).toBe(true);
    const noCanonical = finalizeConfig(ADAPTER_CONFIG(), { ...base, allowIndexing: true, canonicalHost: null });
    expect(managed(noCanonical).some((r) => r.missing)).toBe(false);
  });

  it('HSTS only when a max-age is configured', () => {
    expect(all(finalizeConfig(ADAPTER_CONFIG(), { ...base, hstsMaxAge: 86400 }), 'Strict-Transport-Security')).toBe('max-age=86400');
    expect(JSON.stringify(finalizeConfig(ADAPTER_CONFIG(), base))).not.toContain('Strict-Transport-Security');
  });

  it('is idempotent and depends only on the options, never on an earlier run', () => {
    for (const allowIndexing of [false, true]) {
      const opts = { ...base, allowIndexing, hstsMaxAge: 3600 };
      const once = finalizeConfig(ADAPTER_CONFIG(), opts);
      expect(finalizeConfig(once, opts)).toEqual(once);
    }
    const first = finalizeConfig(ADAPTER_CONFIG(), { ...base, hstsMaxAge: 300 });
    const second = finalizeConfig(first, { ...base, allowIndexing: true, hstsMaxAge: null });
    expect(JSON.stringify(second)).not.toContain('Strict-Transport-Security');
    expect(all(second, 'X-Robots-Tag')).toBeNull();
    expect(finalizeConfig(second, { ...base, hstsMaxAge: 300 })).toEqual(first);
  });

  it('replaces the CSP, never adds a second one', () => {
    const withHash = buildPageCsp({ scriptHashes: [cspHash('console.log(1)')], turnstile: true });
    const c = finalizeConfig(finalizeConfig(ADAPTER_CONFIG(), base), { ...base, csp: withHash });
    expect(routeHeader(managed(c), ROUTE_SRC.pages, 'Content-Security-Policy')).toBe(withHash);
    expect(managed(c).filter((r) => r.headers?.['Content-Security-Policy'] === withHash)).toHaveLength(1);
  });

  it('allows only Turnstile and YouTube nocookie as outside hosts by default (no analytics without a token)', () => {
    const csp = routeHeader(managed(finalizeConfig(ADAPTER_CONFIG(), base)), ROUTE_SRC.pages, 'Content-Security-Policy') ?? '';
    expect(csp).toContain('https://challenges.cloudflare.com');
    expect(csp).toContain('https://www.youtube-nocookie.com');
    expect(csp).not.toContain('cloudflareinsights');
  });

  it('parseHostSuffixes always keeps .vercel.app, adds valid entries, drops junk', () => {
    expect(parseHostSuffixes(undefined)).toEqual(['.vercel.app']);
    expect(parseHostSuffixes('example.org, .Preview.Test ,bad host,;;,.vercel.app')).toEqual(['.vercel.app', '.example.org', '.preview.test']);
  });

  it('block helpers: strip removes only the managed block; a broken block (no end) still strips the begin marker', () => {
    const block = managedBlock(buildHeaderRoutes({ ...base }), []);
    const routes = [{ src: '/a' }, ...block, { src: '/b' }];
    expect(stripManaged(routes)).toEqual([{ src: '/a' }, { src: '/b' }]);
    expect(stripManaged(block.slice(0, -1)).some((r) => r.src === MANAGED_BEGIN_SRC)).toBe(false);
    expect(applyManagedRoutes({ routes: [{ src: '/x' }] }, block).routes?.at(-1)).toEqual({ src: '/x' });
  });

  it('limits: more than 2,048 routes or an oversized header value is a problem', () => {
    expect(checkRouteLimits(Array.from({ length: VERCEL_MAX_ROUTES + 1 }, () => ({ src: '/' })))).toHaveLength(1);
    expect(checkRouteLimits([{ src: '/', headers: { 'Content-Security-Policy': 'x'.repeat(7000) } }])[0]).toContain('7000');
    expect(checkRouteLimits(finalizeConfig(ADAPTER_CONFIG(), base).routes ?? [])).toEqual([]);
  });
});

describe('redirect routes', () => {
  it('make a 301 route per rule; the address without the slash redirects too; regex characters are escaped', () => {
    const [r] = buildRedirectRoutes([{ from: '/players/old-a.b/', to: '/players/new/', status: 301 }]);
    expect(r?.status).toBe(301);
    expect(r?.headers).toEqual({ Location: '/players/new/' });
    const re = new RegExp(r?.src as string);
    expect(re.test('/players/old-a.b/')).toBe(true);
    expect(re.test('/players/old-a.b')).toBe(true);
    expect(re.test('/players/old-aXb/')).toBe(false);
    expect(re.test('/players/old-a.b/extra')).toBe(false);
    expect(r?.continue).toBeUndefined(); // a redirect ends routing
  });

  it('are placed after the header routes inside the managed block', () => {
    const c = finalizeConfig(ADAPTER_CONFIG(), { ...base, redirects: [{ from: '/players/x/', to: '/matches/gone/', status: 301 }] });
    const m = managed(c);
    const idxRedirect = m.findIndex((r) => r.headers?.Location);
    expect(idxRedirect).toBeGreaterThan(m.findIndex((r) => r.src === ROUTE_SRC.everywhere));
    expect(m[idxRedirect]?.headers?.Location).toBe('/matches/gone/');
  });
});

describe('inline scripts and styles in built pages', () => {
  it('hashes exactly what the browser hashes: the text between the tags', () => {
    const script = 'console.log("hi");';
    const expected = `'sha256-${createHash('sha256').update(script).digest('base64')}'`;
    expect(cspHash(script)).toBe(expected);
    expect(inlineCodeOf(`<script>${script}</script>`).scripts).toEqual([script]);
  });

  it('collects inline module and classic scripts and style blocks; skips external scripts, JSON-LD and empty tags', () => {
    const html = page(
      [
        '<script type="module">import("/a.js")</script>',
        '<script>window.x=1</script>',
        '<script src="/_astro/app.js"></script>',
        '<script type="application/ld+json">{"@type":"Thing"}</script>',
        '<script></script>',
        '<style>.a{color:red}</style>',
        '<style> </style>',
      ].join(''),
    );
    const code = inlineCodeOf(html);
    expect(code.scripts).toEqual(['import("/a.js")', 'window.x=1']);
    expect(code.styles).toEqual(['.a{color:red}']);
  });

  it('a data-src attribute does not make a script external (B-17): the inline script is still collected for hashing', () => {
    const code = inlineCodeOf(page('<script data-src="x">var a=1</script><script data-x="a src=b" type="module">var b=2</script><script SRC = "/ext.js"></script>'));
    expect(code.scripts).toEqual(['var a=1', 'var b=2']);
  });

  it('attributesOf reads quoted, single-quoted and bare values and lower-cases the names', () => {
    expect([...attributesOf(' TYPE="module" data-a=\'1 2\' async src=/x.js ')]).toEqual([
      ['type', 'module'],
      ['data-a', '1 2'],
      ['async', ''],
      ['src', '/x.js'],
    ]);
  });

  it('counts inline event handlers and style attributes, ignoring text inside scripts and comments', () => {
    const html = page('<button onclick="go()">x</button><div style="width:3px">y</div><script>el.innerHTML="<a onclick=1>"</script><!-- <i onclick=2> -->');
    const code = inlineCodeOf(html);
    expect(code.eventHandlerAttributes).toBe(1);
    expect(code.styleAttributes).toBe(1);
  });

  it('finalizeFolder puts the hashes of every inline script and style of every page into the CSP, once each', () => {
    const root = makeDist({
      'index.html': page('<script type="module">a()</script><style>.x{}</style>'),
      'book/index.html': page('<script type="module">a()</script><script>b()</script>'),
    });
    const r = finalizeFolder(root, ADAPTER_CONFIG(), { PUBLIC_ALLOW_INDEXING: 'false' });
    expect(r.pages).toBe(2);
    expect(r.scriptHashes).toEqual([cspHash('a()'), cspHash('b()')].sort());
    expect(r.styleHashes).toEqual([cspHash('.x{}')]);
    const csp = routeHeader(managedRoutesOf(r.config), ROUTE_SRC.pages, 'Content-Security-Policy') ?? '';
    expect(csp).toContain(cspHash('a()'));
    expect(csp).toContain(cspHash('b()'));
    expect(csp).toContain(cspHash('.x{}'));
    expect(csp).not.toMatch(/script-src [^;]*'unsafe-inline'/);
    expect(csp).not.toMatch(/style-src [^;]*'unsafe-inline'/); // only style-src-attr carries it
    expect(r.problems).toEqual([]);
  });

  it('reads the configuration from the environment: analytics only with a token, Supabase origin, indexing flag, HSTS, canonical host', () => {
    const root = makeDist({ 'index.html': page('<p>x</p>') });
    const bare = finalizeFolder(root, ADAPTER_CONFIG(), {});
    expect(JSON.stringify(bare.config)).not.toContain('cloudflareinsights');
    expect(routeHeader(managedRoutesOf(bare.config), ROUTE_SRC.everywhere, 'X-Robots-Tag')).toBe('noindex, nofollow');
    const full = finalizeFolder(root, ADAPTER_CONFIG(), {
      PUBLIC_CF_ANALYTICS_TOKEN: 'a'.repeat(32),
      PUBLIC_SUPABASE_URL: 'https://abcdefgh.supabase.co',
      PUBLIC_ALLOW_INDEXING: 'true',
      PUBLIC_HSTS_MAX_AGE: '86400',
      PUBLIC_SITE_URL: 'https://www.powersmash.in/',
    });
    const text = JSON.stringify(full.config);
    expect(text).toContain('https://static.cloudflareinsights.com/beacon.min.js');
    expect(text).toContain('https://abcdefgh.supabase.co');
    expect(routeHeader(managedRoutesOf(full.config), ROUTE_SRC.everywhere, 'X-Robots-Tag')).toBeNull();
    expect(routeHeader(managedRoutesOf(full.config), ROUTE_SRC.everywhere, 'Strict-Transport-Security')).toBe('max-age=86400');
    expect(managedRoutesOf(full.config).some((r) => JSON.stringify(r.missing ?? []).includes('www.powersmash.in'))).toBe(true);
  });
});

describe('finalize-headers command line', () => {
  const setup = (html: string, redirects?: unknown) => {
    const root = makeDist({
      'static/index.html': html,
      'config.json': JSON.stringify(ADAPTER_CONFIG()),
      ...(redirects ? { 'redirects.json': JSON.stringify(redirects) } : {}),
    });
    const args = ['--static', join(root, 'static'), '--config', join(root, 'config.json'), '--redirects', join(root, 'redirects.json')];
    return { root, args };
  };

  it('rewrites config.json in place, keeps the adapter routes, adds redirect routes and is stable on a second run', () => {
    const { root, args } = setup(page('<script type="module">boot()</script>'), [{ from: '/players/old/', to: '/matches/gone/', status: 301 }]);
    const first = runScript('scripts/finalize-headers.ts', args, {});
    expect(first.status).toBe(0);
    expect(first.stdout).toContain('1 inline script hash');
    expect(first.stdout).toContain('1 redirect route');
    const after = readFileSync(join(root, 'config.json'), 'utf8');
    const cfg = JSON.parse(after) as VercelConfig;
    expect(cfg.routes?.slice(-2)).toEqual(ADAPTER_CONFIG().routes);
    expect(after).toContain(cspHash('boot()'));
    expect(after).toContain('/matches/gone/');
    expect(runScript('scripts/finalize-headers.ts', args, {}).status).toBe(0);
    expect(readFileSync(join(root, 'config.json'), 'utf8')).toBe(after);
  });

  it('works without a redirects file', () => {
    const { root } = setup(page('<p>x</p>'));
    const r = runScript('scripts/finalize-headers.ts', ['--static', join(root, 'static'), '--config', join(root, 'config.json'), '--redirects', join(root, 'none.json')], {});
    expect(r.status).toBe(0);
    expect(r.stdout).toContain('0 redirect route');
  });

  it('fails on an inline event handler, and when the CSP value is over the size precaution', () => {
    const handler = setup(page('<button onclick="x()">b</button>'));
    const r = runScript('scripts/finalize-headers.ts', handler.args, {});
    expect(r.status).toBe(1);
    expect(r.stderr).toContain('inline event handler');

    const scripts = Array.from({ length: 120 }, (_, i) => `<script>var n${i}=${i}</script>`).join('');
    const tooLong = setup(page(scripts));
    const r2 = runScript('scripts/finalize-headers.ts', tooLong.args, {});
    expect(r2.status).toBe(1);
    expect(r2.stderr).toContain('precaution limit');
  });

  it('exits 2 when the build output is missing', () => {
    const root = makeDist({ 'x.txt': 'x' });
    expect(runScript('scripts/finalize-headers.ts', ['--static', join(root, 'nope'), '--config', join(root, 'c.json')], {}).status).toBe(2);
    writeFileSync(join(root, 'c.json'), '{}');
    expect(runScript('scripts/finalize-headers.ts', ['--static', root, '--config', join(root, 'missing.json')], {}).status).toBe(2);
  });
});
