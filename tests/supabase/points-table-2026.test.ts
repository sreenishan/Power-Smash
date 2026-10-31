// The approved points table on the DEV project (supabase/demo/points-table-2026-dev.sql, D-129) and its removal through
// supabase/demo/competition-demo-remove.sql.
//  (a) Static: pastes into the SQL editor as it is (one transaction, one DO block, no psql meta-command), refuses until the marked
//      project-reference line is changed (before any write), no contact data or secret, and its table is APPROVED_POINTS_TABLE_2026.
//  (b) On the LOCAL PostgreSQL (skipped unless the server is up): every migration in a scratch database, a fake owner, the demo seed,
//      then this file: the stored table equals APPROVED_POINTS_TABLE_2026, the new published snapshot's ranks equal what the TS
//      ranking (rankingFromResults) works out from the same rows read back, a second run refuses, and the removal clears the demo
//      snapshots but keeps the approved table.
//  (c) A second scratch database with more made-up results: SQL equals TS on every rule (levels, window edges, best 6, league and
//      group, ties past the total), and the refusal when a confirmed knockout result does not fit its draw.
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { apply, binariesPresent, dropDb, isUp, psql, psqlFile } from '../../scripts/pg-local.mjs';
import { rankingFromResults } from '../../src/lib/admin/competition/ranking';
import type { ApprovedPointsTable, CompDrawRow, CompEntryRow, CompEventRow, CompMatchRow, CompPlayerRef, CompTournamentRef } from '../../src/lib/admin/competition/types';
import { APPROVED_POINTS_TABLE_2026 } from '../../src/lib/competition/points-table-2026';

const SEED_PATH = 'supabase/demo/competition-demo.sql';
const POINTS_PATH = 'supabase/demo/points-table-2026-dev.sql';
const REMOVE_PATH = 'supabase/demo/competition-demo-remove.sql';
const read = (p: string): string => readFileSync(new URL(`../../${p}`, import.meta.url), 'utf8').replace(/\r\n/g, '\n');
const SEED = read(SEED_PATH);
const POINTS = read(POINTS_PATH);
const REMOVE = read(REMOVE_PATH);
const REF_PLACEHOLDER = 'PASTE-THE-DEVELOPMENT-PROJECT-REFERENCE-HERE';
const REF_LINE = `c_development_project_ref constant text := '${REF_PLACEHOLDER}';`;
const FAKE_REF_LINE = "c_development_project_ref constant text := 'fakedevprojectref000';";
const RANKING_LABEL = "Demo men's singles ranking with the 2026 points table";
const DEMO_PREFIX = 'de000000-0000-4000-8000-';

const withoutComments = (sql: string): string => sql.replace(/--[^\n]*/g, '');
function topLevelStatements(sql: string): string[] {
  const collapsed = withoutComments(sql).replace(/\$([a-z_]*)\$[\s\S]*?\$\1\$/g, (_m, tag: string) => `$${tag}$`);
  return collapsed
    .split(';')
    .map((s) => s.trim().replace(/\s+/g, ' '))
    .filter((s) => s !== '');
}

