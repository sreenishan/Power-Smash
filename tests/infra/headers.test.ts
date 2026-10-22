import { describe, expect, it } from 'vitest';
import {
  API_CSP,
  BASE_SECURITY_HEADERS,
  CSP_HASH_PATTERN,
  NOINDEX_VALUE,
  PERMISSIONS_POLICY,
  REFERRER_POLICY,
  applySecurityHeaders,
  buildPageCsp,
  hstsValue,
  isNoindexHost,
  parseMaxAge,
  shouldNoindex,
} from '../../src/lib/infra/headers';
import type { SecurityContext } from '../../src/lib/infra/headers';

const HASH_A = `'sha256-${'A'.repeat(43)}='`;
const HASH_B = `'sha256-${'B'.repeat(43)}='`;

const directive = (csp: string, name: string): string[] => {
  const d = csp.split('; ').find((x) => x.startsWith(`${name} `));
  return d ? d.slice(name.length + 1).split(' ') : [];
};

describe('CSP for pages', () => {
  const csp = buildPageCsp({ analytics: true, turnstile: true, supabaseOrigin: 'https://abcdefgh.supabase.co' });

  it('has no unsafe-eval anywhere and no unsafe-inline for scripts or for style blocks', () => {
    expect(csp).not.toContain('unsafe-eval');
    expect(directive(csp, 'script-src')).not.toContain("'unsafe-inline'");
    expect(directive(csp, 'style-src')).not.toContain("'unsafe-inline'");
    expect(directive(csp, 'script-src-attr')).toEqual(["'none'"]);
    // style="" attributes are allowed on purpose (cannot run code); documented in docs/m1/infra-notes.md
    expect(directive(csp, 'style-src-attr')).toEqual(["'unsafe-inline'"]);
  });

  it('allows only self, Turnstile and the Web Analytics beacon file for scripts', () => {
    expect(directive(csp, 'script-src')).toEqual(["'self'", 'https://challenges.cloudflare.com', 'https://static.cloudflareinsights.com/beacon.min.js']);
  });

  it('frames only YouTube (privacy-enhanced) and Turnstile, and nothing may frame the site', () => {
    expect(directive(csp, 'frame-src')).toEqual(['https://www.youtube-nocookie.com', 'https://challenges.cloudflare.com']);
    expect(directive(csp, 'frame-ancestors')).toEqual(["'none'"]);
    expect(directive(csp, 'object-src')).toEqual(["'none'"]);
    expect(directive(csp, 'base-uri')).toEqual(["'self'"]);
    expect(directive(csp, 'form-action')).toEqual(["'self'"]);
  });

  it('images: self, data and YouTube thumbnails; connections: self, the Web Analytics endpoint and the Supabase origin', () => {
    expect(directive(csp, 'img-src')).toEqual(["'self'", 'data:', 'https://i.ytimg.com', 'https://abcdefgh.supabase.co']);
    expect(directive(csp, 'connect-src')).toEqual(["'self'", 'https://cloudflareinsights.com', 'https://abcdefgh.supabase.co']);
    expect(directive(csp, 'font-src')).toEqual(["'self'"]);
  });

  it('leaves out what is not configured: no analytics hosts without a token, no Turnstile when off, no Supabase without a URL', () => {
    const bare = buildPageCsp({});
    expect(bare).not.toContain('cloudflareinsights');
    expect(bare).not.toContain('challenges.cloudflare.com');
    expect(bare).not.toContain('supabase');
    expect(directive(bare, 'frame-src')).toEqual(['https://www.youtube-nocookie.com']);
  });

  it('adds hashes (sorted, de-duplicated) to script-src and style-src', () => {
    const withHashes = buildPageCsp({ scriptHashes: [HASH_B, HASH_A, HASH_A], styleHashes: [HASH_A] });
    expect(directive(withHashes, 'script-src')).toEqual(["'self'", HASH_A, HASH_B]);
    expect(directive(withHashes, 'style-src')).toEqual(["'self'", HASH_A]);
  });

  it('refuses anything that is not a hash source, so nothing can be smuggled into the policy', () => {
    expect(() => buildPageCsp({ scriptHashes: ["'unsafe-inline'"] })).toThrow();
    expect(() => buildPageCsp({ scriptHashes: ["'sha256-abc'; script-src *"] })).toThrow();
    expect(() => buildPageCsp({ styleHashes: ['sha256-' + 'A'.repeat(43)] })).toThrow(); // missing quotes
    expect(CSP_HASH_PATTERN.test(HASH_A)).toBe(true);
  });

  it('only accepts an https Supabase origin', () => {
    expect(buildPageCsp({ supabaseOrigin: 'http://abcdefgh.supabase.co' })).not.toContain('supabase');
    expect(buildPageCsp({ supabaseOrigin: 'not a url' })).not.toContain('supabase');
    expect(buildPageCsp({ supabaseOrigin: 'https://abcdefgh.supabase.co/rest/v1' })).toContain("connect-src 'self' https://abcdefgh.supabase.co");
  });

  it('API responses (JSON, redirects) may load nothing at all', () => {
    expect(API_CSP).toContain("default-src 'none'");
    expect(API_CSP).toContain("frame-ancestors 'none'");
  });
});

