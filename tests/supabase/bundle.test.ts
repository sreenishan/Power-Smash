// The SQL bundles the owner pastes into the Supabase SQL editor (scripts/supabase-bundle.mjs). Built from the real repository files; no database needed.
import { describe, expect, it } from 'vitest';
import { readdirSync } from 'node:fs';
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
    expect(b.checksSql.trimEnd().endsWith("select 'ok: 0013_live_pin assertions passed' as result;")).toBe(true);
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
});
