// The made-up competition data for the DEV project (supabase/demo/competition-demo.sql) and its removal script
// (supabase/demo/competition-demo-remove.sql).
//  (a) Static: both files paste into the Supabase SQL editor as they are (no psql meta-commands, one transaction with one DO block),
//      hold no contact data or secret, every person and place is an obviously invented "Demo" name, and no demo name occurs in the
//      real-title fixtures.
//  (b) On the LOCAL PostgreSQL (skipped unless the server is up: `node scripts/pg-local.mjs start` first and `stop` afterwards):
//      every migration in a scratch database, a fake owner the way supabase/checks/0017_assertions.sql makes one, the seed, the six
//      api.public_competition_* views and api.public_tournaments read AS ANON with the provider's own column lists and order, the
//      rows fed to the page model, a second seed run refused, the removal refused while a non-demo row points at demo data, then the
//      removal: every competition table empty again, a pre-existing non-demo tournament and player untouched.
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { apply, binariesPresent, dropDb, isUp, psql, psqlFile } from '../../scripts/pg-local.mjs';
import { COMPETITION_VIEW_COLUMNS, COMPETITION_VIEWS, type CompetitionView } from '../../src/lib/competition/db';
import { buildCompetitionSite } from '../../src/lib/competition/public/model';
import { COMPETITION_TOURNAMENT_COLUMNS, type RawCompetitionData } from '../../src/lib/competition/public/provider';
import { COMPETITION_VIEW_ORDER } from '../../src/lib/competition/public/supabase-provider';

const SEED_PATH = 'supabase/demo/competition-demo.sql';
const REMOVE_PATH = 'supabase/demo/competition-demo-remove.sql';
const SEED = readFileSync(new URL(`../../${SEED_PATH}`, import.meta.url), 'utf8').replace(/\r\n/g, '\n');
const REMOVE = readFileSync(new URL(`../../${REMOVE_PATH}`, import.meta.url), 'utf8').replace(/\r\n/g, '\n');
const FILES: ReadonlyArray<readonly [string, string]> = [
  [SEED_PATH, SEED],
  [REMOVE_PATH, REMOVE],
];

/** The SQL with -- comments removed (dollar-quoted bodies kept). Good enough for these two files: no "--" inside a string. */
const withoutComments = (sql: string): string => sql.replace(/--[^\n]*/g, '');

/** The top-level statements: comments removed, each dollar-quoted body collapsed to its tag. */
function topLevelStatements(sql: string): string[] {
  const collapsed = withoutComments(sql).replace(/\$([a-z_]*)\$[\s\S]*?\$\1\$/g, (_m, tag: string) => `$${tag}$`);
  return collapsed
    .split(';')
    .map((s) => s.trim().replace(/\s+/g, ' '))
    .filter((s) => s !== '');
}

interface SpecPlayer {
  suffix: string;
  name: string;
  age: 'adult' | 'unknown' | 'minor_suspected';
}
interface Spec {
  tournaments: { name: string; slug: string; city: string; venue: string }[];
  players: SpecPlayer[];
  venues: { name: string; city: string }[];
}
const SPEC: Spec = JSON.parse(/\$spec\$([\s\S]*?)\$spec\$/.exec(SEED)?.[1] ?? '{}') as Spec;
const PROTECTED_NAMES = SPEC.players.filter((p) => p.age !== 'adult').map((p) => p.name);
const DEMO_PREFIX = 'de000000-0000-4000-8000-';
const REF_PLACEHOLDER = 'PASTE-THE-DEVELOPMENT-PROJECT-REFERENCE-HERE';
const REF_LINE = `c_development_project_ref constant text := '${REF_PLACEHOLDER}';`;