describe('points-table-2026-dev.sql: static checks', () => {
  it('pastes into the SQL editor as it is: no psql meta-command, one transaction around one DO block', () => {
    expect(withoutComments(POINTS)).not.toMatch(/^\s*\\/m);
    expect(topLevelStatements(POINTS)).toEqual(['begin', expect.stringMatching(/^do \$[a-z]+\$$/), 'commit']);
  });

  it('holds no contact data, no secret and changes no role or privilege', () => {
    expect(POINTS).not.toMatch(/[A-Za-z0-9._%+-]+@[A-Za-z0-9-]+\.[A-Za-z]{2,}/);
    expect(POINTS).not.toMatch(/\d{7,}/);
    expect(POINTS).not.toMatch(/wa\.me|whatsapp|tel:|mailto:/i);
    expect(POINTS).not.toMatch(/eyJ[A-Za-z0-9_-]{10,}|sb_secret|sb_publishable|service_role|password/i);
    expect(withoutComments(POINTS)).not.toMatch(/\b(set (local )?role|set session|grant |revoke |alter role|alter table|create (or replace )?(function|table|view|role|policy))/i);
    // it writes only through the owner's functions
    expect(withoutComments(POINTS)).not.toMatch(/\b(insert into|update|delete from) public\./);
    for (const rpc of ['admin_set_ranking_points', 'admin_save_ranking_snapshot', 'admin_publish_ranking_snapshot']) expect(POINTS, rpc).toContain(`public.${rpc}(v_owner,`);
  });

  it('refuses until the owner types the development project reference into its one marked line, before any write', () => {
    expect(POINTS.split(REF_PLACEHOLDER).length - 1).toBe(3); // the header, the line itself, the check
    expect(POINTS).toContain(REF_LINE);
    const guard = POINTS.indexOf('this does not look like the development project');
    expect(guard).toBeGreaterThan(0);
    expect(guard).toBeLessThan(POINTS.indexOf('perform public.admin_'));
    expect(POINTS).toContain("select p.id::text into v_owner from public.profiles p where p.role = 'owner' limit 1;");
  });

  it('its table is exactly APPROVED_POINTS_TABLE_2026', () => {
    const literal = /\$table\$([\s\S]*?)\$table\$/.exec(POINTS)?.[1] ?? '{}';
    expect(JSON.parse(literal)).toEqual(APPROVED_POINTS_TABLE_2026);
  });

  it('the removal picks this ranking by its exact label and clears only the made-up demo points table', () => {
    expect(POINTS).toContain(`c_ranking_label constant text := '${RANKING_LABEL.replace("'", "''")}';`);
    expect(REMOVE).toContain(`c_ranking_label_2026 constant text := '${RANKING_LABEL.replace("'", "''")}';`);
    expect(REMOVE).toContain('where x.label = c_ranking_label or x.label = c_ranking_label_2026;');
    expect(withoutComments(REMOVE)).toMatch(/set ranking_points_table = null[^;]*where id = 1 and ranking_points_table ->> 'label' = c_points_label;/);
  });
});

// ------------------------------------------------------------------------------------------------ local PostgreSQL
const up = binariesPresent() && isUp();
const DB = 'pspoints2026';
const OWNER = '00000000-0000-4000-8000-0000000000f1';
const SCRATCH = up ? mkdtempSync(join(tmpdir(), 'pspoints2026-')) : '';
const SEED_DEV = up ? join(SCRATCH, 'competition-demo-dev.sql') : '';
const POINTS_DEV = up ? join(SCRATCH, 'points-table-2026-dev.sql') : '';
if (up) {
  writeFileSync(SEED_DEV, SEED.replace(REF_LINE, FAKE_REF_LINE));
  writeFileSync(POINTS_DEV, POINTS.replace(REF_LINE, FAKE_REF_LINE));
}

function sql(text: string, db: string = DB): string {
  const r = psql(db, text);
  if (r.status !== 0) throw new Error(r.stderr);
  return r.stdout.trim();
}
const json = <T>(query: string, db: string = DB): T => JSON.parse(sql(`select coalesce(jsonb_agg(x), '[]')::text from (${query}) x`, db)) as T;

