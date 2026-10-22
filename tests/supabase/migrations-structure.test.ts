// C-6: a STATIC structural check of every migration file (no database is available in M1: the first real run against the dev
// project is OT-03). It parses supabase/migrations/*.sql and asserts the D-005 rules for every `create table`, so a later
// migration that forgets row level security, a revoke or a grant is caught in CI before anyone applies it. The rules live in
// tests/supabase/migration-rules.ts and are also run against deliberately BROKEN samples below, to show that they can fail.
//
// Rules, for every table created in schema public:
//   1. `alter table ... enable row level security` appears AFTER the create statement;
//   2. a `revoke ... on <table> ... from` statement AFTER the create names anon AND authenticated for it;
//   3. every `grant` in the file goes to service_role only (never anon, authenticated or public, never "with grant option");
//   4. no policy applies to anon, authenticated or public.
// Plus: functions have a fixed search_path and their EXECUTE is revoked from the API roles; every migration has a numbered
// check script; the anon harness manifest lists every table.
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { MANIFEST } from '../../scripts/anon-harness.mjs';
import { checkMigration, statementsOf } from './migration-rules';

const DIR = 'supabase/migrations';
const files = readdirSync(DIR).filter((f) => f.endsWith('.sql')).sort();
const reports = files.map((file) => ({ file, sql: readFileSync(`${DIR}/${file}`, 'utf8'), ...checkMigration(readFileSync(`${DIR}/${file}`, 'utf8')) }));

describe('the statement splitter (so the structural checks can be trusted)', () => {
  it('splits on semicolons outside function bodies, strings and comments', () => {
    const sql = `-- a; comment\ncreate table public.a (x text default 'a;b');\ncreate function app.f() returns trigger as $$ begin x; y; end; $$;\nselect 1;`;
    expect(statementsOf(sql)).toEqual(["create table public.a (x text default 'a;b')", 'create function app.f() returns trigger as $$ begin x; y; end; $$', 'select 1']);
  });
});

describe('every migration file follows the D-005 rules', () => {
  it('is numbered 0001, 0002, ... without gaps, and each has a check script', () => {
    expect(files.length).toBeGreaterThanOrEqual(2);
    // ascending and unique, starting at 0001; a gap is allowed only for a migration that waits in supabase/proposed (none does now: 0003 was moved into the migrations)
    const numbers = files.map((f) => Number(f.slice(0, 4)));
    expect(numbers[0]).toBe(1);
    numbers.forEach((n, i) => {
      const previous = i === 0 ? 0 : (numbers[i - 1] as number);
      expect(n, files[i]).toBeGreaterThan(previous);
      for (let missing = previous + 1; missing < n; missing += 1) {
        const prefix = `${String(missing).padStart(4, '0')}_`;
        const proposed = existsSync('supabase/proposed') && readdirSync('supabase/proposed').some((p) => p.startsWith(prefix));
        expect(proposed, `migration ${prefix} is missing and is not in supabase/proposed`).toBe(true);
      }
    });
    for (const f of files) {
      const n = f.slice(0, 4);
      expect(existsSync(`supabase/checks/${n}_assertions.sql`), `supabase/checks/${n}_assertions.sql`).toBe(true);
      expect(readFileSync(`supabase/checks/${n}_assertions.sql`, 'utf8')).toMatch(new RegExp(`ok: ${n}_[a-z_]+ assertions passed`));
    }
  });

  for (const r of reports) {
    it(`${r.file}: RLS after create, revoke from anon + authenticated, grants to service_role only, no API-role policy, safe functions`, () => {
      // a migration creates tables, or at least views or functions (0006 is the api views and the admin RPCs), or alters a constraint (0003)
      expect(r.tables.length > 0 || /create (?:or replace )?(?:view|function)\b|alter table [a-z_.]+ add constraint\b/i.test(r.sql), `${r.file} creates nothing?`).toBe(true);
      expect(r.problems, r.file).toEqual([]);
    });
  }

  it('table names are unique and the anon harness lists every one of them', () => {
    const names = reports.flatMap((r) => r.tables);
    expect(new Set(names).size).toBe(names.length);
    expect(names.length).toBeGreaterThanOrEqual(8);
    // entries with a `schema` are api views (the read surface), not tables in public
    expect((MANIFEST as Array<{ name: string; schema?: string }>).filter((m) => !m.schema).map((m) => m.name).sort()).toEqual([...names].sort());
  });

  it('the first migration turns off default privileges for anon and authenticated in schema public, before its first table (S-16)', () => {
    const statements = statementsOf(reports[0]?.sql ?? '');
    for (const kind of ['tables', 'sequences', 'functions']) {
      const found = statements.some((s) => new RegExp(`^alter default privileges for role postgres in schema public revoke all on ${kind} from (?:public, )?anon, authenticated$`, 'i').test(s));
      expect(found, `0001 must run: alter default privileges ... revoke all on ${kind} from anon, authenticated`).toBe(true);
    }
    const firstTable = statements.findIndex((s) => /^create table\b/i.test(s));
    const lastDefault = Math.max(...statements.map((s, i) => (/^alter default privileges/i.test(s) ? i : -1)));
    expect(lastDefault).toBeGreaterThanOrEqual(0);
    expect(lastDefault).toBeLessThan(firstTable);
  });

  it('no migration touches the auth, storage or realtime schemas, and none creates a view in public (M1 has no public read)', () => {
    for (const r of reports) {
      for (const s of statementsOf(r.sql)) {
        expect(s, `${r.file}: ${s.slice(0, 80)}`).not.toMatch(/\b(?:auth|storage|realtime|vault)\.[a-z_]+/i);
        // views exist only in the read surface (schema api) and its internal helpers (schema app); never in public, never with `select *`
        if (/^create (?:or replace )?view/i.test(s)) {
          expect(s, `${r.file}: ${s.slice(0, 80)}`).toMatch(/^create (?:or replace )?view (?:api|app)\.[a-z_]+/i);
          expect(s, `${r.file}: view with select *`).not.toMatch(/\bselect\s+(?:distinct\s+)?\*|[a-z_]\.\*/i);
        }
      }
    }
  });
});

