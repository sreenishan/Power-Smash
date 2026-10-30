// Builds the two plain SQL files the OWNER pastes into the Supabase dashboard SQL editor (connect day, route A; no CLI, no database password):
//   tmp/supabase-dev/01-migrations.sql   every supabase/migrations/*.sql in order, to run ONCE (one paste is one implicit transaction: all or nothing)
//   tmp/supabase-dev/02-checks.sql       every supabase/checks/*.sql in order (read-only self-checks; a failed check stops the run with an error)
//
//   npm run sql:bundle [-- --out tmp/supabase-prod] [-- --from 0011]
//
// --from NNNN puts only the migrations from NNNN on into 01-migrations.sql, for a project that already has the earlier ones (the dev project
// had 0001..0010 on 2026-10-24). A paste is all or nothing: if a migration is already there, or an earlier one is missing, the run stops
// with an error and changes nothing. 02-checks.sql always holds every check (read-only), so it proves the whole schema.
//
// Why a script: each check file works alone, but five of them define the same session helper pg_temp.expect_fail. In ONE run the second
// plain CREATE FUNCTION fails ("already exists", seen on the first real run, 2026-10-24), so the bundle turns every pg_temp helper into
// CREATE OR REPLACE. The repository files themselves are never changed. tmp/ is git-ignored; the output holds no secret and no real data.
import { mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { isMain } from './lib/is-main.mjs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');

function readSql(dir) {
  return readdirSync(dir)
    .filter((f) => f.endsWith('.sql'))
    .sort()
    .map((f) => ({ file: f, text: readFileSync(join(dir, f), 'utf8').replace(/\r\n/g, '\n') }));
}

const header = (title, files, extra = '') =>
  `-- ${title}\n-- Generated from the repository files: ${files.map((x) => x.file.replace('.sql', '')).join(', ')}.\n` +
  '-- Paste into the Supabase dashboard SQL editor of the DEV project and press Run ONCE. Do not edit. Contains no secret.\n' +
  extra +
  '\n';

const body = (files, fix = (t) => t) => files.map((x) => `-- ===================== ${x.file} =====================\n${fix(x.text).trimEnd()}\n`).join('\n');

/** Session helpers (pg_temp.*) must be replaceable when several check files run in one session. */
export const replaceTempHelpers = (sql) => sql.replace(/\bcreate\s+function\s+pg_temp\./gi, 'create or replace function pg_temp.');

/**
 * @param {string} [root]
 * @param {{ from?: string | null }} [opts] from = a four-digit migration number: bundle only that migration and the later ones
 */
export function buildBundles(root = ROOT, { from = null } = {}) {
  if (from !== null && !/^\d{4}$/.test(from)) throw new Error(`--from must be a four-digit migration number such as 0011, not ${from}`);
  const all = readSql(join(root, 'supabase', 'migrations'));
  const migrations = from === null ? all : all.filter((m) => m.file.slice(0, 4) >= from);
  if (migrations.length === 0) throw new Error(`no migration from ${from} on`);
  const skipped = all.length - migrations.length;
  const checks = readSql(join(root, 'supabase', 'checks'));
  const migrationsSql =
    header('Power Smash database: migrations (apply in this order, ONCE)', migrations,
      skipped > 0
        ? `-- ONLY the migrations from ${from} on. The project must already have ${all[0].file.slice(0, 4)}..${all[skipped - 1].file.slice(0, 4)}. If one of these is already\n` +
          '-- applied, or an earlier one is missing, the run stops with an error and changes nothing (one paste is all or nothing).\n'
        : '') + body(migrations);
  const checksSql =
    header('Power Smash database: self-checks (read-only; fictional rows are rolled back)', checks,
      '-- Several check files define the same helper (pg_temp.expect_fail); here every one is CREATE OR REPLACE so they can share one run.\n' +
      '-- The editor shows only the LAST result row. Any failed check stops the whole run with an error, so a final row\n' +
      `-- "ok: ${checks.at(-1)?.file.replace('_assertions.sql', '') ?? ''} assertions passed" means every check passed.\n`) +
    body(checks, replaceTempHelpers);
  return { migrationsSql, checksSql, migrationFiles: migrations.map((m) => m.file), checkFiles: checks.map((c) => c.file) };
}

export function main(argv = process.argv.slice(2), log = console.log) {
  const i = argv.indexOf('--out');
  const out = resolve(ROOT, i > -1 && argv[i + 1] ? argv[i + 1] : join('tmp', 'supabase-dev'));
  const j = argv.indexOf('--from');
  const from = j > -1 ? (argv[j + 1] ?? '') : null;
  const { migrationsSql, checksSql, migrationFiles, checkFiles } = buildBundles(ROOT, { from });
  mkdirSync(out, { recursive: true });
  for (const [name, text] of [['01-migrations.sql', migrationsSql], ['02-checks.sql', checksSql]]) {
    writeFileSync(join(out, name), text);
    log(`${name}: ${Buffer.byteLength(text)} bytes, ${text.split('\n').length} lines, sha256 ${createHash('sha256').update(text).digest('hex').slice(0, 16)}`);
  }
  log(`${migrationFiles.length} migrations (${migrationFiles[0]} to ${migrationFiles.at(-1)}) and ${checkFiles.length} checks written to ${out}`);
  return 0;
}

if (isMain(import.meta.url)) process.exit(main());