/** The rows the admin reads, from the database, in the admin's shapes; then the TS ranking for one category and date. */
function tsRanking(asOf: string, db: string = DB): { playerId: string; rank: number; points: number; eventsCounted: number }[] {
  const q = <T>(query: string): T => json<T>(query, db);
  const tournaments = q<{ id: string; name: string; level: string | null; start_date: string | null; end_date: string | null; is_minor_signal: boolean | null; status: string }[]>(
    "select id, name, level, start_date, end_date, is_minor_signal, status from public.tournaments where status <> 'rejected'",
  ).map((r): CompTournamentRef => ({ id: r.id, name: r.name, level: r.level, startDate: r.start_date, endDate: r.end_date, minorSignal: r.is_minor_signal !== false || r.level === 'school_college', status: r.status }));
  const events = q<{ id: string; tournament_id: string; category: string; age_group: string | null; is_junior: boolean; format: string; status: string }[]>(
    'select id, tournament_id, category, age_group, is_junior, format, status from public.tournament_events order by created_at',
  ).map((r) => ({ id: r.id, tournamentId: r.tournament_id, category: r.category, ageGroup: r.age_group, isJunior: r.is_junior, format: r.format, status: r.status }) as unknown as CompEventRow);
  const draws = new Map<string, CompDrawRow>();
  for (const d of q<{ id: string; event_id: string; seed: number; status: string; published_at: string | null; slots: { position: number; entry_id: string | null; group_label: string | null }[] }[]>(
    `select d.id, d.event_id, d.seed, d.status, d.published_at,
            (select coalesce(jsonb_agg(jsonb_build_object('position', s.position, 'entry_id', s.entry_id, 'group_label', s.group_label) order by s.position), '[]') from public.draw_slots s where s.draw_id = d.id) as slots
       from public.draws d where d.status <> 'draft'`,
  )) {
    draws.set(d.event_id, { id: d.id, eventId: d.event_id, seed: d.seed, status: d.status, publishedAt: d.published_at, slots: d.slots.map((s) => ({ position: s.position, entryId: s.entry_id, group: s.group_label })) } as CompDrawRow);
  }
  const matches = q<{ id: string; event_id: string; round_code: string; match_number: number; group_label: string | null; side_a_entry: string | null; side_b_entry: string | null; status: string; winner_side: string | null; confirmed: boolean; revision: number }[]>(
    'select id, event_id, round_code, match_number, group_label, side_a_entry, side_b_entry, status, winner_side, confirmed, revision from public.competition_matches order by event_id, match_number',
  ).map((r) => ({ id: r.id, eventId: r.event_id, roundCode: r.round_code, matchNumber: r.match_number, groupLabel: r.group_label, sideA: r.side_a_entry, sideB: r.side_b_entry, scheduledAt: null, courtId: null, status: r.status, winnerSide: r.winner_side, confirmed: r.confirmed, revision: r.revision }) as unknown as CompMatchRow);
  const entries = q<{ id: string; event_id: string; player1_id: string; player2_id: string | null; seed: number | null; status: string }[]>(
    'select id, event_id, player1_id, player2_id, seed, status from public.event_entries order by created_at',
  ).map((r) => ({ id: r.id, eventId: r.event_id, players: r.player2_id ? [r.player1_id, r.player2_id] : [r.player1_id], seed: r.seed, status: r.status }) as CompEntryRow);
  const players = new Map(
    q<{ id: string; display_name: string; age_status: string }[]>('select id, display_name, age_status from public.players').map((r) => [r.id, { id: r.id, displayName: r.display_name, ageStatus: r.age_status, academy: null } as CompPlayerRef]),
  );
  const rankable = new Set(q<{ id: string }[]>('select id from app.competition_named_players').map((r) => r.id));
  const stored = JSON.parse(sql('select ranking_points_table::text from public.competition_settings where id = 1', db)) as Omit<ApprovedPointsTable, 'approvedAt'>;
  const table: ApprovedPointsTable = { ...stored, approvedAt: '2026-10-31T00:00:00.000Z' };
  return rankingFromResults({ category: 'MS', ageGroup: null, asOf, table, tournaments: new Map(tournaments.map((t) => [t.id, t])), events, draws, matches, entries, players, rankable }).rows;
}

// the scratch folder holds both databases' copies of the scripts: removed once, after every block
afterAll(() => {
  if (up) rmSync(SCRATCH, { recursive: true, force: true });
});

