// The SQL bundles the owner pastes into the Supabase SQL editor (scripts/supabase-bundle.mjs). Built from the real repository files; no database needed.
import { describe, expect, it } from 'vitest';
import { readdirSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { buildBundles, replaceTempHelpers } from '../../scripts/supabase-bundle.mjs';

const ROOT = resolve(__dirname, '../..');
const b = buildBundles(ROOT);

describe('supabase SQL bundles', () => {
  it('hold every migration and every check, in numeric order, each exactly once', () => {
    const migs = readdirSync(join(ROOT, 'supabase', 'migrations')).filter((f) => f.endsWith('.sql')).sort();
    const chks = readdirSync(join(ROOT, 'supabase', 'checks')).filter((f) => f.endsWith('.sql')).sort();
    expect(b.migrationFiles).toEqual(migs);
    expect(b.checkFiles).toEqual(chks);
    const order = (sql: string, files: string[]) => files.map((f) => sql.indexOf(`===================== ${f} =====================`));
    for (const [sql, files] of [[b.migrationsSql, migs], [b.checksSql, chks]] as const) {
      const at = order(sql, files);
      expect(at.every((n) => n >= 0)).toBe(true);
      expect([...at].sort((x, y) => x - y)).toEqual(at);
      for (const f of files) expect(sql.split(`===================== ${f} =====================`).length - 1).toBe(1);
    }
  });

  it('turn every session helper into CREATE OR REPLACE so five check files can share one run (the first real run failed on this)', () => {
    expect(b.checksSql).not.toMatch(/\bcreate\s+function\s+pg_temp\./i);
    expect((b.checksSql.match(/create or replace function pg_temp\.expect_fail/g) ?? []).length).toBeGreaterThanOrEqual(2);
    expect(replaceTempHelpers('create function pg_temp.x() returns void as $$ select 1 $$ language sql;')).toContain('create or replace function pg_temp.x');
    // the migrations are never rewritten, and a migration may not use a session helper
    expect(b.migrationsSql).not.toMatch(/pg_temp\./);
  });

  it('end with the last check\'s ok row, use LF only and carry no secret-shaped text, no psql meta-command and no role change', () => {
    expect(b.checksSql.trimEnd().endsWith("select 'ok: 0018_competition_admin assertions passed' as result;")).toBe(true);
    for (const sql of [b.migrationsSql, b.checksSql]) {
      expect(sql).not.toContain('\r');
      expect(sql).not.toMatch(/sb_secret_|AIza[0-9A-Za-z_-]{35}|-----BEGIN [A-Z ]*PRIVATE KEY|postgres(ql)?:\/\/[^\s:@/]+:[^\s@/]+@/i);
      expect(sql).not.toMatch(/^\\[a-z]/m); // psql meta-commands do not work in the SQL editor
      expect(sql).not.toMatch(/\b(create|alter|drop)\s+role\b/i);
    }
  });

  it('migrations manage no transaction and use no statement that cannot run inside one, so one paste is all-or-nothing', () => {
    expect(b.migrationsSql).not.toMatch(/^\s*(begin|commit|rollback)\s*;/im);
    expect(b.migrationsSql).not.toMatch(/\bconcurrently\b|alter\s+type\s+\S+\s+add\s+value|^\s*vacuum\b/im);
  });
  it('every check that adds a fake owner first sets a real owner aside (only one owner is allowed; the dev project has one)', () => {
    for (const file of b.checkFiles) {
      const text = readFileSync(join(ROOT, 'supabase', 'checks', file), 'utf8');
      const insert = text.indexOf("values (v_owner, 'owner'");
      if (insert === -1) continue;
      const aside = text.lastIndexOf("update public.profiles set role = 'editor' where role = 'owner';", insert);
      expect(aside, `${file} must set a real owner aside before inserting the fake owner`).toBeGreaterThan(-1);
      // in the same rolled-back block: no block end between the two, and the block ends in ps_rollback
      expect(text.slice(aside, insert), file).not.toMatch(/\n\s*end;?\n/);
      expect(text.indexOf("raise exception 'ps_rollback'", insert), file).toBeGreaterThan(insert);
    }
  });
  it('--from keeps only the later migrations (for a project that has the earlier ones), says so, and still bundles every check', () => {
    const later = buildBundles(ROOT, { from: '0011' });
    expect(later.migrationFiles[0]).toBe('0011_products.sql');
    expect(later.migrationFiles.every((f) => f.slice(0, 4) >= '0011')).toBe(true);
    expect(later.migrationsSql).not.toContain('0001_lead_funnel.sql =====');
    expect(later.migrationsSql).toContain('-- ONLY the migrations from 0011 on. The project must already have 0001..0010.');
    expect(later.checkFiles).toEqual(b.checkFiles);
    expect(b.migrationsSql).not.toContain('-- ONLY the migrations');
    expect(() => buildBundles(ROOT, { from: '11' })).toThrow('four-digit');
    expect(() => buildBundles(ROOT, { from: '9999' })).toThrow('no migration');
  });
});
