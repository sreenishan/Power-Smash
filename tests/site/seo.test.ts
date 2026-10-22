import { describe, expect, it } from 'vitest';
import {
  PAGE_META,
  isIndexingAllowed,
  robotsTxt,
  shouldNoindex,
  titleWithBrand,
  withTrailingSlash,
} from '../../src/lib/seo';

describe('indexing safety (hard rule 9)', () => {
  it('allows indexing only for the exact string "true"', () => {
    expect(isIndexingAllowed('true')).toBe(true);
    for (const v of [undefined, null, '', 'false', 'TRUE', 'True', '1', 'yes', ' true', 'true ']) {
      expect(isIndexingAllowed(v as string | undefined | null)).toBe(false);
    }
  });

  it('forces noindex unless indexing is allowed, and a page can never turn it off', () => {
    expect(shouldNoindex({ allowIndexing: false })).toBe(true);
    expect(shouldNoindex({ allowIndexing: false, pageNoindex: false })).toBe(true);
    expect(shouldNoindex({ allowIndexing: true })).toBe(false);
    expect(shouldNoindex({ allowIndexing: true, pageNoindex: false })).toBe(false);
    expect(shouldNoindex({ allowIndexing: true, pageNoindex: true })).toBe(true);
  });
});

describe('robotsTxt', () => {
  it('disallows everything when indexing is not allowed (and never lists a sitemap)', () => {
    const body = robotsTxt({ allowIndexing: false, sitemapUrl: 'https://example.test/sitemap.xml' });
    expect(body).toBe('User-agent: *\nDisallow: /\n');
    expect(body).not.toMatch(/sitemap/i);
    expect(body).not.toMatch(/^Allow:/m);
  });

  it('allows crawling when indexing is allowed, keeps /api/ and /go/ out, and omits the sitemap line when there is none', () => {
    const body = robotsTxt({ allowIndexing: true, sitemapUrl: null });
    expect(body).toContain('User-agent: *');
    expect(body).toContain('Allow: /');
    expect(body).toContain('Disallow: /api/');
    expect(body).toContain('Disallow: /go/');
    expect(body).not.toMatch(/^Disallow: \/$/m);
    expect(body).not.toMatch(/sitemap/i);
  });

  it('lists the sitemap only when one is passed', () => {
    const body = robotsTxt({ allowIndexing: true, sitemapUrl: 'https://example.test/sitemap-index.xml' });
    expect(body).toContain('Sitemap: https://example.test/sitemap-index.xml');
  });

  it('ends with a newline', () => {
    expect(robotsTxt({ allowIndexing: false }).endsWith('\n')).toBe(true);
    expect(robotsTxt({ allowIndexing: true }).endsWith('\n')).toBe(true);
  });
});

describe('titles and URLs', () => {
  it('adds the brand suffix once', () => {
    expect(titleWithBrand('Services')).toBe('Services | Power Smash');
    expect(titleWithBrand('Power Smash - Tamil Nadu Badminton')).toBe('Power Smash - Tamil Nadu Badminton');
    expect(titleWithBrand('About Power Smash')).toBe('About Power Smash');
  });

  it('gives page paths a trailing slash and leaves files, the root and queries alone', () => {
    expect(withTrailingSlash('/about')).toBe('/about/');
    expect(withTrailingSlash('/about/')).toBe('/about/');
    expect(withTrailingSlash('/')).toBe('/');
    expect(withTrailingSlash('/tournaments/sample-open-2026-city')).toBe('/tournaments/sample-open-2026-city/');
    expect(withTrailingSlash('/robots.txt')).toBe('/robots.txt');
    expect(withTrailingSlash('/brand/og-default.svg')).toBe('/brand/og-default.svg');
    expect(withTrailingSlash('/book?package=pro')).toBe('/book/?package=pro');
    expect(withTrailingSlash('/services#players')).toBe('/services/#players');
  });

  // Absolute URLs are built by absoluteUrl() in src/lib/urls.ts (the one helper, R-LINKS); tests/site/urls.test.ts covers it.
});

describe('PAGE_META (this worker\'s pages)', () => {
  const entries = Object.entries(PAGE_META);

  it('gives every page a non-empty title and description', () => {
    for (const [key, meta] of entries) {
      expect(meta.title.trim().length, key).toBeGreaterThan(0);
      expect(meta.description.trim().length, key).toBeGreaterThan(0);
    }
  });

  it('keeps titles and descriptions unique', () => {
    const titles = entries.map(([, m]) => titleWithBrand(m.title));
    const descriptions = entries.map(([, m]) => m.description);
    expect(new Set(titles).size).toBe(titles.length);
    expect(new Set(descriptions).size).toBe(descriptions.length);
  });

  it('keeps titles within 70 characters and descriptions within 160', () => {
    for (const [key, meta] of entries) {
      expect(titleWithBrand(meta.title).length, `${key} title`).toBeLessThanOrEqual(70);
      expect(meta.description.length, `${key} description`).toBeLessThanOrEqual(160);
    }
  });

  it('claims no price, tax or delivery figure', () => {
    for (const [key, meta] of entries) {
      expect(`${meta.title} ${meta.description}`, key).not.toMatch(/₹|\bRs\b|\bINR\b|%|\bGST\b|\d/);
    }
  });
});
