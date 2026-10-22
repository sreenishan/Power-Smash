// Catalogue profiler tests. SYNTHETIC titles only (tests/fixtures/profile-synthetic); every name is invented.
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import { analyse } from '../../src/lib/profile/analyse';
import { outputAllowed, parseArgs, run } from '../../src/lib/profile/cli';
import { drawGoldSample } from '../../src/lib/profile/gold';
import { readInput, readCsv, readRss } from '../../src/lib/profile/input';
import { titleShape } from '../../src/lib/profile/shape';
import { editDistance, wilson } from '../../src/lib/profile/stats';

const FIX = resolve(__dirname, '../fixtures/profile-synthetic');
const read = (n: string): string => readFileSync(join(FIX, n), 'utf8');
const repoRoot = resolve(__dirname, '../..');
const tmpDirs: string[] = [];
const scratch = (): string => {
  const d = mkdtempSync(join(tmpdir(), 'ps-profile-'));
  tmpDirs.push(d);
  return d;
};
afterAll(() => tmpDirs.forEach((d) => rmSync(d, { recursive: true, force: true })));
const NOW = new Date('2026-10-22T00:00:00Z');

describe('stats', () => {
  it('wilson interval matches known values', () => {
    const w = wilson(90, 100);
    expect(w?.point).toBeCloseTo(0.9, 5);
    expect(w?.low).toBeCloseTo(0.826, 2);
    expect(w?.high).toBeCloseTo(0.945, 2);
    expect(wilson(0, 0)).toBeNull();
    expect(wilson(10, 10)?.high).toBe(1);
  });
  it('edit distance with early exit', () => {
    expect(editDistance('kitten', 'sitting', 5)).toBe(3);
    expect(editDistance('abc', 'abc', 1)).toBe(0);
    expect(editDistance('abcdef', 'uvwxyz', 2)).toBe(3);
  });
});

describe('input readers', () => {
  it('reads text, JSON videos, RSS and a CSV with a title column', () => {
    expect(readInput(read('titles.txt'), 'titles.txt').items.length).toBe(53);
    const json = readInput(read('videos.json'), 'videos.json');
    expect(json.format).toBe('json');
    expect(json.items[0]?.id).toBe('SYN000');
    expect(json.items.some((i) => i.durationSeconds === 55)).toBe(true);
    const rss = readRss(read('feed.xml'));
    expect(rss.items.map((i) => i.rssLinkType)).toEqual(['watch', 'shorts']);
    expect(rss.items[0]?.title).toContain('& more');
    const csv = readCsv(read('takeout-like.csv'));
    expect(csv.items).toHaveLength(2);
    expect(csv.items[0]?.durationSeconds).toBe(600);
    expect(csv.items[1]?.title).toBe('Rally, clip #shorts');
    expect(csv.notes.join(' ')).toContain('Video Title (Original)');
  });
  it('reads YouTube-shaped and record-shaped JSON, skipping private and empty ones', () => {
    const text = JSON.stringify({
      items: [
        { id: 'A', snippet: { title: 'Alpha Beta vs Gamma Delta', publishedAt: '2025-01-01T00:00:00Z' }, contentDetails: { duration: 'PT10M' } },
        { id: 'B', snippet: { title: 'Hidden one' }, status: { privacyStatus: 'private' } },
        { youtube_id: 'C', title_raw: 'Epsilon Zeta vs Eta Theta', duration_s: 90, type: 'short' },
        { title_raw: '' },
      ],
    });
    const r = readInput(text);
    expect(r.items.map((i) => i.id)).toEqual(['A', 'C']);
    expect(r.items[0]?.durationSeconds).toBe(600);
    expect(r.items[1]?.playlist).toBe('UUSH');
    expect(r.skipped).toBe(2);
  });
  it('fails loudly for a CSV with no title column', () => {
    expect(() => readCsv('a,b\n1,2\n')).toThrow(/title/);
  });
});

