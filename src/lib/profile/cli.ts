/**
 * Command line driver for the catalogue profiler (see scripts/profile-catalogue.ts and docs/PROFILING.md).
 *   node scripts/profile-catalogue.ts <input> [--out <folder>] [--show-titles] [--gold-sample N] [--seed S] [--convert]
 * Output never goes into the repository, except under <repo>/tmp (git-ignored). Real titles are written only with
 * --show-titles, --gold-sample or --convert, and the tool says so loudly. No network.
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { basename, isAbsolute, relative, resolve, sep } from 'node:path';
import { analyse } from './analyse';
import { drawGoldSample, goldToCsv } from './gold';
import { readInput } from './input';
import { PRIVATE_WARNING, renderPrivate, renderReport } from './render';

export type CliIo = { cwd: string; repoRoot: string; log: (line: string) => void; err: (line: string) => void; now?: () => Date };

const USAGE = `Usage: node scripts/profile-catalogue.ts <input-file> [--out <folder>] [--show-titles] [--gold-sample N] [--seed S] [--convert]
  <input-file>   JSON (videos or titles), text (one title per line), CSV (with a "title" column), YouTube RSS XML
  --out          output folder (default: <repo>/tmp/profile). Must be outside the repo or under <repo>/tmp
  --show-titles  ALSO write a private file with real titles and names (tmp only; loud warning)
  --gold-sample  write N titles drawn at random (stratified, seeded) for the owner to label (real titles; tmp only)
  --seed         seed for the draw (default 1)
  --convert      only convert the input to <out>/videos.normalised.json (real titles; tmp only)`;

/** True when `target` is inside `root` (or is it). */
export function isInside(root: string, target: string): boolean {
  const rel = relative(resolve(root), resolve(target));
  return rel === '' || (!rel.startsWith('..') && !isAbsolute(rel));
}

/** Output may go outside the repo, or under <repo>/tmp. Never anywhere else inside the repo. */
export function outputAllowed(repoRoot: string, out: string): boolean {
  return !isInside(repoRoot, out) || isInside(resolve(repoRoot, 'tmp'), out);
}

type Args = { input: string | null; out: string | null; showTitles: boolean; gold: number | null; seed: number; convert: boolean; error: string | null };

export function parseArgs(argv: readonly string[]): Args {
  const a: Args = { input: null, out: null, showTitles: false, gold: null, seed: 1, convert: false, error: null };
  for (let i = 0; i < argv.length; i++) {
    const t = argv[i] as string;
    const next = (): string | undefined => argv[++i];
    if (t === '--out') a.out = next() ?? null;
    else if (t === '--show-titles') a.showTitles = true;
    else if (t === '--convert') a.convert = true;
    else if (t === '--gold-sample') {
      const v = Number(next());
      if (!Number.isInteger(v) || v < 1) a.error = '--gold-sample needs a whole number of 1 or more.';
      else a.gold = v;
    } else if (t === '--seed') {
      const v = Number(next());
      if (!Number.isInteger(v)) a.error = '--seed needs a whole number.';
      else a.seed = v;
    } else if (t.startsWith('--')) a.error = `Unknown option ${t}.`;
    else if (a.input === null) a.input = t;
    else a.error = 'Only one input file is allowed.';
  }
  if (a.input === null && a.error === null) a.error = 'Missing the input file.';
  return a;
}

export function run(argv: readonly string[], io: CliIo): number {
  const args = parseArgs(argv);
  if (args.error !== null) {
    io.err(`${args.error}\n${USAGE}`);
    return 2;
  }
  const out = resolve(io.cwd, args.out ?? resolve(io.repoRoot, 'tmp', 'profile'));
  if (!outputAllowed(io.repoRoot, out)) {
    io.err(`Refusing to write into the repository: ${out}\nUse a folder outside the repo, or one under tmp\\ (git-ignored).`);
    return 2;
  }
  const inputPath = resolve(io.cwd, args.input as string);
  if (!existsSync(inputPath)) {
    io.err(`Input file not found: ${inputPath}`);
    return 2;
  }
  let input;
  try {
    input = readInput(readFileSync(inputPath, 'utf8'), basename(inputPath));
  } catch (e) {
    io.err(`Could not read the input: ${(e as Error).message}`);
    return 2;
  }
  io.log(`Read ${input.items.length} videos from ${basename(inputPath)} (${input.format}); ${input.skipped} entries skipped.`);
  for (const note of input.notes) io.log(`Note: ${note}`);
  if (input.items.length === 0) {
    io.err('No titles found: nothing to profile.');
    return 2;
  }
  mkdirSync(out, { recursive: true });

  if (args.convert) {
    const rows = input.items.map((i) => ({ id: i.id, title: i.title, duration_s: i.durationSeconds, published_at: i.publishedAt, rss_link_type: i.rssLinkType }));
    const file = resolve(out, 'videos.normalised.json');
    writeFileSync(file, JSON.stringify(rows, null, 2) + '\n', 'utf8');
    io.log(`WARNING: ${file} holds real titles. ${PRIVATE_WARNING}`);
    return 0;
  }

  const { report, detail, rows } = analyse(input.items, input.skipped, { now: io.now?.() });
  writeFileSync(resolve(out, 'profile-report.md'), renderReport(report), 'utf8');
  writeFileSync(resolve(out, 'profile-report.json'), JSON.stringify(report, null, 2) + '\n', 'utf8');
  io.log(`Report (counts only, safe to share): ${resolve(out, 'profile-report.md')} and profile-report.json`);

  const m = report.matchStyle;
  io.log(`DoD 1: ${m.dod1.percent ?? 'n/a'}% auto-accept of ${m.total} match-style titles (95% interval ${m.dod1.ci95Low ?? 'n/a'} to ${m.dod1.ci95High ?? 'n/a'}); review queue ${m.reviewQueueSize}. ${m.dod1.verdict}.`);

  if (args.showTitles) {
    const base = resolve(out, 'PRIVATE-titles-and-names');
    writeFileSync(`${base}.md`, renderPrivate(detail), 'utf8');
    writeFileSync(`${base}.json`, JSON.stringify(detail, null, 2) + '\n', 'utf8');
    io.log(`WARNING: ${base}.md and .json hold REAL titles and names. ${PRIVATE_WARNING}`);
  }
  if (args.gold !== null) {
    const entries = drawGoldSample(rows, args.gold, args.seed);
    const base = resolve(out, `gold-sample-seed${args.seed}`);
    writeFileSync(`${base}.csv`, goldToCsv(entries), 'utf8');
    writeFileSync(`${base}.json`, JSON.stringify(entries, null, 2) + '\n', 'utf8');
    io.log(`Gold sample of ${entries.length} titles for labelling: ${base}.csv (REAL titles). ${PRIVATE_WARNING}`);
  }
  void sep;
  return 0;
}