describe('fixed headers', () => {
  it('the referrer policy is strict-origin-when-cross-origin, never no-referrer (YouTube embeds need a Referer)', () => {
    expect(REFERRER_POLICY).toBe('strict-origin-when-cross-origin');
    expect(BASE_SECURITY_HEADERS['Referrer-Policy']).toBe('strict-origin-when-cross-origin');
    expect(Object.values(BASE_SECURITY_HEADERS).join(' ')).not.toMatch(/no-referrer/);
  });

  it('nosniff, DENY framing and a restrictive Permissions-Policy', () => {
    expect(BASE_SECURITY_HEADERS['X-Content-Type-Options']).toBe('nosniff');
    expect(BASE_SECURITY_HEADERS['X-Frame-Options']).toBe('DENY');
    for (const f of ['camera', 'microphone', 'geolocation', 'payment', 'usb']) expect(PERMISSIONS_POLICY).toContain(`${f}=()`);
  });

  it('HSTS is only produced for a valid configured value, without includeSubDomains or preload', () => {
    expect(parseMaxAge(undefined)).toBeNull();
    expect(parseMaxAge('')).toBeNull();
    expect(parseMaxAge('abc')).toBeNull();
    expect(parseMaxAge('-5')).toBeNull();
    expect(parseMaxAge('99999999999')).toBeNull();
    expect(parseMaxAge('63072001')).toBeNull();
    expect(parseMaxAge(' 86400 ')).toBe(86400);
    expect(parseMaxAge('0')).toBe(0);
    expect(hstsValue(null)).toBeNull();
    expect(hstsValue(86400)).toBe('max-age=86400');
    expect(hstsValue(86400)).not.toMatch(/includeSubDomains|preload/);
  });
});

describe('noindex rules (D-023, D-029)', () => {
  it('vercel.app and any non-canonical host are noindex', () => {
    expect(isNoindexHost('power-smash.vercel.app', 'powersmash.in')).toBe(true);
    expect(isNoindexHost('abc-power-smash-git-feature-team.vercel.app', null)).toBe(true);
    expect(isNoindexHost('x.example.org', null, ['.example.org'])).toBe(true);
    expect(isNoindexHost('power-smash.account.workers.dev', null)).toBe(false); // Cloudflare hosting is gone
    expect(isNoindexHost('www.powersmash.in', 'powersmash.in')).toBe(true);
    expect(isNoindexHost('POWERSMASH.in', 'powersmash.in')).toBe(false);
    expect(isNoindexHost('powersmash.in', null)).toBe(false);
  });

  it('everything is noindex unless indexing is explicitly allowed', () => {
    const base = { hostname: 'powersmash.in', canonicalHost: 'powersmash.in', pathname: '/book' };
    expect(shouldNoindex({ ...base, allowIndexing: false })).toBe(true);
    expect(shouldNoindex({ ...base, allowIndexing: true })).toBe(false);
  });

  it('/api, /go, /admin and /cdn-cgi are noindex even when indexing is on', () => {
    const on = { allowIndexing: true, hostname: 'powersmash.in', canonicalHost: 'powersmash.in' };
    for (const pathname of ['/api/lead', '/api/health', '/go/some-sponsor', '/admin', '/admin/leads', '/cdn-cgi/rum']) {
      expect(shouldNoindex({ ...on, pathname }), pathname).toBe(true);
    }
    for (const pathname of ['/', '/pricing', '/gone', '/apple', '/administrators']) expect(shouldNoindex({ ...on, pathname }), pathname).toBe(false);
  });

  it('a non-canonical host is noindex even when indexing is on', () => {
    expect(shouldNoindex({ allowIndexing: true, hostname: 'power-smash-git-x.vercel.app', canonicalHost: 'powersmash.in', pathname: '/' })).toBe(true);
  });
});

