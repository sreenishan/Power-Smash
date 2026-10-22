import { describe, expect, it } from 'vitest';
import { footerGroups, footerGroupsFor, headerNav, headerNavFor, pathOf } from '../../src/components/site/nav';
import { robotsTxt } from '../../src/lib/seo';
import { robotsSitemapUrl } from '../../src/lib/wiring/robots';
import { features } from '../../src/content/legal/status';

describe('archive nav links follow features.archivePages', () => {
  it('off: exactly the M1 nav, no archive links anywhere', () => {
    expect(headerNavFor({ archivePages: false })).toBe(headerNav);
    expect(footerGroupsFor({ archivePages: false })).toBe(footerGroups);
    const all = [...headerNavFor({ archivePages: false }), ...footerGroupsFor({ archivePages: false }).flatMap((g) => g.links)];
    expect(all.some((l) => /^\/(matches|players)\//.test(l.href))).toBe(false);
  });
  it('on: Matches and Players in header and footer, slash form, never posters', () => {
    const h = headerNavFor({ archivePages: true });
    expect(h.map((l) => l.href)).toEqual(expect.arrayContaining(['/matches/', '/players/']));
    const f = footerGroupsFor({ archivePages: true })
      .flatMap((g) => g.links)
      .map((l) => pathOf(l.href));
    expect(f).toEqual(expect.arrayContaining(['/matches/', '/players/']));
    expect([...h.map((l) => l.href), ...f].some((x) => x.startsWith('/posters'))).toBe(false);
    expect(new Set(h.map((l) => l.href)).size).toBe(h.length);
  });
  it('the shipped flag is still off (the owner and lawyer approve D-012 first)', () => {
    expect(features.archivePages).toBe(false);
    expect(headerNavFor()).toBe(headerNav);
  });
});

describe('robots sitemap line', () => {
  const site = 'https://example.test';
  it('only when indexing is allowed AND archive pages are on', () => {
    expect(robotsSitemapUrl({ allowIndexing: true, archivePages: true, site })).toBe('https://example.test/sitemap-index.xml');
    expect(robotsSitemapUrl({ allowIndexing: true, archivePages: false, site })).toBeNull();
    expect(robotsSitemapUrl({ allowIndexing: false, archivePages: true, site })).toBeNull();
    expect(robotsSitemapUrl({ allowIndexing: true, archivePages: true, site: undefined })).toBeNull();
  });
  it('robots.txt text carries the line only then', () => {
    expect(robotsTxt({ allowIndexing: true, sitemapUrl: robotsSitemapUrl({ allowIndexing: true, archivePages: true, site }) })).toContain('Sitemap: https://example.test/sitemap-index.xml');
    expect(robotsTxt({ allowIndexing: false, sitemapUrl: robotsSitemapUrl({ allowIndexing: false, archivePages: true, site }) })).toBe('User-agent: *\nDisallow: /\n');
  });
});