describe.skipIf(!up)('points-table-2026-dev.sql on the local PostgreSQL', () => {
  beforeAll(() => {
    dropDb(DB);
    apply(DB, { quiet: true });
    sql(`insert into public.profiles (id, role, display_name) values ('${OWNER}', 'owner', 'Fake Owner')`);
  }, 180_000);

  afterAll(() => {
    if (up) dropDb(DB);
  }, 60_000);

  it('refuses before the demo data is there, and refuses as it is in the repository (placeholder line)', () => {
    const noDemo = psqlFile(DB, POINTS_DEV, { quiet: true });
    expect(noDemo.status).not.toBe(0);
    expect(noDemo.stderr).toMatch(/the made-up competition data is not in this database/);
    const seed = psqlFile(DB, SEED_DEV, { quiet: true });
    expect(seed.status, seed.stderr).toBe(0);
    const asIs = psqlFile(DB, POINTS_PATH, { quiet: true });
    expect(asIs.status).not.toBe(0);
    expect(asIs.stderr).toMatch(/DEMO: this does not look like the development project/);
    expect(sql("select ranking_points_table ->> 'label' from public.competition_settings")).toBe('Demo points table (made up, dev only)');
  }, 180_000);

  it('installs the approved table and publishes a demo ranking whose ranks equal the TS ranking of the same rows', () => {
    const r = psqlFile(DB, POINTS_DEV, { quiet: true });
    expect(r.status, r.stderr).toBe(0);
    expect(r.stderr).toMatch(/approved points table installed and the demo ranking/);
    expect(JSON.parse(sql('select ranking_points_table::text from public.competition_settings where id = 1'))).toEqual(APPROVED_POINTS_TABLE_2026);
    expect(sql('select ranking_points_approved_by from public.competition_settings where id = 1')).toBe(OWNER);
    expect(Number(sql("select count(*) from public.audit_log where action = 'approve_ranking_points'"))).toBe(2); // the demo table, then this one
    const snap = json<{ id: string; as_of: string; published: boolean; category: string; age_group: string | null }[]>(
      `select id, as_of, published, category, age_group from public.ranking_snapshots where label = '${RANKING_LABEL.replace("'", "''")}'`,
    );
    expect(snap).toHaveLength(1);
    const s = snap[0]!;
    expect([s.published, s.category, s.age_group]).toEqual([true, 'MS', null]);
    const stored = json<{ playerId: string; rank: number; points: number; eventsCounted: number; name: string }[]>(
      `select r.player_id as "playerId", r.rank, r.points, r.events_counted as "eventsCounted", p.display_name as name
         from public.ranking_entries r join public.players p on p.id = r.player_id where r.snapshot_id = '${s.id}' order by r.rank, r.player_id`,
    );
    const ts = tsRanking(s.as_of);
    expect(stored.map(({ name: _n, ...row }) => row)).toEqual([...ts].sort((a, b) => a.rank - b.rank || (a.playerId < b.playerId ? -1 : 1)));
    // the demo results with the district row of the approved table: W 200, F 140, SF 100, QF 70; ties share, the next rank skips
    expect(stored.map((x) => [x.rank, x.points])).toEqual([[1, 200], [2, 140], [3, 100], [3, 100], [5, 70], [5, 70], [5, 70]]);
    expect(stored.every((x) => x.playerId.startsWith(DEMO_PREFIX) && x.name.startsWith('Demo '))).toBe(true);
    // for the lead to show the owner
    console.log(`points-table-2026 demo ranking:\n${stored.map((x) => `${x.rank}. ${x.name} ${x.points}`).join('\n')}`);
  }, 120_000);

  it('a second run refuses and changes nothing', () => {
    const before = sql('select count(*) from public.ranking_snapshots');
    const r = psqlFile(DB, POINTS_DEV, { quiet: true });
    expect(r.status).not.toBe(0);
    expect(r.stderr).toMatch(/already in this database, so this file has already run\. Nothing was changed/);
    expect(sql('select count(*) from public.ranking_snapshots')).toBe(before);
  }, 60_000);

  it('the demo seed refuses now: it would replace the approved table', () => {
    const r = psqlFile(DB, SEED_DEV, { quiet: true });
    expect(r.status).not.toBe(0);
    expect(r.stderr).toMatch(/already in this database|a ranking points table is already approved/);
  }, 60_000);

  it('the removal clears both demo rankings and the demo data but keeps the approved table', () => {
    expect(Number(sql("select count(*) from public.ranking_snapshots where label like 'Demo%'"))).toBe(2);
    const r = psqlFile(DB, REMOVE_PATH, { quiet: true });
    expect(r.status, r.stderr).toBe(0);
    expect(sql('select count(*) from public.ranking_snapshots')).toBe('0');
    expect(sql('select count(*) from public.ranking_entries')).toBe('0');
    expect(sql(`select count(*) from public.tournaments where id::text like '${DEMO_PREFIX}%'`)).toBe('0');
    expect(JSON.parse(sql('select ranking_points_table::text from public.competition_settings where id = 1'))).toEqual(APPROVED_POINTS_TABLE_2026);
    expect(sql('select ranking_points_approved_by from public.competition_settings where id = 1')).toBe(OWNER);
    expect(sql("select count(*) from pg_trigger where tgname like '%guard' and tgenabled <> 'O'")).toBe('0');
    // a second removal is harmless and still keeps the table
    const again = psqlFile(DB, REMOVE_PATH, { quiet: true });
    expect(again.status, again.stderr).toBe(0);
    expect(JSON.parse(sql('select ranking_points_table::text from public.competition_settings where id = 1'))).toEqual(APPROVED_POINTS_TABLE_2026);
    // and this file refuses without the demo data
    const after = psqlFile(DB, POINTS_DEV, { quiet: true });
    expect(after.status).not.toBe(0);
    expect(after.stderr).toMatch(/the made-up competition data is not in this database/);
  }, 120_000);
});

