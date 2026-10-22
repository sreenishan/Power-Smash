// Review finding C-1: the first-party JavaScript budget (spec 12.5) is measured by scripts/check-js-budget.ts. Fixture dist folders only.
import { afterEach, describe, expect, it, vi } from 'vitest';
import { randomBytes } from 'node:crypto';
import { gzipSync } from 'node:zlib';
import { join } from 'node:path';
import { formatJsBudgetReport, importsOf, JS_BUDGET_BYTES, main as budgetMain, measureJsBudget, referencesOf, resolveAsset } from '../../scripts/check-js-budget.ts';
import { cleanupTemp, makeDist, page, runScript } from './helpers';

afterEach(cleanupTemp);
vi.setConfig({ testTimeout: 30_000 });

const gz = (text: string | Buffer): number => gzipSync(Buffer.isBuffer(text) ? text : Buffer.from(text, 'utf8'), { level: 9 }).length;
/** Incompressible-ish padding so a chunk has a size worth measuring. */
const padding = (n: number): string => `/*${randomBytes(n).toString('base64')}*/`;

/** A file with some code and random padding. Content is fixed once made so the test can compute the expected gzip size. */
const chunk = (code: string, pad = 600): string => `${code}${padding(pad)}`;

const pageWith = (scripts: string, body = ''): string => page(`${body}${scripts}`);

