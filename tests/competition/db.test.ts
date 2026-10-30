// The competition schema (migration 0017) must not drift from src/lib/competition/db.ts and the engines: the api view columns, the
// vocabularies in the check constraints, the default ruleset, the house rules (RLS, revokes, service-role reads, locked-down owner RPCs)
// and the safe defaults (all switches off, nothing seeded). Static: reads the SQL text, no database (the database behaviour is
// supabase/checks/0017_assertions.sql). Pattern: tests/supabase/products-view.test.ts.
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
  COMPETITION_RPCS,
  COMPETITION_VIEW_COLUMNS,
  COMPETITION_VIEWS,
  DRAW_STATUSES,
  ENTRY_STATUSES,
  EVENT_FORMATS,
  EVENT_STATUSES,
  OUTBOX_STATUSES,
  PAYMENT_MODES,
  COMPETITION_AGE_GROUP_PATTERN,
  competitionErrorCode,
  isCompetitionAgeGroup,
  isJuniorAgeGroup,
  outboxPayloadProblem,
} from '../../src/lib/competition/db';
import { DEFAULT_RULESET } from '../../src/lib/competition/scoring';
import { MATCH_STATUSES } from '../../src/lib/competition/types';
import { checkMigration, statementsOf } from '../supabase/migration-rules';

const sql = readFileSync('supabase/migrations/0017_competition.sql', 'utf8').replace(/\r\n/g, '\n');
const checks = readFileSync('supabase/checks/0017_assertions.sql', 'utf8').replace(/\r\n/g, '\n');
const statements = statementsOf(sql);
/** The statements with whitespace collapsed (no comments), for exact phrase checks. */
const flat = statements.join(';\n');

/** Split on commas that are not inside parentheses or quotes. */
function splitTop(list: string): string[] {
  const out: string[] = [];
  let depth = 0;
  let quoted = false;
  let cur = '';
  for (const ch of list) {
    if (ch === "'") quoted = !quoted;
    if (!quoted && ch === '(') depth += 1;
    if (!quoted && ch === ')') depth -= 1;
    if (!quoted && depth === 0 && ch === ',') {
      out.push(cur.trim());
      cur = '';
    } else cur += ch;
  }
  if (cur.trim()) out.push(cur.trim());
  return out;
}

function viewColumns(name: string): string[] {
  const s = statements.find((x) => x.startsWith(`create view api.${name} `));
  expect(s, name).toBeDefined();
  expect(s, name).toMatch(new RegExp(`^create view api\\.${name} with \\(security_barrier = true\\) as select `));
  const select = /\bas select (.*?) from public\./.exec(s as string)?.[1];
  expect(select, name).toBeDefined();
  return splitTop(select as string).map((item) => {
    const alias = /\bas ([a-z0-9_]+)$/i.exec(item)?.[1];
    if (alias) return alias;
    const plain = /^(?:[a-z0-9_]+\.)?([a-z0-9_]+)$/i.exec(item)?.[1];
    expect(plain, `${name}: cannot read a column name from "${item}"`).toBeDefined();
    return plain as string;
  });
}

/** The values listed in a `<column> in ('a', 'b', ...)` check inside one create table statement. */
function checkValues(table: string, column: string): string[] {
  const s = statements.find((x) => x.startsWith(`create table public.${table} (`));
  expect(s, table).toBeDefined();
  const m = new RegExp(`\\b${column} in \\(([^)]*)\\)`).exec(s as string);
  expect(m, `${table}.${column}`).not.toBeNull();
  return [...(m as RegExpExecArray)[1]!.matchAll(/'([^']*)'/g)].map((x) => x[1] as string);
}

