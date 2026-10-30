// Build step: writes the archive redirect rules as JSON for scripts/finalize-headers.ts (review C2-1; Vercel port, area B):
//   node scripts/write-archive-redirects.mjs [--out <file>]      default tmp/archive-redirects.json  ([{from, to, status}, ...])
// Run it BEFORE finalize-headers (which turns the rules into routes in .vercel/output/config.json). The lead chains it in
// scripts/build.mjs and scripts/build-strict.mjs; it is not an npm hook (.npmrc ignore-scripts=true). It loads the same provider as
// the pages, so the rules always match the pages that were built. jiti is used only to import the TypeScript library.
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { createJiti } from 'jiti';

const jiti = createJiti(import.meta.url, { interopDefault: true });
const i = process.argv.indexOf('--out');
const out = resolve(i > -1 ? process.argv[i + 1] : 'tmp/archive-redirects.json');

const { selectArchiveProvider } = await jiti.import(pathToFileURL(resolve('src/lib/archive/select.ts')).href);
const { buildPublicArchive } = await jiti.import(pathToFileURL(resolve('src/lib/archive/model.ts')).href);
const { buildRedirects } = await jiti.import(pathToFileURL(resolve('src/lib/archive/redirects.ts')).href);

const { archiveInBuild } = await jiti.import(pathToFileURL(resolve('src/lib/archive/in-build.ts')).href);
if (!archiveInBuild(process.env)) {
  // the release build leaves the archive out until its legal switch is on (D-107): no archive page, so no archive redirect
  mkdirSync(dirname(out), { recursive: true });
  writeFileSync(out, '[]\n', 'utf8');
  console.log(`write-archive-redirects: the archive is left out of this build (D-107); 0 rules written to ${out}.`);
  process.exit(0);
}

const provider = selectArchiveProvider();
const raw = await provider.load();
const archive = buildPublicArchive(raw, { source: provider.id });
const result = buildRedirects(archive, raw);
for (const s of result.skipped) console.warn(`[redirects] ${s}`);
if (result.errors.length > 0) {
  for (const e of result.errors) console.error(`[redirects] ${e}`);
  process.exit(1);
}
mkdirSync(dirname(out), { recursive: true });
writeFileSync(out, JSON.stringify(result.rules, null, 2) + '\n', 'utf8');
console.log(`write-archive-redirects: ${result.rules.length} rule(s) written to ${out}.`);