describe('competition demo SQL: static checks', () => {
  it('pastes into the SQL editor as it is: no psql meta-command, one transaction around one DO block', () => {
    for (const [path, sql] of FILES) {
      expect(withoutComments(sql), path).not.toMatch(/^\s*\\/m);
      expect(topLevelStatements(sql), path).toEqual(['begin', expect.stringMatching(/^do \$[a-z]+\$$/), 'commit']);
    }
  });

  it('holds no contact data and no secret', () => {
    for (const [path, sql] of FILES) {
      expect(sql, path).not.toMatch(/[A-Za-z0-9._%+-]+@[A-Za-z0-9-]+\.[A-Za-z]{2,}/);
      expect(sql, path).not.toMatch(/\d{7,}/);
      expect(sql, path).not.toMatch(/(?:\+?91[\s-]?)?[6-9]\d{4}[\s-]?\d{5}\b/);
      expect(sql, path).not.toMatch(/wa\.me|whatsapp|tel:|mailto:/i);
      expect(sql, path).not.toMatch(/eyJ[A-Za-z0-9_-]{10,}|sb_secret|sb_publishable|service_role|password/i);
      expect(sql, path).not.toMatch(/insert into public\.(tournament_private|leads|event_registrations|notify_subscribers|sponsor_contacts)/);
    }
  });

  it('every person, hall, city and tournament is an obviously invented Demo name; no real brand or real-title name', () => {
    expect(SPEC.players.length).toBeGreaterThanOrEqual(12);
    for (const p of SPEC.players) expect(p.name).toMatch(/^Demo [A-Z][a-z]+ [A-Z][a-z]+$/);
    for (const t of SPEC.tournaments) {
      expect(t.name).toMatch(/^Demo /);
      expect(t.slug).toMatch(/^demo-/);
      expect(t.venue).toMatch(/^Demo /);
      expect(['Sampleville', 'Fakenagar']).toContain(t.city);
    }
    for (const v of SPEC.venues) {
      expect(v.name).toMatch(/^Demo /);
      expect(['Sampleville', 'Fakenagar']).toContain(v.city);
    }
    for (const [path, sql] of FILES) expect(sql, path).not.toMatch(/power\s*smash/i);
    // no demo name (without the "Demo" word) is a name from the real YouTube titles kept in this private repo's fixtures
    const realTitles = readFileSync(new URL('../fixtures/real-titles.raw.json', import.meta.url), 'utf8').toLowerCase();
    for (const p of SPEC.players) expect(realTitles.includes(p.name.slice('Demo '.length).toLowerCase()), p.suffix).toBe(false);
  });

  it('the protected cases are there: unknown age, one minor_suspected, a junior event, a School/college tournament', () => {
    expect(SPEC.players.filter((p) => p.age === 'minor_suspected')).toHaveLength(1);
    expect(SPEC.players.filter((p) => p.age === 'unknown').length).toBeGreaterThanOrEqual(2);
    expect(SEED).toMatch(/"category": "BS", "ageGroup": "U15"/);
    expect(SEED).toMatch(/"level": "school_college",\s+"minor": true/);
  });

  it('the seed refuses until the owner types the development project reference into its one marked line', () => {
    expect(SEED.split(REF_PLACEHOLDER).length - 1).toBe(3); // the header, the line itself, the check
    expect(SEED).toContain(REF_LINE);
    expect(SEED).toMatch(/raise exception 'DEMO: this does not look like the development project/);
    // the guard comes before any write
    expect(SEED.indexOf('this does not look like the development project')).toBeLessThan(SEED.indexOf('public.admin_'));
    expect(SEED.indexOf('this does not look like the development project')).toBeLessThan(SEED.indexOf('insert into'));
  });

  it('seed and removal pick the halls and the ranking by the same rule', () => {
    for (const [path, sql] of FILES) {
      expect(sql, path).toContain("c_demo_cities constant text[] := array['Sampleville', 'Fakenagar'];");
      expect(sql, path).toContain("c_ranking_label constant text := 'Demo men''s singles ranking (made up)';");
      expect(sql, path).toContain("x.name like 'Demo %' and x.city = any (c_demo_cities)");
      expect(sql, path).toMatch(/ranking_snapshots x where x\.label = c_ranking_label/);
      expect(withoutComments(sql), path).not.toMatch(/label like 'Demo %'/);
    }
  });

  it('the seed writes through the owner RPCs with the real owner, refuses a second run, and changes no role or privilege', () => {
    for (const rpc of [
      'admin_save_event', 'admin_add_entry', 'admin_save_draw', 'admin_publish_draw', 'admin_save_match', 'admin_record_result',
      'admin_confirm_result', 'admin_save_venue', 'admin_save_court', 'admin_set_ranking_points', 'admin_save_ranking_snapshot',
      'admin_publish_ranking_snapshot', 'admin_set_age_status', 'admin_update_player',
    ]) {
      expect(SEED, rpc).toContain(`public.${rpc}(v_owner,`);
    }
    expect(SEED).toContain("select p.id::text into v_owner from public.profiles p where p.role = 'owner' limit 1;");
    expect(SEED).toMatch(/already in this database\. Nothing was added/);
    // the only direct writes: tournaments, players, the rankings switch (dev only)
    const direct = [...withoutComments(SEED).matchAll(/\b(insert into|update|delete from) (public\.[a-z_]+)/g)].map((m) => `${m[1]} ${m[2]}`);
    expect([...new Set(direct)].sort()).toEqual(['insert into public.players', 'insert into public.tournaments', 'update public.competition_settings']);
    for (const [path, sql] of FILES) {
      expect(withoutComments(sql), path).not.toMatch(/\b(set (local )?role|set session|grant |revoke |alter role|create (or replace )?(function|table|view|role|policy))/i);
    }
  });

  it('the removal deletes only demo rows, switches off only the six guards inside its transaction, and switches them back on', () => {
    const body = withoutComments(REMOVE);
    expect(body).toContain(`c_prefix constant text := '${DEMO_PREFIX}';`);
    expect(body).toMatch(/raise exception 'DEMO: nothing was removed/);
    expect(body).toContain("execute format('alter table %s disable trigger %I'");
    expect(body).toContain("execute format('alter table %s enable trigger %I'");
    expect(body).not.toMatch(/alter table (?!%s)/);
    for (const g of ['draws_guard', 'draw_slots_guard', 'competition_matches_guard', 'match_games_guard', 'ranking_snapshots_guard', 'ranking_entries_guard']) {
      expect(body, g).toContain(`'${g}'`);
    }
    expect(body).not.toMatch(/audit_log_append_only|match_score_events_append_only|delete from public\.(audit_log|match_score_events|profiles|competition_settings)/);
    // every delete is limited to an id list worked out above
    for (const m of body.matchAll(/delete from public\.[a-z_]+ x where ([^;]+);/g)) expect(m[1]).toMatch(/^x\.[a-z_]+ = any \(v_[a-z]+\)$/);
  });
});

// ------------------------------------------------------------------------------------------------ local PostgreSQL
const up = binariesPresent() && isUp();
const DB = 'pscompdemo';
const OWNER = '00000000-0000-4000-8000-0000000000f1';
const KEEP_TOURNAMENT = '00000000-0000-4000-8000-00000000c001';
const KEEP_PLAYER = '00000000-0000-4000-8000-00000000c002';
const COMPETITION_TABLES = [
  'tournament_events', 'event_entries', 'event_entry_players', 'draws', 'draw_slots', 'competition_matches', 'match_games',
  'match_score_events', 'courts', 'venues', 'ranking_snapshots', 'ranking_entries',
];

// the seed as the owner would run it on the development project: the marked line filled in (a scratch copy outside the project)
const SCRATCH = up ? mkdtempSync(join(tmpdir(), 'pscompdemo-')) : '';
const SEED_DEV_PATH = up ? join(SCRATCH, 'competition-demo-dev.sql') : '';
if (up) writeFileSync(SEED_DEV_PATH, SEED.replace(REF_LINE, "c_development_project_ref constant text := 'fakedevprojectref000';"));

function sql(text: string): string {
  const r = psql(DB, text);
  if (r.status !== 0) throw new Error(r.stderr);
  return r.stdout.trim();
}

/** The PostgREST order string of the provider ("a.asc,b.asc.nullslast") as SQL. */
function orderSql(order: string): string {
  return order
    .split(',')
    .map((part) => {
      const [col, dir, nulls] = part.split('.');
      return `${col} ${dir}${nulls === 'nullslast' ? ' nulls last' : nulls === 'nullsfirst' ? ' nulls first' : ''}`;
    })
    .join(', ');
}

/** Reads one api view as anon, with exactly the columns and order the Supabase provider asks for. */
function readView<T>(view: CompetitionView | 'public_tournaments', columns: readonly string[]): T[] {
  const r = psql(DB, `begin; set local role anon; select coalesce(jsonb_agg(x), '[]')::text from (select ${columns.join(', ')} from api.${view} order by ${orderSql(COMPETITION_VIEW_ORDER[view])}) x; rollback;`);
  expect(r.status, `${view}: ${r.stderr}`).toBe(0);
  const line = r.stdout.split(/\r?\n/).find((l) => l.startsWith('[')) ?? '';
  return JSON.parse(line) as T[];
}

function readAll(): RawCompetitionData & Record<CompetitionView, unknown[]> {
  const byView = Object.fromEntries(COMPETITION_VIEWS.map((v) => [v, readView(v, COMPETITION_VIEW_COLUMNS[v])])) as Record<CompetitionView, unknown[]>;
  const tournaments = readView<{ id: string }>('public_tournaments', COMPETITION_TOURNAMENT_COLUMNS).filter((t) => t.id.startsWith(DEMO_PREFIX));
  return {
    ...byView,
    tournaments: tournaments as unknown as RawCompetitionData['tournaments'],
    events: byView.public_competition_events as RawCompetitionData['events'],
    draws: byView.public_competition_draws as RawCompetitionData['draws'],
    slots: byView.public_competition_draw_slots as RawCompetitionData['slots'],
    matches: byView.public_competition_matches as RawCompetitionData['matches'],
    games: byView.public_competition_match_games as RawCompetitionData['games'],
    rankings: byView.public_competition_rankings as RawCompetitionData['rankings'],
    generatedAt: '2026-10-31T00:00:00.000Z',
  };
}

describe.skipIf(!up)('competition demo SQL on the local PostgreSQL', () => {
  beforeAll(() => {
    dropDb(DB);
    apply(DB, { quiet: true });
    // a fake owner, as supabase/checks/0017_assertions.sql makes one; a non-demo tournament and player that must survive
    sql(`insert into public.profiles (id, role, display_name) values ('${OWNER}', 'owner', 'Fake Owner');
         insert into public.tournaments (id, slug, name, series_key, edition_year, region, status, visibility)
           values ('${KEEP_TOURNAMENT}', 'fake-keep-open-2026', 'Fake Keep Open', 'fake keep open', 2026, 'tamil_nadu', 'published', 'public');
         insert into public.players (id, display_name, name_normalized, identity_tier) values ('${KEEP_PLAYER}', 'Fake Keep Player', 'fake keep player', 'multi_token');`);
  }, 180_000);

  afterAll(() => {
    if (up) {
      dropDb(DB);
      rmSync(SCRATCH, { recursive: true, force: true });
    }
  }, 60_000);

  it('the seed as it is in the repository (placeholder line unchanged) refuses and adds nothing', () => {
    const r = psqlFile(DB, SEED_PATH, { quiet: true });
    expect(r.status).not.toBe(0);
    expect(r.stderr).toMatch(/DEMO: this does not look like the development project/);
    expect(sql(`select count(*) from public.tournaments where id::text like '${DEMO_PREFIX}%'`)).toBe('0');
    expect(sql("select count(*) from public.audit_log where action like 'demo_%'")).toBe('0');
    expect(sql('select rankings_public from public.competition_settings')).toBe('f');
  }, 60_000);

  it('the removal on a database with no demo data changes nothing (rankings_public stays on, no audit row, no rebuild flag)', () => {
    sql('update public.competition_settings set rankings_public = true where id = 1');
    sql('update public.site_state set dirty = false, dirty_reason = null where id = 1');
    const r = psqlFile(DB, REMOVE_PATH, { quiet: true });
    expect(r.status, r.stderr).toBe(0);
    expect(r.stderr).toMatch(/no made-up competition data found in this database; nothing was changed/);
    expect(sql('select rankings_public from public.competition_settings')).toBe('t');
    expect(sql("select count(*) from public.audit_log where action like 'demo_%'")).toBe('0');
    expect(sql('select dirty from public.site_state')).toBe('f');
    sql('update public.competition_settings set rankings_public = false where id = 1');
  }, 60_000);

  it('the seed runs once and every public view the provider reads returns rows', () => {
    const r = psqlFile(DB, SEED_DEV_PATH, { quiet: true });
    expect(r.status, r.stderr).toBe(0);
    expect(r.stderr).toMatch(/DEMO: added 3 made-up tournaments/);
    const data = readAll();
    expect(data.tournaments).toHaveLength(3);
    for (const v of COMPETITION_VIEWS) expect(data[v].length, v).toBeGreaterThan(0);
    expect(data.events).toHaveLength(6);
    expect(data.matches).toHaveLength(27);
    expect(data.events.every((e) => typeof e.is_junior === 'boolean')).toBe(true);
    // the ranking: worked out from the confirmed results; the unknown-age player of that draw is left out, no gap, ties share
    expect(data.rankings.map((x) => [x.rank, x.points])).toEqual([[1, 200], [2, 140], [3, 100], [3, 100], [5, 60], [5, 60], [5, 60]]);
    // results: a walkover, a retirement, several completed; matches still to play
    const statuses = data.matches.map((m) => m.status);
    expect(statuses).toEqual(expect.arrayContaining(['completed', 'walkover', 'retired', 'scheduled']));
  }, 120_000);

  it('protected players are never named, and the junior and School/college events name nobody', () => {
    const data = readAll();
    const text = JSON.stringify(data);
    for (const name of PROTECTED_NAMES) expect(text.includes(name), name).toBe(false);
    const juniorEvents = new Set(data.events.filter((e) => e.is_junior).map((e) => e.id));
    expect(juniorEvents.size).toBe(2);
    const juniorDraws = new Set(data.draws.filter((d) => juniorEvents.has(d.event_id)).map((d) => d.id));
    const juniorSlots = data.slots.filter((s) => juniorDraws.has(s.draw_id));
    expect(juniorSlots.length).toBe(8);
    for (const s of juniorSlots) expect([s.player1_name, s.player2_name, s.player1_slug, s.player2_slug, s.is_protected]).toEqual([null, null, null, null, true]);
    for (const m of data.matches.filter((x) => juniorEvents.has(x.event_id))) {
      expect([m.side_a_player1_name, m.side_a_player2_name, m.side_b_player1_name, m.side_b_player2_name]).toEqual([null, null, null, null]);
    }
    // a protected single player: no name, flagged
    const masked = data.slots.filter((s) => !juniorDraws.has(s.draw_id) && s.is_protected);
    expect(masked.length).toBeGreaterThanOrEqual(3);
  }, 60_000);

  it('the page model builds every demo page from those rows', () => {
    const site = buildCompetitionSite(readAll(), { source: 'supabase' });
    expect(site.dropped).toEqual({ tournaments: 0, events: 0, rankingSnapshots: 0 });
    expect(site.tournaments.map((t) => t.slug).sort()).toEqual(['demo-lakeside-open', 'demo-riverside-championship', 'demo-schools-cup']);
    expect(site.tournaments.flatMap((t) => t.events)).toHaveLength(6);
    const lakeside = site.tournaments.find((t) => t.slug === 'demo-lakeside-open');
    const ms = lakeside?.events.find((e) => e.code === 'ms');
    expect(ms?.results).toHaveLength(7);
    expect(ms?.bracket?.map((r) => r.code)).toEqual(['QF', 'SF', 'F']);
    const bs = lakeside?.events.find((e) => e.code === 'bs-u15');
    expect(bs?.junior).toBe(true);
    expect(bs?.entries.flatMap((x) => x.players).every((p) => p.protected && p.name === null)).toBe(true);
    const school = site.tournaments.find((t) => t.slug === 'demo-schools-cup');
    expect(school?.events.every((e) => e.junior)).toBe(true);
    const riverside = site.tournaments.find((t) => t.slug === 'demo-riverside-championship');
    expect(riverside?.events.flatMap((e) => e.schedule).length).toBe(11);
    expect(site.rankings).toHaveLength(1);
    expect(site.rankings[0]?.items).toHaveLength(7);
  }, 60_000);

  it('running the seed again refuses and changes nothing', () => {
    const before = sql('select count(*) from public.competition_matches');
    const r = psqlFile(DB, SEED_DEV_PATH, { quiet: true });
    expect(r.status).not.toBe(0);
    expect(r.stderr).toMatch(/already in this database\. Nothing was added/);
    expect(sql('select count(*) from public.competition_matches')).toBe(before);
  }, 60_000);

  it('the removal refuses while a non-demo row points at demo data, and changes nothing', () => {
    sql(`insert into public.tournament_aliases (alias_normalized, tournament_id) values ('fake alias', '${DEMO_PREFIX}000000000101')`);
    const r = psqlFile(DB, REMOVE_PATH, { quiet: true });
    expect(r.status).not.toBe(0);
    expect(r.stderr).toMatch(/DEMO: nothing was removed.*tournament_aliases/);
    expect(sql(`select count(*) from public.tournaments where id::text like '${DEMO_PREFIX}%'`)).toBe('3');
    expect(sql("select count(*) from pg_trigger where tgname like '%guard' and tgenabled <> 'O'")).toBe('0');
    sql("delete from public.tournament_aliases where alias_normalized = 'fake alias'");
  }, 60_000);

  it('the removal takes away every demo row and nothing else; a second run is harmless', () => {
    expect(sql('select rankings_public from public.competition_settings')).toBe('t');
    for (let run = 0; run < 2; run += 1) {
      const r = psqlFile(DB, REMOVE_PATH, { quiet: true });
      expect(r.status, r.stderr).toBe(0);
    }
    for (const t of COMPETITION_TABLES) expect(sql(`select count(*) from public.${t}`), t).toBe('0');
    expect(sql(`select count(*) from public.players where id::text like '${DEMO_PREFIX}%' or display_name like 'Demo %'`)).toBe('0');
    expect(sql(`select count(*) from public.tournaments where id::text like '${DEMO_PREFIX}%' or slug like 'demo-%'`)).toBe('0');
    expect(sql(`select count(*) from public.tournaments where id = '${KEEP_TOURNAMENT}'`)).toBe('1');
    expect(sql(`select count(*) from public.players where id = '${KEEP_PLAYER}'`)).toBe('1');
    expect(sql("select rankings_public::text || ' ' || coalesce(ranking_points_table::text, 'none') from public.competition_settings")).toBe('false none');
    expect(sql("select count(*) from pg_trigger where tgname like '%guard' and tgenabled <> 'O'")).toBe('0');
    // the audit log is append-only: the seed's rows stay, the first removal adds one, the second (nothing left) adds none
    expect(Number(sql("select count(*) from public.audit_log where action = 'demo_competition_remove'"))).toBe(1);
    // the owner then switches rankings on deliberately: a stray removal (nothing demo left) must not switch it off from the old seed row
    sql('update public.competition_settings set rankings_public = true where id = 1');
    const stray = psqlFile(DB, REMOVE_PATH, { quiet: true });
    expect(stray.status, stray.stderr).toBe(0);
    expect(sql('select rankings_public from public.competition_settings')).toBe('t');
    expect(Number(sql("select count(*) from public.audit_log where action = 'demo_competition_remove'"))).toBe(1);
    // the seed can run again after a removal; it records rankings_public = true as the value to restore, and the removal restores it
    const again = psqlFile(DB, SEED_DEV_PATH, { quiet: true });
    expect(again.status, again.stderr).toBe(0);
    expect(sql("select diff ->> 'rankings_public_before' from public.audit_log where action = 'demo_competition_seed' order by id desc limit 1")).toBe('true');
    const removeAgain = psqlFile(DB, REMOVE_PATH, { quiet: true });
    expect(removeAgain.status, removeAgain.stderr).toBe(0);
    expect(sql('select rankings_public from public.competition_settings')).toBe('t');
  }, 120_000);
});