describe('check-js-budget: what is counted for a page', () => {
  it('counts a module script, everything it imports statically (once), and the inline scripts; dynamic imports are lazy', () => {
    const entry = chunk('import{a}from"./dep.js";import"./side.js";export{b}from\'./again.js\';const lazy=()=>import("./lazy.js");');
    const dep = chunk('import{c}from"./shared.js";export const a=1;');
    const side = chunk('import{c}from"./shared.js";');
    const again = chunk('export const b=2;');
    const shared = chunk('export const c=3;');
    const lazy = chunk('import{c}from"./shared.js";export const l=4;');
    const inline = 'window.__x=1;';
    const root = makeDist({
      'index.html': pageWith(`<script type="module" src="/_astro/entry.js"></script><script>${inline}</script>`),
      '_astro/entry.js': entry,
      '_astro/dep.js': dep,
      '_astro/side.js': side,
      '_astro/again.js': again,
      '_astro/shared.js': shared,
      '_astro/lazy.js': lazy,
    });
    const report = measureJsBudget(root);
    expect(report.pages).toHaveLength(1);
    const p = report.pages[0]!;
    expect(p.page).toBe('index.html');
    expect(p.onViewBytes).toBe(gz(entry) + gz(dep) + gz(side) + gz(again) + gz(shared) + gz(inline));
    expect(p.inlineBytes).toBe(gz(inline));
    expect(p.lazyBytes).toBe(gz(lazy));
    expect(p.files.map((f) => f.file).sort()).toEqual(['_astro/again.js', '_astro/dep.js', '_astro/entry.js', '_astro/shared.js', '_astro/side.js']);
    expect(p.missing).toEqual([]);
  });

  it('counts the chunks named by an island (component-url and renderer-url) and what they import, plus the hydration script', () => {
    const component = chunk('import{r}from"./react.js";import{l}from"./leadform.js";export default 1;');
    const renderer = chunk('import{r}from"./react.js";export default 2;');
    const react = chunk('export const r=1;', 2000);
    const leadform = chunk('export const l=1;');
    const hydration = 'class AstroIsland extends HTMLElement{}customElements.define("astro-island",AstroIsland);';
    const island = '<astro-island uid="Z1" component-url="/_astro/form.js" component-export="default" renderer-url="/_astro/client.js" props="{&quot;a&quot;:[0,&quot;x&gt;y&quot;]}" client="visible"></astro-island>';
    const root = makeDist({
      'contact/index.html': pageWith(`<script>${hydration}</script>`, island),
      '_astro/form.js': component,
      '_astro/client.js': renderer,
      '_astro/react.js': react,
      '_astro/leadform.js': leadform,
    });
    const p = measureJsBudget(root).pages[0]!;
    expect(p.onViewBytes).toBe(gz(component) + gz(renderer) + gz(react) + gz(leadform) + gz(hydration));
    expect(p.files.map((f) => f.file).sort()).toEqual(['_astro/client.js', '_astro/form.js', '_astro/leadform.js', '_astro/react.js']);
  });

  it('a before-hydration-url and a modulepreload link are counted too', () => {
    const a = chunk('export const a=1;');
    const b = chunk('export const b=1;');
    const root = makeDist({
      'index.html': pageWith('<link rel="modulepreload" href="/_astro/a.js">', '<astro-island before-hydration-url="/_astro/b.js" component-url="/_astro/b.js" renderer-url="/_astro/b.js"></astro-island>'),
      '_astro/a.js': a,
      '_astro/b.js': b,
    });
    const p = measureJsBudget(root).pages[0]!;
    expect(p.onViewBytes).toBe(gz(a) + gz(b));
  });

  it('JSON-LD, speculation rules and other data blocks are not code; a data-src attribute is not a script file; an inline script with a data-src attribute is counted', () => {
    const body = 'var z=1;';
    const root = makeDist({
      'index.html': pageWith(
        `<script type="application/ld+json">{"@type":"Thing","name":"${padding(400)}"}</script><script type="speculationrules">{"prefetch":[]}</script><script data-src="/nope.js">${body}</script>`,
      ),
    });
    const p = measureJsBudget(root).pages[0]!;
    expect(p.onViewBytes).toBe(gz(body));
    expect(p.missing).toEqual([]);
  });

  it('scripts on other origins are listed and not counted', () => {
    const root = makeDist({
      'index.html': pageWith('<script src="https://challenges.cloudflare.com/turnstile/v0/api.js"></script><script type="module" src="//static.cloudflareinsights.com/beacon.min.js"></script>'),
    });
    const p = measureJsBudget(root).pages[0]!;
    expect(p.onViewBytes).toBe(0);
    expect(p.external).toEqual(['//static.cloudflareinsights.com/beacon.min.js', 'https://challenges.cloudflare.com/turnstile/v0/api.js']);
  });

  it('relative script paths resolve from the page folder; a path that leaves the folder is ignored', () => {
    const a = chunk('export const a=1;');
    const root = makeDist({
      'book/index.html': pageWith('<script type="module" src="../_astro/a.js"></script><script src="/../../outside.js"></script><script src="../../outside2.js"></script>'),
      '_astro/a.js': a,
    });
    const p = measureJsBudget(root).pages[0]!;
    expect(p.onViewBytes).toBe(gz(a));
    expect(p.missing).toEqual([]);
    expect(resolveAsset(root, 'book/index.html', '../../x.js')).toBeNull();
    expect(resolveAsset(root, 'index.html', '/_astro/a.js?v=1#h')).toBe('_astro/a.js');
    expect(resolveAsset(root, 'a/b/index.html', 'c.js')).toBe('a/b/c.js');
    expect(resolveAsset(root, 'index.html', 'https://x.example/a.js')).toBeNull();
  });

  it('a referenced file that is not in the folder is reported as missing', () => {
    const root = makeDist({ 'index.html': pageWith('<script type="module" src="/_astro/gone.js"></script>') });
    const p = measureJsBudget(root).pages[0]!;
    expect(p.missing).toEqual(['_astro/gone.js']);
    expect(formatJsBudgetReport(measureJsBudget(root), '.vercel/output/static').lines.join('\n')).toContain('not in the folder');
  });

  it('import forms: bare, braces, export-from, dynamic; bare package names are not files', () => {
    const src = 'import"./a.js";import{x as y}from"./b.js";import z,{w}from\'./c.js\';export*from"./d.js";export{q}from"./e.js";import("./f.js");import("pkg");import"react";';
    const { statics, dynamics } = importsOf('/root', '_astro/x.js', src);
    expect(statics.sort()).toEqual(['_astro/a.js', '_astro/b.js', '_astro/c.js', '_astro/d.js', '_astro/e.js']);
    expect(dynamics).toEqual(['_astro/f.js']);
  });

  it('referencesOf separates entries, inline code, external scripts', () => {
    const refs = referencesOf('/root', 'index.html', '<script src="/_astro/a.js"></script><script>import("/_astro/b.js")</script><script src="https://x.example/y.js"></script>');
    expect([...refs.entries].sort()).toEqual(['_astro/a.js', '_astro/b.js']);
    expect(refs.inline).toHaveLength(1);
    expect(refs.external).toEqual(['https://x.example/y.js']);
  });
});

