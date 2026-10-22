import { createHash } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { apply, binariesPresent, check, dropDb, isUp, psql } from '../../scripts/pg-local.mjs';

// Runs the migrations on the LOCAL throwaway PostgreSQL (scripts/pg-local.mjs, docs/m1/tooling-notes.md) and exercises the
// privilege rules for real. SKIPPED unless the local server is already up: `node scripts/pg-local.mjs start` first and
// `node scripts/pg-local.mjs stop` afterwards. Uses its own database (pstest), dropped at the end. Fictional data only.
const DB = 'pstest';
const up = binariesPresent() && isUp();
const NEWLINE = /\r?\n/;

const NOTICE = 'Fictional notice text for a local test.';
const SHA = createHash('sha256').update(NOTICE, 'utf8').digest('hex');
const LEAD_ID = '00000000-0000-4000-8000-000000000001';
const leadInsert = (type = 'coverage', id = LEAD_ID, ref = 'PS-2026-7K3QDM', key = '00000000-0000-4000-8000-0000000000aa') =>
  `insert into public.leads (id, ref_code, type, name, phone, consent_id, consent_version, consent_at, idempotency_key)
   values ('${id}', '${ref}', '${type}', 'Test Person', '910000000000', 'lead-notice', 'v1', now(), '${key}')`;

/** Runs SQL as a role inside one transaction that is rolled back. */
function as(role, sql) {
  return psql(DB, `begin; set local role ${role}; ${sql}; rollback;`);
}

describe.skipIf(!up)('local PostgreSQL: migrations and privileges', () => {
  let tables = [];
  const firstColumn = {};

  beforeAll(() => {
    dropDb(DB);
    apply(DB, { quiet: true });
    tables = psql(DB, "select tablename from pg_tables where schemaname = 'public' order by 1").stdout.trim().split(NEWLINE);
    for (const t of tables) {
      firstColumn[t] = psql(
        DB,
        `select column_name from information_schema.columns where table_schema = 'public' and table_name = '${t}' order by ordinal_position limit 1`,
      ).stdout.trim();
    }
  }, 120_000);

  afterAll(() => {
    if (up) dropDb(DB);
  });

  it('applies both migrations and the check files report ok', () => {
    // later migrations add tables (0004-0006 archive, 0007 placements): the M1 tables must still be there, nothing is asserted about the others here
    expect(tables).toEqual(expect.arrayContaining(['consent_events', 'daily_salts', 'events', 'lead_events', 'leads', 'notice_versions', 'outbound_clicks', 'rate_limit_hits']));
    expect(check(DB).length).toBeGreaterThanOrEqual(2);
  }, 120_000);

  it('service_role can insert into every table the Worker writes (the lead trigger writes the created event)', () => {
    const sql = [
      leadInsert(),
      `insert into public.events (name, page_path) values ('page_view', '/book/')`,
      `insert into public.outbound_clicks (go_slug) values ('example-link')`,
      `insert into public.rate_limit_hits (bucket, key_hash) values ('ip', 'k.0000')`,
      `insert into public.daily_salts (day, salt) values (current_date, 'abc')`,
      `insert into public.notice_versions (id, version, sha256, "text") values ('lead-notice', 'v1', '${SHA}', '${NOTICE}')`,
      `insert into public.consent_events (lead_id, notice_id, notice_version, notice_sha256, given) values ('${LEAD_ID}', 'lead-notice', 'v1', '${SHA}', true)`,
      `select count(*) from public.lead_events where lead_id = '${LEAD_ID}' and event = 'created'`,
    ].join('; ');
    const r = as('service_role', sql);
    expect(r.stderr).toBe('');
    expect(r.status).toBe(0);
    expect(r.stdout.trim().split(NEWLINE)).toContain('1');
  });

  it('service_role cannot delete or truncate leads (retention anonymises) but can update them', () => {
    expect(as('service_role', `${leadInsert()}; update public.leads set status = 'contacted' where id = '${LEAD_ID}'`).status).toBe(0);
    expect(as('service_role', `${leadInsert()}; delete from public.leads where id = '${LEAD_ID}'`).stderr).toMatch(/permission denied/);
    expect(as('service_role', 'truncate public.leads').stderr).toMatch(/permission denied/);
  });

  it('a wrong notice hash is refused by the database', () => {
    const r = as('service_role', `insert into public.notice_versions (id, version, sha256, "text") values ('lead-notice', 'v2', '${'0'.repeat(64)}', '${NOTICE}')`);
    expect(r.stderr).toMatch(/notice_versions_sha256_matches/);
  });

  for (const role of ['anon', 'authenticated']) {
    it(
      `${role} is denied select, insert, update and delete on every table in public`,
      () => {
        expect(tables.length).toBeGreaterThan(0);
        for (const t of tables) {
          const column = firstColumn[t];
          for (const stmt of [`select * from public.${t} limit 1`, `insert into public.${t} default values`, `update public.${t} set ${column} = ${column}`, `delete from public.${t}`]) {
            expect(as(role, stmt).stderr, `${role}: ${stmt}`).toMatch(/permission denied/);
          }
        }
      },
      120_000,
    );

    it(`${role} cannot use schema app or its functions`, () => {
      expect(as(role, 'select app.touch_updated_at()').stderr).toMatch(/permission denied/);
    });
  }

  it('consent_events and notice_versions are append-only, even for the owner role', () => {
    const seed = `${leadInsert()}; insert into public.notice_versions (id, version, sha256, "text") values ('lead-notice', 'v1', '${SHA}', '${NOTICE}'); insert into public.consent_events (lead_id, notice_id, notice_version, notice_sha256, given) values ('${LEAD_ID}', 'lead-notice', 'v1', '${SHA}', true)`;
    for (const stmt of [
      'update public.consent_events set given = false',
      'delete from public.consent_events',
      'truncate public.consent_events',
      "update public.notice_versions set version = 'v9'",
      'delete from public.notice_versions',
      'truncate public.notice_versions',
    ]) {
      const owner = psql(DB, `begin; ${seed}; ${stmt}; rollback;`);
      expect(owner.stderr, `postgres: ${stmt}`).toMatch(/append-only/);
      const worker = as('service_role', `${seed}; ${stmt}`);
      expect(worker.stderr, `service_role: ${stmt}`).toMatch(/permission denied|append-only/);
    }
  }, 60_000);

  it('0003 (the two M3 lead kinds) is part of the migrations: both kinds are accepted, an unknown kind is refused', () => {
    for (const [i, kind] of ['video_submission', 'alerts_signup'].entries()) {
      const r = as('service_role', leadInsert(kind, `00000000-0000-4000-8000-00000000001${i}`, `PS-2026-7K3QD${i + 5}`, `00000000-0000-4000-8000-00000000002${i}`));
      expect(r.stderr).toBe('');
      expect(r.status).toBe(0);
    }
    const bad = as('service_role', leadInsert('no_such_kind', '00000000-0000-4000-8000-000000000002', 'PS-2026-7K3QDN', '00000000-0000-4000-8000-0000000000ab'));
    expect(bad.stderr).toMatch(/leads_type_check/);
    expect(check(DB).length).toBeGreaterThanOrEqual(2);
  }, 120_000);
});
