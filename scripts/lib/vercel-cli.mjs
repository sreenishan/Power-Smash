// The Vercel command-line tool, from OUR lockfile (review fix-infra 3). CI installs it with `npm ci --ignore-scripts` in ci/vercel-cli;
// the owner's PC does the same once with `npm run vercel:install`. Nothing here ever downloads a tool at run time: a missing install is
// reported, never replaced by a live `npx` fetch, because the loader pipes real production secrets into this CLI.
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

export const CLI_DIR = join(resolve(dirname(fileURLToPath(import.meta.url)), '..', '..'), 'ci', 'vercel-cli');

/** The one command that installs the locked CLI (no install scripts). */
export const VERCEL_INSTALL_COMMAND = 'npm run vercel:install';

/**
 * The locked Vercel CLI as a command Node can run directly (no `.cmd` shim, so it works on Windows without a shell), or null when it
 * is not installed. The entry file is read from the package's own `bin` field, so a new pinned version needs no change here.
 * The installed copy must be EXACTLY the version pinned in this folder's package.json: an older or newer copy left from before a
 * bump counts as not installed (the loader pipes real secrets into this tool, so it must be the one the lockfile reviewed).
 * @returns {{ cmd: string, args: string[] } | null}
 */
export function resolveLockedVercel(dir = CLI_DIR) {
  try {
    const pkgPath = join(dir, 'node_modules', 'vercel', 'package.json');
    if (!existsSync(pkgPath)) return null;
    const { bin, version } = JSON.parse(readFileSync(pkgPath, 'utf8'));
    const pinned = JSON.parse(readFileSync(join(dir, 'package.json'), 'utf8'))?.dependencies?.vercel;
    if (typeof pinned !== 'string' || version !== pinned) return null;
    const rel = typeof bin === 'string' ? bin : (bin?.vercel ?? bin?.vc);
    if (typeof rel !== 'string') return null;
    const file = join(dir, 'node_modules', 'vercel', rel);
    return existsSync(file) ? { cmd: process.execPath, args: [file] } : null;
  } catch {
    return null;
  }
}

/** Plain-English text for the owner when the locked CLI is missing. */
export const VERCEL_MISSING_TEXT = `The Vercel command-line tool from our locked list is not installed (or an older copy is). Run this once, then try again: ${VERCEL_INSTALL_COMMAND}`;
