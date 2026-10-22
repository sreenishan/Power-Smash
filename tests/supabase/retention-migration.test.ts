// Static checks of migration 0010_retention.sql, plus a real run on the LOCAL PostgreSQL with fictional dated rows (skipped unless the
// server is up: `node scripts/pg-local.mjs start` first and `stop` afterwards). Own database: psretention, dropped at the end.
import { readFileSync } from 'node:fs';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { apply, binariesPresent, dropDb, isUp, psql } from '../../scripts/pg-local.mjs';
import { checkMigration } from './migration-rules';

const sql = readFileSync('supabase/migrations/0010_retention.sql', 'utf8');
const body = sql.replace(/--.*$/gm, '');

describe('0010_retention.sql (static)', () => {
  it('follows the D-005 rules and closes the function to the API roles', () => {
    expect(checkMigration(sql).problems).toEqual([]);
    expect(body).toContain('security definer');
    expect(body).toContain("set search_path = ''");
    expect(body).toContain('grant execute on function public.admin_run_retention(text, boolean) to service_role;');
  });

  it('never touches tombstones, the audit log, consent evidence or lead timelines', () => {
    for (const t of ['suppression', 'audit_log', 'consent_events', 'notice_versions', 'lead_events', 'tournament_private']) {
      expect(body, t).not.toMatch(new RegExp(`(update|delete from|truncate)\\s+(table\\s+)?public\\.${t}\\b`, 'i'));
    }
  });

  it('keeps the counters: only personal fields are cleared on a lead', () => {
    const update = /update public\.leads\s+set([\s\S]*?)where/i.exec(body)?.[1] ?? '';
    for (const col of ['name', 'organization', 'phone', 'email', 'notes', 'lost_reason', 'ip_hash', 'payload', 'anonymised_at']) expect(update, col).toMatch(new RegExp(`\\b${col}\\b`));
    for (const col of ['ref_code', 'type', 'status', 'value_paise', 'budget_range', 'source_path', 'consent_at', 'created_at']) expect(update, col).not.toMatch(new RegExp(`\\b${col}\\b`));
  });

  it('uses the stated windows: 24 months for leads, 2 days for hits and salts', () => {
    expect(body).toContain("interval '24 months'");
    expect(body).toContain("interval '2 days'");
    expect(body).toMatch(/status in \('completed', 'lost'\)/);
  });

  it('adds no table (the anon harness manifest is unchanged)', () => {
    expect(body).not.toMatch(/create table/i);
  });
});

const up = binariesPresent() && isUp();
const DB = 'psretention';
const ID = (n: number): string => `f2000000-0000-4000-8000-00000000000${n}`;
const lead = (n: number, status: string, monthsAgo: number): string =>
  `insert into public.leads (id, ref_code, type, status, name, organization, phone, email, notes, payload, lost_reason, ip_hash, value_paise, source_path, consent_id, consent_version, consent_at, idempotency_key)
   values ('${ID(n)}', 'PS-2024-RT${n}MMM', 'general', '${status}', 'Fictional Person ${n}', 'Fake Org', '91000000000${n}', 'p${n}@example.invalid', 'fake note', '{"message":"fake"}', 'fake reason', 'k.0000', 100, '/contact/', 'lead-notice', 'v1', now() - interval '${monthsAgo} months', '${ID(n).replace('f2', 'f3')}')`;
const age = (n: number, monthsAgo: number): string =>
  `alter table public.leads disable trigger leads_touch_updated_at; update public.leads set updated_at = now() - interval '${monthsAgo} months' where id = '${ID(n)}'; alter table public.leads enable trigger leads_touch_updated_at`;

