// retention.yml (M4 retention job): text checks of the safety properties. No secret value appears anywhere.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { ROOT } from './helpers';

const text = readFileSync(join(ROOT, '.github/workflows/retention.yml'), 'utf8').replace(/\r\n/g, '\n');
const code = text
  .split('\n')
  .filter((l) => !l.trim().startsWith('#'))
  .join('\n');

describe('retention.yml', () => {
  it('is disabled unless RETENTION_ENABLED is "true" and the run is on main, weekly plus on demand, one at a time', () => {
    expect(code).toMatch(/^ {4}if: \$\{\{ vars\.RETENTION_ENABLED == 'true' && github\.ref == 'refs\/heads\/main' \}\}$/m);
    expect(code).toMatch(/schedule:\n\s+- cron: "\d+ \d+ \* \* \d"/);
    expect(code).toContain('workflow_dispatch:');
    expect(code).toMatch(/concurrency:\n\s+group: retention\n\s+cancel-in-progress: false/);
  });

  it('has a dry-run input that defaults to true, and the schedule is never a dry run', () => {
    expect(code).toMatch(/dry_run:\n(\s+.*\n)*?\s+type: boolean\n\s+default: true/);
    expect(code).toContain("DRY_RUN: ${{ github.event_name == 'workflow_dispatch' && inputs.dry_run || false }}");
    expect(code).toContain('\\"p_dry_run\\":${dry}');
  });

  it('has the minimum permissions, no checkout, no third-party action, no shell tracing', () => {
    expect(code).toMatch(/^permissions:\n {2}contents: read$/m);
    expect(code).not.toContain('uses:');
    expect(code).not.toContain('pull_request_target');
    expect(code).not.toMatch(/set -[a-z]*x|bash -x/);
  });

  it('sends the secret key only to the project address, through curl standard input, never on a command line', () => {
    expect(code).toContain('--config -');
    expect(code).toContain('supabase\\.co');
    expect(code).not.toMatch(/curl[^\n]*(apikey|Authorization|SUPABASE_SECRET_KEY)/i);
    expect(code).not.toMatch(/echo[^\n]*\$\{?SUPABASE_SECRET_KEY/);
    expect(code).toContain('/rest/v1/rpc/admin_run_retention');
  });

  it('puts the secret key on the apikey header only, never as a Bearer token (VF-S9, as src/lib/supabase/rest.ts does)', () => {
    expect(code.match(/header = "apikey: \$\{SUPABASE_SECRET_KEY\}"/g)).toHaveLength(2);
    expect(code).not.toMatch(/Authorization: Bearer \$\{?SUPABASE_SECRET_KEY/i);
    const sync = readFileSync('.github/workflows/sync.yml', 'utf8');
    expect(sync).not.toMatch(/Authorization: Bearer \$\{?SUPABASE_SECRET_KEY/i);
  });

  it('fails on any answer other than HTTP 200 and prints only what the function returns', () => {
    expect(code).toContain('if [ "$status" != "200" ]');
    expect(code).toContain('cat "$result"');
    expect(code).toContain('trap \'rm -f "$result"\' EXIT');
  });
});
