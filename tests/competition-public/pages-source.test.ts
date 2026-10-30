// Static checks of the competition page sources (the built output is checked by tests/build/* after the lead's build):
// no raw HTML injection, no hand-typed owner marker, no "Live" wording, no player link, no hand-written internal page link, no client
// JavaScript, noindex for sample data, and the strict-build refusal of the seed.
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { describe, expect, it } from 'vitest';

const ROOT = join(__dirname, '..', '..');
const DIR = join(ROOT, 'src', 'pages', 'competitions');

function walk(dir: string): string[] {
  return readdirSync(dir).flatMap((n) => {
    const p = join(dir, n);
    return statSync(p).isDirectory() ? walk(p) : [p];
  });
}

const files = walk(DIR).filter((f) => f.endsWith('.astro'));
const routes = files.filter((f) => !relative(DIR, f).startsWith('_'));
const FIXED_ROUTE = join(DIR, '[...page].astro');
/** Everything that renders a whole page: the routes, except the fixed-page switch, plus the two fixed page bodies in _parts/. */
const pages = [
  ...routes.filter((f) => f !== FIXED_ROUTE),
  join(DIR, '_parts', 'CompetitionIndexPage.astro'),
  join(DIR, '_parts', 'CompetitionRankingsPage.astro'),
];
const read = (f: string): string => readFileSync(f, 'utf8');

describe('competition page sources', () => {
  it('has the three routes, the two fixed page bodies and the notice', () => {
    expect(routes.map((f) => relative(DIR, f).split('\\').join('/')).sort()).toEqual(['[...page].astro', '[tournament]/[event].astro', '[tournament]/index.astro']);
    for (const p of pages) expect(files).toContain(p);
    expect(files.some((f) => f.endsWith('CompetitionSampleNotice.astro'))).toBe(true);
  });

  it('the fixed pages are generated only through competitionFixedPaths (none in a build without competition pages)', () => {
    const src = read(FIXED_ROUTE);
    expect(src).toContain('getStaticPaths = (() => competitionFixedPaths())');
    expect(src).toContain('<CompetitionIndexPage />');
    expect(src).toContain('<CompetitionRankingsPage />');
    // no static index.astro or rankings.astro that would always be built
    expect(routes.some((f) => ['index.astro', 'rankings.astro'].includes(relative(DIR, f)))).toBe(false);
  });

  it('the event and tournament pages say when the snapshot was taken', () => {
    for (const f of [join(DIR, '[tournament]', '[event].astro'), join(DIR, '[tournament]', 'index.astro')]) {
      const src = read(f);
      expect(src).toContain('updatedText(generatedAt)');
      expect(src).toContain('data-updated-note');
    }
  });

  it('the event page: entries once for group events, and no second region named by the bracket heading', () => {
    const src = read(join(DIR, '[tournament]', '[event].astro'));
    expect(src).toContain('const showFlatEntries = e.groups.length === 0;');
    expect(src).toMatch(/\{showFlatEntries && \(/);
    expect(src).not.toContain('labelledBy="draw-heading"');
  });

  it.each(files.map((f) => [relative(ROOT, f), f]))('%s: no set:html, no typed owner marker, no client script, no player link', (_name, f) => {
    const src = read(f as string);
    expect(src).not.toMatch(/set:html|dangerouslySetInnerHTML/);
    expect(src).not.toContain('TODO' + '(owner)');
    expect(src).not.toMatch(/<script/);
    expect(src).not.toMatch(/\/players\//);
    // internal page links only through the paths module or the page model, never a literal href="/..."
    expect(src).not.toMatch(/href="\//);
    expect(src).not.toMatch(/href=\{`\//);
  });

  it.each(pages.map((f) => [relative(ROOT, f), f]))('%s: noindex for sample data, the sample notice, a canonical path', (_name, f) => {
    const src = read(f as string);
    expect(src).toMatch(/noindex=\{[^}]*source === 'seed'\}/);
    expect(src).toContain('<CompetitionSampleNotice');
    expect(src).toMatch(/canonicalPath=\{/);
  });

  it('the event page never claims a live score', () => {
    const src = read(join(DIR, '[tournament]', '[event].astro'));
    expect(src).toContain('live={false}');
    expect(src).not.toMatch(/live=\{true\}|\blive\b(?!=)/);
  });

  it('the notice prints the owner marker in the strict build for the seed or with the switch off', () => {
    const src = read(join(DIR, '_parts', 'CompetitionSampleNotice.astro'));
    expect(src).toMatch(/strict && \(isSeed \|\| legalOff\)/);
    expect(src).toContain('<Todo what=');
    expect(src).toContain("process.env.PS_STRICT === '1'");
    expect(src).toContain('features.competitionPages !== true');
  });
});