describe('check-js-budget: the budget', () => {
  it('is 80 KiB of gzip (81,920 bytes)', () => {
    expect(JS_BUDGET_BYTES).toBe(81_920);
  });

  it('a page just inside the budget passes, one byte over fails, and the report names the heaviest pages and files', () => {
    const big = chunk('export const a=1;', 3000);
    const root = makeDist({
      'heavy/index.html': pageWith('<script type="module" src="/_astro/big.js"></script>'),
      'light/index.html': pageWith('<script>var a=1;</script>'),
      '_astro/big.js': big,
    });
    const size = gz(big);
    const ok = measureJsBudget(root, size);
    expect(ok.over).toEqual([]);
    expect(formatJsBudgetReport(ok, 'x').exitCode).toBe(0);
    const bad = measureJsBudget(root, size - 1);
    expect(bad.over.map((p) => p.page)).toEqual(['heavy/index.html']);
    const out = formatJsBudgetReport(bad, 'x');
    expect(out.exitCode).toBe(1);
    const text = out.lines.join('\n');
    expect(text).toMatch(/OVER by 1\b/);
    expect(text).toContain('_astro/big.js');
    expect(text.indexOf('heavy/index.html')).toBeLessThan(text.indexOf('light/index.html')); // heaviest first
  });

  it('prints only the top N pages', () => {
    const files: Record<string, string> = {};
    for (let i = 0; i < 6; i++) files[`p${i}/index.html`] = pageWith(`<script>var a${i}="${'x'.repeat(100 * (i + 1))}${padding(50 * i)}";</script>`);
    const out = formatJsBudgetReport(measureJsBudget(makeDist(files)), 'x', 3).lines.join('\n');
    expect(out.match(/index\.html/g)).toHaveLength(3);
    expect(out).toContain('Heaviest 3 page(s)');
  });

  it('an empty folder fails (nothing was measured)', () => {
    const report = measureJsBudget(makeDist({ 'robots.txt': 'x' }));
    expect(report.pages).toEqual([]);
    expect(formatJsBudgetReport(report, 'x').exitCode).toBe(1);
  });

  it('main(): exit 0 inside the budget, 1 over it, 2 for a missing folder or a bad --budget', () => {
    const root = makeDist({ 'index.html': pageWith('<script>var a=1;</script>') });
    const log = vi.spyOn(console, 'log').mockImplementation(() => undefined);
    const err = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    try {
      expect(budgetMain(['--dist', root])).toBe(0);
      expect(budgetMain(['--dist', root, '--budget', '5'])).toBe(1);
      expect(budgetMain(['--dist', join(root, 'nope')])).toBe(2);
      expect(budgetMain(['--dist', root, '--budget', 'lots'])).toBe(2);
    } finally {
      log.mockRestore();
      err.mockRestore();
    }
  });

  it('the command line (the way npm runs it): exit codes and a readable report', () => {
    const root = makeDist({ 'index.html': pageWith('<script>var a=1;</script>') });
    const ok = runScript('scripts/check-js-budget.ts', ['--dist', root]);
    expect(ok.status).toBe(0);
    expect(ok.stdout).toContain('OK: every page is inside the budget');
    const bad = runScript('scripts/check-js-budget.ts', ['--dist', root, '--budget', '5']);
    expect(bad.status).toBe(1);
    expect(bad.stdout).toContain('FAIL: 1 page(s) over the budget');
  });
});
