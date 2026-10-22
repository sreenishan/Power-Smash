// `npm run vercel -- <arguments>`: runs the locked Vercel CLI (ci/vercel-cli) from the project folder, for the owner's one-time
// `login` and `link` (docs/SECRETS.md). It never downloads anything: if the locked copy is missing it says how to install it.
//   npm run vercel:install          once (npm ci --ignore-scripts inside ci/vercel-cli)
//   npm run vercel -- login
//   npm run vercel -- link
import { spawnSync } from 'node:child_process';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { isMain } from './lib/is-main.mjs';
import { VERCEL_MISSING_TEXT, resolveLockedVercel } from './lib/vercel-cli.mjs';

export function main(argv = process.argv.slice(2)) {
  const cli = resolveLockedVercel();
  if (!cli) {
    console.error(`vercel: ${VERCEL_MISSING_TEXT}`);
    return 2;
  }
  const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
  const r = spawnSync(cli.cmd, [...cli.args, ...argv], { stdio: 'inherit', cwd: root, windowsHide: true });
  return r.status ?? 1;
}

if (isMain(import.meta.url)) process.exit(main());
