// Local restore drill (D-011 part 1, run on this PC): the same flow as .github/workflows/restore.yml, against the LOCAL throwaway PostgreSQL.
//
//   node scripts/pg-local.mjs start
//   node scripts/restore-drill.mjs            run the drill (never touches production: the data is generated here and is fictional)
//   node scripts/pg-local.mjs stop
//
// Flow: build a source database from the migrations + generated made-up rows, take `pg_dump --format=custom --no-owner`, encrypt it with a
// THROWAWAY age key and decrypt it again (only when the `age` and `age-keygen` programs are on PATH), `pg_restore` it into a fresh database,
// re-apply the erasure log, compare row counts table by table, run scripts/restore-drill.sql (RLS on, no API-role grants) and every file in
// supabase/checks. Both databases and the temp folder (in the system temp dir, never in the project) are removed at the end.
// If `age` is absent the drill uses the plain path and says so: ENCRYPTION IS THEN VERIFIED ONLY IN CI (restore.yml). Nothing is downloaded.
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { PG_BIN, PG_HOST, PG_PORT, ROOT, apply, binariesPresent, dropDb, isUp, psql, psqlFile } from './pg-local.mjs';
import { isMain } from './lib/is-main.mjs';

export const SRC_DB = 'psdrill_src';
export const DST_DB = 'psdrill_dst';

const pgExe = (name) => join(PG_BIN, `${name}.exe`);
const conn = ['-h', PG_HOST, '-p', String(PG_PORT), '-U', 'postgres', '-w'];

/** One line per public table: `name|count`, sorted. Used on the source and on the restored database; the two lists must be equal. */
export const COUNT_SQL = `select c.relname || '|' || (xpath('/row/c/text()', query_to_xml(format('select count(*) as c from public.%I', c.relname), false, true, '')))[1]::text
  from pg_class c join pg_namespace n on n.oid = c.relnamespace where n.nspname = 'public' and c.relkind = 'r' order by c.relname`;

/** Pure: split a psql -A -t listing into a name -> count map. */
export function parseCounts(text) {
  const out = {};
  for (const line of String(text).split(/\r?\n/)) {
    const m = /^([a-z_0-9]+)\|(\d+)$/.exec(line.trim());
    if (m) out[m[1]] = Number(m[2]);
  }
  return out;
}

/** Pure: tables whose counts differ (or that are missing on either side). Empty list = identical. */
export function diffCounts(source, restored) {
  const names = [...new Set([...Object.keys(source), ...Object.keys(restored)])].sort();
  return names.filter((n) => source[n] !== restored[n]).map((n) => `${n}: source ${source[n] ?? 'missing'}, restored ${restored[n] ?? 'missing'}`);
}

/** Is the age program (encrypt + keygen) available? Never downloads. */
export function findAge(run = spawnSync) {
  const ok = (cmd) => {
    const r = run(cmd, ['--version'], { encoding: 'utf8', windowsHide: true });
    return !r.error && r.status === 0;
  };
  return ok('age') && ok('age-keygen');
}

/** Fictional rows that exercise every kind of table the backup must carry (fixed fake values; no real person, phone or e-mail). */
export function madeUpDataSql() {
  const notice = 'Fictional notice text for a drill.';
  const sha = createHash('sha256').update(notice, 'utf8').digest('hex');
  return [
    `insert into public.notice_versions (id, version, sha256, "text") values ('lead-notice', 'v1', '${sha}', '${notice}')`,
    `insert into public.leads (id, ref_code, type, status, name, phone, consent_id, consent_version, consent_at, idempotency_key)
       values ('d1000000-0000-4000-8000-000000000001', 'PS-2026-DR1MM1', 'general', 'new', 'Drill Person One', '910000000001', 'lead-notice', 'v1', now(), 'd2000000-0000-4000-8000-000000000001'),
              ('d1000000-0000-4000-8000-000000000002', 'PS-2026-DR2MM2', 'coverage', 'lost', 'Drill Person Two', '910000000002', 'lead-notice', 'v1', now() - interval '30 months', 'd2000000-0000-4000-8000-000000000002')`,
    `insert into public.consent_events (lead_id, notice_id, notice_version, given) values ('d1000000-0000-4000-8000-000000000001', 'lead-notice', 'v1', true)`,
    `insert into public.events (name, page_path) values ('page_view', '/'), ('page_view', '/book/')`,
    `insert into public.outbound_clicks (go_slug) values ('drill-link')`,
    `insert into public.rate_limit_hits (bucket, key_hash) values ('ip', 'k.drill')`,
    `insert into public.daily_salts (day, salt) values (current_date, 'drillsalt')`,
    `insert into public.videos (youtube_id, title_raw) values ('drill-vid-1', 'Fictional Drill Title')`,
    `insert into public.suppression (kind, value, reason, created_by) values ('youtube_id', 'drill-gone-1', 'drill tombstone', 'drill-admin')`,
    `select app.audit('drill-admin', 'drill_action', 'drill', null, '{}'::jsonb, 'restore drill')`,
  ].join(';\n');
}