describe('applySecurityHeaders (function responses)', () => {
  const ctx = (over: Partial<SecurityContext> = {}): SecurityContext => ({
    allowIndexing: true,
    hostname: 'powersmash.in',
    canonicalHost: 'powersmash.in',
    pathname: '/book',
    protocol: 'https:',
    hstsMaxAge: null,
    pageCsp: buildPageCsp({ turnstile: true }),
    ...over,
  });

  it('adds the base headers and the strict API policy to a JSON response', () => {
    const res = applySecurityHeaders(Response.json({ ok: true }), ctx({ pathname: '/api/health' }));
    expect(res.headers.get('content-security-policy')).toBe(API_CSP);
    expect(res.headers.get('x-content-type-options')).toBe('nosniff');
    expect(res.headers.get('referrer-policy')).toBe('strict-origin-when-cross-origin');
    expect(res.headers.get('permissions-policy')).toBe(PERMISSIONS_POLICY);
    expect(res.headers.get('x-frame-options')).toBe('DENY');
    expect(res.headers.get('x-robots-tag')).toBe(NOINDEX_VALUE);
    expect(res.headers.get('strict-transport-security')).toBeNull();
  });

  it('gives HTML the page policy, and no X-Robots-Tag when the page may be indexed', () => {
    const html = new Response('<p>x</p>', { headers: { 'content-type': 'text/html; charset=utf-8' } });
    const res = applySecurityHeaders(html, ctx());
    expect(res.headers.get('content-security-policy')).toContain("script-src 'self'");
    expect(res.headers.get('x-robots-tag')).toBeNull();
  });

  it('never overwrites a header the route set itself', () => {
    const own = new Response('x', { headers: { 'content-type': 'text/plain', 'x-robots-tag': 'none', 'content-security-policy': "default-src 'none'; img-src data:" } });
    const res = applySecurityHeaders(own, ctx({ allowIndexing: false }));
    expect(res.headers.get('x-robots-tag')).toBe('none');
    expect(res.headers.get('content-security-policy')).toBe("default-src 'none'; img-src data:");
  });

  it('HSTS only on https and only when configured', () => {
    expect(applySecurityHeaders(Response.json({}), ctx({ hstsMaxAge: 86400 })).headers.get('strict-transport-security')).toBe('max-age=86400');
    expect(applySecurityHeaders(Response.json({}), ctx({ hstsMaxAge: 86400, protocol: 'http:' })).headers.get('strict-transport-security')).toBeNull();
    expect(applySecurityHeaders(Response.json({}), ctx({ hstsMaxAge: null })).headers.get('strict-transport-security')).toBeNull();
  });

  it('works on a response with immutable headers (a Response straight from fetch)', () => {
    const immutable = Response.json({ ok: true });
    Object.defineProperty(immutable.headers, 'set', {
      value: () => {
        throw new TypeError('immutable');
      },
    });
    const res = applySecurityHeaders(immutable, ctx());
    expect(res.headers.get('x-content-type-options')).toBe('nosniff');
    expect(res.status).toBe(200);
  });

  it('keeps status, status text and body of a redirect', async () => {
    const res = applySecurityHeaders(new Response(null, { status: 302, headers: { location: 'https://x.example/' } }), ctx({ pathname: '/go/x' }));
    expect(res.status).toBe(302);
    expect(res.headers.get('location')).toBe('https://x.example/');
    expect(res.headers.get('x-robots-tag')).toBe(NOINDEX_VALUE);
    expect(await res.text()).toBe('');
  });
});