describe('shape', () => {
  it('replaces names with class tokens and keeps structural words', () => {
    const s = titleShape('Zorvan Pell vs Quillan Raske | MS Final | Zeta Memorial Cup 2023');
    expect(s).toBe('Aaaa*2 vs Aaaa*2 | MS final | Aaaa*2 cup 9999');
    expect(s).not.toMatch(/Zorvan|Pell|Quillan|Raske|Zeta/u);
  });
  it('handles all caps, initials and Tamil', () => {
    expect(titleShape('K. P. ARUN vs ராம்')).toBe('A. A. AAA vs T');
  });
});

describe('analyse (synthetic catalogue)', () => {
  const input = readInput(read('videos.json'), 'videos.json');
  const { report, detail, rows } = analyse(input.items, input.skipped, { now: NOW });
  it('counts every video and splits kinds', () => {
    expect(report.input.videos).toBe(53);
    expect(report.input.parserErrors).toBe(0);
    const kinds = Object.fromEntries(report.counts.byKind.map((c) => [c.label, c.count]));
    expect(kinds.match).toBeGreaterThan(20);
    expect(kinds.non_match).toBeGreaterThan(3);
    expect(report.counts.international).toBeGreaterThanOrEqual(1);
    expect(report.counts.byVideoType.find((c) => c.label === 'short')?.count).toBeGreaterThanOrEqual(1);
  });
  it('computes the DoD 1 number consistently', () => {
    const m = report.matchStyle;
    expect(m.autoAccept + m.held).toBe(m.total);
    expect(m.total).toBeGreaterThan(20);
    expect(m.dod1.percent).toBeCloseTo((m.autoAccept / m.total) * 100, 0);
    expect(m.dod1.ci95Low).toBeLessThanOrEqual(m.dod1.percent as number);
    expect(m.dod1.ci95High).toBeGreaterThanOrEqual(m.dod1.percent as number);
    expect(m.confidenceHistogram.reduce((s, b) => s + b.autoAccept + b.held, 0)).toBe(m.total);
    expect(m.hardFlagsRanked.length).toBeGreaterThan(0);
  });
  it('reports the protected-player load: nobody is adult_confirmed', () => {
    expect(report.age.adultConfirmed).toBe(0);
    expect(report.age.protectedPercent).toBe(100);
    expect(report.age.minorSuspected).toBeGreaterThan(0);
    expect(report.age.titlesWithMinorHold).toBeGreaterThan(0);
  });
  it('finds slash-less doubles, text before side A, first-name-only, tournament clusters and duplicates', () => {
    expect(report.shapesOfInterest.slashlessDoubles.titles).toBeGreaterThanOrEqual(1);
    expect(report.shapesOfInterest.textBeforeSideA.titles).toBeGreaterThanOrEqual(1);
    expect(report.shapesOfInterest.firstNameOnly.appearances).toBeGreaterThanOrEqual(2);
    expect(report.tournaments.clusters).toBeGreaterThanOrEqual(3);
    expect(report.tournaments.clustersWithSeveralYears).toBeGreaterThanOrEqual(1);
    expect(report.duplicates.nearIdenticalTitlePairs).toBeGreaterThanOrEqual(1);
    expect(report.collisions.distinctKeys).toBeGreaterThan(5);
  });
  it('lists at most ten fix-first patterns, ranked', () => {
    const p = report.fixFirst.patterns;
    expect(p.length).toBeGreaterThan(0);
    expect(p.length).toBeLessThanOrEqual(10);
    for (let i = 1; i < p.length; i++) expect((p[i - 1] as { titles: number }).titles).toBeGreaterThanOrEqual((p[i] as { titles: number }).titles);
  });
  it('the DEFAULT report contains no input title and no player name', () => {
    const blob = JSON.stringify(report) + '\n' + JSON.stringify(report.fixFirst);
    for (const item of input.items) expect(blob.includes(item.title.trim())).toBe(false);
    for (const name of ['Zorvan', 'Quillan', 'Mavrik', 'Tessun', 'Brevik', 'Harvo', 'Ulmar', 'Pelvin', 'Dorsan', 'Yarlo', 'Kestin', 'Orvun', 'Zeta', 'Nimbus', 'Quark']) {
      expect(blob).not.toContain(name);
    }
  });
  it('the private detail does hold real titles', () => {
    expect(JSON.stringify(detail)).toContain('Zorvan');
    expect(rows).toHaveLength(53);
  });
});