describe('migration 0017 competition: the public api views', () => {
  it('declares exactly the views the migration creates', () => {
    const created = statements.map((s) => /^create view api\.([a-z_]+)/.exec(s)?.[1]).filter(Boolean);
    expect([...created].sort()).toEqual([...COMPETITION_VIEWS].sort());
  });

  it.each(COMPETITION_VIEWS)('api.%s selects exactly the declared columns, in order, and is granted to the API roles', (name) => {
    expect(viewColumns(name)).toEqual([...COMPETITION_VIEW_COLUMNS[name]]);
    expect(sql).toContain(`grant select on api.${name} to anon, authenticated;`);
  });

  it('the check file asserts the same column lists against the database', () => {
    for (const name of COMPETITION_VIEWS) {
      const m = new RegExp(`'${name}', jsonb_build_array\\(([^)]*)\\)`).exec(checks);
      expect(m, name).not.toBeNull();
      expect([...(m as RegExpExecArray)[1]!.matchAll(/'([^']*)'/g)].map((x) => x[1])).toEqual([...COMPETITION_VIEW_COLUMNS[name]]);
    }
  });

  it('never uses select *, never exposes a player id, and names players only through the masked entry faces or the eligible check', () => {
    const views = statements.filter((s) => /^create view api\./.test(s));
    for (const v of views) {
      expect(v).not.toMatch(/select \*|\.\*/);
      expect(v).not.toMatch(/security_invoker/);
      expect(v).not.toMatch(/\bplayer[12]_id\b|\bage_status\b|\bphone\b|\bemail\b/);
      // a player's name or slug is only ever read behind a "named" decision
      for (const m of v.matchAll(/\bp[12]?\.(display_name|slug)\b/g)) {
        const before = v.slice(0, m.index);
        expect(before.endsWith('case when nm.named then ') || before.endsWith('case when n1.named then ') || before.endsWith('case when n2.named then '), v.slice(0, 60)).toBe(true);
      }
    }
    // the entry faces and the rankings decide "named" from app.eligible_players and the junior rule (D-012, fail closed)
    const faces = statements.find((s) => s.startsWith('create view app.competition_entry_faces')) as string;
    expect(faces).toContain('not pe.is_junior and exists (select 1 from app.eligible_players ep where ep.id = en.player1_id)');
    expect(faces).toContain('not pe.is_junior and exists (select 1 from app.eligible_players ep where ep.id = en.player2_id)');
    const events = statements.find((s) => s.startsWith('create view app.competition_public_events')) as string;
    expect(events).toContain('join app.public_tournament_ids pt on pt.id = e.tournament_id');
    expect(events).toContain("where e.status <> 'draft'");
    expect(events).toContain('(e.is_junior or t.is_minor_signal) as is_junior');
    const rankings = statements.find((s) => s.startsWith('create view api.public_competition_rankings')) as string;
    expect(rankings).toContain('exists (select 1 from app.eligible_players ep where ep.id = r.player_id)');
    expect(rankings).toContain('where s.published and nm.named and coalesce((select rp.on_now from app.competition_rankings_public rp), false)');
    expect(flat).toContain('create view app.competition_rankings_public as select cs.rankings_public as on_now from public.competition_settings cs where cs.id = 1');
  });

  it('shows only published draws and confirmed results', () => {
    const v = (name: string) => statements.find((s) => s.startsWith(`create view api.${name} `)) as string;
    expect(v('public_competition_draws')).toContain("where d.status in ('published', 'locked')");
    expect(v('public_competition_draw_slots')).toContain("where d.status in ('published', 'locked')");
    expect(v('public_competition_match_games')).toContain('where m.confirmed');
    expect(v('public_competition_matches')).toContain('case when m.confirmed then m.winner_side end as winner_side');
    expect(v('public_competition_matches')).toContain("then 'awaiting_result' else m.status end as status");
    const ids = statements.find((s) => s.startsWith('create view app.competition_public_match_ids')) as string;
    expect(ids).toContain("d.status in ('published', 'locked')");
  });
});

describe('migration 0017 competition: vocabularies match the engines and db.ts', () => {
  it('statuses, formats and codes', () => {
    expect(checkValues('competition_matches', 'status')).toEqual([...MATCH_STATUSES]);
    expect(checkValues('competition_matches', 'round_code')).toEqual(['F', 'SF', 'QF', 'R16', 'R32', 'R64', 'R128', '3P', 'group', 'league']);
    expect(checkValues('tournament_events', 'category')).toEqual(['MS', 'WS', 'MD', 'WD', 'XD', 'BS', 'GS', 'BD', 'GD']);
    expect(checkValues('tournament_events', 'format')).toEqual([...EVENT_FORMATS]);
    expect(checkValues('tournament_events', 'status')).toEqual([...EVENT_STATUSES]);
    expect(checkValues('event_entries', 'status')).toEqual([...ENTRY_STATUSES]);
    expect(checkValues('draws', 'status')).toEqual([...DRAW_STATUSES]);
    expect(checkValues('notification_outbox', 'status')).toEqual([...OUTBOX_STATUSES]);
    expect(checkValues('competition_settings', 'payment_mode')).toEqual([...PAYMENT_MODES]);
  });

  it('the SQL default ruleset is DEFAULT_RULESET', () => {
    const m = /select '(\{"gamesToWin"[^']*\})'::jsonb/.exec(sql);
    expect(m).not.toBeNull();
    expect(JSON.parse((m as RegExpExecArray)[1] as string)).toEqual({ ...DEFAULT_RULESET });
  });

  it('games are 0 to 30 points, best of five at most, and validated by the trigger against the event ruleset', () => {
    expect(flat).toContain('points_a smallint not null check (points_a between 0 and 30)');
    expect(flat).toContain('points_b smallint not null check (points_b between 0 and 30)');
    expect(flat).toContain('create trigger match_games_guard before insert or update or delete on public.match_games');
    expect(sql).toContain("if (p ->> 'pointCap')::integer not between v_ptw and 30 then");
  });

  it('reads error prefixes', () => {
    expect(competitionErrorCode('INVALID: the event is full')).toBe('INVALID');
    expect(competitionErrorCode('STALE: the match changed')).toBe('STALE');
    expect(competitionErrorCode('FORBIDDEN: the actor is not the owner')).toBe('FORBIDDEN');
    expect(competitionErrorCode('duplicate key value')).toBeNull();
    expect(competitionErrorCode('SUPPRESSED: x')).toBeNull();
  });
});

