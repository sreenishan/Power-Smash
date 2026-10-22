// Internal link policy (R-LINKS; review findings B-15 and C-21): every internal page link is written in ONE form, with a trailing
// slash, because the build writes book/index.html and Cloudflare serves that form directly. This file checks the DATA (navigation
// definitions, enquiry links) and the SOURCES of the shell files. The BUILT pages are checked by tests/build/links.test.ts.
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, resolve, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { bookCoverageLink, footerGroups, headerNav, legalLinks, pathOf } from '../../src/components/site/nav';
import { enquiryHref, enquiryTarget, products } from '../../src/content/products';
import { sponsorPackages } from '../../src/content/sponsor-packages';
import { isInternalPath, path } from '../../src/lib/urls';

const ROOT = resolve(fileURLToPath(new URL('.', import.meta.url)), '..', '..');

const navLinks = [...headerNav, bookCoverageLink, ...footerGroups.flatMap((g) => g.links), ...legalLinks];

describe('navigation definitions: every internal href ends with a slash', () => {
  it('header, book-coverage button, footer groups and legal links', () => {
    expect(navLinks.length).toBeGreaterThan(15);
    for (const link of navLinks) {
      expect(isInternalPath(link.href), `${link.label} -> ${link.href}`).toBe(true);
      expect(pathOf(link.href).endsWith('/'), `${link.label} -> ${link.href}`).toBe(true);
      expect(path(link.href), link.href).toBe(link.href); // already canonical
    }
  });

  it('keeps the fragment after the slash ("/services/#players")', () => {
    const players = headerNav.find((l) => l.label === 'Players & parents');
    expect(players?.href).toBe('/services/#players');
  });
});

describe('enquiry links (R-TOPIC, review B-11 and R-LINKS)', () => {
  const everything = [...products, ...sponsorPackages];

  it('every enquiry link points to a page path with a trailing slash before the query', () => {
    for (const p of everything) {
      const { href } = enquiryTarget(p);
      expect(pathOf(href).endsWith('/'), `${p.slug}: ${href}`).toBe(true);
      expect(path(href), href).toBe(href);
    }
  });

  it('coverage packages keep /book/?package=<key>', () => {
    const coverage = products.filter((p) => p.group === 'organizers');
    expect(coverage.map((p) => p.slug)).toEqual(['essential', 'pro', 'broadcast']);
    for (const p of coverage) expect(enquiryHref(p)).toBe(`/book/?package=${p.slug}`);
  });

  it('sponsor packages keep /partner/?package=<key>', () => {
    for (const p of sponsorPackages) expect(enquiryHref(p)).toBe(`/partner/?package=${p.slug}`);
  });

  it('every other product goes to /contact/?topic=<key> (player products, promotion, add-ons)', () => {
    const others = products.filter((p) => p.group !== 'organizers');
    expect(others.map((p) => p.group)).toEqual(expect.arrayContaining(['players', 'promotion', 'addons']));
    for (const p of others) expect(enquiryHref(p), p.slug).toBe(`/contact/?topic=${p.slug}`);
    // the five products the review named: none of them may land on the coverage form any more
    for (const slug of ['highlight-reel', 'hd-match-file', 'season-pack', 'custom-edit', 'tournament-promotion']) {
      const product = products.find((p) => p.slug === slug);
      expect(product, slug).toBeDefined();
      expect(enquiryHref(product!)).toMatch(/^\/contact\/\?topic=/);
      expect(enquiryHref(product!)).not.toMatch(/\/book\//);
    }
  });

  it('only product keys are ever used as a topic or package value (no free text)', () => {
    const keys = new Set(everything.map((p) => p.slug));
    for (const p of everything) {
      const value = new URL(enquiryHref(p), 'https://example.test').searchParams.get(p.group === 'organizers' || p.group === 'sponsorship' ? 'package' : 'topic');
      expect(keys.has(value ?? ''), p.slug).toBe(true);
    }
  });
});

// ---- source scan: the shell's own files never write a literal internal page href --------------------------------------------
function sourceFiles(): string[] {
  const out: string[] = [];
  const walk = (dir: string): void => {
    for (const name of readdirSync(dir)) {
      const abs = join(dir, name);
      if (statSync(abs).isDirectory()) walk(abs);
      else if (/\.(astro|ts)$/.test(name)) out.push(abs);
    }
  };
  for (const d of ['src/layouts', 'src/components/ui', 'src/components/site']) walk(join(ROOT, d));
  for (const f of [
    'src/pages/index.astro',
    'src/pages/services.astro',
    'src/pages/pricing.astro',
    'src/pages/support.astro',
    'src/pages/about.astro',
    'src/pages/404.astro',
    'src/pages/500.astro',
    'src/pages/tournaments/index.astro',
    'src/pages/tournaments/[slug].astro',
    'src/content/products.ts',
    'src/content/tournaments.ts',
  ]) {
    out.push(join(ROOT, f));
  }
  return out;
}

// href="/x", href='/x', href: '/x', primaryHref="/x", link('Label', '/x'). A bare "/" (home) is allowed; /api/ endpoints are not pages;
// a file such as href="/favicon.svg" (last segment with an extension) is not a page either.
const LITERAL_PAGE_HREF = /\b(?:href|primaryHref)\s*[=:]\s*\{?\s*(['"`])\/(?!api\/|go\/)(?![^'"`\s]*\.[a-z0-9]+\1)[^'"`\s]+\1/g;
const LITERAL_NAV_LINK = /\blink\(\s*'[^']*'\s*,\s*'\//g;

describe('shell sources write internal links through ROUTES / path(), never as string literals', () => {
  const files = sourceFiles();

  it('finds the files it is supposed to scan', () => {
    expect(files.length).toBeGreaterThan(25);
  });

  it('has no literal internal page href in the layout, the ui and site components or the shell pages', () => {
    const offenders: string[] = [];
    for (const file of files) {
      const text = readFileSync(file, 'utf8');
      const rel = relative(ROOT, file).replaceAll('\\', '/');
      for (const m of text.matchAll(LITERAL_PAGE_HREF)) offenders.push(`${rel}: ${m[0]}`);
      for (const m of text.matchAll(LITERAL_NAV_LINK)) offenders.push(`${rel}: ${m[0]}`);
    }
    expect(offenders, `Use href={ROUTES.x} or path('/x') (src/lib/urls.ts):\n${offenders.join('\n')}`).toEqual([]);
  });

  it('no component builds a canonical or JSON-LD url with new URL(): they use absoluteUrl()', () => {
    const offenders: string[] = [];
    for (const file of files) {
      const rel = relative(ROOT, file).replaceAll('\\', '/');
      if (rel === 'src/lib/urls.ts') continue;
      const text = readFileSync(file, 'utf8');
      // new URL('/...', origin) with an internal path literal or a template path would bypass path()
      for (const m of text.matchAll(/new URL\(\s*[`'"]\/[^)]*\)/g)) offenders.push(`${rel}: ${m[0]}`);
    }
    expect(offenders).toEqual([]);
  });
});