describe('gold sample', () => {
  const { rows } = analyse(readInput(read('videos.json'), 'videos.json').items, 0, { now: NOW });
  it('is seeded, stratified and the requested size', () => {
    const a = drawGoldSample(rows, 20, 7);
    const b = drawGoldSample(rows, 20, 7);
    const c = drawGoldSample(rows, 20, 8);
    expect(a).toHaveLength(20);
    expect(a).toEqual(b);
    expect(a.map((x) => x.title)).not.toEqual(c.map((x) => x.title));
    expect(new Set(a.map((x) => x.n)).size).toBe(20);
    const strata = new Set(rows.map((r) => r.stratum));
    expect(new Set(a.map((x) => x.stratum)).size).toBe(strata.size);
  });
  it('caps at the catalogue size', () => {
    expect(drawGoldSample(rows, 999, 1)).toHaveLength(rows.length);
  });
});

describe('cli', () => {
  const quiet = (out: string[] = []) => ({ cwd: repoRoot, repoRoot, log: (l: string) => out.push(l), err: (l: string) => out.push(l), now: () => NOW });

  it('rejects bad arguments and unsafe output folders', () => {
    expect(parseArgs([]).error).toMatch(/Missing/);
    expect(parseArgs(['x', '--gold-sample', '0']).error).toMatch(/whole number/);
    expect(outputAllowed(repoRoot, join(repoRoot, 'docs'))).toBe(false);
    expect(outputAllowed(repoRoot, join(repoRoot, 'src', 'x'))).toBe(false);
    expect(outputAllowed(repoRoot, join(repoRoot, 'tmp', 'profile'))).toBe(true);
    expect(outputAllowed(repoRoot, tmpdir())).toBe(true);
    const lines: string[] = [];
    expect(run([join(FIX, 'titles.txt'), '--out', join(repoRoot, 'docs', 'oops')], quiet(lines))).toBe(2);
    expect(lines.join('\n')).toContain('Refusing');
    expect(existsSync(join(repoRoot, 'docs', 'oops'))).toBe(false);
  });

  it('writes a counts-only report by default and no private file', () => {
    const out = scratch();
    const lines: string[] = [];
    expect(run([join(FIX, 'videos.json'), '--out', out], quiet(lines))).toBe(0);
    const md = readFileSync(join(out, 'profile-report.md'), 'utf8');
    const json = readFileSync(join(out, 'profile-report.json'), 'utf8');
    expect(md).toContain('DoD 1');
    for (const item of readInput(read('titles.txt')).items) {
      expect(md.includes(item.title.trim())).toBe(false);
      expect(json.includes(item.title.trim())).toBe(false);
    }
    expect(md).not.toContain('Zorvan');
    expect(existsSync(join(out, 'PRIVATE-titles-and-names.md'))).toBe(false);
    expect(existsSync(join(out, 'gold-sample-seed1.csv'))).toBe(false);
  });

  it('--show-titles and --gold-sample write real titles with a loud warning', () => {
    const out = scratch();
    const lines: string[] = [];
    expect(run([join(FIX, 'titles.txt'), '--out', out, '--show-titles', '--gold-sample', '12', '--seed', '3'], quiet(lines))).toBe(0);
    expect(readFileSync(join(out, 'PRIVATE-titles-and-names.md'), 'utf8')).toContain('WARNING');
    expect(readFileSync(join(out, 'gold-sample-seed3.csv'), 'utf8').split('\r\n').length).toBe(14);
    expect(lines.join('\n')).toContain('WARNING');
    // the shareable report stays clean even in this mode
    expect(readFileSync(join(out, 'profile-report.md'), 'utf8')).not.toContain('Zorvan');
  });

  it('--convert turns RSS into normalised JSON the profiler can read', () => {
    const out = scratch();
    expect(run([join(FIX, 'feed.xml'), '--out', out, '--convert'], quiet())).toBe(0);
    const back = readInput(readFileSync(join(out, 'videos.normalised.json'), 'utf8'));
    expect(back.items).toHaveLength(2);
    expect(back.items[1]?.rssLinkType).toBe('shorts');
  });
});