describe('migration 0017 competition: house rules and safe defaults', () => {
  it('passes the D-005 migration rules (RLS, revokes, service_role-only grants, fixed search_path, closed functions)', () => {
    const report = checkMigration(sql);
    expect(report.problems).toEqual([]);
    expect(report.tables.length).toBe(18);
  });

  it('every table: RLS on, everything revoked including service_role, then select for service_role only; no policy', () => {
    const tables = [...sql.matchAll(/^create table public\.([a-z_]+) \(/gm)].map((m) => m[1] as string);
    for (const t of tables) {
      expect(sql).toContain(`alter table public.${t} enable row level security;`);
      expect(sql).toContain(`revoke all on table public.${t} from public, anon, authenticated, service_role;`);
      expect(sql).toContain(`grant select on public.${t} to service_role;`);
      expect(sql).not.toMatch(new RegExp(`grant (insert|update|delete|all)[^;]*public\\.${t}\\b`, 'i'));
    }
    expect(sql).not.toMatch(/create policy/i);
  });

  it.each(COMPETITION_RPCS)('public.%s is SECURITY DEFINER, calls app.require_owner first, and only service_role may run it', (rpc) => {
    const s = statements.find((x) => x.startsWith(`create or replace function public.${rpc}(`)) as string;
    expect(s, rpc).toBeDefined();
    expect(s).toMatch(/returns jsonb language plpgsql security definer set search_path = '' as \$\$ declare .*? begin perform app\.require_owner\(p_actor\);/);
    const args = /^create or replace function public\.[a-z_]+\(([^)]*)\)/.exec(s)?.[1] as string;
    const types = args.split(',').map((a) => a.trim().split(' ')[1]).join(', ');
    expect(sql).toContain(`revoke all on function public.${rpc}(${types}) from public, anon, authenticated;`);
    expect(sql).toContain(`grant execute on function public.${rpc}(${types}) to service_role;`);
    expect(s).toMatch(/app\.audit\(p_actor, /);
  });

  it('the declared RPC list is every admin function of the migration', () => {
    const created = [...sql.matchAll(/^create or replace function public\.([a-z_]+)\(/gm)].map((m) => m[1]);
    expect(created.sort()).toEqual([...COMPETITION_RPCS].sort());
  });

  it('switches all default off, payments can only be manual, nothing but the settings row is seeded, profiles roles are untouched', () => {
    const settings = statements.find((s) => s.startsWith('create table public.competition_settings')) as string;
    for (const col of ['organizer_roles_enabled', 'player_accounts_enabled', 'registration_enabled', 'rankings_public']) {
      expect(settings).toContain(`${col} boolean not null default false`);
    }
    expect(settings).toContain("payment_mode text not null default 'off'");
    const inserts = statements.filter((s) => /^insert into /i.test(s));
    expect(inserts).toEqual(['insert into public.competition_settings (id) values (1)']);
    expect(sql).not.toMatch(/alter table public\.profiles|profiles_role_check/);
    expect(flat).toContain("is_official boolean not null default false check (not is_official)");
    expect(flat).toContain("constraint data_providers_enabled_needs_licence check (not enabled or (licence_status = 'licensed' and licence_ref is not null))");
  });

  it('the outbox holds references only, and the rally log is append-only and idempotent', () => {
    expect(flat).toContain('constraint notification_outbox_payload check ( app.competition_outbox_payload_ok(payload) )');
    expect(sql).toContain("lower(kv.key) ~ '(phone|mail|whatsapp|mobile|address|addr|contact|name|msisdn|recipient)'");
    expect(sql).toContain("(kv.value #>> '{}') !~ '[0-9]{7,}'");
    expect(flat).toContain('constraint notification_outbox_one_recipient check (num_nonnulls(recipient_lead_id, recipient_profile_id) = 1)');
    expect(flat).toContain('constraint notification_outbox_key_unique unique (idempotency_key)');
    expect(sql).toContain('create trigger match_score_events_append_only before update or delete on public.match_score_events for each row execute function app.forbid_row_change();');
    expect(flat).toContain('constraint match_score_events_key_unique unique (match_id, idempotency_key)');
  });

  it('the check file sets a real owner aside, rolls back, and ends with its ok line', () => {
    expect(checks).toContain("update public.profiles set role = 'editor' where role = 'owner';");
    expect(checks).toContain("raise exception 'ps_rollback';");
    expect(checks.trimEnd().endsWith("select 'ok: 0017_competition assertions passed' as result;")).toBe(true);
  });
});

describe('migration 0017 competition: wave 2 review fixes', () => {
  it('age groups: the SQL uses the canonical vocabulary, in the tables, the RPCs and the fail-closed junior test', () => {
    expect(sql).toContain(`select p is null or p ~ '${COMPETITION_AGE_GROUP_PATTERN}';`);
    expect(sql.split('check (app.competition_age_group_ok(age_group))').length - 1).toBe(2);
    expect(sql).not.toContain("'^[A-Za-z0-9_+-]{1,20}$'");
    expect(sql).not.toContain("age_group ~* '^U");
    // the junior flag is a stored column computed at write time on both tables; the public views read the column (no function call)
    expect(sql.split('generated always as (').filter((s) => s.includes('app.competition_age_is_junior(age_group)) stored')).length).toBe(2);
    expect(sql).toContain('(e.is_junior or t.is_minor_signal) as is_junior');
    expect(sql).toContain('  not s.is_junior\n');
    const views = sql.slice(sql.indexOf('create view'), sql.indexOf('-- Small shared checks for the RPCs'));
    expect(views).not.toContain('app.competition_age_is_junior(');
    // a protected player is left out of a public ranking, not shown as a masked row
    expect(views).toMatch(/where s\.published\n(?:\s*--[^\n]*\n)*\s*and nm\.named\n/);
    for (const ok of [null, 'U17', 'U21', '35+', 'senior', 'open', 'veterans', 'masters', 'sub_junior', 'junior', 'youth', 'cadet', 'mini']) {
      expect(isCompetitionAgeGroup(ok), String(ok)).toBe(true);
    }
    for (const bad of ['U-17', 'Under17', 'U17B', 'u17', '', 'Senior', 'U 17']) expect(isCompetitionAgeGroup(bad), bad).toBe(false);
  });

  it('junior detection fails closed', () => {
    for (const adult of [null, 'senior', 'open', 'veterans', 'masters', 'U20', 'U21', '19+', '35+']) expect(isJuniorAgeGroup(adult), String(adult)).toBe(false);
    for (const junior of ['U9', 'U13', 'U19', 'sub_junior', 'junior', 'youth', 'cadet', 'mini', '15+', 'U-17', 'Under17', 'U17B', 'whatever']) {
      expect(isJuniorAgeGroup(junior), junior).toBe(true);
    }
  });

  it('outbox payloads: references and codes only, at any depth and under any key', () => {
    expect(outboxPayloadProblem({ draw: 'ref', matchId: 'c0170000-0000-4000-8000-0000000000a0', round: 'SF', number: 3, on: '2026-10-30', final: true })).toBeNull();
    const phone = ['91', '0000', '000000'].join('');
    for (const bad of [
      { data: { phone } },
      { list: [phone] },
      { phone_number: 'x' },
      { Email: 'x' },
      { contact: 'x' },
      { wa: 'x' },
      { to: 'x' },
      { playerName: 'x' },
      { ref: phone },
      { ref: '+' + phone },
      { ref: Number(phone) },
      { ref: 'x' + phone },
      { ref: ['fake', 'example.com'].join('@') },
      { ref: 'Fake Person' },
      [],
      'x',
      null,
    ]) {
      expect(outboxPayloadProblem(bad), JSON.stringify(bad)).not.toBeNull();
    }
  });

  it('retirement before any rally is refused, like validateMatch', () => {
    expect(sql).toContain("raise exception 'INVALID: no rally was played: record this as a walkover, not a retirement'");
  });

  it('listed_no_player_pages tournaments link no player page (D-018)', () => {
    expect(flat).toContain("(t.visibility = 'listed_no_player_pages') as no_player_pages");
    expect(flat).toContain('case when n1.named and not pe.no_player_pages then p1.slug end as player1_slug');
    expect(flat).toContain('case when n2.named and not pe.no_player_pages then p2.slug end as player2_slug');
  });

  it('results need a match that is on and confirmed sides; matches take confirmed entries only', () => {
    expect(sql).toContain("if m.status not in ('scheduled', 'ready', 'live', 'paused', 'completed', 'walkover', 'retired', 'abandoned') then");
    expect(sql).toContain("(en.event_id <> v_event or en.status <> 'confirmed')");
    expect(sql).toContain("and not (p_record ->> 'status' = 'walkover' and en.status = 'withdrawn'");
  });

  it('the new rule functions are closed to the API roles and listed in the check file', () => {
    for (const fn of ['app.competition_age_group_ok(text)', 'app.competition_age_is_junior(text)', 'app.competition_outbox_payload_ok(jsonb)']) {
      expect(sql).toContain(`revoke all on function ${fn} from public, anon, authenticated;`);
      expect(checks).toContain(`'${fn}'`);
    }
  });
});
