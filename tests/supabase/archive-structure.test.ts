// Static structural rules for the archive migrations (0004-0006), on top of the generic D-005 rules of migrations-structure.test.ts:
// the exposed surface, the private-column list, the grants matrix, the RPC shape, and the protected-player rules in the SQL text.
// The SQL itself is executed by supabase/checks/0004..0006_assertions.sql against the local PostgreSQL (tests/supabase/local-pg.test.mjs).
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { ADMIN_RPCS, API_VIEWS, API_VIEW_COLUMNS } from '../../src/lib/archive/types';
import { statementsOf } from './migration-rules';

const read = (f: string) => readFileSync(`supabase/migrations/${f}`, 'utf8');
const F4 = read('0004_archive_core.sql');
const F5 = read('0005_archive_safety.sql');
const F6 = read('0006_archive_api.sql') + '\n' + read('0009_archive_purge.sql');
const S4 = statementsOf(F4);
const S5 = statementsOf(F5);
const S6 = statementsOf(F6);
const flat = (s: string) => s.replace(/\s+/g, ' ');

/** Columns that must never appear in a public view (personal data, evidence, internals). */
const PRIVATE_COLUMNS = [
  'description', 'organizer_phone', 'organizer_email', 'phone', 'email', 'age_signal', 'age_confirmed_by', 'age_confirmed_at', 'age_confirmed_evidence',
  'age_status', 'name_normalized', 'name_key', 'latin_key', 'parse_result', 'hard_flags', 'review_reasons', 'manual_override', 'merged_into',
  'is_provisional', 'consent_at', 'consent_notice_id', 'consent_notice_version', 'etag', 'minor_hold', 'identity_tier', 'link_policy', 'resolution',
  'ip_hash', 'delivery_url', 'created_by', 'actor', 'reason', 'diff',
];

/** Problems with one `create view api.x` statement (empty = fine). Pure, so it can be shown to fail. */
export function viewProblems(statement: string): string[] {
  const problems: string[] = [];
  const name = /^create (?:or replace )?view (api\.[a-z_]+)/i.exec(statement)?.[1] ?? '?';
  if (/\bselect\s+(?:distinct\s+)?\*|[a-z_]\.\*/i.test(statement)) problems.push(`${name}: select * or alias.*`);
  if (!/with \(security_barrier = true\)/i.test(statement)) problems.push(`${name}: not a security_barrier view`);
  if (/security_invoker/i.test(statement)) problems.push(`${name}: security_invoker would need grants on the private tables`);
  const selectList = /\bas select (.*?) from /i.exec(statement)?.[1] ?? '';
  for (const col of PRIVATE_COLUMNS) {
    // a private column name as the OUTPUT name (the alias, or the bare column) is what leaks; it may be read inside a case expression
    const outputs = selectList.split(/,(?![^()]*\))/).map((x) => (/\bas ([a-z_]+)\s*$/i.exec(x.trim())?.[1] ?? /(?:^|\.)([a-z_]+)\s*$/i.exec(x.trim())?.[1] ?? ''));
    if (outputs.includes(col)) problems.push(`${name}: exposes the private column ${col}`);
  }
  return problems;
}

