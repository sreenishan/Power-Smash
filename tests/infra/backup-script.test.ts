// Review finding S-13: the database password must never be on a command line. This test RUNS the real shell script of the backup
// workflow's dump step (taken from backup.yml) with fake `pg_dump` and `age` programs that record how they were called.
// It needs a POSIX shell (Git Bash on Windows, bash on Linux); without one the tests skip themselves.
import { afterEach, describe, expect, it, vi } from 'vitest';
import { chmodSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { delimiter, dirname, join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { cleanupTemp, fakeAgePublicKey, ROOT, tempDir } from './helpers';

afterEach(cleanupTemp);
vi.setConfig({ testTimeout: 60_000 });

function findBash(): { bash: string; extraPath: string[] } | null {
  const candidates =
    process.platform === 'win32'
      ? ['C:\\Program Files\\Git\\bin\\bash.exe', 'C:\\Program Files\\Git\\usr\\bin\\bash.exe', 'C:\\Program Files (x86)\\Git\\bin\\bash.exe']
      : ['/bin/bash', '/usr/bin/bash'];
  for (const c of candidates) {
    if (!existsSync(c)) continue;
    const extra = process.platform === 'win32' ? [dirname(c), join(dirname(c), '..', 'usr', 'bin'), join(dirname(c), '..', 'mingw64', 'bin')] : [];
    return { bash: c, extraPath: extra };
  }
  return null;
}

const shell = findBash();
const it_ = shell ? it : it.skip;

/** The `run:` script of one workflow step, dedented. */
function stepScript(workflow: string, stepName: string): string {
  const lines = workflow.replace(/\r\n/g, '\n').split('\n');
  const at = lines.findIndex((l) => l.includes(`- name: ${stepName}`));
  if (at === -1) throw new Error(`step not found: ${stepName}`);
  const run = lines.findIndex((l, i) => i > at && /^\s+run: \|\s*$/.test(l));
  if (run === -1) throw new Error('run block not found');
  const body: string[] = [];
  for (let i = run + 1; i < lines.length; i++) {
    const line = lines[i] as string;
    if (line.trim() !== '' && !line.startsWith('          ')) break;
    body.push(line.startsWith('          ') ? line.slice(10) : '');
  }
  return `${body.join('\n')}\n`;
}

const script = stepScript(readFileSync(join(ROOT, '.github/workflows/backup.yml'), 'utf8'), 'Dump the database and encrypt it (no plaintext on disk)');

const PG_SHIM = `#!/bin/sh
{
  echo "ARGS:$*"
  echo "PGHOST=$PGHOST"
  echo "PGPORT=$PGPORT"
  echo "PGUSER=$PGUSER"
  echo "PGPASSWORD=$PGPASSWORD"
  echo "PGDATABASE=$PGDATABASE"
  echo "PGSSLMODE=$PGSSLMODE"
  echo "HAS_URL=\${SUPABASE_DB_URL:+yes}"
} > "$SHIM_LOG"
printf 'dumpdata'
`;

const AGE_SHIM = `#!/bin/sh
out=""
while [ $# -gt 0 ]; do
  case "$1" in
    -o) out="$2"; shift 2 ;;
    *) shift ;;
  esac
done
cat > /dev/null
{ printf 'age-encryption.org/v1\\n'; head -c 2048 /dev/zero; } > "$out"
`;

// the password pieces, assembled at run time so no connection string with a password is committed
const PASSWORD = 'p@ss/w:rd';
const RAW_PASSWORD = 'p%40ss%2Fw%3Ard';
const url = (parts: { user?: string; password?: string; host?: string; port?: string; db?: string } = {}): string => {
  const { user = 'postgres.abcdefgh', password = RAW_PASSWORD, host = 'aws-0-ap-south-1.pooler.supabase.com', port = ':5432', db = '/postgres' } = parts;
  return ['postgresql', '://', user, password === '' ? '' : ':', password, '@', host, port, db].join('');
};

function runStep(env: Record<string, string>): { status: number | null; output: string; log: string | null } {
  const sh = shell as { bash: string; extraPath: string[] };
  const work = tempDir('ps-backup-');
  const shims = join(work, 'shims');
  mkdirSync(shims);
  for (const [name, content] of [['pg_dump', PG_SHIM], ['age', AGE_SHIM]] as const) {
    writeFileSync(join(shims, name), content, { mode: 0o755 });
    chmodSync(join(shims, name), 0o755);
  }
  const file = join(work, 'step.sh');
  writeFileSync(file, script);
  const logFile = join(work, 'pg.log');
  const path = [shims, dirname(process.execPath), ...sh.extraPath, process.platform === 'win32' ? '' : '/usr/bin:/bin'].filter(Boolean).join(delimiter);
  const r = spawnSync(sh.bash, [file], {
    cwd: work,
    encoding: 'utf8',
    env: {
      PATH: path,
      SystemRoot: process.env.SystemRoot ?? '',
      HOME: work,
      TMPDIR: work,
      SHIM_LOG: logFile,
      AGE_PUBLIC_KEY: fakeAgePublicKey(),
      ...env,
    },
  });
  return { status: r.status, output: `${r.stdout}${r.stderr}`, log: existsSync(logFile) ? readFileSync(logFile, 'utf8') : null };
}

/** The shell output without the `::add-mask::` lines (GitHub consumes those and never prints them). */
const withoutMasks = (output: string): string => output.split('\n').filter((l) => !l.startsWith('::add-mask::')).join('\n');

describe('backup.yml: the dump step keeps the password off every command line (S-13)', () => {
  it('the step text was found and is the real one', () => {
    expect(script).toContain('pg_dump --format=custom --no-owner | age -r');
    expect(script).toContain('::add-mask::');
  });

  // each run starts a shell and several Node processes: slow on Windows, so the heavy runs are shared between the assertions
  let good: ReturnType<typeof runStep> | null = null;
  const goodRun = (): ReturnType<typeof runStep> => (good ??= runStep({ SUPABASE_DB_URL: url() }));

  it_('hands the connection to pg_dump through PG* variables only, with the password decoded', () => {
    const r = goodRun();
    expect(r.output, r.output).toContain('Encrypted backup');
    expect(r.status).toBe(0);
    const log = r.log as string;
    const lines = log.split('\n');
    expect(lines).toContain('ARGS:--format=custom --no-owner'); // no --dbname, no URL, no password
    expect(lines).toContain('PGHOST=aws-0-ap-south-1.pooler.supabase.com');
    expect(lines).toContain('PGPORT=5432');
    expect(lines).toContain('PGUSER=postgres.abcdefgh');
    expect(lines).toContain(`PGPASSWORD=${PASSWORD}`);
    expect(lines).toContain('PGDATABASE=postgres');
    expect(lines).toContain('PGSSLMODE=require');
    expect(lines).toContain('HAS_URL='); // the URL variable is gone from the environment of pg_dump
  });

  it_('masks the decoded and the encoded password for the runner log, and never prints either one otherwise', () => {
    const r = goodRun();
    expect(r.output).toContain(`::add-mask::${PASSWORD}`);
    expect(r.output).toContain(`::add-mask::${RAW_PASSWORD}`);
    const visible = withoutMasks(r.output);
    expect(visible).not.toContain(PASSWORD);
    expect(visible).not.toContain(RAW_PASSWORD);
    expect(visible).not.toContain('postgres.abcdefgh');
  });

  it_('defaults the port to 5432 and the database to postgres when the URL has none', () => {
    const r = runStep({ SUPABASE_DB_URL: url({ port: '', db: '' }) });
    expect(r.status).toBe(0);
    const lines = (r.log as string).split('\n');
    expect(lines).toContain('PGPORT=5432');
    expect(lines).toContain('PGDATABASE=postgres');
  });

  it_('refuses a URL that cannot be read, or has no password, and never runs pg_dump', () => {
    const bad = runStep({ SUPABASE_DB_URL: 'this is not a connection string' });
    expect(bad.status).toBe(1);
    expect(bad.log).toBeNull();
    expect(bad.output).not.toContain('this is not a connection string');

    const noPassword = runStep({ SUPABASE_DB_URL: url({ password: '' }) });
    expect(noPassword.status).toBe(1);
    expect(noPassword.output).toContain('does not contain a host, a user and a password');
    expect(noPassword.log).toBeNull();
  });

  it_('still refuses a missing secret and a private (or malformed) age key', () => {
    expect(runStep({ SUPABASE_DB_URL: '' }).status).toBe(1);
    const privateKey = runStep({ SUPABASE_DB_URL: url(), AGE_PUBLIC_KEY: ['AGE', 'SECRET', 'KEY', '1' + 'Q'.repeat(58)].join('-') });
    expect(privateKey.status).toBe(1);
    expect(privateKey.output).toContain('not an age public key');
    expect(privateKey.log).toBeNull();
  });
});
