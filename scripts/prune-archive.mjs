// Leaves the video archive out of the release build until its legal switch is on (owner decision 2026-10-30, D-107).
//   node scripts/prune-archive.mjs --static <.vercel/output/static>
// When src/lib/archive/in-build.ts says this build carries no archive (PS_STRICT=1 and features.archivePages is not true), the loader
// is already empty, so no player, match or archive-tournament page was generated; this removes the files Astro writes for the
// archive's fixed routes anyway (the match and player lists, their search and sitemap files, and /matches/gone/). In every other build
// it does nothing. It runs after `astro build` and before the redirects, headers and release gates.
import { existsSync, rmSync } from 'node:fs';
import { join, relative, resolve, sep } from 'node:path';
import { pathToFileURL } from 'node:url';
import { createJiti } from 'jiti';
import { isMain } from './lib/is-main.mjs';

const jiti = createJiti(import.meta.url, { interopDefault: true });

/**
 * @param {{ staticDir: string, env?: Record<string, string | undefined>, flags?: { archivePages: boolean }, log?: (s: string) => void }} opts
 * @returns {Promise<{ pruned: boolean, removed: string[] }>}
 */
export async function pruneArchive({ staticDir, env = process.env, flags, log = console.log }) {
  const { archiveInBuild, ARCHIVE_OUTPUT_PATHS } = await jiti.import(pathToFileURL(resolve('src/lib/archive/in-build.ts')).href);
  const status = flags ?? (await jiti.import(pathToFileURL(resolve('src/content/legal/status.ts')).href)).features;
  if (archiveInBuild(env, status)) {
    log('prune-archive: this build carries the archive; nothing removed.');
    return { pruned: false, removed: [] };
  }
  const root = resolve(staticDir);
  const removed = [];
  for (const p of ARCHIVE_OUTPUT_PATHS) {
    const target = resolve(root, p);
    // never outside the static folder
    if (target !== root && !target.startsWith(root + sep)) throw new Error(`prune-archive: refusing a path outside ${root}: ${p}`);
    if (existsSync(target)) {
      rmSync(target, { recursive: true, force: true });
      removed.push(relative(root, target).split(sep).join('/'));
    }
  }
  log(`prune-archive: the archive is left out of this build until its legal switch is on (D-107); removed ${removed.length ? removed.join(', ') : 'nothing'}.`);
  return { pruned: true, removed };
}

if (isMain(import.meta.url)) {
  const i = process.argv.indexOf('--static');
  if (i === -1 || !process.argv[i + 1]) {
    console.error('usage: node scripts/prune-archive.mjs --static <.vercel/output/static>');
    process.exit(2);
  }
  const staticDir = process.argv[i + 1];
  if (!existsSync(join(staticDir))) {
    console.error(`prune-archive: ${staticDir} does not exist (run the build first).`);
    process.exit(1);
  }
  await pruneArchive({ staticDir });
}