describe('the public read surface (schema api)', () => {
  const views = S6.filter((s) => /^create view api\./i.test(s));

  it('is exactly the seven views of API_VIEWS, and nothing else is created in schema api', () => {
    expect(views).toHaveLength(7);
    expect(views.map((s) => /^create view api\.([a-z_]+)/i.exec(s)?.[1]).sort()).toEqual([...API_VIEWS].sort());
    for (const s of [...S4, ...S5, ...S6]) {
      expect(s, s.slice(0, 80)).not.toMatch(/^create (?:or replace )?(?:table|function|materialized view) api\./i);
    }
  });

  for (const v of views) {
    it(`${/^create view (api\.[a-z_]+)/i.exec(v)?.[1]}: explicit columns, no private column, security_barrier, no security_invoker`, () => {
      expect(viewProblems(v)).toEqual([]);
    });
  }

  it('no column list names a private column (TS lists)', () => {
    for (const [view, cols] of Object.entries(API_VIEW_COLUMNS)) {
      for (const c of cols) expect(PRIVATE_COLUMNS, `${view}.${c}`).not.toContain(c);
    }
  });

  it('only the seven views and usage on schema api are granted to the API roles, and nothing in schema app', () => {
    const grants = [...S4, ...S5, ...S6].filter((s) => /^grant\b/i.test(s));
    const toApi = grants.filter((s) => /\bto\b[^;]*\b(?:anon|authenticated|public)\b/i.test(s));
    expect(toApi.sort()).toEqual(
      [
        'grant usage on schema api to anon, authenticated',
        ...API_VIEWS.map((v) => `grant select on api.${v} to anon, authenticated`),
      ].sort(),
    );
    for (const s of grants) expect(s, s).not.toMatch(/schema app\b.*\bto\b.*\b(?:anon|authenticated)\b/i);
    expect(flat(F6)).toContain('revoke all on all tables in schema app from public, anon, authenticated');
  });

  it('the helper logic lives in internal views of schema app, not in functions the API roles would have to execute', () => {
    const internal = S6.filter((s) => /^create view app\./i.test(s)).map((s) => /^create view app\.([a-z_]+)/i.exec(s)?.[1]);
    expect(internal.sort()).toEqual(['eligible_players', 'public_tournament_ids', 'suppressed_keys', 'video_mode']);
    // PostgreSQL checks EXECUTE on functions called inside a view against the calling role: an api view must call no app function
    for (const v of views) expect(v, v.slice(0, 40)).not.toMatch(/\bapp\.[a-z_]+\(/i);
  });

  it('the shown view problems really fail on broken samples', () => {
    const good = 'create view api.public_x with (security_barrier = true) as select a.id, a.name from public.x a where a.ok';
    expect(viewProblems(good)).toEqual([]);
    expect(viewProblems(good.replace('a.id, a.name', '*'))).toContain('api.public_x: select * or alias.*');
    expect(viewProblems(good.replace('a.id, a.name', 'a.*'))).toContain('api.public_x: select * or alias.*');
    expect(viewProblems(good.replace('a.id, a.name', 'a.id, a.organizer_phone'))).toContain('api.public_x: exposes the private column organizer_phone');
    expect(viewProblems(good.replace('a.id, a.name', 'a.id, a.description as description'))).toContain('api.public_x: exposes the private column description');
    expect(viewProblems(good.replace('with (security_barrier = true) ', ''))).toContain('api.public_x: not a security_barrier view');
    expect(viewProblems(good.replace('security_barrier = true', 'security_invoker = true'))).toHaveLength(2);
    // reading a private column inside a case (masking) is fine
    expect(viewProblems(good.replace('a.id, a.name', "a.id, case when a.age_status = 'x' then 1 else 0 end as flag"))).toEqual([]);
  });
});

describe('grants matrix (private tables: service_role only, exact privileges)', () => {
  const expected: Record<string, string> = {
    videos: 'select, insert, update',
    video_title_history: 'select, insert',
    tournaments: 'select, insert, update',
    tournament_private: 'select, insert, update, delete',
    tournament_aliases: 'select, insert, update, delete',
    players: 'select, insert, update',
    player_aliases: 'select, insert, update',
    matches: 'select, insert, update',
    match_participants: 'select, insert, update, delete',
    slug_redirects: 'select, insert, update, delete',
    sync_runs: 'select, insert, update',
    archive_settings: 'select, insert, update',
    site_state: 'select, update',
    audit_log: 'select, insert',
    suppression: 'select, insert, update',
  };
  const grants = [...S4, ...S5].filter((s) => /^grant (?:select|insert|update|delete)/i.test(s));
  for (const [table, privs] of Object.entries(expected)) {
    it(`public.${table}: ${privs}`, () => {
      const mine = grants.filter((s) => new RegExp(`^grant [a-z, ]+ on public\\.${table} to `, 'i').test(s));
      expect(mine, table).toHaveLength(1);
      expect(mine[0]).toBe(`grant ${privs} on public.${table} to service_role`);
    });
  }
  it('nobody can delete a video, tournament, player, match, alias, suppression or audit row (tombstones, append-only)', () => {
    for (const t of ['videos', 'tournaments', 'players', 'player_aliases', 'matches', 'suppression', 'audit_log', 'site_state']) {
      expect(expected[t], t).not.toMatch(/delete/);
    }
  });
});

describe('admin RPCs', () => {
  const fns = S6.filter((s) => /^create (?:or replace )?function public\.admin_/i.test(s));
  it('every admin RPC is SECURITY DEFINER with a fixed search_path, audits, marks the site dirty, and is executable by service_role only', () => {
    expect(fns).toHaveLength(ADMIN_RPCS.length);
    for (const s of fns) {
      const name = /function public\.([a-z_]+)\(/i.exec(s)?.[1] as string;
      expect(s, name).toMatch(/security definer/i);
      expect(s, name).toMatch(/set search_path = ''/i);
      expect(s, name).toMatch(/app\.audit\(/);
      expect(s, name).toMatch(/app\.mark_dirty\(/);
      const sig = new RegExp(`(?:revoke|grant) (?:all|execute) on function public\\.${name}\\(([^)]*)\\) (?:from|to) ([a-z_, ]+)`, 'gi');
      const rules = [...flat(F6).matchAll(sig)].map((m) => `${m[0].split(' ')[0]} ${m[2]}`);
      expect(rules.sort(), name).toEqual(['grant service_role', 'revoke public, anon, authenticated']);
    }
  });
  it('a plain admin RPC cannot be reached without the actor id: every body calls app.audit, which refuses an empty actor', () => {
    expect(flat(F6)).toContain("raise exception 'an admin action needs the verified actor id'");
  });
  it('merge refuses a minor/adult mix without the override, merges to the stricter status, and refuses suppressed players', () => {
    const merge = fns.find((s) => /admin_merge_players/.test(s)) as string;
    expect(merge).toMatch(/p_override_age/);
    expect(merge).toMatch(/age_rank\(a\.age_status\) >= app\.age_rank\(b\.age_status\)/);
    expect(merge).toMatch(/is_suppressed\('player_id'/);
    expect(merge).toMatch(/insert into public\.slug_redirects/);
  });
  it('emergency hide records the tombstone, hides, locks, marks the site urgent and returns the owner checklist', () => {
    const hide = fns.find((s) => /admin_emergency_hide/.test(s)) as string;
    expect(hide).toMatch(/insert into public\.suppression/);
    expect(hide).toMatch(/app\.mark_dirty\('emergency hide', true\)/);
    for (const step of ['deploy_now', 'purge_cache_for_urls', 'set_youtube_video_private', 'search_console_removals_request']) expect(hide).toContain(step);
    expect(hide).not.toMatch(/delete from public\.suppression/);
  });
});

describe('protected-player and suppression rules in the SQL', () => {
  it('players_protected_rules: a protected player has no profile data, is noindex, hidden and has an opaque slug', () => {
    const text = flat(F4);
    expect(text).toContain("constraint players_protected_rules check ( age_status = 'adult_confirmed' or (district is null and photo_path is null and bio is null and instagram_handle is null and noindex and visibility = 'hidden' and slug_kind = 'opaque') )");
    expect(text).toContain("constraint players_public_needs_adult check (visibility <> 'public' or (age_status = 'adult_confirmed' and not is_provisional and merged_into is null))");
    expect(text).toContain("constraint players_adult_has_evidence check (age_status <> 'adult_confirmed' or (age_confirmed_by is not null and age_confirmed_at is not null))");
  });

  it('a new video starts hidden, a new match held, a new player unknown and opaque (SA-M31, D-012)', () => {
    const t = flat(F4);
    expect(t).toContain("visibility text not null default 'hidden'");
    expect(t).toContain("publish_state text not null default 'held'");
    expect(t).toContain("age_status text not null default 'unknown'");
    expect(t).toContain("slug_kind text not null default 'opaque'");
  });

  it('suppression is a tombstone: unique key, never deleted, release only stamps; the guard triggers exist on videos, players, tournaments', () => {
    const t = flat(F5);
    expect(t).toContain('constraint suppression_kind_value_unique unique (kind, value)');
    expect(t).toContain("raise exception 'DELETE on suppression is not allowed");
    for (const trg of ['videos_guard', 'players_guard', 'tournaments_guard', 'matches_guard', 'participants_guard', 'redirects_guard']) {
      expect(t, trg).toMatch(new RegExp(`create trigger ${trg} before (?:insert or update|insert or update) on public\\.[a-z_]+ for each row execute function app\\.${trg}\\(\\)`));
    }
    expect(t).toContain("app.is_suppressed('youtube_id', new.youtube_id)");
    expect(t).toContain("app.is_suppressed('player_id', new.id::text)");
    expect(t).toContain("app.is_suppressed('tournament_id', new.id::text)");
  });

  it('the sync cannot lift a status, create an adult, or change the lock list (only the admin RPCs set the switches)', () => {
    const t = flat(F5);
    expect(t).toContain("current_setting('app.age_lift_ok', true)");
    expect(t).toContain("current_setting('app.override_bypass', true)");
    expect(t).toContain('a player cannot be created as adult_confirmed outside an admin action');
    // every RPC that sets a switch also switches it off before it returns
    for (const m of flat(F6).matchAll(/set_config\('app\.age_lift_ok', 'on', true\)/g)) expect(m[0]).toBeDefined();
    expect(flat(F6)).toContain("set_config('app.age_lift_ok', 'off', true)");
    expect(flat(F6)).toContain("set_config('app.override_bypass', 'off', true)");
  });

  it('the page mode view reads both mode settings and fails closed on a minor signal and on no participants', () => {
    const t = flat(F6);
    expect(t).toContain("s.key = 'unknown_match_mode'");
    expect(t).toContain("s.key = 'minor_match_mode'");
    expect(t).toContain("m.category in ('BS', 'GS', 'BD', 'GD')");
    expect(t).toContain("m.age_group ~ '^U([0-9]|1[0-9])$'");
    expect(t).toContain('when count(mp.id) = 0 then 1');
  });

  it('private organizer contact is only in tournament_private and never selected by a view except the consented organizer name', () => {
    expect(flat(F4)).not.toMatch(/create table public\.tournaments \([^)]*organizer_(?:phone|email)/);
    for (const s of S6.filter((x) => /^create view/i.test(x))) {
      expect(s, s.slice(0, 40)).not.toMatch(/organizer_phone|organizer_email/);
    }
    expect(flat(F6)).toContain('case when t.show_contact_public then tp.organizer_name else null end as organizer_name');
  });

  it('410 (gone) rows are not readable through any public view', () => {
    const v = S6.find((s) => /^create view api\.public_slug_redirects/i.test(s)) as string;
    expect(v).toMatch(/r\.http_status = 301/);
    expect(v).toMatch(/r\.to_path is not null/);
  });
});

describe('fix wave rules in the SQL (S2-7, S2-9, match slugs, 30-day purge)', () => {
  const t5 = flat(F5);
  const t6 = flat(F6);
  it('a confirmed minor is lifted only with the audited override', () => {
    expect(t6).toContain("r.age_status = 'minor_confirmed' and p_status = 'adult_confirmed' and not coalesce(p_override_minor, false)");
    expect(t6).toContain("'age_override_minor'");
  });
  it('name tombstones reach unlinked participants and aliases, existing and new; the view also checks the raw name', () => {
    expect(t5).toContain('create trigger suppression_apply after insert or update on public.suppression');
    expect(t5).toContain('create trigger aliases_guard before insert or update on public.player_aliases');
    expect(t5).toMatch(/app\.is_suppressed\('name_normalized', btrim\(regexp_replace\(regexp_replace\(lower\(new\.raw_name\)/);
    expect(t6).toMatch(/k\.kind = 'name_normalized' and k\.value = btrim\(regexp_replace\(regexp_replace\(lower\(mp\.raw_name\)/);
  });
  it('match slugs are persisted, opaque by default, masked in the view and retired (410) when a participant turns protected', () => {
    expect(flat(F4)).toContain("constraint matches_slug_kind_matches check (slug = '' or ((slug_kind = 'opaque') = (slug ~ '^match-[0-9a-f]{16}$')))");
    expect(t6).toContain("case when x.mode = 'full' then m.slug else 'match-' || substr(replace(m.id::text, '-', ''), 1, 16) end as slug");
    expect(t5).toContain('perform app.retire_match_slugs(new.id)');
    expect(t6).toContain('perform app.retire_match_slugs(p.id)');
  });
  it('the purge RPC is bounded to 1..30 days, keeps tombstones and never deletes a suppression row', () => {
    const purge = read('0009_archive_purge.sql');
    expect(purge).toContain('p_older_than_days < 1 or p_older_than_days > 30');
    expect(purge).not.toMatch(/delete from public\.suppression/);
    expect(purge).toContain('security definer');
  });
});
