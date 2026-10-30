import { readdirSync, readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { RLS_MATRIX } from '../../src/lib/admin/policy';
import { checkMigration, statementsOf } from '../supabase/migration-rules';

// RLS_MATRIX (src/lib/admin/policy.ts) must describe the real schema: every table the migrations create is in it, nothing else is, and the
// api views are exactly the views the migrations create. A new table in a migration without a matrix row fails here.
const DIR = 'supabase/migrations';
const sqls = readdirSync(DIR).filter((f) => f.endsWith('.sql')).sort().map((f) => readFileSync(`${DIR}/${f}`, 'utf8'));
const tables = sqls.flatMap((sql) => checkMigration(sql).tables).sort();
// a view re-created by a later migration (0012 re-creates api.public_players) is still ONE view
const views = [
  ...new Set(
    sqls
      .flatMap((sql) => statementsOf(sql))
      .map((s) => /^create (?:or replace )?view api\.([a-z_]+)/i.exec(s)?.[1])
      .filter((v): v is string => typeof v === 'string'),
  ),
].sort();
const matrixTables = Object.keys(RLS_MATRIX).filter((k) => !k.startsWith('api.')).sort();
const matrixViews = Object.keys(RLS_MATRIX).filter((k) => k.startsWith('api.')).map((k) => k.slice(4)).sort();

describe('RLS_MATRIX against the migrations', () => {
  it('finds the schema (so the test cannot pass on an empty parse)', () => {
    expect(tables.length).toBeGreaterThanOrEqual(30);
    expect(views.length).toBe(10); // 7 archive views + api.public_products (0011) + the two live views (0013)
  });
  it('has a row for every table the migrations create, and no row for a table that does not exist', () => {
    expect(tables.filter((t) => !matrixTables.includes(t)), 'tables missing from RLS_MATRIX').toEqual([]);
    expect(matrixTables.filter((t) => !tables.includes(t)), 'RLS_MATRIX rows without a table').toEqual([]);
  });
  it('lists exactly the api views of the migrations', () => {
    expect(matrixViews).toEqual(views);
  });
  it('treats every base table as private', () => {
    for (const t of tables) expect(RLS_MATRIX[t as keyof typeof RLS_MATRIX].private, t).toBe(true);
  });
});
