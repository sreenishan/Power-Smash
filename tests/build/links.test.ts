// Internal links in the BUILT pages (R-LINKS; review findings B-15, C-21): every internal href resolves to a page or file that exists
// in .vercel/output/static, internal page links are written in the one slash form, and canonical, og:url and JSON-LD urls use the same form.
// Reads .vercel/output/static; skipped when the folder does not exist (see ./helpers.ts for how CI runs it after the build).
import { describe, expect, it } from 'vitest';
import { ENDPOINT_PREFIXES, isInternalPath } from '../../src/lib/urls';
import { DIST, anchorHrefs, builtFiles, builtPages, hasDist, requireDist } from './helpers';

it.runIf(requireDist && !hasDist)('.vercel/output/static must exist when PS_REQUIRE_DIST=1 (run the build first)', () => {
  expect(hasDist, `build the site first: ${DIST}`).toBe(true);
});

const split = (href: string): { pathname: string; query: string; hash: string } => {
  const hashAt = href.indexOf('#');
  const noHash = hashAt === -1 ? href : href.slice(0, hashAt);
  const hash = hashAt === -1 ? '' : href.slice(hashAt);
  const q = noHash.indexOf('?');
  return { pathname: q === -1 ? noHash : noHash.slice(0, q), query: q === -1 ? '' : noHash.slice(q), hash };
};

/** function routes: not files in .vercel/output/static, never given a trailing slash, checked by their own tests. */
const isEndpoint = (pathname: string): boolean => ENDPOINT_PREFIXES.some((prefix) => `${pathname}/`.startsWith(prefix));
const hasExtension = (pathname: string): boolean => /\.[a-z0-9]+$/i.test(pathname.split('/').pop() ?? '');

describe.skipIf(!hasDist)('internal links in the built pages (.vercel/output/static)', () => {
  const pages = builtPages();
  const files = builtFiles();

  const internal: { page: string; href: string; pathname: string }[] = [];
  for (const page of pages) {
    for (const href of anchorHrefs(page.text)) {
      if (!isInternalPath(href)) continue;
      internal.push({ page: page.rel, href, pathname: split(href).pathname });
    }
  }

  it('finds pages and internal links to check', () => {
    expect(pages.length).toBeGreaterThanOrEqual(10);
    expect(internal.length).toBeGreaterThan(100);
  });

  it('every internal href resolves to an existing page or file (no dead link)', () => {
    const dead: string[] = [];
    for (const { page, href, pathname } of internal) {
      if (isEndpoint(pathname)) continue; // /api/*, /go/*: function routes
      const rel = pathname.replace(/^\//, '');
      const candidates = pathname.endsWith('/')
        ? [`${rel}index.html`]
        : [rel, `${rel}.html`, `${rel}/index.html`];
      if (!candidates.some((c) => files.has(c))) dead.push(`${page}: ${href}`);
    }
    expect(dead, `dead internal links:\n${dead.join('\n')}`).toEqual([]);
  });

  it('every internal PAGE link ends with a slash (one form for nav, footer, breadcrumbs, cards and buttons)', () => {
    const slashless = internal.filter(({ pathname }) => pathname !== '' && !pathname.endsWith('/') && !isEndpoint(pathname) && !hasExtension(pathname));
    expect(
      slashless.map((l) => `${l.page}: ${l.href}`),
      'write internal links through ROUTES / path() from src/lib/urls.ts',
    ).toEqual([]);
  });

  it('a link that points at a page resolves to the directory form, so no redirect is needed', () => {
    const redirecting = internal.filter(({ pathname }) => {
      if (isEndpoint(pathname) || hasExtension(pathname) || pathname.endsWith('/')) return false;
      const rel = pathname.replace(/^\//, '');
      return files.has(`${rel}/index.html`);
    });
    expect(redirecting.map((l) => `${l.page}: ${l.href}`)).toEqual([]);
  });

  it('canonical link and og:url are the page\'s own slash URL', () => {
    const wrong: string[] = [];
    for (const page of pages) {
      if (page.url === null) continue; // 404.html and 500.html have no stable address
      const canonical = /<link rel="canonical" href="([^"]*)"/.exec(page.text)?.[1];
      const ogUrl = /<meta property="og:url" content="([^"]*)"/.exec(page.text)?.[1];
      if (!canonical) {
        wrong.push(`${page.rel}: no canonical link`);
        continue;
      }
      if (new URL(canonical).pathname !== page.url) wrong.push(`${page.rel}: canonical ${canonical} is not ${page.url}`);
      if (ogUrl !== canonical) wrong.push(`${page.rel}: og:url ${String(ogUrl)} differs from canonical ${canonical}`);
    }
    expect(wrong).toEqual([]);
  });

  it('every url in the JSON-LD (breadcrumbs, organization, events) uses the same slash form', () => {
    const wrong: string[] = [];
    let seen = 0;
    const visit = (page: string, value: unknown): void => {
      if (Array.isArray(value)) return value.forEach((v) => visit(page, v));
      if (typeof value !== 'object' || value === null) return;
      for (const [key, v] of Object.entries(value as Record<string, unknown>)) {
        if ((key === 'url' || key === 'item') && typeof v === 'string' && /^https?:\/\//.test(v)) {
          const { pathname } = new URL(v);
          if (!/^(?:www\.)?(?:youtube|instagram|facebook)\./.test(new URL(v).hostname)) {
            seen += 1;
            if (!pathname.endsWith('/') && !hasExtension(pathname)) wrong.push(`${page}: ${key} ${v}`);
          }
        } else {
          visit(page, v);
        }
      }
    };
    for (const page of pages) {
      for (const m of page.text.matchAll(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/g)) {
        visit(page.rel, JSON.parse(m[1] as string));
      }
    }
    expect(seen).toBeGreaterThan(5);
    expect(wrong).toEqual([]);
  });

  it('breadcrumb links on inner pages point to the slash form too', () => {
    const about = pages.find((p) => p.rel === 'about/index.html');
    expect(about?.text).toMatch(/<a href="\/"[^>]*>Home<\/a>/);
  });
});
