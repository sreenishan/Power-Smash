// Migration 0024 (D-117/D-122) without a database (the behaviour is supabase/checks/0024_assertions.sql): the three organizer RPCs check
// 'run' access to the tournament first (the TS map says the same), never call the owner check, return only the allowed fields, audit
// without a name, use the same numbers as the TS rules, and follow the house rules.
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { scopedNeed } from '../../src/lib/admin/accounts/access';
import { ORGANIZER_PLAYER_LIMITS } from '../../src/lib/admin/competition/validate';
import { checkMigration } from '../supabase/migration-rules';

const m24 = readFileSync('supabase/migrations/0024_organizer_search.sql', 'utf8').replace(/\r\n/g, '\n');
const c24 = readFileSync('supabase/checks/0024_assertions.sql', 'utf8').replace(/\r\n/g, '\n');

function definition(name: string): string {
  const start = m24.indexOf(`create or replace function public.${name}(`);
  expect(start, name).toBeGreaterThan(-1);
  return m24.slice(start, m24.indexOf('\n$$;\n', start) + 4);
}

const RPCS: Record<string, string> = {
  admin_competition_search_players: 'competition.searchPlayers',
  admin_competition_create_player: 'competition.createPlayer',
  // the preview has no action of its own: it is part of competition.event for an organizer, which also needs 'run' for the entries
  admin_competition_event_naming: 'competition.addEntry',
};

describe('0024_organizer_search.sql', () => {
  it('each RPC checks run access to the tournament first, at the level the TS map uses, and never the owner check', () => {
    for (const [name, action] of Object.entries(RPCS)) {
      const d = definition(name);
      expect(d, name).toMatch(/\nbegin\n {2}perform app\.require_competition_access\(p_actor, [^;]+, 'run'\);\n/);
      expect(d).not.toContain('require_owner');
      expect(d).toMatch(/\nsecurity definer\nset search_path = ''\n/);
      expect(scopedNeed('organizer', action)).toBe('run');
      expect(scopedNeed('scorer', action)).toBeNull();
      expect(m24).toMatch(new RegExp(`revoke all on function public\\.${name}\\([^)]*\\) from public, anon, authenticated;`));
      expect(m24).toMatch(new RegExp(`grant execute on function public\\.${name}\\([^)]*\\) to service_role;`));
    }
  });
  it('the search returns id and display name only (no naming flag), and reads no age, profile or contact column', () => {
    const d = definition('admin_competition_search_players');
    expect(d).toContain("jsonb_build_object('id', x.id, 'displayName', x.display_name)");
    expect(d).not.toContain("'named'");
    expect(d).toContain("jsonb_build_object('items', v_rows, 'hasMore', v_count > p_limit)");
    expect(d).not.toMatch(/age_status|age_signal|slug|district|academy|bio|photo_path|instagram|phone|email/);
    expect(d).toContain('p.merged_into is null');
    expect(d).toContain('app.suppressed_keys');
    // an organizer: protected players only by the exact name or when tied to this tournament; audited (no query) and limited
    expect(d).toContain('or p.name_normalized = v_q');
    expect(d).toContain('or p.provisional_tournament_id = p_tournament');
    expect(d).toContain("jsonb_build_object('query_length', length(v_q), 'offset', p_offset)");
    expect(d).toContain("interval '10 minutes') >= 120 then");
    // the numbers are the TS ones
    expect(d).toContain(`length(v_q) < ${ORGANIZER_PLAYER_LIMITS.queryMin} or length(v_q) > ${ORGANIZER_PLAYER_LIMITS.queryMax}`);
    expect(d).toContain(`p_limit > ${ORGANIZER_PLAYER_LIMITS.pageMax}`);
    expect(d).toContain(`p_offset > ${ORGANIZER_PLAYER_LIMITS.offsetMax}`);
  });
  it('the new player is provisional, hidden and of unknown age by the column defaults; never an age, never an update of another player', () => {
    const d = definition('admin_competition_create_player');
    expect(d).toContain("insert into public.players (display_name, name_normalized, identity_tier, created_source, provisional_tournament_id)");
    expect(d).not.toMatch(/age_status|visibility|is_provisional\s*=|update public\.players/);
    expect(d).toContain("app.competition_keys(p_record, array['name', 'nameNormalized'], 'new player')");
    expect(d).toContain(`app.registration_line_ok(v_name, ${ORGANIZER_PLAYER_LIMITS.nameMax})`);
    expect(d).toContain(">= 7 then");
    // the audit row holds ids and field names, never the name itself
    const audit = d.slice(d.indexOf('perform app.audit('), d.indexOf('p_reason);', d.indexOf('perform app.audit(')));
    expect(audit).toContain("'fields', jsonb_build_array('display_name', 'name_normalized')");
    expect(audit).not.toMatch(/v_name|v_norm/);
  });
  it('the preview returns booleans per player id only', () => {
    const d = definition('admin_competition_event_naming');
    expect(d).toContain("jsonb_build_object('playerId', x.pid, 'named', exists (select 1 from app.competition_named_players np where np.id = x.pid))");
    expect(d).not.toMatch(/display_name|age_status/);
  });
  it('follows the D-005 house rules and adds no table, view, policy or API grant', () => {
    expect(checkMigration(m24).problems).toEqual([]);
    expect(m24).not.toMatch(/create (table|view|policy)|grant (select|insert|update|delete)|to (anon|authenticated)\b|pg_temp\./i);
  });
  it('its check covers assigned, unassigned, scorer and owner cases and ends with its ok row', () => {
    for (const label of ['an organizer past the search limit', 'an organizer can tell a removal request or a hidden player from an ordinary existing name', 'an organizer searching for an unassigned tournament', 'a scorer searching', 'a scorer adding a player', 'the owner, an unknown tournament', 'another tournament\'\'s organizer asking for the preview']) {
      expect(c24).toContain(label);
    }
    expect(c24.trimEnd().endsWith("select 'ok: 0024_organizer_search assertions passed' as result;")).toBe(true);
  });
});
