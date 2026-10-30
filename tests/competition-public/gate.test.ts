// The build gate of the public competition pages (src/lib/competition/in-build.ts): the strict release build carries them only with
// features.competitionPages on; every other build carries them (with the sample notice while the data is the seed).
import { afterEach, describe, expect, it } from 'vitest';
import { COMPETITION_OUTPUT_PATHS, competitionFixedPaths, competitionInBuild } from '../../src/lib/competition/in-build';
import { FEATURE_INFO, features } from '../../src/content/legal/status';
import { loadCompetitionSite, resetCompetitionSiteCache } from '../../src/lib/competition/public/load';

describe('competitionInBuild', () => {
  it('a non-strict build always carries the pages', () => {
    expect(competitionInBuild({}, { competitionPages: false })).toBe(true);
    expect(competitionInBuild({ PS_STRICT: '0' }, { competitionPages: false })).toBe(true);
    expect(competitionInBuild({ PS_STRICT: 'true' }, { competitionPages: false })).toBe(true);
  });

  it('the strict build carries them only when the switch is exactly true', () => {
    expect(competitionInBuild({ PS_STRICT: '1' }, { competitionPages: false })).toBe(false);
    expect(competitionInBuild({ PS_STRICT: '1' }, { competitionPages: 'true' as unknown as boolean })).toBe(false);
    expect(competitionInBuild({ PS_STRICT: '1' }, { competitionPages: true })).toBe(true);
  });

  it('the switch is off today and documented', () => {
    expect(features.competitionPages).toBe(false);
    expect(FEATURE_INFO.competitionPages.arrives.trim()).not.toBe('');
    expect(FEATURE_INFO.competitionPages.unlocks).toMatch(/not official BWF/);
  });

  it('the fixed pages (/competitions/, /competitions/rankings/) are not generated at all when the build carries no competition pages', () => {
    // strict release build, switch off: no path, so no competitions folder and no owner marker from these pages
    expect(competitionFixedPaths({ PS_STRICT: '1' }, { competitionPages: false })).toEqual([]);
    expect(competitionFixedPaths({ PS_STRICT: '1' }, { competitionPages: 'true' as unknown as boolean })).toEqual([]);
    const on = competitionFixedPaths({ PS_STRICT: '1' }, { competitionPages: true });
    expect(on).toEqual([
      { params: { page: undefined }, props: { which: 'index' } },
      { params: { page: 'rankings' }, props: { which: 'rankings' } },
    ]);
    expect(competitionFixedPaths({}, { competitionPages: false })).toEqual(on);
  });

  it('the prune list is the one competitions folder, relative and inside the static output', () => {
    expect([...COMPETITION_OUTPUT_PATHS]).toEqual(['competitions']);
    for (const p of COMPETITION_OUTPUT_PATHS) expect(p).not.toMatch(/^\/|\.\./);
  });
});

describe('loadCompetitionSite follows the gate', () => {
  const saved = { strict: process.env.PS_STRICT, source: process.env.PS_COMPETITION_SOURCE };
  afterEach(() => {
    if (saved.strict === undefined) delete process.env.PS_STRICT;
    else process.env.PS_STRICT = saved.strict;
    if (saved.source === undefined) delete process.env.PS_COMPETITION_SOURCE;
    else process.env.PS_COMPETITION_SOURCE = saved.source;
    resetCompetitionSiteCache();
  });

  it('strict build with the switch off: an empty site (no tournament or event page is generated)', async () => {
    process.env.PS_STRICT = '1';
    resetCompetitionSiteCache();
    const site = await loadCompetitionSite();
    expect(site.tournaments).toEqual([]);
    expect(site.rankings).toEqual([]);
    // and the fixed pages read the same environment: nothing at all is built under /competitions/
    expect(competitionFixedPaths()).toEqual([]);
  });

  it('developer build: the fictional seed, marked as such', async () => {
    delete process.env.PS_STRICT;
    delete process.env.PS_COMPETITION_SOURCE;
    resetCompetitionSiteCache();
    const site = await loadCompetitionSite();
    expect(site.source).toBe('seed');
    expect(site.tournaments.length).toBeGreaterThan(0);
  });
});
