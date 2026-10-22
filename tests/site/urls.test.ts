import { existsSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { ENDPOINT_PREFIXES, PLAYERS_SECTION, ROUTES, absoluteUrl, isInternalPath, path } from '../../src/lib/urls';
import { withTrailingSlash } from '../../src/lib/seo';

const ROOT = resolve(fileURLToPath(new URL('.', import.meta.url)), '..', '..');

describe('path(): the one canonical form of an internal page URL (R-LINKS)', () => {
  it('adds the trailing slash to page paths', () => {
    expect(path('/about')).toBe('/about/');
    expect(path('/tournaments/submit')).toBe('/tournaments/submit/');
    expect(path('/tournaments/sample-open-2026-sample-city')).toBe('/tournaments/sample-open-2026-sample-city/');
  });

  it('leaves the root and paths that already end with a slash alone (idempotent)', () => {
    expect(path('/')).toBe('/');
    expect(path('/about/')).toBe('/about/');
    expect(path(path('/book'))).toBe('/book/');
  });

  it('keeps the query string and the fragment after the inserted slash', () => {
    expect(path('/book?package=pro')).toBe('/book/?package=pro');
    expect(path('/services#players')).toBe('/services/#players');
    expect(path('/contact?topic=highlight-reel#form')).toBe('/contact/?topic=highlight-reel#form');
    expect(path('/book/?package=pro')).toBe('/book/?package=pro');
  });

  it('leaves files with an extension alone', () => {
    expect(path('/robots.txt')).toBe('/robots.txt');
    expect(path('/favicon.svg')).toBe('/favicon.svg');
    expect(path('/brand/og-default.svg')).toBe('/brand/og-default.svg');
    expect(path('/media-kit.pdf')).toBe('/media-kit.pdf');
  });

  it('never adds a slash to endpoint paths: /api/*, /go/* and /cdn-cgi/* are Worker routes, not pages', () => {
    expect(path('/api/lead')).toBe('/api/lead');
    expect(path('/api/health')).toBe('/api/health');
    expect(path('/go/some-partner')).toBe('/go/some-partner');
    expect(path('/cdn-cgi/trace')).toBe('/cdn-cgi/trace');
    expect(path('/api')).toBe('/api');
    expect(ENDPOINT_PREFIXES).toEqual(expect.arrayContaining(['/api/', '/go/']));
    // a page whose name only starts with the same letters is still a page
    expect(path('/apiary')).toBe('/apiary/');
    expect(path('/gone')).toBe('/gone/');
  });

  it('returns anything that is not an internal path unchanged', () => {
    for (const value of [
      'https://example.test/about',
      'http://example.test',
      'mailto:hello@example.test',
      'tel:+910000000000',
      '#enquiry',
      '?topic=x',
      '',
      '//evil.test/about',
      '/\\evil.test/about',
      'about',
      'https://wa.me/910000000000?text=Hi',
    ]) {
      expect(path(value), value).toBe(value);
    }
  });

  it('isInternalPath treats protocol-relative and backslash forms as external', () => {
    expect(isInternalPath('/about')).toBe(true);
    expect(isInternalPath('//host/x')).toBe(false);
    expect(isInternalPath('/\\host/x')).toBe(false);
    expect(isInternalPath('https://host/x')).toBe(false);
    expect(isInternalPath('#x')).toBe(false);
  });

  it('is the same function as the older seo.ts name withTrailingSlash', () => {
    expect(withTrailingSlash).toBe(path);
  });
});

describe('absoluteUrl(): canonical, og:url, JSON-LD and breadcrumb urls', () => {
  it('builds the absolute URL in the same slash form as the links', () => {
    expect(absoluteUrl('/services', 'https://example.test')).toBe('https://example.test/services/');
    expect(absoluteUrl('/', 'https://example.test')).toBe('https://example.test/');
    expect(absoluteUrl('/tournaments/sample-open-2026-sample-city', new URL('https://example.test/x/y'))).toBe(
      'https://example.test/tournaments/sample-open-2026-sample-city/',
    );
    expect(absoluteUrl('/book?package=pro', 'https://example.test')).toBe('https://example.test/book/?package=pro');
  });

  it('keeps files as they are (the Open Graph image)', () => {
    expect(absoluteUrl('/brand/og-default.svg', 'https://example.test/x/y')).toBe('https://example.test/brand/og-default.svg');
  });

  it('absoluteUrl(path) always equals the origin plus path()', () => {
    for (const p of ['/about', '/about/', '/book?package=x', '/services#players', '/robots.txt']) {
      expect(absoluteUrl(p, 'https://example.test')).toBe(`https://example.test${path(p)}`);
    }
  });
});

describe('ROUTES: every internal page, already in canonical form', () => {
  const entries = Object.entries(ROUTES);

  it('every value is already what path() would write', () => {
    for (const [key, value] of entries) expect(path(value), key).toBe(value);
    expect(path(PLAYERS_SECTION)).toBe(PLAYERS_SECTION);
  });

  it('every value has a page file in src/pages (a typo or a removed page fails here)', () => {
    for (const [key, value] of entries) {
      const rel = value === '/' ? 'index' : value.replace(/^\/|\/$/g, '');
      const found =
        existsSync(join(ROOT, 'src', 'pages', `${rel}.astro`)) || existsSync(join(ROOT, 'src', 'pages', rel, 'index.astro'));
      expect(found, `${key} -> ${value}`).toBe(true);
    }
  });

  it('has no duplicates and the players section lives on the services page', () => {
    const values = entries.map(([, v]) => v);
    expect(new Set(values).size).toBe(values.length);
    expect(PLAYERS_SECTION).toBe(`${ROUTES.services}#players`);
  });
});