describe.skipIf(!up)('admin_run_retention on the local PostgreSQL', () => {
  beforeAll(() => {
    dropDb(DB);
    apply(DB, { quiet: true });
  }, 120_000);
  afterAll(() => {
    if (up) dropDb(DB);
  });

  const run = (dry: boolean, role = 'service_role'): string => {
    const r = psql(DB, `begin; set local role ${role}; select public.admin_run_retention('fake-actor', ${dry}); commit`);
    expect(r.status, r.stderr).toBe(0);
    return r.stdout;
  };

  it('is refused for anon and authenticated', () => {
    for (const role of ['anon', 'authenticated']) {
      const r = psql(DB, `begin; set local role ${role}; select public.admin_run_retention('fake-actor', true); rollback`);
      expect(r.status, role).not.toBe(0);
      expect(r.stderr).toMatch(/permission denied/);
    }
  }, 60_000);

  it('dry run counts and changes nothing; the real run anonymises only old closed leads and is idempotent', () => {
    const setup = [
      lead(1, 'lost', 30),
      lead(2, 'completed', 25),
      lead(3, 'new', 30),
      lead(4, 'lost', 6),
      lead(5, 'won', 30),
      age(1, 30),
      age(2, 25),
      age(3, 30),
      age(5, 30),
      "insert into public.rate_limit_hits (bucket, key_hash, hit_at) values ('ip', 'rt.old', now() - interval '3 days'), ('ip', 'rt.new', now())",
      "insert into public.daily_salts (day, salt) values (date '2001-01-01', 'old'), (date '2999-12-31', 'new')",
      "insert into public.suppression (kind, value, reason, created_by) values ('youtube_id', 'rt-fake-1', 'test', 'fake-admin')",
    ].join(';\n');
    expect(psql(DB, setup).status).toBe(0);
    const auditBefore = psql(DB, "select count(*) from public.audit_log where action = 'retention_run'").stdout.trim();

    const dry = run(true);
    expect(dry).toContain('"leads_anonymised": 2');
    expect(dry).toContain('"rate_limit_hits_deleted": 1');
    expect(dry).toContain('"daily_salts_deleted": 1');
    expect(dry).toContain('"event_documents": "not_built"');
    expect(psql(DB, 'select count(*) from public.leads where anonymised_at is not null').stdout.trim()).toBe('0');
    expect(psql(DB, "select count(*) from public.audit_log where action = 'retention_run'").stdout.trim()).toBe(auditBefore);

    const real = run(false);
    expect(real).toContain('"dry_run": false');
    expect(real).toContain('"leads_anonymised": 2');
    const people = psql(DB, `select id || '|' || name || '|' || coalesce(phone, 'null') || '|' || coalesce(email, 'null') || '|' || coalesce(notes, 'null') || '|' || payload::text || '|' || status || '|' || value_paise from public.leads order by id`).stdout.trim().split(/\r?\n/);
    expect(people[0]).toBe(`${ID(1)}|Anonymised|null|null|null|{}|lost|100`);
    expect(people[1]).toBe(`${ID(2)}|Anonymised|null|null|null|{}|completed|100`);
    expect(people[2]).toContain('Fictional Person 3|910000000003');
    expect(people[3]).toContain('Fictional Person 4|910000000004');
    expect(people[4]).toContain('Fictional Person 5|910000000005');
    expect(psql(DB, "select count(*) from public.rate_limit_hits where key_hash like 'rt.%'").stdout.trim()).toBe('1');
    expect(psql(DB, "select count(*) from public.daily_salts where day = date '2001-01-01'").stdout.trim()).toBe('0');
    expect(psql(DB, "select count(*) from public.suppression where value = 'rt-fake-1' and released_at is null").stdout.trim()).toBe('1');
    expect(psql(DB, "select count(*) from public.audit_log where action = 'retention_run'").stdout.trim()).toBe(String(Number(auditBefore) + 1));
    expect(psql(DB, "select diff::text from public.audit_log where action = 'retention_run' order by id desc limit 1").stdout).not.toMatch(/Fictional|9100000|example/);

    const again = run(false);
    expect(again).toContain('"leads_anonymised": 0');
    expect(psql(DB, "select count(*) from public.audit_log where action = 'retention_run'").stdout.trim()).toBe(String(Number(auditBefore) + 1));
  }, 120_000);

  it('rejects an empty actor and a null dry-run flag', () => {
    expect(psql(DB, "select public.admin_run_retention('', true)").status).not.toBe(0);
    expect(psql(DB, "select public.admin_run_retention('fake-actor', null)").status).not.toBe(0);
  }, 60_000);
});