// ------------------------------------------------------------------------------------------------ local PostgreSQL: SQL against TS on more rules
// The demo data alone is one district knockout where every player has one result. This second scratch database adds made-up
// tournaments (all fictional, test only) so the SQL in the dev file and the TS ranking are compared on every rule: every level of the
// table, a School/college tournament (not counted), a round robin and a groups stage (all confirmed: 'league' and 'group'), one not
// fully confirmed (not counted), a result exactly on the window's first day (asOf - 363, counted) and one a day older (not counted), a
// player with 8 results (the best 6 count), and ties past the total (the better best result, then the more recent latest result).
// It also checks the refusal when a confirmed knockout result does not fit its draw.
const DB_X = 'pspoints2026x';
const X_PLAYERS = ['301', '302', '303', '304', '305', '306', '307', '308', '309', '310', '311', '312', '321', '322', '323', '324', '325', '326', '327'];
interface XTournament {
  suffix: string;
  level: string;
  /** the last day, in days from today (India) */
  endOffset: number;
  days?: number;
  format: 'knockout' | 'round_robin' | 'groups_knockout';
  /** knockout: [winner, final, semi-final, semi-final]; round robin and groups: the entries (groups: first half A, second half B) */
  entries: string[];
  /** leave the last match without a confirmed result (the event then does not count) */
  unfinished?: boolean;
}
const X_TOURNAMENTS: XTournament[] = [
  { suffix: '501', level: 'national', endOffset: -363, days: 2, format: 'knockout', entries: ['301', '302', '303', '304'] },
  { suffix: '502', level: 'open', endOffset: -364, format: 'knockout', entries: ['302', '301', '304', '303'] },
  { suffix: '503', level: 'zonal', endOffset: -30, format: 'knockout', entries: ['303', '304', '301', '302'] },
  { suffix: '504', level: 'state', endOffset: -40, format: 'knockout', entries: ['304', '303', '302', '301'] },
  { suffix: '505', level: 'corporate', endOffset: -50, format: 'knockout', entries: ['301', '305', '306', '307'] },
  { suffix: '506', level: 'veterans', endOffset: -60, format: 'knockout', entries: ['305', '301', '307', '306'] },
  { suffix: '507', level: 'other', endOffset: -70, format: 'knockout', entries: ['306', '307', '301', '305'] },
  { suffix: '508', level: 'district', endOffset: -80, format: 'knockout', entries: ['307', '306', '305', '301'] },
  { suffix: '509', level: 'open', endOffset: -90, format: 'knockout', entries: ['301', '308', '309', '310'] },
  { suffix: '510', level: 'school_college', endOffset: -20, format: 'knockout', entries: ['301', '302', '303', '304'] },
  { suffix: '511', level: 'state', endOffset: -100, format: 'round_robin', entries: ['308', '309', '310'] },
  { suffix: '512', level: 'zonal', endOffset: -110, format: 'groups_knockout', entries: ['311', '312', '308', '309'] },
  { suffix: '513', level: 'national', endOffset: -115, format: 'round_robin', entries: ['311', '312', '310'], unfinished: true },
  { suffix: '515', level: 'open', endOffset: -130, format: 'knockout', entries: ['321', '323', '322', '324'] },
  { suffix: '516', level: 'open', endOffset: -140, format: 'knockout', entries: ['325', '326', '322', '327'] },
];
// Worked out by hand from the D-129 table (the window, the best 6 and the levels):
//  301: 1000 national W, 350 zonal SF, 300 open W, 250 state SF, 150 corporate W, 105 veterans F (100 district SF and 50 other SF
//       not among the best 6; the School/college win not counted) = 2155;  302: 700 + 350 + 250 = 1300 (the open win a day outside
//       the window not counted);  303: 500 + 700 + 350 = 1550;  304: 500 + 490 + 500 = 1490;  305: 105 + 150 + 50 + 100 = 405;
//  306: 75 + 75 + 100 + 140 = 390;  307: 75 + 75 + 70 + 200 = 420;  308: 210 open F + 25 league + 35 group = 270;
//  309: 150 + 25 + 35 = 210;  310: 150 + 25 = 175 (the unfinished league not counted);  311 and 312: 35 group each (fully equal);
//  321 300 (130 days ago), 325 300 (140 days ago), 322 150 + 150 = 300: the same total, ranked 321, 325, 322;
//  323 210 (130 days ago), 326 210 (140 days ago), 309 210 (best 150): ranked 323, 326, 309.
const X_EXPECTED_POINTS: Record<string, number> = {
  '301': 2155, '302': 1300, '303': 1550, '304': 1490, '305': 405, '306': 390, '307': 420, '308': 270, '309': 210, '310': 175,
  '311': 35, '312': 35, '321': 300, '322': 300, '323': 210, '324': 150, '325': 300, '326': 210, '327': 150,
};
const xid = (suffix: string): string => `${DEMO_PREFIX}${suffix.padStart(12, '0')}`;

