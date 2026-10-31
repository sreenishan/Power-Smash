// Static checks of migration 0025_platform_retention.sql, its check script and the retention workflow's second step. The SQL and the TS
// copy of the limits and answer keys (src/lib/retention/platform.ts) must agree.
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { KEEP_DAYS_LIMITS, RUN_COUNT_KEYS } from '../../src/lib/retention/platform';
import { checkMigration } from '../supabase/migration-rules';

const sql = readFileSync('supabase/migrations/0025_platform_retention.sql', 'utf8');
const body = sql.replace(/--.*$/gm, '');
const checks = readFileSync('supabase/checks/0025_assertions.sql', 'utf8');
const workflow = readFileSync('.github/workflows/retention.yml', 'utf8').replace(/\r\n/g, '\n');
const workflowCode = workflow
  .split('\n')
  .filter((l) => !l.trim().startsWith('#'))
  .join('\n');

describe('0025_platform_retention.sql (static)', () => {
  it('follows the D-005 rules', () => {
    expect(checkMigration(sql).problems).toEqual([]);
    expect(checkMigration(sql).tables.sort()).toEqual(['notify_unsubscribe_hashes', 'retention_settings']);
  });

  it('gives the periods no default and starts them empty', () => {
    expect(body).toMatch(/registration_keep_days\s+integer\s+check/);
    expect(body).toMatch(/subscriber_keep_days\s+integer\s+check/);
    expect(body).not.toMatch(/keep_days\s+integer[^,\n]*default/i);
    expect(body).toContain('insert into public.retention_settings (id) values (1);');
  });

  it('uses the same day limits as the TS copy, in the table and in the RPC', () => {
    const r = KEEP_DAYS_LIMITS.registrationKeepDays;
    const s = KEEP_DAYS_LIMITS.subscriberKeepDays;
    expect(body).toContain(`registration_keep_days is null or registration_keep_days between ${r.min} and ${r.max}`);
    expect(body).toContain(`subscriber_keep_days is null or subscriber_keep_days between ${s.min} and ${s.max}`);
    expect(body).toMatch(new RegExp(`'registrationKeepDays', 'the days to keep closed registrations', ${r.min}, ${r.max}\\)`));
    expect(body).toMatch(new RegExp(`'subscriberKeepDays', 'the days to keep unconfirmed or unsubscribed email sign-ups', ${s.min}, ${s.max}\\)`));
  });

  it('answers with exactly the keys the TS parser accepts', () => {
    const ret = /return jsonb_build_object\('dry_run'([\s\S]*?)\);\s*end;/.exec(body)?.[1] ?? '';
    const keys = ['dry_run', ...[...ret.matchAll(/'([a-z_]+)'/g)].map((m) => m[1] as string)];
    expect(keys.sort()).toEqual(['dry_run', 'registration_keep_days', 'subscriber_keep_days', ...RUN_COUNT_KEYS].sort());
  });

  it('never touches the audit log, consent evidence, tombstones, leads, entries or players', () => {
    for (const t of ['audit_log', 'consent_events', 'notice_versions', 'suppression', 'leads', 'event_entries', 'players', 'tournaments']) {
      expect(body, t).not.toMatch(new RegExp(`(update|delete from|truncate)\\s+(table\\s+)?public\\.${t}\\b`, 'i'));
    }
  });

  it('never deletes an active subscriber; the CURRENT status decides; the hash only for unsubscribes and only behind its own switch', () => {
    expect(body).toMatch(/n\.status = 'pending' and n\.confirm_expires_at <= p_now/);
    expect(body).toMatch(/n\.status = 'unsubscribed' and n\.unsubscribed_at \+ make_interval/);
    expect(body).not.toMatch(/status = 'active'/);
    expect(body).toMatch(/case when n\.status = 'unsubscribed' then 'delete_unsubscribed' else 'delete' end/);
    expect(body).toMatch(/keep_unsubscribe_hash\s+boolean\s+not null default false/);
    // every hash insert sits inside "if v_keep_hash then"
    const inserts = [...body.matchAll(/insert into public\.notify_unsubscribe_hashes/g)].length;
    expect(inserts).toBe(1);
    expect(body).toMatch(/if v_keep_hash then\s+insert into public\.notify_unsubscribe_hashes/);
  });

  it('the real run takes ONE list after locking and uses it for the hash, the counts and the deletes', () => {
    const real = body.slice(body.indexOf('perform 1 from public.event_registrations r'), body.indexOf('if v_reg_anon + v_reg_del'));
    expect(real).toMatch(/into v_anon, v_del, v_pending, v_unsub/);
    expect(real.match(/platform_retention_candidates/g)).toHaveLength(4);
    expect(real).toMatch(/from public\.notification_outbox o\s+where o\.recipient_subscriber_id in [^;]+for update/);
  });

  it('freezes an anonymised registration and requires a cleared partner name', () => {
    expect(body).toMatch(/create trigger event_registrations_anonymised_frozen before update on public\.event_registrations/);
    expect(body).toMatch(/if old\.anonymised_at is not null then\s+raise exception 'INVALID: /);
    expect(body).toMatch(/and \(player2_name is null or player2_name = 'Anonymised partner'\)\)/);
  });

  it('clears every contact field of an anonymised registration', () => {
    const update = /update public\.event_registrations r\s+set([\s\S]*?)where r\.id = any/i.exec(body)?.[1] ?? '';
    for (const col of ['player1_name', 'player2_name', 'contact_phone', 'contact_email', 'payment_reference', 'ip_hash', 'whatsapp_ok', 'rejected_reason', 'anonymised_at', 'revision']) {
      expect(update, col).toMatch(new RegExp(`\\b${col}\\b`));
    }
    for (const col of ['entry_id', 'status', 'payment_verified_amount_paise', 'fee_paise_at_submit', 'consent_id', 'consent_version', 'consent_at', 'ref']) {
      expect(update, col).not.toMatch(new RegExp(`\\b${col}\\s*=`));
    }
  });

  it('the job checks its inputs before anything else, and the owner RPCs call require_owner first', () => {
    expect(body).toMatch(/function app\.platform_retention\([\s\S]*?begin\s+(?:--[^\n]*\n\s*)?if p_actor is null/);
    for (const fn of ['admin_set_platform_retention', 'admin_platform_retention_summary']) {
      expect(sql).toMatch(new RegExp(`function public\\.${fn}\\([\\s\\S]*?begin\\s+perform app\\.require_owner\\(p_actor\\);`));
    }
  });
});

describe('0025_assertions.sql', () => {
  it('ends with its ok row and tests the boundary, the empty periods and the dry run', () => {
    expect(checks).toMatch(/ok: 0025_platform_retention assertions passed/);
    expect(checks).toContain("b_reg - interval '1 second'");
    expect(checks).toContain("b_sub - interval '1 second'");
    expect(checks).toContain("'empty periods'");
    expect(checks).toContain('a dry run changed a registration');
    expect(checks).toContain("raise exception 'ps_rollback'");
  });

  it('uses fictional data only', () => {
    expect(checks).not.toMatch(/@(?!example\.test)[a-z0-9.-]+\.[a-z]{2,}/i);
    for (const m of checks.matchAll(/'(9\d{9,14})'/g)) expect(m[1]).toMatch(/^9100000000\d+$/);
  });
});

describe('retention.yml: the registrations and sign-ups step', () => {
  const step = workflowCode.slice(workflowCode.indexOf('Run the registrations and sign-ups retention function'));

  it('exists after the leads step, behind the same job switch', () => {
    expect(workflowCode.indexOf('/rest/v1/rpc/admin_run_retention')).toBeGreaterThan(0);
    expect(workflowCode.indexOf('/rest/v1/rpc/admin_run_platform_retention')).toBeGreaterThan(workflowCode.indexOf('/rest/v1/rpc/admin_run_retention'));
    expect(workflowCode).toMatch(/^ {4}if: \$\{\{ vars\.RETENTION_ENABLED == 'true' && github\.ref == 'refs\/heads\/main' \}\}$/m);
    expect(step.length).toBeGreaterThan(100);
  });

  it('follows the dry-run input, sends the key only through curl standard input and prints only the answer', () => {
    expect(step).toContain("DRY_RUN: ${{ github.event_name == 'workflow_dispatch' && inputs.dry_run || false }}");
    expect(step).toContain('\\"p_dry_run\\":${dry}');
    expect(step).toContain('--config -');
    expect(step).toContain("grep -Eq '^https://[a-z0-9]{20}\\.supabase\\.co/?$'");
    expect(step).not.toMatch(/curl[^\n]*(apikey|Authorization|SUPABASE_SECRET_KEY)/i);
    expect(step).not.toMatch(/echo[^\n]*\$\{?SUPABASE_SECRET_KEY/);
    expect(step).toContain('if [ "$status" != "200" ]');
    expect(step).toContain('cat "$result"');
    expect(step).toContain('trap \'rm -f "$result"\' EXIT');
    expect(step).not.toMatch(/set -[a-z]*x|bash -x/);
    expect(workflowCode).not.toContain('uses:');
    expect(workflowCode).not.toContain('pull_request_target');
  });
});
