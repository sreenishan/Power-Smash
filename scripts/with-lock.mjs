// Run a command while holding a named lock, so several workers never run heavy jobs at once on the dev PC
// (2 cores, about 8 GB RAM). Usage:  node scripts/with-lock.mjs <name> -- <command> [args...]
// Example: node scripts/with-lock.mjs build -- npm run build
// The lock is a directory created atomically under tmp/locks/ (git-ignored). A lock older than 30 minutes is
// treated as stale. Waits up to 40 minutes, polling every 3 seconds. Exit code = the command's exit code.
// Arguments are passed on exactly as given, spaces and quotes included (scripts/lib/shell-command.mjs); one that cmd.exe cannot pass
// safely stops the run with exit code 2 before the lock is taken.
import { mkdirSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { spawn } from 'node:child_process';
import { join } from 'node:path';
import { commandLine } from './lib/shell-command.mjs';

const argv = process.argv.slice(2);
const sep = argv.indexOf('--');
if (sep < 1 || sep === argv.length - 1) {
  console.error('Usage: node scripts/with-lock.mjs <name> -- <command> [args...]');
  process.exit(2);
}
const name = argv[0].replace(/[^a-z0-9_-]/gi, '');
const cmd = argv.slice(sep + 1);
let line;
try {
  line = commandLine(cmd);
} catch (e) {
  console.error(`with-lock: ${e.message}`);
  process.exit(2);
}
const dir = join('tmp', 'locks', `${name}.lock`);
const STALE_MS = 30 * 60 * 1000;
const WAIT_MS = 40 * 60 * 1000;
mkdirSync(join('tmp', 'locks'), { recursive: true });

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const started = Date.now();
let announced = false;
for (;;) {
  try {
    mkdirSync(dir); // atomic: throws EEXIST if held
    writeFileSync(join(dir, 'owner.txt'), `${process.pid} ${new Date().toISOString()} ${cmd.join(' ')}\n`);
    break;
  } catch (e) {
    if (e.code !== 'EEXIST') throw e;
    try {
      if (Date.now() - statSync(dir).mtimeMs > STALE_MS) {
        rmSync(dir, { recursive: true, force: true });
        continue;
      }
    } catch {
      /* lock vanished: retry */
    }
    if (Date.now() - started > WAIT_MS) {
      console.error(`with-lock: gave up waiting for "${name}"`);
      process.exit(3);
    }
    if (!announced) {
      console.error(`with-lock: waiting for "${name}" (another job is running)...`);
      announced = true;
    }
    await sleep(3000);
  }
}

const release = () => {
  try {
    rmSync(dir, { recursive: true, force: true });
  } catch {
    /* ignore */
  }
};
process.on('SIGINT', () => {
  release();
  process.exit(130);
});
process.on('SIGTERM', () => {
  release();
  process.exit(143);
});
const child = spawn(line, { stdio: 'inherit', shell: true });
child.on('exit', (code, signal) => {
  release();
  process.exit(code ?? (signal ? 1 : 0));
});
child.on('error', (err) => {
  release();
  console.error(err);
  process.exit(1);
});