describe('the rules can fail: deliberately broken migrations are reported', () => {
  const good = `
    create table public.t (id uuid primary key);
    alter table public.t enable row level security;
    revoke all on table public.t from public, anon, authenticated;
    grant select, insert on public.t to service_role;`;

  it('a correct migration has no problems', () => {
    expect(checkMigration(good)).toEqual({ tables: ['t'], problems: [] });
  });

  it('no row level security', () => {
    const r = checkMigration(good.replace('alter table public.t enable row level security;', ''));
    expect(r.problems).toEqual(['public.t has no "enable row level security" after its create statement']);
  });

  it('row level security enabled BEFORE the table is created does not count', () => {
    const r = checkMigration(`alter table public.t enable row level security; ${good.replace('alter table public.t enable row level security;', '')}`);
    expect(r.problems.join(' ')).toContain('no "enable row level security"');
  });

  it('no revoke, a revoke missing authenticated, a revoke for another table', () => {
    expect(checkMigration(good.replace('revoke all on table public.t from public, anon, authenticated;', '')).problems).toHaveLength(1);
    expect(checkMigration(good.replace('from public, anon, authenticated', 'from public, anon')).problems).toEqual(['public.t has no revoke from anon, authenticated after its create statement']);
    expect(checkMigration(good.replace('revoke all on table public.t', 'revoke all on table public.other')).problems).toHaveLength(1);
  });

  it('a revoke naming several tables covers each of them', () => {
    const two = `create table public.a (id int); create table public.b (id int); alter table public.a enable row level security; alter table public.b enable row level security;
      revoke all on table public.a, public.b from public, anon, authenticated; grant select on public.a to service_role;`;
    expect(checkMigration(two).problems).toEqual([]);
  });

  it('grants to anon, authenticated, public, with grant option, or grant all are reported', () => {
    expect(checkMigration(`${good} grant select on public.t to anon;`).problems).toHaveLength(1);
    expect(checkMigration(`${good} grant select on public.t to authenticated, service_role;`).problems).toHaveLength(1);
    expect(checkMigration(`${good} grant select on public.t to public;`).problems).toHaveLength(1);
    expect(checkMigration(`${good} grant select on public.t to service_role with grant option;`).problems).toHaveLength(1);
    expect(checkMigration(`${good} grant all on public.t to service_role;`).problems.length).toBeGreaterThan(0);
  });

  it('a policy for anon, authenticated or public, or without a "to" clause, is reported', () => {
    expect(checkMigration(`${good} create policy p on public.t for select to anon using (true);`).problems).toHaveLength(1);
    expect(checkMigration(`${good} create policy p on public.t for select to authenticated using (true);`).problems).toHaveLength(1);
    expect(checkMigration(`${good} create policy p on public.t for select using (true);`).problems).toHaveLength(1);
    expect(checkMigration(`${good} create policy p on public.t for select to service_role using (true);`).problems).toEqual([]);
  });

  it('a table outside schema public or an unqualified table is reported', () => {
    expect(checkMigration('create table api.x (id int);').problems.join(' ')).toContain('not in schema public');
    expect(checkMigration('create table x (id int);').problems.join(' ')).toContain('schema-qualified');
  });

  it('a function without a fixed search_path or without the revoke is reported', () => {
    const fn = `create or replace function app.f() returns trigger language plpgsql set search_path = '' as $$ begin return new; end; $$; revoke all on function app.f() from public, anon, authenticated;`;
    expect(checkMigration(fn).problems).toEqual([]);
    expect(checkMigration(fn.replace("set search_path = ''", '')).problems).toEqual(['function app.f has no fixed search_path']);
    expect(checkMigration(fn.replace(' revoke all on function app.f() from public, anon, authenticated;', '')).problems).toEqual(['function app.f is not revoked from anon, authenticated']);
  });
});
