// Local throwaway PostgreSQL for running the Supabase migrations and checks (docs/m1/tooling-notes.md). Node only, no shell syntax.
//
//   node scripts/pg-local.mjs <command>
//
//   init     initdb the cluster in tools/pgdata (trust auth, localhost only) if it does not exist
//   start    init if needed, then pg_ctl start on 127.0.0.1:54329
//   stop     pg_ctl stop (fast)
//   status   print whether the server is up
//   reset    drop and re-create the database `psdev`
//   apply    reset-free: create `psdev` if missing, run roles.sql, then every supabase/migrations/*.sql in order
//   check    run every supabase/checks/*.sql against `psdev` (each must print an "ok" row)
//   proposed apply roles, migrations AND supabase/proposed/*.sql in a fresh scratch database `psscratch`, then run the checks
//   all      start, reset, apply, check, proposed (leaves the server running; use `stop` afterwards)
//
// The binaries are the official PostgreSQL 17 Windows zip from EnterpriseDB (tools/pg/pgsql/, git-ignored). The cluster has NO
// password and listens on 127.0.0.1 only; it holds fictional test data and nothing else. Port 54329.
import { spawnSync } from 'node:child_process';
import { existsSync, readdirSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

export const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
export const PG_BIN = join(ROOT, 'tools', 'pg', 'pgsql', 'bin');
export const PG_DATA = join(ROOT, 'tools', 'pgdata');
export const PG_PORT = 54329;
export const PG_HOST = '127.0.0.1';
export const DEV_DB = 'psdev';
export const SCRATCH_DB = 'psscratch';

const exe = (name) => join(PG_BIN, `${name}.exe`);

function run(name, args, { allowFail = false, quiet = false } = {}) {
  const res = spawnSync(exe(name), args, { encoding: 'utf8', windowsHide: true, cwd: ROOT });
  if (!quiet && res.stdout) process.stdout.write(res.stdout);
  if (!quiet && res.stderr) process.stderr.write(res.stderr);
  if (res.error) throw res.error;
  if (res.status !== 0 && !allowFail) throw new Error(`${name} ${args.join(' ')} failed with exit code ${res.status}`);
  return res;
}

const conn = ['-h', PG_HOST, '-p', String(PG_PORT), '-U', 'postgres', '-w'];

export function binariesPresent() {
  return existsSync(exe('postgres'));
}

export function isUp() {
  if (!binariesPresent()) return false;
  const res = spawnSync(exe('pg_isready'), ['-h', PG_HOST, '-p', String(PG_PORT), '-U', 'postgres'], { encoding: 'utf8', windowsHide: true });
  return res.status === 0;
}

/** Runs SQL text through psql. Returns { status, stdout, stderr }; stops at the first error (ON_ERROR_STOP). */
export function psql(db, sql, extra = []) {
  const res = spawnSync(exe('psql'), [...conn, '-d', db, '-X', '-v', 'ON_ERROR_STOP=1', '-A', '-t', ...extra, '-c', sql], {
    encoding: 'utf8',
    windowsHide: true,
    cwd: ROOT,
  });
  return { status: res.status, stdout: res.stdout ?? '', stderr: res.stderr ?? '' };
}

export function psqlFile(db, file, { quiet = false } = {}) {
  const res = spawnSync(exe('psql'), [...conn, '-d', db, '-X', '-q', '-v', 'ON_ERROR_STOP=1', '-f', file], {
    encoding: 'utf8',
    windowsHide: true,
    cwd: ROOT,
  });
  if (!quiet) {
    if (res.stdout) process.stdout.write(res.stdout);
    if (res.stderr) process.stderr.write(res.stderr);
  }
  return { status: res.status, stdout: res.stdout ?? '', stderr: res.stderr ?? '' };
}

function sqlFiles(dir) {
  const full = join(ROOT, dir);
  return existsSync(full)
    ? readdirSync(full)
        .filter((f) => f.endsWith('.sql'))
        .sort()
        .map((f) => join(full, f))
    : [];
}

export function init() {
  if (!binariesPresent()) throw new Error(`PostgreSQL binaries not found in ${PG_BIN} (see docs/m1/tooling-notes.md).`);
  if (existsSync(join(PG_DATA, 'PG_VERSION'))) return;
  console.log('initdb: creating tools/pgdata (trust auth, UTF8)');
  run('initdb', ['-D', PG_DATA, '-U', 'postgres', '-E', 'UTF8', '--locale=C', '--auth-local=trust', '--auth-host=trust']);
}

export function start() {
  init();
  if (isUp()) {
    console.log(`already running on ${PG_HOST}:${PG_PORT}`);
    return;
  }
  const logFile = join(ROOT, 'tools', 'pg.log');
  // stdio is ignored on purpose: the server process inherits pipes, and spawnSync would wait for them to close forever.
  const res = spawnSync(exe('pg_ctl'), ['start', '-D', PG_DATA, '-l', logFile, '-w', '-t', '60', '-o', `-p ${PG_PORT} -c listen_addresses=${PG_HOST}`], { stdio: 'ignore', windowsHide: true });
  if (res.status !== 0) throw new Error(`pg_ctl start failed (see tools/pg.log), exit code ${res.status}`);
  console.log(`started on ${PG_HOST}:${PG_PORT}`);
}

export function stop() {
  if (!existsSync(join(PG_DATA, 'postmaster.pid'))) {
    console.log('not running');
    return;
  }
  run('pg_ctl', ['stop', '-D', PG_DATA, '-m', 'fast', '-w', '-t', '60'], { allowFail: true });
}

function dbExists(name) {
  return psql('postgres', `select 1 from pg_database where datname = '${name}'`).stdout.trim() === '1';
}

export function dropDb(name) {
  if (dbExists(name)) {
    const r = psql('postgres', `drop database "${name}" with (force)`);
    if (r.status !== 0) throw new Error(r.stderr);
  }
}

export function createDb(name) {
  if (!dbExists(name)) {
    const r = psql('postgres', `create database "${name}"`);
    if (r.status !== 0) throw new Error(r.stderr);
  }
}

export function reset(name = DEV_DB) {
  dropDb(name);
  createDb(name);
  console.log(`database ${name}: re-created`);
}

/** roles + every migration (+ the proposed files when `withProposed`). Throws at the first failing file. */
export function apply(name = DEV_DB, { withProposed = false, quiet = false } = {}) {
  createDb(name);
  const files = [join(ROOT, 'supabase', 'local', 'roles.sql'), ...sqlFiles('supabase/migrations'), ...(withProposed ? sqlFiles('supabase/proposed') : [])];
  for (const file of files) {
    console.log(`apply ${name}: ${file.slice(ROOT.length + 1)}`);
    const r = psqlFile(name, file, { quiet });
    if (r.status !== 0) throw new Error(`failed: ${file}\n${r.stderr}`);
  }
}

/** Runs every check file; each ends with a select that returns an "ok: ..." row. Returns the list of ok lines. */
export function check(name = DEV_DB) {
  const lines = [];
  for (const file of sqlFiles('supabase/checks')) {
    const res = psqlFile(name, file, { quiet: true });
    if (res.status !== 0) throw new Error(`check failed: ${file}\n${res.stderr}`);
    const ok = res.stdout.split(/\r?\n/).find((l) => /\bok\b/i.test(l) && /assertions passed/i.test(l));
    if (!ok) throw new Error(`check printed no ok row: ${file}\n${res.stdout}`);
    console.log(`check ${name}: ${file.slice(ROOT.length + 1)} -> ${ok.trim()}`);
    lines.push(ok.trim());
  }
  return lines;
}

export function proposed() {
  dropDb(SCRATCH_DB);
  apply(SCRATCH_DB, { withProposed: true });
  check(SCRATCH_DB);
}

const commands = {
  init,
  start,
  stop,
  status: () => console.log(isUp() ? `up on ${PG_HOST}:${PG_PORT}` : 'down'),
  reset: () => {
    if (!isUp()) throw new Error('server is not running: node scripts/pg-local.mjs start');
    reset();
  },
  apply: () => apply(),
  check: () => void check(),
  proposed,
  all: () => {
    start();
    reset();
    apply();
    check();
    proposed();
  },
};

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const cmd = process.argv[2] ?? '';
  const fn = commands[cmd];
  if (!fn) {
    console.error(`usage: node scripts/pg-local.mjs <${Object.keys(commands).join('|')}>`);
    process.exit(2);
  }
  try {
    fn();
  } catch (err) {
    console.error(String(err instanceof Error ? err.message : err));
    process.exit(1);
  }
}
