// Migration 0019 (D-108) without a database (the behaviour is supabase/checks/0019_assertions.sql): the scoped RPCs are the 0017/0018
// bodies unchanged except their first statement, the levels match the TS map, rankings stay owner only, the house rules hold, and the
// account rules in SQL use the same numbers as accounts/rules.ts.
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { scopedNeed } from '../../src/lib/admin/accounts/access';
import { DISPLAY_NAME_MAX, DISPLAY_NAME_MAX_DIGITS, DISPLAY_NAME_MIN, TOURNAMENTS_MAX } from '../../src/lib/admin/accounts/rules';
import { checkMigration } from '../supabase/migration-rules';

const read = (p: string) => readFileSync(p, 'utf8').replace(/\r\n/g, '\n');
const m17 = read('supabase/migrations/0017_competition.sql');
const m18 = read('supabase/migrations/0018_competition_admin.sql');
const m19 = read('supabase/migrations/0019_competition_accounts.sql');

function definition(sql: string, name: string): string | null {
  const start = sql.lastIndexOf(`create or replace function public.${name}(`);
  if (start === -1) return null;
  return sql.slice(start, sql.indexOf('\n$$;\n', start) + 4);
}

/** RPC -> the TS action whose need it must match. */
const SCOPED: Record<string, { action: string; level: 'run' | 'score' }> = {
  admin_save_event: { action: 'competition.saveEvent', level: 'run' },
  admin_add_entry: { action: 'competition.addEntry', level: 'run' },
  admin_withdraw_entry: { action: 'competition.withdrawEntry', level: 'run' },
  admin_set_entry: { action: 'competition.setEntry', level: 'run' },
  admin_save_draw: { action: 'competition.generateDraw', level: 'run' },
  admin_publish_draw: { action: 'competition.publishDraw', level: 'run' },
  admin_save_match: { action: 'competition.saveMatch', level: 'run' },
  admin_record_result: { action: 'competition.recordResult', level: 'score' },
  admin_confirm_result: { action: 'competition.confirmResult', level: 'run' },
  admin_save_court: { action: 'competition.saveCourt', level: 'run' },
};

describe('0019: the scoped competition RPCs', () => {
  it.each(Object.keys(SCOPED))('%s is the last 0017/0018 body with only the access check changed', (name) => {
    const before = definition(m18, name) ?? definition(m17, name);
    const after = definition(m19, name);
    expect(before, name).not.toBeNull();
    expect(after, name).not.toBeNull();
    const ownerLine = '  perform app.require_owner(p_actor);\n';
    expect(before!.split(ownerLine).length - 1).toBe(1);
    // remove the access lines from the new body and the owner line from the old: the rest is identical, byte for byte
    const stripped = after!.replace(/^ {2}(?:if p_id is not null then )?perform app\.require_competition_access\(p_actor, .*\n/gm, '');
    expect(stripped).toBe(before!.replace(ownerLine, ''));
    // the access check is the first statement after begin, at the level the TS map uses
    expect(after).toMatch(/\nbegin\n {2}perform app\.require_competition_access\(p_actor, /);
    const levels = [...after!.matchAll(/require_competition_access\(p_actor, .*, '(run|score)'\);/g)].map((m) => m[1]);
    expect(new Set(levels)).toEqual(new Set([SCOPED[name]!.level]));
    expect(scopedNeed('organizer', SCOPED[name]!.action)).toBe(SCOPED[name]!.level);
    expect(after).not.toContain('app.require_owner(');
    // its privileges are restated
    expect(m19).toMatch(new RegExp(`revoke all on function public\\.${name}\\([^)]*\\) from public, anon, authenticated;`));
    expect(m19).toMatch(new RegExp(`grant execute on function public\\.${name}\\([^)]*\\) to service_role;`));
  });

  it('every competition RPC of 0017/0018 is either scoped here or stays owner only (rankings, venues, the points table)', () => {
    const all = [...new Set([...`${m17}\n${m18}`.matchAll(/^create or replace function public\.([a-z_]+)\(/gm)].map((m) => m[1] as string))];
    const ownerOnly = all.filter((n) => !(n in SCOPED)).sort();
    expect(ownerOnly).toEqual(['admin_competition_rankable_players', 'admin_publish_ranking_snapshot', 'admin_save_ranking_snapshot', 'admin_save_venue', 'admin_set_ranking_points']);
    for (const n of ownerOnly) expect(definition(m19, n), n).toBeNull();
    expect(scopedNeed('scorer', 'competition.recordResult')).toBe('score');
  });

  it('follows the D-005 house rules (RLS untouched, no policy, no grant to an API role, fixed search_path, revoked functions)', () => {
    expect(checkMigration(m19).problems).toEqual([]);
    expect(m19).not.toMatch(/create policy|grant (select|insert|update|delete)[^;]* to (anon|authenticated)|disable row level security/i);
    expect(m19).not.toMatch(/pg_temp\./);
  });

  it('the account RPCs are owner only, audited without names, and the check text uses the TS numbers', () => {
    for (const name of ['admin_create_account', 'admin_assign_tournament', 'admin_revoke_assignment', 'admin_disable_account', 'admin_set_organizer_access']) {
      const d = definition(m19, name)!;
      expect(d, name).toMatch(/\nbegin\n {2}perform app\.require_owner\(p_actor\);\n {2}perform app\.competition_reason\(p_reason\);/);
      expect(d).toMatch(/app\.audit\(p_actor, /);
      expect(d).not.toMatch(/app\.audit\([^;]*(display_name|v_name|displayName)/);
    }
    const create = definition(m19, 'admin_create_account')!;
    expect(create).toContain(`length(v_name) not between ${DISPLAY_NAME_MIN} and ${DISPLAY_NAME_MAX}`);
    expect(create).toContain(`'g')) >= ${DISPLAY_NAME_MAX_DIGITS + 1}`);
    expect(create).toContain(`not between 1 and ${TOURNAMENTS_MAX}`);
    expect(m19).toContain(`length(display_name) between ${DISPLAY_NAME_MIN} and ${DISPLAY_NAME_MAX}`);
    expect(m19).toContain(`'g')) < ${DISPLAY_NAME_MAX_DIGITS + 1}`);
    // nothing about an email is stored or audited (only the refusal sentences mention one)
    expect(m19.replace(/--.*$/gm, '').replace(/'[^']*'/g, '')).not.toMatch(/email/i);
  });

  it('the access check: owner first, then switch, account, assignment and role; refuses with FORBIDDEN', () => {
    const start = m19.indexOf('create or replace function app.require_competition_access(');
    const body = m19.slice(start, m19.indexOf('\n$$;\n', start));
    const order = ["p.role = 'owner' then return", 'p.disabled_at is null', 'organizer_roles_enabled', 'a.revoked_at is null and a.role = p.role', "(a.role = 'organizer' or p_needed = 'score')", "raise exception 'FORBIDDEN:"];
    let at = 0;
    for (const s of order) {
      const i = body.indexOf(s, at);
      expect(i, s).toBeGreaterThan(-1);
      at = i;
    }
    expect(m19).toContain('revoke all on function app.require_competition_access(text, uuid, text) from public, anon, authenticated, service_role;');
  });
});
