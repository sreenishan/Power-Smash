// Migration 0025 on the LOCAL PostgreSQL (skipped unless the server is up: `node scripts/pg-local.mjs start` first and `stop` afterwards).
// Own database: psplatformretention, dropped at the end. Runs the 0025 check script and reads the job's real answers through the TS parser.
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { apply, binariesPresent, dropDb, isUp, psql, psqlFile } from '../../scripts/pg-local.mjs';
import { parseRetentionRun } from '../../src/lib/retention/platform';

const up = binariesPresent() && isUp();
const DB = 'psplatformretention';

describe.skipIf(!up)('0025 platform retention on the local PostgreSQL', () => {
  beforeAll(() => {
    dropDb(DB);
    apply(DB, { quiet: true });
  }, 180_000);
  afterAll(() => {
    if (up) dropDb(DB);
  }, 60_000);

  it('passes its check script', () => {
    const r = psqlFile(DB, 'supabase/checks/0025_assertions.sql', { quiet: true });
    expect(r.status, r.stderr).toBe(0);
    expect(r.stdout).toContain('ok: 0025_platform_retention assertions passed');
  }, 120_000);

  it('the workflow call (service_role, dry by default) answers counts the TS parser accepts; anon and authenticated are refused', () => {
    const r = psql(DB, "begin; set local role service_role; select public.admin_run_platform_retention('fake-retention')::text; commit");
    expect(r.status, r.stderr).toBe(0);
    const line = r.stdout.trim().split(/\r?\n/).find((l) => l.startsWith('{')) ?? '';
    const run = parseRetentionRun(JSON.parse(line));
    expect(run.dryRun).toBe(true);
    expect(run.registrationKeepDays).toBeNull();
    expect(run.subscriberKeepDays).toBeNull();
    expect(Object.values(run.counts).every((n) => n === 0)).toBe(true);
    for (const role of ['anon', 'authenticated']) {
      const denied = psql(DB, `begin; set local role ${role}; select public.admin_run_platform_retention('fake-retention', true); rollback`);
      expect(denied.status, role).not.toBe(0);
      expect(denied.stderr).toMatch(/permission denied/);
    }
  }, 60_000);
});
