// Catalogue profiler (BUILD_PLAN M0 item 5, DoD 1). Owner steps: docs/PROFILING.md.
//   node scripts\profile-catalogue.ts <input> [--out <folder>] [--show-titles] [--gold-sample N] [--seed S] [--convert]
// Type-annotation-light on purpose: the library is loaded through jiti (like scripts/write-archive-redirects.mjs), because the
// parser imports have no file extensions. Output never goes into the repo (only under tmp\, which is git-ignored). No network.
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { createJiti } from 'jiti';

const jiti = createJiti(import.meta.url, { interopDefault: true });
const repoRoot = resolve(import.meta.dirname, '..');
const { run } = (await jiti.import(pathToFileURL(resolve(repoRoot, 'src/lib/profile/cli.ts')).href)) as {
  run: (argv: string[], io: { cwd: string; repoRoot: string; log: (line: string) => void; err: (line: string) => void }) => number;
};

const code = run(process.argv.slice(2), {
  cwd: process.cwd(),
  repoRoot,
  log: (line: string) => console.log(line),
  err: (line: string) => console.error(line),
});
process.exit(code);
