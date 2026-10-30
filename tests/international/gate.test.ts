// The build gate of /international/ (D-112): the strict release build makes no page while features.internationalLinks is off (and
// the flag, which the integrator adds, counts as off while it does not exist); every other build makes it from fictional data with
// noindex and the sample notice; the strict build refuses the seed with a Todo.
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { features } from '../../src/content/legal/status';
import { INTERNATIONAL_OUTPUT_PATHS, internationalInBuild, internationalLinksFlag, internationalPaths } from '../../src/lib/international/in-build';

const read = (p: string) => readFileSync(new URL(`../../${p}`, import.meta.url), 'utf8');

describe('internationalInBuild', () => {
  it('strict release build: only when the switch is exactly true', () => {
    expect(internationalInBuild({ PS_STRICT: '1' }, {})).toBe(false);
    expect(internationalInBuild({ PS_STRICT: '1' }, { internationalLinks: false })).toBe(false);
    expect(internationalInBuild({ PS_STRICT: '1' }, { internationalLinks: true })).toBe(true);
    expect(internationalInBuild({ PS_STRICT: '1' }, { internationalLinks: 'true' as unknown as boolean })).toBe(false);
  });
  it('every other build carries the page', () => {
    expect(internationalInBuild({}, {})).toBe(true);
    expect(internationalInBuild({ PS_STRICT: '0' }, {})).toBe(true);
    expect(internationalInBuild({ PS_STRICT: 'true' }, {})).toBe(true);
  });
  it('the flag is read defensively: missing or not exactly true = off', () => {
    expect(internationalLinksFlag({})).toBe(false);
    expect(internationalLinksFlag({ internationalLinks: 'true' })).toBe(false);
    expect(internationalLinksFlag({ internationalLinks: 1 })).toBe(false);
    expect(internationalLinksFlag({ internationalLinks: true })).toBe(true);
    // today the real switch is off (or not added yet)
    expect(internationalLinksFlag(features as unknown as Record<string, unknown>)).toBe(false);
  });
  it('the static paths: none in the strict build while off, one page otherwise', () => {
    expect(internationalPaths({ PS_STRICT: '1' }, {})).toEqual([]);
    expect(internationalPaths({ PS_STRICT: '1' }, { internationalLinks: true })).toEqual([{ params: { page: undefined } }]);
    expect(internationalPaths({}, {})).toEqual([{ params: { page: undefined } }]);
    expect(INTERNATIONAL_OUTPUT_PATHS).toEqual(['international']);
  });
});

describe('the page sources', () => {
  const route = read('src/pages/international/[...page].astro');
  const body = read('src/pages/international/_parts/InternationalPage.astro');
  const notice = read('src/pages/international/_parts/InternationalSampleNotice.astro');

  it('the route takes its paths from the gate', () => {
    expect(route).toContain('export const getStaticPaths = (() => internationalPaths()) satisfies GetStaticPaths;');
  });
  it('noindex for seed data, canonical through path(), no set:html', () => {
    expect(body).toContain("noindex={page.source === 'seed'}");
    expect(body).toContain('canonicalPath={path(INTERNATIONAL_PATH)}');
    for (const s of [route, body, notice]) {
      expect(s).not.toMatch(/set:html|dangerouslySetInnerHTML/);
      expect(s).not.toMatch(/TODO\(owner\)/);
    }
  });
  it('the official link: new tab, rel noopener noreferrer nofollow, an external-link label', () => {
    expect(body).toContain('target="_blank" rel={EXTERNAL_LINK_REL}');
    expect(body).toContain('{linkLabel(e.host)}');
    expect(body).toContain('(opens the official site in a new tab)');
    expect(body).toContain('Details and results on the official site');
  });
  it('the sample notice: a banner for the seed, a Todo in the strict build for the seed or while the switch is off', () => {
    expect(notice).toContain("process.env.PS_STRICT === '1'");
    expect(notice).toContain('{strict && (isSeed || legalOff) && (');
    expect(notice).toContain('<Todo what=');
    expect(notice).toContain('const legalOff = !internationalLinksFlag();');
  });
  it('nothing on the page fetches or embeds the linked sites (no img, iframe or script from them)', () => {
    expect(body).not.toMatch(/<img|<iframe|<script|fetch\(/);
  });
});