function must(res, what) {
  if (res.error) throw res.error;
  if (res.status !== 0) throw new Error(`${what} failed (exit ${res.status}): ${String(res.stderr ?? '').slice(0, 600)}`);
  return res;
}

const sh = (cmd, args, opts = {}) => spawnSync(cmd, args, { encoding: 'utf8', windowsHide: true, maxBuffer: 256 * 1024 * 1024, ...opts });

/** Runs the drill. Returns a report; throws on the first failed step. `log` receives progress lines. */
export function runDrill({ log = console.log, withAge = findAge() } = {}) {
  if (!binariesPresent() || !isUp()) throw new Error('The local PostgreSQL is not running: node scripts/pg-local.mjs start');
  const tmp = mkdtempSync(join(tmpdir(), 'ps-restore-drill-'));
  const report = { encrypted: withAge, steps: [], tables: 0 };
  const step = (s) => {
    report.steps.push(s);
    log(`restore drill: ${s}`);
  };
  try {
    dropDb(SRC_DB);
    dropDb(DST_DB);
    apply(SRC_DB, { quiet: true });
    must(psql(SRC_DB, madeUpDataSql()), 'made-up data');
    const sourceCounts = parseCounts(must(psql(SRC_DB, COUNT_SQL), 'source counts').stdout);
    report.tables = Object.keys(sourceCounts).length;
    step(`source database built with made-up data (${report.tables} tables)`);

    // dump: custom format, no owner, to a file in the temp folder (the plaintext dump holds made-up data only)
    const plain = join(tmp, 'drill.dump');
    must(sh(pgExe('pg_dump'), [...conn, '--format=custom', '--no-owner', '-f', plain, SRC_DB]), 'pg_dump');
    let restoreFrom = plain;
    if (withAge) {
      const keyFile = join(tmp, 'drill-key.txt');
      const keygen = must(sh('age-keygen', ['-o', keyFile]), 'age-keygen');
      const pub = /age1[0-9a-z]{58}/.exec(`${keygen.stderr}${keygen.stdout}`)?.[0];
      if (!pub) throw new Error('age-keygen printed no public key');
      const enc = join(tmp, 'drill.dump.age');
      must(sh('age', ['-r', pub, '-o', enc, plain]), 'age encrypt');
      rmSync(plain);
      const header = readFileSync(enc).subarray(0, 21).toString('latin1');
      if (header !== 'age-encryption.org/v1') throw new Error('the encrypted file is not an age file');
      restoreFrom = join(tmp, 'drill.dump.decrypted');
      must(sh('age', ['-d', '-i', keyFile, '-o', restoreFrom, enc]), 'age decrypt');
      step('dump encrypted with a throwaway age key and decrypted again');
    } else {
      step('age is not installed: PLAIN path used; encryption is verified only in CI (restore.yml)');
    }

    must(psql('postgres', `create database "${DST_DB}"`), 'create restore target');
    must(sh(pgExe('pg_restore'), [...conn, '--no-owner', '--exit-on-error', '-d', DST_DB, restoreFrom]), 'pg_restore');
    step('restored into a fresh database');

    const erasure = psqlFile(DST_DB, join(ROOT, 'scripts', 'restore-drill-erasure.sql'), { quiet: true });
    if (erasure.status !== 0) throw new Error(`erasure step failed: ${erasure.stderr}`);
    step('erasure_log step done');

    const restoredCounts = parseCounts(must(psql(DST_DB, COUNT_SQL), 'restored counts').stdout);
    const bad = diffCounts(sourceCounts, restoredCounts);
    if (bad.length > 0) throw new Error(`row counts differ after the restore: ${bad.join('; ')}`);
    if ((restoredCounts.leads ?? 0) < 2) throw new Error('the restored leads table is empty: the drill proves nothing');
    step('row counts equal on every table');

    const asserts = psqlFile(DST_DB, join(ROOT, 'scripts', 'restore-drill.sql'), { quiet: true });
    if (asserts.status !== 0 || !/ok: restore drill assertions passed/.test(asserts.stdout)) throw new Error(`restore assertions failed: ${asserts.stderr || asserts.stdout}`);
    step('RLS on and no anon or authenticated grants after the restore');

    const checksDir = join(ROOT, 'supabase', 'checks');
    for (const f of readdirSync(checksDir).filter((x) => x.endsWith('.sql')).sort()) {
      const r = psqlFile(DST_DB, join(checksDir, f), { quiet: true });
      if (r.status !== 0 || !/assertions passed/i.test(r.stdout)) throw new Error(`check ${f} failed on the restored database: ${r.stderr || r.stdout}`);
    }
    step('every supabase/checks file passes on the restored database');
    return report;
  } finally {
    dropDb(SRC_DB);
    dropDb(DST_DB);
    rmSync(tmp, { recursive: true, force: true });
  }
}

if (isMain(import.meta.url)) {
  try {
    const rep = runDrill();
    console.log(`restore drill: PASSED (${rep.steps.length} steps${rep.encrypted ? ', with encryption' : ', plain path: encryption verified only in CI'})`);
  } catch (err) {
    console.error(`restore drill: FAILED - ${String(err instanceof Error ? err.message : err)}`);
    process.exit(1);
  }
}