function extraDataSql(): string {
  const spec = JSON.stringify({ players: X_PLAYERS, tournaments: X_TOURNAMENTS });
  return `begin;
do $extra$
declare
  c_prefix constant text := '${DEMO_PREFIX}';
  c_reason constant text := 'Made-up extra results for the points table test (fictional)';
  v_spec constant jsonb := $spec$${spec}$spec$::jsonb;
  v_today date := (now() at time zone 'Asia/Kolkata')::date;
  v_owner text;
  v_adults uuid[] := '{}';
  v_pid uuid;
  p text;
  t jsonb;
  v_tid uuid;
  v_end date;
  v_event uuid;
  v_draw uuid;
  v_ids uuid[];
  v_n integer;
  v_slots jsonb;
  v_matches jsonb;
  mt jsonb;
  v_res jsonb;
  i integer;
  j integer;
begin
  select x.id::text into v_owner from public.profiles x where x.role = 'owner' limit 1;
  for p in select jsonb_array_elements_text(v_spec -> 'players') loop
    v_pid := (c_prefix || lpad(p, 12, '0'))::uuid;
    insert into public.players (id, display_name, name_normalized, identity_tier, age_status, is_provisional, created_source)
      values (v_pid, 'Demo Extra Player ' || p, 'demo extra player ' || p, 'multi_token', 'unknown', false, 'admin');
    v_adults := v_adults || v_pid;
  end loop;
  perform public.admin_set_age_status(v_owner, v_adults, 'adult_confirmed', 'Made-up test player (fictional)', c_reason);
  foreach v_pid in array v_adults loop
    perform public.admin_update_player(v_owner, v_pid, '{"visibility": "public"}'::jsonb, c_reason);
  end loop;

  for t in select value from jsonb_array_elements(v_spec -> 'tournaments') loop
    v_tid := (c_prefix || lpad(t ->> 'suffix', 12, '0'))::uuid;
    v_end := v_today + (t ->> 'endOffset')::integer;
    insert into public.tournaments (id, slug, name, series_key, edition_year, level, region, city, venue, start_date, end_date,
                                    categories, age_groups, status, source, visibility, is_minor_signal)
      values (v_tid, 'demo-extra-' || (t ->> 'suffix'), 'Demo Extra Cup ' || (t ->> 'suffix'), 'demo extra cup ' || (t ->> 'suffix'),
              extract(year from v_end)::smallint, t ->> 'level', 'tamil_nadu', 'Sampleville', 'Demo Extra Hall',
              v_end - coalesce((t ->> 'days')::integer, 1) + 1, v_end, array['MS'], '{}', 'completed', 'admin', 'public', false);
    v_n := jsonb_array_length(t -> 'entries');
    v_event := (public.admin_save_event(v_owner, null, jsonb_build_object('tournamentId', v_tid, 'category', 'MS', 'ageGroup', null,
      'format', t ->> 'format', 'ruleset', app.competition_default_ruleset(), 'capacity', v_n, 'status', 'open'), c_reason) ->> 'id')::uuid;
    v_ids := '{}';
    for i in 0 .. v_n - 1 loop
      v_ids := v_ids || (public.admin_add_entry(v_owner, v_event, jsonb_build_object(
        'players', jsonb_build_array(c_prefix || lpad(t -> 'entries' ->> i, 12, '0')), 'seed', null, 'status', 'confirmed'), c_reason) ->> 'id')::uuid;
    end loop;
    if t ->> 'format' = 'knockout' then
      -- slots: winner, semi-finalist, semi-finalist, finalist. SF 1: the winner beats a semi-finalist; SF 2: the finalist beats the
      -- other; the final: the winner beats the finalist.
      v_slots := jsonb_build_array(
        jsonb_build_object('position', 1, 'entryId', v_ids[1], 'group', null), jsonb_build_object('position', 2, 'entryId', v_ids[4], 'group', null),
        jsonb_build_object('position', 3, 'entryId', v_ids[3], 'group', null), jsonb_build_object('position', 4, 'entryId', v_ids[2], 'group', null));
      v_matches := jsonb_build_array(
        jsonb_build_object('r', 'SF', 'n', 1, 'a', v_ids[1], 'b', v_ids[4], 'g', null, 'w', 'A', 'c', true),
        jsonb_build_object('r', 'SF', 'n', 2, 'a', v_ids[3], 'b', v_ids[2], 'g', null, 'w', 'B', 'c', true),
        jsonb_build_object('r', 'F', 'n', 3, 'a', v_ids[1], 'b', v_ids[2], 'g', null, 'w', 'A', 'c', true));
    elsif t ->> 'format' = 'round_robin' then
      select jsonb_agg(jsonb_build_object('position', k, 'entryId', v_ids[k], 'group', null) order by k) into v_slots from generate_series(1, v_n) k;
      v_matches := '[]';
      for i in 1 .. v_n - 1 loop
        for j in i + 1 .. v_n loop
          v_matches := v_matches || jsonb_build_object('r', 'league', 'n', jsonb_array_length(v_matches) + 1, 'a', v_ids[i], 'b', v_ids[j], 'g', null, 'w', 'A', 'c', true);
        end loop;
      end loop;
    else
      select jsonb_agg(jsonb_build_object('position', k, 'entryId', v_ids[k], 'group', case when k <= v_n / 2 then 'A' else 'B' end) order by k)
        into v_slots from generate_series(1, v_n) k;
      v_matches := jsonb_build_array(
        jsonb_build_object('r', 'group', 'n', 1, 'a', v_ids[1], 'b', v_ids[2], 'g', 'A', 'w', 'A', 'c', true),
        jsonb_build_object('r', 'group', 'n', 2, 'a', v_ids[3], 'b', v_ids[4], 'g', 'B', 'w', 'B', 'c', true));
    end if;
    if coalesce((t ->> 'unfinished')::boolean, false) then
      v_matches := jsonb_set(v_matches, array[(jsonb_array_length(v_matches) - 1)::text, 'c'], 'false');
    end if;
    v_draw := (public.admin_save_draw(v_owner, v_event, jsonb_build_object('seed', 7000 + (t ->> 'suffix')::integer, 'slots', v_slots), c_reason) ->> 'id')::uuid;
    perform public.admin_publish_draw(v_owner, v_draw, c_reason);
    for mt in select value from jsonb_array_elements(v_matches) loop
      v_res := public.admin_save_match(v_owner, null, jsonb_build_object('eventId', v_event, 'roundCode', mt ->> 'r', 'matchNumber', mt -> 'n',
        'groupLabel', mt -> 'g', 'sideA', mt -> 'a', 'sideB', mt -> 'b', 'scheduledAt', null, 'courtId', null), null, c_reason);
      if (mt ->> 'c')::boolean then
        v_res := public.admin_record_result(v_owner, (v_res ->> 'id')::uuid, jsonb_build_object('status', 'completed',
          'games', case mt ->> 'w' when 'A' then '[{"a": 21, "b": 12}, {"a": 21, "b": 15}]'::jsonb else '[{"a": 13, "b": 21}, {"a": 17, "b": 21}]'::jsonb end,
          'walkoverWinner', null, 'retiringSide', null), (v_res ->> 'revision')::integer, c_reason);
        perform public.admin_confirm_result(v_owner, (v_res ->> 'id')::uuid, (v_res ->> 'revision')::integer, c_reason);
      end if;
    end loop;
  end loop;
end
$extra$;
commit;
`;
}

