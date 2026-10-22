// Strict release build: `npm run build:strict`. Windows-safe (no shell syntax): PS_STRICT=1 is set for every child process here.
//
//   1. check-release --env-only   fail fast on missing or wrong build variables, before the long build
//   2. astro build
//   3. finalize-headers           CSP hashes, noindex rules, HSTS, archive redirects as routes in .vercel/output/config.json
//   4. check-placeholders         no TODO(owner) in the public output
//   5. privacy-scan               no phone, email, secret-shaped value, private name or localhost URL
//   6. check-release              canonical links, noindex, robots.txt, file budget, route limits (2,048), dated owner figures
//   7. check-js-budget            first-party JavaScript at most 81,920 bytes gzip on every page (spec 12.5, review C-1)
// Steps 4-7 all run even when one fails, so one run shows every problem. The first failing step 1-3 stops the run.
// Production deploys use this from .github/workflows/deploy.yml (D-008); pull-request CI runs the same checks NON-strict.
import { spawnSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { CONFIG_PATH, REDIRECTS_JSON, STATIC_DIR } from './lib/output-paths.mjs';

const env = { ...process.env, PS_STRICT: '1' };
const node = process.execPath;

const run = (label, args) => {
  console.log(`\n=== ${label} ===`);
  const res = spawnSync(node, args, { stdio: 'inherit', env });
  return res.status === 0;
};

const require = createRequire(import.meta.url);
const astroBin = join(dirname(require.resolve('astro/package.json')), 'bin', 'astro.mjs');

if (!run('1/7 release check (build variables)', ['scripts/check-release.ts', '--env-only'])) process.exit(1);
if (!run('2/7 astro build', [astroBin, 'build'])) process.exit(1);
if (!run('2b archive redirects (route list)', ['scripts/write-archive-redirects.mjs', '--out', REDIRECTS_JSON])) process.exit(1);
if (!run('3/7 finalize headers', ['scripts/finalize-headers.ts', '--static', STATIC_DIR, '--config', CONFIG_PATH, '--redirects', REDIRECTS_JSON])) process.exit(1);

const results = [
  run('4/7 placeholder gate', ['scripts/check-placeholders.ts']),
  run('5/7 privacy scan', ['scripts/privacy-scan.ts']),
  run('6/7 release check (build output)', ['scripts/check-release.ts']),
  run('7/7 first-party JavaScript budget', ['scripts/check-js-budget.ts']),
];
if (results.every(Boolean)) {
  console.log('\nbuild:strict OK: the build is fit to publish.');
  process.exit(0);
}
console.error('\nbuild:strict FAILED: see the messages above. Nothing was deployed.');
process.exit(1);
