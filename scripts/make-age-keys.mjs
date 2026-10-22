// age key-pair helper (OT-31, D-011, BUILD_PLAN M1 item 4a). THE OWNER RUNS THIS at the PC. Claude never sees the private key.
//
//   node scripts/make-age-keys.mjs            make the PRODUCTION backup key   -> GitHub variable AGE_PUBLIC_KEY
//   node scripts/make-age-keys.mjs --drill    make the separate DRILL key      -> GitHub variable AGE_DRILL_PUBLIC_KEY + secret AGE_DRILL_KEY
//   options: --out <file>          where to save the private key (default: a folder in your home folder, OUTSIDE the project)
//            --age-keygen <path>   the age-keygen program, if it is not on your PATH
//
// This is a wrapper around the `age-keygen` program from the age project. It NEVER downloads anything: if the program is missing it prints
// what to download (after you said yes in chat) and stops. The private key is written only to the file you choose, outside the repository;
// the screen shows ONLY the public key. It refuses a target inside the project folder and refuses to overwrite a file.
import { existsSync, mkdirSync, realpathSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { homedir } from 'node:os';
import { basename, dirname, join, relative, resolve, isAbsolute, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { isMain } from './lib/is-main.mjs';

/** The release this wrapper was written against (checked 2026-10-21, github.com/FiloSottile/age). Re-check before use. */
export const AGE_VERSION = '1.3.2';
export const AGE_WINDOWS_ZIP = `age-v${AGE_VERSION}-windows-amd64.zip`;
export const AGE_RELEASE_PAGE = `https://github.com/FiloSottile/age/releases/tag/v${AGE_VERSION}`;
const PUBLIC_KEY_PATTERN = /^age1[0-9a-z]{58}$/;

const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');

/** What to say when `age-keygen` is not installed. Nothing here downloads anything. */
export function missingProgramHelp(platform = process.platform) {
  const lines = [
    'The age program is not installed on this PC, so no key was made. Nothing was downloaded.',
    '',
    'Do this first: tell Claude in chat "yes, download age". Claude then confirms the exact file, where it comes from and its size, and you answer yes.',
    'Only after that:',
  ];
  if (platform === 'win32') {
    lines.push(
      `  1. Open ${AGE_RELEASE_PAGE}`,
      `  2. Download "${AGE_WINDOWS_ZIP}" (about 20 MB). It is published by the age project itself.`,
      '  3. Unzip it. Copy age-keygen.exe (and age.exe) into a folder such as C:\\age.',
      '  4. Run this again and point to it:  node scripts/make-age-keys.mjs --age-keygen "C:\\age\\age-keygen.exe"',
    );
  } else {
    lines.push(
      '  1. Install it with your system\'s package manager (for example: sudo apt install age), or download the release for your system from',
      `     ${AGE_RELEASE_PAGE}`,
      '  2. Run this again.',
    );
  }
  return lines;
}

/**
 * The real path of `p`: symbolic links, junctions, subst drives and short (8.3) names resolved. A path that does not exist yet (the key
 * file) is resolved through its nearest existing parent folder and the missing names are added back.
 */
export function realPathOfNearest(p) {
  const missing = [];
  let current = resolve(p);
  for (;;) {
    try {
      return missing.length === 0 ? realpathSync.native(current) : join(realpathSync.native(current), ...missing.reverse());
    } catch {
      const parent = dirname(current);
      if (parent === current) return resolve(p);
      missing.push(basename(current));
      current = parent;
    }
  }
}

/** True when `file` is inside the project folder, compared by REAL path (review S-8: a junction into the project used to look outside). */
export function insideProject(file, root = projectRoot) {
  const rel = relative(realPathOfNearest(root), realPathOfNearest(file));
  return rel === '' || (rel !== '..' && !rel.startsWith(`..${sep}`) && !isAbsolute(rel));
}

/** The real program runner. Output is returned to the caller, which decides what (little) to print. */
export function realRun(cmd, args) {
  const r = spawnSync(cmd, args, { encoding: 'utf8', windowsHide: true });
  return { status: r.status, stdout: r.stdout ?? '', stderr: r.stderr ?? '', missing: Boolean(r.error && r.error.code === 'ENOENT') };
}

function argValue(argv, name) {
  const i = argv.indexOf(name);
  return i !== -1 ? (argv[i + 1] ?? null) : null;
}

/** @returns {number} 0 key made, 1 the program failed, 2 refused or program missing */
export function main(argv = process.argv.slice(2), deps = {}) {
  const log = deps.log ?? ((s) => console.log(s));
  const err = deps.err ?? ((s) => console.error(s));
  const run = deps.run ?? realRun;
  const exists = deps.exists ?? existsSync;
  const mkdir = deps.mkdir ?? ((p) => mkdirSync(p, { recursive: true, mode: 0o700 }));
  const home = deps.home ?? homedir();
  const platform = deps.platform ?? process.platform;

  const drill = argv.includes('--drill');
  const program = argValue(argv, '--age-keygen') ?? 'age-keygen';
  const out = resolve(argValue(argv, '--out') ?? join(home, 'power-smash-keys', drill ? 'age-drill-key.txt' : 'age-production-key.txt'));

  if (insideProject(out)) {
    err(`make-age-keys: REFUSED. ${out} is inside the project folder. The private key must be saved OUTSIDE the project; choose another place with --out.`);
    return 2;
  }
  if (exists(out)) {
    err(`make-age-keys: REFUSED. ${out} already exists. This program never overwrites a key file. Choose another name with --out, or move the old file first.`);
    return 2;
  }

  const probe = run(program, ['--version']);
  if (probe.missing || probe.status !== 0) {
    for (const line of missingProgramHelp(platform)) err(line);
    return 2;
  }

  mkdir(dirname(out));
  const made = run(program, ['-o', out]);
  if (made.status !== 0 || !exists(out)) {
    err('make-age-keys: age-keygen did not create the key file. Nothing was saved. (Its output is not shown, in case it contained key material.)');
    return 1;
  }
  const pub = run(program, ['-y', out]);
  const publicKey = pub.stdout.trim();
  if (pub.status !== 0 || !PUBLIC_KEY_PATTERN.test(publicKey)) {
    err('make-age-keys: the key file was made but its public key could not be read back. Tell Claude; do not use this key.');
    return 1;
  }

  log(`Done. Your ${drill ? 'DRILL' : 'PRODUCTION BACKUP'} key was made.`);
  log('');
  log(`PRIVATE key saved in this file, outside the project:`);
  log(`  ${out}`);
  log('  Open that file yourself. It is never shown here and Claude never sees it.');
  log('');
  log('PUBLIC key (safe to share, safe to paste in chat):');
  log(`  ${publicKey}`);
  log('');
  log('What to do now:');
  if (drill) {
    log('  1. GitHub, repository power-smash, Settings, Secrets and variables, Actions, Variables tab: add a VARIABLE named AGE_DRILL_PUBLIC_KEY with the public key above.');
    log('  2. Secrets tab: add a SECRET named AGE_DRILL_KEY with the single AGE-SECRET-KEY-1... line from the file (you type it, or use scripts/load-secrets.mjs). It only opens made-up test data.');
  } else {
    log('  1. GitHub, repository power-smash, Settings, Secrets and variables, Actions, Variables tab: add a VARIABLE (not a secret) named AGE_PUBLIC_KEY with the public key above.');
    log('  2. Store the PRIVATE key in your password manager, or write it on paper. Give ONE sealed copy to one trusted person (the escrow copy, D-011).');
    log('  3. Then delete the file yourself. The private key must never go to GitHub, Cloudflare, e-mail, WhatsApp or chat.');
    log('  4. Without this private key the backups cannot be opened. Losing it means losing the backups.');
  }
  return 0;
}

if (isMain(import.meta.url)) process.exit(main());
