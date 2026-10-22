// restore.yml (D-011 part 1) and the local drill script: text checks of the workflow, unit tests of the drill helpers, and, when the local
// PostgreSQL is up, the whole drill for real (made-up data only). Fictional data; no secret value appears anywhere.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { binariesPresent, isUp } from '../../scripts/pg-local.mjs';
import { COUNT_SQL, diffCounts, findAge, madeUpDataSql, parseCounts, runDrill } from '../../scripts/restore-drill.mjs';
import { ROOT } from './helpers';

const read = (rel: string): string => readFileSync(join(ROOT, rel), 'utf8').replace(/\r\n/g, '\n');
const restore = read('.github/workflows/restore.yml');
const backup = read('.github/workflows/backup.yml');
const code = restore
  .split('\n')
  .filter((l) => !l.trim().startsWith('#'))
  .join('\n');

describe('restore.yml', () => {
  it('is disabled unless RESTORE_DRILL_ENABLED is "true" and the run is on main, runs monthly and on demand, one at a time', () => {
    expect(code).toMatch(/^ {4}if: \$\{\{ vars\.RESTORE_DRILL_ENABLED == 'true' && github\.ref == 'refs\/heads\/main' \}\}$/m);
    expect(code).toMatch(/schedule:\n\s+- cron: "\d+ \d+ \d+ \* \*"/);
    expect(code).toContain('workflow_dispatch:');
    expect(code).toMatch(/concurrency:\n\s+group: restore-drill\n\s+cancel-in-progress: false/);
  });

  it('has the minimum permissions, pinned actions only (the same SHAs as ci.yml) and a Postgres 17 service container', () => {
    expect(code).toMatch(/^permissions:\n {2}contents: read$/m);
    expect(code).not.toMatch(/^\s+[\w-]+:\s*write\s*$/m);
    const uses = code.split('\n').filter((l) => /^\s*-?\s*uses:/.test(l));
    expect(uses.length).toBeGreaterThan(0);
    const ci = read('.github/workflows/ci.yml');
    for (const l of uses) {
      expect(l, l).toMatch(/uses:\s+[\w.-]+\/[\w.-]+@[0-9a-f]{40}\s+# v\d+(\.\d+){0,2}\s*$/);
      expect(ci, `${l.trim()} must be a SHA already used in ci.yml`).toContain(l.trim().replace(/^-\s*/, ''));
    }
    expect(code).toContain('image: postgres:17');
    expect(code).toContain('postgresql-client-17');
    expect(code).not.toContain('pull_request_target');
    expect(code).not.toMatch(/set -[a-z]*x|bash -x/);
  });

  it('dumps the DEV project with the backup pipeline, encrypted to the DRILL key, and never uses the production key or secret', () => {
    expect(code).toContain('pg_dump --format=custom --no-owner | age -r "$AGE_DRILL_PUBLIC_KEY" -o "$out"');
    expect(backup).toContain('pg_dump --format=custom --no-owner | age -r "$AGE_PUBLIC_KEY" -o "$out"');
    expect(code).toContain('DEV_SUPABASE_DB_URL');
    expect(code).not.toContain('secrets.SUPABASE_DB_URL');
    expect(code).not.toContain('AGE_PUBLIC_KEY');
    expect(code).not.toMatch(/pg_dump[^\n|]*(-f|--file)[ =]/);
  });

  it('decrypts with AGE_DRILL_KEY in one step only, through a 0600 file that is removed, straight into pg_restore', () => {
    expect(code.match(/secrets\.AGE_DRILL_KEY/g)).toHaveLength(1);
    expect(code).toContain('umask 077');
    expect(code).toMatch(/age -d -i "\$keyfile" [^\n]*\\\n\s*\| pg_restore --no-owner --exit-on-error/);
    expect(code).toContain('trap \'rm -f "$keyfile"\' EXIT');
    expect(code).not.toMatch(/echo[^\n]*\$\{?AGE_DRILL_KEY/);
    expect(code).not.toMatch(/echo[^\n]*\$\{?keyfile/);
  });

  it('keeps the connection password off command lines and out of the log', () => {
    expect(code).toContain('::add-mask::');
    expect(code).toContain('unset DEV_SUPABASE_DB_URL');
    expect(code).toContain('PGPASSWORD');
  });

  it('applies the erasure log, compares row counts, asserts RLS and grants and reuses supabase/checks', () => {
    expect(code).toContain('scripts/restore-drill-erasure.sql');
    expect(code).toContain('diff -u drill/source-counts.txt drill/restored-counts.txt');
    expect(code).toContain('scripts/restore-drill.sql');
    expect(code).toContain('supabase/checks/*.sql');
  });

  it('restores only into the loopback service container', () => {
    const restoreStep = code.slice(code.indexOf('Decrypt with the drill key'));
    expect(restoreStep).toContain('PGHOST: 127.0.0.1');
    expect(restoreStep).not.toContain('DEV_SUPABASE_DB_URL');
  });
});

describe('restore drill helpers', () => {
  it('parses and compares count listings', () => {
    const a = parseCounts('events|2\nleads|3\n\nnoise\n');
    expect(a).toEqual({ events: 2, leads: 3 });
    expect(diffCounts(a, { events: 2, leads: 3 })).toEqual([]);
    expect(diffCounts(a, { events: 2, leads: 2 })).toEqual(['leads: source 3, restored 2']);
    expect(diffCounts(a, { events: 2 })).toEqual(['leads: source 3, restored missing']);
  });

  it('the count query and made-up data are fictional and use no real value', () => {
    expect(COUNT_SQL).toContain("n.nspname = 'public'");
    const sql = madeUpDataSql();
    expect(sql).toMatch(/9100000000/);
    expect(sql).not.toMatch(/@/);
  });

  it('finds age only through the runner it is given and never downloads', () => {
    expect(findAge((() => ({ status: 0 })) as never)).toBe(true);
    expect(findAge((() => ({ status: 1 })) as never)).toBe(false);
    expect(findAge((() => ({ error: new Error('ENOENT'), status: null })) as never)).toBe(false);
  });
});

const up = binariesPresent() && isUp();
describe.skipIf(!up)('the local drill (needs `node scripts/pg-local.mjs start`)', () => {
  it('builds, dumps, restores and verifies made-up data, then leaves nothing behind', () => {
    const lines: string[] = [];
    const report = runDrill({ log: (l: string) => lines.push(l) });
    expect(report.steps.length).toBeGreaterThanOrEqual(7);
    expect(report.tables).toBeGreaterThanOrEqual(25);
    expect(lines.join('\n')).toContain('row counts equal on every table');
  }, 300_000);
});
