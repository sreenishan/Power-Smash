// Source checks for wave 5 (D-113): the migration follows the 0017/0018 house rules, the event page carries the live region only
// through the gated component, and the region is text-only progressive enhancement.
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const sql = readFileSync('supabase/migrations/0021_live_scores.sql', 'utf8');
const fnBody = (name: string): string => {
  const start = sql.indexOf(`create or replace function ${name}(`);
  expect(start, name).toBeGreaterThanOrEqual(0);
  return sql.slice(start, sql.indexOf('\n$$;', start));
};

describe('migration 0021', () => {
  it.each([
    ['public.admin_live_score', 'score'],
    ['public.admin_live_match_status', 'score'],
    ['public.admin_set_live_scores', 'owner'],
  ])('%s is SECURITY DEFINER, search_path empty, access check first (%s)', (name, access) => {
    const body = fnBody(name);
    expect(body).toContain('security definer');
    expect(body).toContain("set search_path = ''");
    // scoring: the per-tournament check of 0019 (the owner, or an assigned organizer or scorer); the settings stay owner only
    if (access === 'score') expect(body).toMatch(/\bbegin\s+perform app\.require_competition_access\(p_actor, app\.competition_tournament_of\('match', p_match\), 'score'\);/);
    else expect(body).toMatch(/\bbegin\s+perform app\.require_owner\(p_actor\);/);
    expect(sql).toContain(`revoke all on function ${name}(`);
    expect(sql).toMatch(new RegExp(`grant execute on function ${name.replace('.', '\\.')}\\([^)]*\\) to service_role;`));
  });
  it('the helpers are for nobody and keep a fixed search_path', () => {
    for (const name of ['app.competition_live_replay', 'app.competition_live_store']) {
      expect(fnBody(name)).toContain("set search_path = ''");
      expect(fnBody(name)).not.toContain('security definer');
      expect(sql).toContain(`revoke all on function ${name}(`);
    }
  });
  it('the new table: RLS on, everything revoked, service_role reads only, no policy', () => {
    expect(sql).toContain('alter table public.match_live_state enable row level security;');
    expect(sql).toContain('revoke all on table public.match_live_state from public, anon, authenticated, service_role;');
    expect(sql).toContain('grant select on public.match_live_state to service_role;');
    expect(sql).not.toMatch(/create policy/i);
  });
  it('errors use the house prefixes; audits hold ids and codes only', () => {
    const raises = [...sql.matchAll(/raise exception '([A-Z_]+):/g)].map((m) => m[1]);
    expect(new Set(raises)).toEqual(new Set(['INVALID', 'NOT_FOUND', 'STALE']));
    for (const m of sql.matchAll(/perform app\.audit\(([^;]+);/g)) expect(m[1]).not.toMatch(/display_name|player_name|_name'/);
  });
  it('the rally log stays append-only: the migration never updates or deletes it', () => {
    expect(sql).not.toMatch(/(update|delete from)\s+public\.match_score_events/i);
    expect(sql).toMatch(/insert into public\.match_score_events/);
  });
  it('the api view: security_barrier, explicit columns, granted to the API roles, names only through the faces view', () => {
    expect(sql).toContain('create view api.public_competition_live with (security_barrier = true) as');
    expect(sql).toContain('grant select on api.public_competition_live to anon, authenticated;');
    expect(sql).toContain('revoke all on app.competition_live_settings from public, anon, authenticated;');
    const view = sql.slice(sql.indexOf('create view api.public_competition_live'));
    expect(view).not.toContain('public.players');
    expect(view).not.toContain('public.match_score_events');
    expect(view).toContain("where m.status in ('live', 'paused')");
    expect(view).toContain('and s.on_now;');
  });
  it('no price, no contact field, no fictional value that looks real', () => {
    expect(sql).not.toMatch(/paise|price|phone|email|upi/i);
  });
});

describe('the event page and the live region', () => {
  const page = readFileSync('src/pages/competitions/[tournament]/[event].astro', 'utf8');
  const gate = readFileSync('src/components/competition/live/LiveScores.astro', 'utf8');
  const region = readFileSync('src/components/competition/live/LiveScoresRegion.astro', 'utf8');
  it('the page includes the gated component once, with the event id', () => {
    expect(page.match(/<LiveScores eventId=\{e\.id\} \/>/g)).toHaveLength(1);
    expect(page).toContain("import LiveScores from '../../../components/competition/live/LiveScores.astro';");
    expect(page).not.toContain('LiveScoresRegion');
  });
  it('the gate renders the region (and so its script) only when features.liveScores is on and the id is a uuid', () => {
    expect(gate).toContain('liveScoresInBuild() && isUuid(eventId)');
    expect(gate).toContain('{show && <LiveScoresRegion eventId={eventId} />}');
    expect(gate).not.toContain('<script');
  });
  it('the region starts hidden, has a polite summary, calls the endpoint without a slash, no set:html', () => {
    expect(region).toMatch(/<section[^>]*data-live-scores[^>]*hidden>/);
    expect(region).toContain('aria-live="polite" data-live-summary');
    expect(region).toContain('`/api/live-scores/${eventId.toLowerCase()}`');
    expect(region).not.toMatch(/set:html|is:inline/);
  });
});
