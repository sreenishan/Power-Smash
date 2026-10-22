// Protected-player leakage scan over the BUILT site (.vercel/output/static): every generated page, sitemap, JSON and text file.
// Skips without .vercel/output/static (build first); PS_REQUIRE_DIST=1 turns a missing build into a failure (CI does this).
// Runs against the fictional seed (the default build). The model-level matrix lives in model.test.ts.
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { describe, expect, it } from 'vitest';
import { STATIC_DIR } from '../../scripts/lib/output-paths.mjs';
import { buildPublicArchive } from '../../src/lib/archive/model';
import { protectedSeedNames, seedArchive } from '../../src/lib/archive/seed';

const DIST = join(process.cwd(), STATIC_DIR);
const present = existsSync(DIST);
const required = process.env.PS_REQUIRE_DIST === '1';

function walk(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const full = join(dir, name);
    return statSync(full).isDirectory() ? walk(full) : [full];
  });
}

const archive = buildPublicArchive(seedArchive);
const unknownNames = seedArchive.players.filter((p) => p.ageStatus === 'unknown').map((p) => p.displayName);
const minorNames = seedArchive.players.filter((p) => p.ageStatus.startsWith('minor')).map((p) => p.displayName);
const all = protectedSeedNames();
const hiddenVideoIds = seedArchive.matches.map((m) => m.videoId).filter((id) => !archive.matches.some((m) => m.videoId === id));

describe.skipIf(!present && !required)('built output leaks no protected player', () => {
  it('.vercel/output/static exists', () => {
    expect(present).toBe(true);
  });
  if (!present) return;
  const files = walk(DIST).filter((f) => /\.(html|xml|json|txt)$/.test(f));
  const read = (f: string) => readFileSync(f, 'utf8');
  const rel = (f: string) => relative(DIST, f).replace(/\\/g, '/');
  const isSeed = existsSync(join(DIST, 'matches', 'index.html')) && read(join(DIST, 'matches', 'index.html')).includes('data-archive-sample');

  it.skipIf(!isSeed)('no minor name appears in any file, and unknown names only on their own minimal pages', () => {
    const offenders: string[] = [];
    for (const f of files) {
      const text = read(f);
      const path = rel(f);
      for (const n of minorNames) if (text.includes(n)) offenders.push(`${path}: minor ${n}`);
      for (const n of unknownNames) {
        if (!text.includes(n)) continue;
        const allowed = /^matches\/match-[a-z0-9]+\/index\.html$/.test(path); // only where the raw title shows it
        if (!allowed) offenders.push(`${path}: unknown ${n}`);
      }
    }
    expect(offenders).toEqual([]);
  });

  it.skipIf(!isSeed)('no protected slug form appears anywhere, and no hidden video id', () => {
    const offenders: string[] = [];
    for (const f of files) {
      const text = read(f).toLowerCase();
      for (const n of all) if (text.includes(n.toLowerCase().replace(/\s+/g, '-'))) offenders.push(`${rel(f)}: slug of ${n}`);
      for (const id of hiddenVideoIds) if (text.includes(id)) offenders.push(`${rel(f)}: hidden video ${id}`);
    }
    expect(hiddenVideoIds.length).toBeGreaterThan(0);
    expect(offenders).toEqual([]);
  });

  it.skipIf(!isSeed)('the pages listed in the sitemaps are the indexable ones only', () => {
    const matchesXml = read(join(DIST, 'sitemap-matches.xml'));
    const playersXml = read(join(DIST, 'sitemap-players.xml'));
    expect((matchesXml.match(/<loc>/g) ?? []).length).toBe(archive.grid.length);
    expect((playersXml.match(/<loc>/g) ?? []).length).toBe(archive.players.length);
    for (const m of archive.matches.filter((x) => x.kind === 'minimal')) expect(matchesXml).not.toContain(m.slug);
    expect(matchesXml).toMatch(/<lastmod>\d{4}-\d{2}-\d{2}<\/lastmod>/);
  });

  it.skipIf(!isSeed)('every minimal page is noindex with no structured data and no share link; full pages have a VideoObject', () => {
    for (const m of archive.matches) {
      const html = read(join(DIST, 'matches', m.slug, 'index.html'));
      expect(html).toContain(m.rawTitle.replace(/&/g, '&amp;'));
      if (m.kind === 'minimal') {
        expect(html).toContain('<meta name="robots" content="noindex"');
        expect(html).not.toContain('"@type":"VideoObject"');
        expect(html).not.toContain('wa.me/?text=');
        expect(html).toContain('<title>Match video</title>');
      }
    }
    for (const p of archive.minimalPlayers) {
      const html = read(join(DIST, 'players', p.slug, 'index.html'));
      expect(html).toContain('<meta name="robots" content="noindex"');
      expect(html).not.toContain('"@type":"ProfilePage"');
      expect(html).not.toContain('wa.me/?text=');
    }
    const full = archive.matches.find((m) => m.kind === 'full');
    expect(read(join(DIST, 'matches', full!.slug, 'index.html'))).toContain('"@type":"VideoObject"');
  });

  it.skipIf(!isSeed)('the search index and match index hold only public data', () => {
    const search = JSON.parse(read(join(DIST, 'search-index.json')));
    expect(search.players.length).toBe(archive.players.length);
    const list = JSON.parse(read(join(DIST, 'matches', 'index.json')));
    expect(list.items.length).toBe(archive.grid.length);
  });
});