describe.skipIf(!up)('points-table-2026-dev.sql against the TS ranking on every rule (local PostgreSQL)', () => {
  const XFILE = up ? join(SCRATCH, 'extra-results.sql') : '';
  const RANKING_SQL = `select id, as_of from public.ranking_snapshots where label = '${RANKING_LABEL.replace("'", "''")}'`;

  beforeAll(() => {
    dropDb(DB_X);
    apply(DB_X, { quiet: true });
    sql(`insert into public.profiles (id, role, display_name) values ('${OWNER}', 'owner', 'Fake Owner')`, DB_X);
    const seed = psqlFile(DB_X, SEED_DEV, { quiet: true });
    if (seed.status !== 0) throw new Error(seed.stderr);
    writeFileSync(XFILE, extraDataSql());
    const extra = psqlFile(DB_X, XFILE, { quiet: true });
    if (extra.status !== 0) throw new Error(extra.stderr);
  }, 300_000);

  afterAll(() => {
    if (up) dropDb(DB_X);
  }, 60_000);

  it('refuses when a confirmed knockout result does not fit its draw, and changes nothing', () => {
    const final = `(select m.id from public.competition_matches m join public.tournament_events e on e.id = m.event_id where e.tournament_id = '${xid('501')}' and m.match_number = 3)`;
    // a local-only shortcut to make a bad row: the guard triggers are skipped for this one statement's session
    sql(`set session_replication_role = replica; update public.competition_matches set round_code = 'SF' where id = ${final}`, DB_X);
    const r = psqlFile(DB_X, POINTS_DEV, { quiet: true });
    sql(`set session_replication_role = replica; update public.competition_matches set round_code = 'F' where id = ${final}`, DB_X);
    expect(r.status).not.toBe(0);
    expect(r.stderr).toMatch(/DEMO: 1 confirmed knockout result\(s\) do not fit their draw/);
    expect(sql("select ranking_points_table ->> 'label' from public.competition_settings", DB_X)).toBe('Demo points table (made up, dev only)');
    expect(sql('select count(*) from public.ranking_snapshots', DB_X)).toBe('1');
  }, 120_000);

  it('the published ranking equals the TS ranking of the same rows, and the hand-worked points', () => {
    const r = psqlFile(DB_X, POINTS_DEV, { quiet: true });
    expect(r.status, r.stderr).toBe(0);
    const snap = json<{ id: string; as_of: string }[]>(RANKING_SQL, DB_X);
    expect(snap).toHaveLength(1);
    const stored = json<{ playerId: string; rank: number; points: number; eventsCounted: number }[]>(
      `select r.player_id as "playerId", r.rank, r.points, r.events_counted as "eventsCounted"
         from public.ranking_entries r where r.snapshot_id = '${snap[0]!.id}' order by r.rank, r.player_id`,
      DB_X,
    );
    const ts = tsRanking(snap[0]!.as_of, DB_X);
    expect(stored).toEqual([...ts].sort((a, b) => a.rank - b.rank || (a.playerId < b.playerId ? -1 : 1)));

    const by = new Map(stored.map((x) => [x.playerId, x]));
    for (const [suffix, points] of Object.entries(X_EXPECTED_POINTS)) expect(by.get(xid(suffix))?.points, suffix).toBe(points);
    // the best 6 of 8
    expect(by.get(xid('301'))?.eventsCounted).toBe(6);
    // the window: asOf - 363 counted (302's final at national level), asOf - 364 not (302's open win)
    expect(by.get(xid('302'))?.eventsCounted).toBe(3);
    // ties past the total: the better best result, then the more recent latest result; fully equal = the same rank
    const rank = (s: string): number => by.get(xid(s))!.rank;
    expect(rank('321')).toBeLessThan(rank('325'));
    expect(rank('325')).toBeLessThan(rank('322'));
    expect(rank('323')).toBeLessThan(rank('326'));
    expect(rank('326')).toBeLessThan(rank('309'));
    expect(rank('324')).toBeLessThan(rank('327'));
    expect(rank('311')).toBe(rank('312'));
    // the demo seed's players keep their district points
    expect(stored.filter((x) => Number(x.playerId.slice(-3)) < 300).map((x) => x.points)).toEqual([200, 140, 100, 100, 70, 70, 70]);
    console.log(`points-table-2026 wider ranking:\n${stored.map((x) => `${x.rank}. ${x.playerId.slice(-3)} ${x.points} (${x.eventsCounted})`).join('\n')}`);
  }, 120_000);
});
