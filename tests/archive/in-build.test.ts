// The first public release leaves the video archive out until its legal switch is on (owner decision 2026-10-30, D-107): the switch,
// the empty loader, the sitemaps, and the prune step. The real strict output was also checked by a release-settings build (PR notes).
import { existsSync, mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { ARCHIVE_OUTPUT_PATHS, archiveInBuild } from '../../src/lib/archive/in-build';
import { emptyArchive, loadPublicArchive, resetPublicArchiveCache } from '../../src/lib/archive/model';
import { pageSitemapUrls, sitemapIndexEntries } from '../../src/lib/archive/sitemap';
import { features } from '../../src/content/legal/status';
import { pruneArchive } from '../../scripts/prune-archive.mjs';

const ORIGIN = 'https://www.example.test';

describe('archiveInBuild (D-107)', () => {
  it('the release build leaves the archive out while its legal switch is off; every other build keeps it', () => {
    expect(archiveInBuild({ PS_STRICT: '1' }, { archivePages: false })).toBe(false);
    expect(archiveInBuild({ PS_STRICT: '1' }, { archivePages: true })).toBe(true);
    expect(archiveInBuild({}, { archivePages: false })).toBe(true);
    expect(archiveInBuild({ PS_STRICT: '0' }, { archivePages: false })).toBe(true);
  });
  it('the legal switch is still off, so the release build has no archive today', () => {
    expect(features.archivePages).toBe(false);
    expect(archiveInBuild({ PS_STRICT: '1' })).toBe(false);
  });
});

describe('the loader and the sitemaps', () => {
  const saved = process.env.PS_STRICT;
  afterEach(() => {
    if (saved === undefined) delete process.env.PS_STRICT;
    else process.env.PS_STRICT = saved;
    resetPublicArchiveCache();
  });

  it('a release build reads an empty archive (no player, match or archive-tournament page is generated)', async () => {
    process.env.PS_STRICT = '1';
    resetPublicArchiveCache();
    const a = await loadPublicArchive();
    expect(a).toEqual(emptyArchive());
    expect([a.matches, a.grid, a.players, a.minimalPlayers, a.tournaments, a.featured].every((l) => l.length === 0)).toBe(true);
  });

  it('a developer build still reads the sample archive', async () => {
    delete process.env.PS_STRICT;
    resetPublicArchiveCache();
    const a = await loadPublicArchive();
    expect(a.source).toBe('seed');
    expect(a.matches.length).toBeGreaterThan(0);
  });

  it('without the archive, the sitemaps list neither the archive lists nor the archive sitemaps', () => {
    const urls = (withArchive: boolean) => pageSitemapUrls(ORIGIN, withArchive).map((u) => u.loc);
    expect(urls(true)).toEqual(expect.arrayContaining([`${ORIGIN}/matches/`, `${ORIGIN}/players/`]));
    expect(urls(false).some((u) => /\/(matches|players)\//.test(u))).toBe(false);
    const index = (withArchive: boolean) => sitemapIndexEntries(emptyArchive(), [], ORIGIN, withArchive).map((u) => u.loc);
    expect(index(false)).toEqual([`${ORIGIN}/sitemap-pages.xml`, `${ORIGIN}/sitemap-tournaments.xml`]);
    expect(index(true)).toEqual(expect.arrayContaining([`${ORIGIN}/sitemap-matches.xml`, `${ORIGIN}/sitemap-players.xml`]));
  });
});

describe('scripts/prune-archive.mjs', () => {
  const fakeOutput = () => {
    const dir = mkdtempSync(join(tmpdir(), 'ps-prune-'));
    for (const d of ['matches/gone', 'players', 'tournaments/submit', 'book']) mkdirSync(join(dir, d), { recursive: true });
    for (const f of ['matches/index.html', 'matches/gone/index.html', 'matches/index.json', 'players/index.html', 'search-index.json', 'sitemap-matches.xml', 'sitemap-players.xml', 'sitemap-pages.xml', 'tournaments/index.html', 'tournaments/submit/index.html', 'book/index.html', 'index.html']) {
      writeFileSync(join(dir, f), 'x');
    }
    return dir;
  };
  const quiet = () => undefined;

  it('removes exactly the archive files in a release build with the switch off, and keeps everything else', async () => {
    const dir = fakeOutput();
    const r = await pruneArchive({ staticDir: dir, env: { PS_STRICT: '1' }, flags: { archivePages: false }, log: quiet });
    expect(r.pruned).toBe(true);
    expect(r.removed.sort()).toEqual([...ARCHIVE_OUTPUT_PATHS].sort());
    for (const p of ARCHIVE_OUTPUT_PATHS) expect(existsSync(join(dir, p)), p).toBe(false);
    for (const keep of ['index.html', 'book/index.html', 'tournaments/index.html', 'tournaments/submit/index.html', 'sitemap-pages.xml']) expect(existsSync(join(dir, keep)), keep).toBe(true);
  });

  it('does nothing in a developer build, or once the legal switch is on', async () => {
    for (const [env, flags] of [[{}, { archivePages: false }], [{ PS_STRICT: '1' }, { archivePages: true }]] as const) {
      const dir = fakeOutput();
      const r = await pruneArchive({ staticDir: dir, env, flags, log: quiet });
      expect(r).toEqual({ pruned: false, removed: [] });
      expect(existsSync(join(dir, 'matches/index.html'))).toBe(true);
    }
  });
});
