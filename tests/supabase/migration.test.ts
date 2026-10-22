import { readFileSync, readdirSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { MANIFEST } from '../../scripts/anon-harness.mjs';

// Static checks on the migration text (no database here). The real check is supabase/checks/0001_assertions.sql
// and scripts/anon-harness.mjs against the dev project once it exists (OT-03).
const sql = readFileSync('supabase/migrations/0001_lead_funnel.sql', 'utf8');
const checks = readFileSync('supabase/checks/0001_assertions.sql', 'utf8');
const stripped = sql.replace(/--.*$/gm, '');

const tables = [...stripped.matchAll(/create table public\.(\w+)/g)].map((m) => m[1] as string);

describe('migration 0001_lead_funnel.sql (D-005)', () => {
  it('creates the six private tables', () => {
    expect(tables.sort()).toEqual(['daily_salts', 'events', 'lead_events', 'leads', 'outbound_clicks', 'rate_limit_hits']);
  });

  it('enables row level security on every table', () => {
    for (const t of tables) expect(stripped, t).toMatch(new RegExp(`alter table public\\.${t}\\s+enable row level security`));
  });

  it('has NO policies at all (no anon, no authenticated, no public)', () => {
    expect(stripped).not.toMatch(/create policy/i);
    expect(stripped).not.toMatch(/alter policy/i);
  });

  it('revokes everything from public, anon and authenticated on every table', () => {
    const revoke = /revoke all on table\s([\s\S]*?)from public, anon, authenticated;/i.exec(stripped); // "tables" (default privileges) has no space after "table"
    expect(revoke).not.toBeNull();
    for (const t of tables) expect(revoke?.[1], t).toContain(`public.${t}`);
  });

  it('grants only to service_role, and only what the Worker needs', () => {
    const grants = [...stripped.matchAll(/grant ([a-z, ]+) on (?:table )?([\w.]+)\s+to (\w+)/gi)];
    expect(grants.length).toBe(6);
    for (const g of grants) expect(g[3], g[0]).toBe('service_role');
    const byTable = Object.fromEntries(grants.map((g) => [g[2], (g[1] as string).split(',').map((x) => x.trim()).sort()]));
    expect(byTable['public.leads']).toEqual(['insert', 'select', 'update']);
    expect(byTable['public.events']).toEqual(['insert']);
    expect(byTable['public.outbound_clicks']).toEqual(['insert']);
    expect(byTable['public.lead_events']).toEqual(['insert', 'select']);
    expect(byTable['public.rate_limit_hits']).toEqual(['delete', 'insert', 'select']);
    expect(byTable['public.daily_salts']).toEqual(['delete', 'insert', 'select']);
    expect(stripped).not.toMatch(/grant [^;]*\bto (anon|authenticated|public)\b/i);
    expect(stripped).not.toMatch(/grant all/i);
  });

  it('functions live in the app schema with a fixed search_path and no EXECUTE for anyone', () => {
    const fns = [...stripped.matchAll(/create or replace function (\S+)\(\)/g)].map((m) => m[1]);
    expect(fns.sort()).toEqual(['app.lead_created_event', 'app.touch_updated_at']);
    expect((stripped.match(/set search_path = ''/g) ?? []).length).toBe(2);
    for (const f of fns) expect(stripped).toMatch(new RegExp(`revoke all on function ${f.replace('.', '\\.')}\\(\\)\\s+from public, anon, authenticated`));
    expect(stripped).toMatch(/revoke all on schema app from public/);
    expect(stripped).not.toMatch(/security definer/i);
  });

  it('lead idempotency and reference uniqueness exist under the names the handler relies on', () => {
    expect(stripped).toContain('constraint leads_idempotency_key_uq unique (idempotency_key)');
    expect(stripped).toContain('constraint leads_ref_code_uq unique (ref_code)');
    expect(stripped).toContain("^PS-[0-9]{4}-[0-9A-HJKMNP-TV-Z]{6}$");
  });

  it('has the spec 11.2 lead columns, consent and hash columns, and money in integer paise', () => {
    const leads = (/create table public\.leads \(([\s\S]*?)\n\);/.exec(stripped)?.[1] ?? '').replace(/[ \t]+/g, ' ');
    for (const col of ['ref_code', 'type', 'status', 'name', 'organization', 'phone', 'email', 'whatsapp_ok', 'payload jsonb', 'budget_range', 'value_paise bigint', 'source_path', 'utm jsonb', 'follow_up_on date', 'notes', 'lost_reason', 'idempotency_key uuid', 'consent_id', 'consent_version', 'consent_at timestamptz', 'ip_hash', 'alert_state']) {
      expect(leads, col).toContain(col);
    }
    expect(leads).not.toMatch(/value_paise\s+bigint\s+not null\s+default/i); // no default price
    expect(leads).not.toMatch(/\bnumeric\b|\bmoney\b|\bfloat\b|\bdouble\b/i);
  });

  it('documents every private column with a comment', () => {
    for (const col of ['leads.phone', 'leads.email', 'leads.name', 'leads.payload', 'leads.ip_hash', 'leads.notes', 'events.session_hash', 'outbound_clicks.ua_hash', 'rate_limit_hits.key_hash', 'daily_salts.salt']) {
      expect(sql, col).toContain(`comment on column public.${col} is`);
    }
    for (const t of tables) expect(sql, t).toContain(`comment on table public.${t} is`);
  });

  it('exposes nothing through views (M1 has no public read)', () => {
    expect(stripped).not.toMatch(/create (or replace )?view/i);
    expect(stripped).not.toMatch(/create schema (if not exists )?api/i);
  });

  it('hardcodes no price, fee or tax rate', () => {
    expect(stripped).not.toMatch(/default\s+\d{3,}/i);
    expect(stripped).not.toMatch(/gst|tds|\b18\s*%/i);
  });
});

describe('assertions script', () => {
  it('names every table and the rules the migration promises', () => {
    for (const t of tables) expect(checks, t).toContain(`'${t}'`);
    for (const word of ['relrowsecurity', 'has_table_privilege', 'has_column_privilege', 'pg_policies', "'anon'", "'authenticated'", 'service_role', 'has_function_privilege', 'leads_idempotency_key_uq', 'pg_depend']) {
      expect(checks, word).toContain(word);
    }
    expect(checks).toMatch(/ok: 0001_lead_funnel assertions passed/);
  });

  it('changes nothing (read-only): one DO block of assertions and a final SELECT', () => {
    const body = checks.replace(/--.*$/gm, '');
    const doBlock = /do \$\$[\s\S]*?\n\$\$;/;
    expect(body).toMatch(doBlock);
    const outside = body.replace(doBlock, '').trim();
    expect(outside).toMatch(/^select '[^']*' as result;$/);
    expect(body).not.toMatch(/^\s*(insert into|update\s|delete from|drop\s|alter\s|create\s|grant\s|revoke\s|truncate\s)/im);
  });
});

describe('the anon harness manifest matches the migrations', () => {
  it('lists every private table (all migrations) with a primary key column that exists', () => {
    // every migration file (0001, 0002, then the archive, placements ... migrations): the manifest lists every table in public
    const all = readdirSync('supabase/migrations')
      .filter((f) => f.endsWith('.sql'))
      .sort()
      .map((f) => readFileSync(`supabase/migrations/${f}`, 'utf8').replace(/--.*$/gm, ''))
      .join('\n');
    const allTables = [...all.matchAll(/create table public\.(\w+)/g)].map((m) => m[1] as string);
    // entries with a `schema` are api views (the read surface), not tables in public
    const tableEntries = (MANIFEST as Array<{ name: string; pk: string; schema?: string }>).filter((m) => !m.schema);
    expect(tableEntries.map((m) => m.name).sort()).toEqual([...allTables].sort());
    for (const m of tableEntries) {
      const table = new RegExp(`create table public\\.${m.name} \\(([\\s\\S]*?)\\n\\);`).exec(all)?.[1] ?? '';
      expect(table, m.name).toMatch(new RegExp(`\\b${m.pk}\\b`));
    }
  });
});

describe('S-16: the default-privilege revoke and the all-tables assertions', () => {
  it('0001 revokes the default grants on future tables, sequences and functions for the API roles, before the first table', () => {
    expect(stripped).toMatch(/alter default privileges for role postgres in schema public revoke all on tables from anon, authenticated;/i);
    expect(stripped).toMatch(/alter default privileges for role postgres in schema public revoke all on sequences from anon, authenticated;/i);
    expect(stripped).toMatch(/alter default privileges for role postgres in schema public revoke all on functions from public, anon, authenticated;/i);
    expect(stripped.search(/alter default privileges/i)).toBeLessThan(stripped.search(/create table public\.leads/i));
  });

  it('the assertions script loops over EVERY table in public and checks pg_default_acl, so a forgotten table is caught', () => {
    for (const word of ["n.nspname = 'public' and c.relkind in ('r', 'p', 'v', 'm', 'f')", 'pg_default_acl', 'aclexplode', 'has_any_column_privilege', 'raise notice']) {
      expect(checks, word).toContain(word);
    }
  });
});

describe('0002_consent_records.sql (C-10, D-028)', () => {
  const sql2 = readFileSync('supabase/migrations/0002_consent_records.sql', 'utf8');
  const s2 = sql2.replace(/--.*$/gm, '');
  const checks2 = readFileSync('supabase/checks/0002_assertions.sql', 'utf8');

  it('creates notice_versions (id, version, sha256, text, created_at) and an append-only consent_events', () => {
    const notice = /create table public\.notice_versions \(([\s\S]*?)\n\);/.exec(s2)?.[1] ?? '';
    for (const col of ['id ', 'version ', 'sha256 ', '"text" ', 'created_at ', 'primary key (id, version)', "sha256 ~ '^[0-9a-f]{64}$'"]) expect(notice, col).toContain(col);
    expect(notice).toContain("sha256 = encode(sha256(convert_to(\"text\", 'UTF8')), 'hex')"); // the database re-computes the hash
    const consent = /create table public\.consent_events \(([\s\S]*?)\n\);/.exec(s2)?.[1] ?? '';
    for (const col of ['id ', 'lead_id ', 'notice_id ', 'notice_version ', 'notice_sha256 ', 'given ', 'channel ', 'created_at ']) expect(consent, col).toContain(col);
    expect(consent).not.toMatch(/references/i); // the evidence outlives the lead
    // N-4: no IP hash here (the leads row holds it and can be anonymised; consent evidence is append-only, so it must not carry one)
    expect(consent).not.toMatch(/ip_hash/i);
    expect(s2).not.toMatch(/consent_events.ip_hash/);
  });

  it('service_role may only select and insert; update, delete and truncate are refused by grants AND by triggers', () => {
    const grants = [...s2.matchAll(/grant ([a-z, ]+) on ([\w.]+)\s+to (\w+)/gi)];
    expect(grants).toHaveLength(2);
    for (const g of grants) {
      expect(g[3]).toBe('service_role');
      expect((g[1] as string).split(',').map((x) => x.trim()).sort()).toEqual(['insert', 'select']);
    }
    for (const t of ['notice_versions', 'consent_events']) {
      expect(s2).toContain(`create trigger ${t}_append_only`);
      expect(s2).toContain(`before update or delete on public.${t}`);
      expect(s2).toContain(`create trigger ${t}_no_truncate`);
      expect(s2).toContain(`before truncate on public.${t}`);
    }
    expect(s2).toMatch(/create or replace function app\.forbid_row_change\(\)[\s\S]*?set search_path = ''/);
    expect(s2).not.toMatch(/security definer/i);
  });

  it('documents every table and column', () => {
    for (const c of ['notice_versions.id', 'notice_versions.version', 'notice_versions.sha256', 'notice_versions."text"', 'consent_events.lead_id', 'consent_events.notice_id', 'consent_events.notice_version', 'consent_events.notice_sha256', 'consent_events.given', 'consent_events.channel']) {
      expect(sql2, c).toContain(`comment on column public.${c} is`);
    }
    for (const t of ['notice_versions', 'consent_events']) expect(sql2, t).toContain(`comment on table public.${t} is`);
  });

  it('its assertions script is read-only and checks append-only, grants, triggers and the hash constraint', () => {
    const body = checks2.replace(/--.*$/gm, '');
    expect(body).not.toMatch(/^\s*(insert into|update\s|delete from|drop\s|alter\s|create\s|grant\s|revoke\s|truncate\s)/im);
    for (const word of ["'notice_versions'", "'consent_events'", 'relrowsecurity', 'service_role', "'TRUNCATE'", '_append_only', '_no_truncate', 'notice_versions_sha256_matches', 'has_function_privilege']) {
      expect(checks2, word).toContain(word);
    }
    expect(checks2).toMatch(/ok: 0002_consent_records assertions passed/);
    // N-4: the script asserts that consent_events has NO ip_hash column
    expect(checks2).toContain('ip_hash');
    expect(checks2).toMatch(/information_schema.columns|pg_attribute/);
  });
});
