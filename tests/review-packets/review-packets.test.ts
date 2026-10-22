import { describe, it, expect } from 'vitest';
import { readFileSync, existsSync } from 'node:fs';
import { resolve, join } from 'node:path';
import { tmpdir } from 'node:os';
import * as rp from '../../scripts/review-packets.mjs';

const ROOT = resolve(__dirname, '../..');

// Synthetic mini gold seed: invented names only (never real titles).
const SEED = {
  entries: [
    {
      index: 0,
      title: 'AAA BBB vs CCC DDD || MS Final - Test Open 2099 <script>',
      unsure: false,
      unsure_reasons: [],
      label: {
        kind: 'match', format: 'singles', category: 'MS', age_group: null, minor_signal_in_title: false, round: 'F',
        tournament: 'Test Open', year: 2099, is_international: false,
        side_a: { raw: 'AAA BBB', split: 'clear', players: [{ name: 'Aaa Bbb' }] },
        side_b: { raw: 'CCC DDD', split: 'clear', players: [{ name: 'Ccc Ddd' }] },
      },
    },
    {
      index: 1,
      title: 'Highlights reel 2099',
      unsure: true,
      unsure_reasons: ['no vs token'],
      label: { kind: 'non_match', non_match_reason: 'highlights', category: null, round: null, tournament: null, year: 2099, is_international: false },
    },
  ],
};

describe('Tamil packet', () => {
  it('is up to date with the code and spec (regenerate with: node scripts/review-packets.mjs tamil)', () => {
    const file = resolve(ROOT, 'docs/review-packets/TAMIL_REVIEW.md');
    expect(existsSync(file)).toBe(true);
    expect(readFileSync(file, 'utf8')).toBe(rp.buildTamilPacket());
  });

  it('contains every Tamil word found in src (non-comment lines)', () => {
    const packet = readFileSync(resolve(ROOT, 'docs/review-packets/TAMIL_REVIEW.md'), 'utf8');
    const found: Map<string, Set<string>> = rp.tamilStringsInSrc();
    expect(found.size).toBeGreaterThan(0);
    for (const word of found.keys()) expect(packet, `missing Tamil word ${word}`).toContain(word);
  });

  it('contains every Tamil line of spec Appendix B', () => {
    const packet = readFileSync(resolve(ROOT, 'docs/review-packets/TAMIL_REVIEW.md'), 'utf8');
    const spec = readFileSync(resolve(ROOT, 'power-smash-website-spec.md'), 'utf8').split(/\r?\n/);
    const start = spec.findIndex((l) => l.startsWith('## Appendix B'));
    const rows = spec.slice(start + 1).filter((l) => l.startsWith('| ') && /[஀-௿]/.test(l));
    expect(rows.length).toBeGreaterThan(0);
    for (const row of rows) {
      const tamil = row.split('|')[3].replace(/\s*\*\(.*?\)\*\s*$/, '').trim();
      expect(packet).toContain(tamil);
    }
  });

  it('flags the Appendix B H1 mismatch and asks for the reviewer columns', () => {
    const packet = readFileSync(resolve(ROOT, 'docs/review-packets/TAMIL_REVIEW.md'), 'utf8');
    expect(packet).toContain('MISMATCH');
    expect(packet).toContain('OK / change to ...');
  });
});

describe('Spot-check generator privacy', () => {
  it('refuses to write inside tracked repo folders, allows tmp/ and outside the repo', () => {
    for (const bad of ['docs', 'docs/review-packets', 'tests', 'src', 'public', '.', 'scripts']) {
      expect(() => rp.assertSafeOutputDir(resolve(ROOT, bad), ROOT), bad).toThrow(/Refusing/);
    }
    expect(() => rp.assertSafeOutputDir(resolve(ROOT, 'tmp/spot-check'), ROOT)).not.toThrow();
    expect(() => rp.assertSafeOutputDir(join(tmpdir(), 'spot'), ROOT)).not.toThrow();
  });

  it('the repo .gitignore covers tmp/', () => {
    const gi = readFileSync(resolve(ROOT, '.gitignore'), 'utf8').split(/\r?\n/).map((l) => l.trim());
    expect(gi.some((l) => l === 'tmp/' || l === '/tmp/' || l === 'tmp')).toBe(true);
  });

  it('produces a self-contained page with no network URLs or external resources', () => {
    const html: string = rp.buildSpotCheckHtml(SEED);
    expect(html).not.toMatch(/https?:\/\//i);
    expect(html).not.toMatch(/\/\/[a-z0-9.-]+\.[a-z]{2,}/i);
    expect(html).not.toMatch(/<(link|img|iframe|script)[^>]+\b(src|href)=/i);
    expect(html).not.toMatch(/\b(fetch|XMLHttpRequest|sendBeacon|WebSocket)\b/);
    expect(html).toContain('Correct');
    expect(html).toContain('Wrong');
    expect(html).toContain('Unsure');
    expect(html).toContain('Export');
    expect(html).toContain('Aaa Bbb');
  });

  it('escapes markup in titles so a title cannot break the page', () => {
    const html: string = rp.buildSpotCheckHtml(SEED);
    expect(html).not.toContain('<script>"');
    expect(html.match(/<script>/g)).toHaveLength(1);
  });

  it('shows plain-English proposed labels and puts unsure titles first', () => {
    const fields = rp.proposedFields(SEED.entries[0]).map((f: { name: string }) => f.name);
    for (const n of ['Category', 'Age signal', 'Round', 'Tournament', 'Year', 'International?', 'Players per side']) expect(fields).toContain(n);
    const nonMatch = rp.proposedFields(SEED.entries[1]).map((f: { name: string }) => f.name);
    expect(nonMatch).not.toContain('Side A');
    const html: string = rp.buildSpotCheckHtml(SEED);
    expect(html.indexOf('Highlights reel')).toBeLessThan(html.indexOf('AAA BBB'));
  });
});

describe('Packet docs hold no real titles', () => {
  it('the real gold-seed titles appear nowhere in docs/review-packets or docs/m3/packets-notes.md', () => {
    const seedFile = resolve(ROOT, 'tests/fixtures/gold-seed.real70.json');
    if (!existsSync(seedFile)) return;
    const titles: string[] = JSON.parse(readFileSync(seedFile, 'utf8')).entries.map((e: { title: string }) => e.title);
    const docs = ['docs/review-packets/TAMIL_REVIEW.md', 'docs/review-packets/SPOTCHECK_HOWTO.md', 'docs/m3/packets-notes.md']
      .map((p) => resolve(ROOT, p))
      .filter(existsSync)
      .map((p) => readFileSync(p, 'utf8'))
      .join('\n');
    for (const t of titles) expect(docs).not.toContain(t);
  });
});
