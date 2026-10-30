// `npm run build`: astro build (the Vercel adapter writes .vercel/output), archive redirects, then finalise the routing config
// .vercel/output/config.json (CSP hashes, noindex rules, HSTS, redirects; scripts/finalize-headers.ts).
//
// Why a wrapper and not an npm `postbuild` script: .npmrc sets ignore-scripts=true (D-002), and npm then skips every pre- and
// post- hook, so a `postbuild` entry would silently never run. This file makes the second step part of the build itself.
// Windows-safe: no shell syntax. Extra arguments are passed to `astro build` (for example `npm run build -- --verbose`).
import { spawnSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { CONFIG_PATH, REDIRECTS_JSON, STATIC_DIR } from './lib/output-paths.mjs';

const require = createRequire(import.meta.url);
const astroBin = join(dirname(require.resolve('astro/package.json')), 'bin', 'astro.mjs');

const run = (args) => spawnSync(process.execPath, args, { stdio: 'inherit', env: process.env }).status ?? 1;

// One loud line (review C-5), printed first and again as the last line: this is the DEVELOPER build, and it gates nothing. Placeholders
// and private data are only reported by the checks that follow it. A release is built with `npm run build:strict`, the only build that
// .github/workflows/deploy.yml runs.
const NOTICE = '*** npm run build = NON-STRICT developer build: placeholders and private data are only reported, never blocked. Releases use npm run build:strict. ***';
console.log(NOTICE);

const built = run([astroBin, 'build', ...process.argv.slice(2)]);
if (built !== 0) process.exit(built);
// Archive redirects (301 for renamed or merged pages, and a neutral noindex page for removed or protected ones): review C2-1.
// D-107: with PS_STRICT=1 and the archive switch off, the archive's fixed files are removed (a no-op in a normal developer build)
const pruned = run(['scripts/prune-archive.mjs', '--static', STATIC_DIR]);
if (pruned !== 0) process.exit(pruned);
const redirected = run(['scripts/write-archive-redirects.mjs', '--out', REDIRECTS_JSON]);
if (redirected !== 0) process.exit(redirected);
const finalised = run(['scripts/finalize-headers.ts', '--static', STATIC_DIR, '--config', CONFIG_PATH, '--redirects', REDIRECTS_JSON]);
console.log(NOTICE);
process.exit(finalised);
