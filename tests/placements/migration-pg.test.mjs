import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { binariesPresent, createDb, dropDb, isUp, psql, psqlFile, ROOT } from '../../scripts/pg-local.mjs';

// Runs 0007_placements.sql on the LOCAL throwaway PostgreSQL (scripts/pg-local.mjs, docs/m1/tooling-notes.md): the constraints, the
// counters, the dedupe and the privilege rules for real. SKIPPED unless the local server is already up
// (`node scripts/pg-local.mjs start` first, `stop` afterwards). Own database (psbiz_test), dropped at the end. Fictional data only.
// It applies roles.sql + 0001 + 0002 + 0007 only, so it does not depend on other workers' migrations.
const DB = 'psbiz_test';
const up = binariesPresent() && isUp();
const NEWLINE = /\r?\n/;
const FILES = ['supabase/local/roles.sql', 'supabase/migrations/0001_lead_funnel.sql', 'supabase/migrations/0002_consent_records.sql', 'supabase/migrations/0007_placements.sql'];

const SPONSOR = '00000000-0000-4000-8000-0000000000a1';
const P1 = '00000000-0000-4000-8000-0000000000b1';
const P2 = '00000000-0000-4000-8000-0000000000b2';

const sponsorInsert = `insert into public.sponsors (id, name, website) values ('${SPONSOR}', 'Fictional Sponsor', 'https://sponsor.example')`;
const placementInsert = (id = P1, slug = 'fictional-one', over = {}) => {
  const v = { slot: 'home_partner_strip', scope: 'null', desktop: "'sponsors/fictional/a.png'", status: 'active', ...over };
  return `insert into public.placements (id, sponsor_id, slot, scope_key, creative_desktop_path, alt, target_url, go_slug, start_date, end_date, label, status)
    values ('${id}', '${SPONSOR}', '${v.slot}', ${v.scope}, ${v.desktop}, 'Fictional logo', 'https://sponsor.example/landing', '${slug}', '2026-11-01', '2026-11-30', 'Partner', '${v.status}')`;
};
const today = "(now() at time zone 'Asia/Kolkata')::date";

function as(role, sql) {
  return psql(DB, `begin; set local role ${role}; ${sql}; rollback;`);
}
/** Several statements in one rolled-back transaction as service_role; returns the last select's rows. */
const svc = (...stmts) => as('service_role', stmts.join('; '));
/** The result rows of a run, without psql's command tags. */
const rows = (r) => r.stdout.trim().split(NEWLINE).filter((l) => !/^(BEGIN|SET|ROLLBACK|INSERT \d+ \d+|UPDATE \d+|DELETE \d+)$/.test(l));

describe.skipIf(!up)('local PostgreSQL: 0007 placements', () => {
  // each psql call takes a second or more on Windows
  vi.setConfig({ testTimeout: 240_000, hookTimeout: 240_000 });

  beforeAll(() => {
    dropDb(DB);
    createDb(DB);
    for (const f of FILES) {
      const r = psqlFile(DB, join(ROOT, f), { quiet: true });
      if (r.status !== 0) throw new Error(`${f}: ${r.stderr}`);
    }
  }, 240_000);

  afterAll(() => {
    if (up) dropDb(DB);
  });

  it('service_role can create a sponsor and a placement', () => {
    const r = svc(sponsorInsert, placementInsert(), 'select count(*) from public.placements');
    expect(r.stderr).toBe('');
    expect(r.stdout.trim().split(NEWLINE)).toContain('1');
  });

  it('refuses a http target, a bad slug, reversed dates, an active placement with no image and a scoped slot without scope', () => {
    expect(svc(sponsorInsert, placementInsert().replace('https://sponsor.example/landing', 'http://sponsor.example/x')).stderr).toMatch(/placements_target_https/);
    expect(svc(sponsorInsert, placementInsert(P1, 'Bad Slug')).stderr).toMatch(/placements_go_slug_format/);
    expect(svc(sponsorInsert, placementInsert().replace("'2026-11-01', '2026-11-30'", "'2026-11-30', '2026-11-01'")).stderr).toMatch(/placements_dates_order/);
    expect(svc(sponsorInsert, placementInsert(P1, 'x1', { desktop: 'null' })).stderr).toMatch(/placements_active_has_creative/);
    expect(svc(sponsorInsert, placementInsert(P1, 'x2', { slot: 'tournament_coverage_title' })).stderr).toMatch(/placements_scope_rule/);
    expect(svc(sponsorInsert, placementInsert(P1, 'x3', { slot: 'home_partner_strip', scope: "'open-2026'" })).stderr).toMatch(/placements_scope_rule/);
    expect(svc(sponsorInsert, placementInsert(P1, 'x4', { desktop: "'../etc/passwd'" })).stderr).toMatch(/placements_creative_desktop_format/);
  });

  it('go_slug is unique', () => {
    expect(svc(sponsorInsert, placementInsert(P1, 'same'), placementInsert(P2, 'same')).stderr).toMatch(/placements_go_slug_uq/);
  });

  it('bump_stat adds to the daily counters atomically (impressions and clicks, total and per page)', () => {
    const r = svc(
      sponsorInsert,
      placementInsert(),
      `select public.bump_stat('${P1}', ${today}, 2, 1, '/players/fictional/')`,
      `select public.bump_stat('${P1}', ${today}, 3, 0, '/players/fictional/')`,
      `select impressions || ':' || clicks from public.placement_stats_daily where placement_id = '${P1}'`,
      `select impressions || ':' || clicks from public.placement_page_stats_daily where placement_id = '${P1}'`,
    );
    expect(r.stderr).toBe('');
    const lines = r.stdout.trim().split(NEWLINE);
    expect(lines.filter((l) => l === '5:1')).toHaveLength(2);
    expect(svc(sponsorInsert, placementInsert(), `select public.bump_stat('${P1}', ${today}, -1, 0)`).stderr).toMatch(/must not be negative/);
  });

  it('record_placement_impressions dedupes per placement, day and session and ignores inactive or unknown placements', () => {
    const items = (ids) => `'${JSON.stringify(ids.map((id) => ({ placement_id: id, page_path: '/' })))}'::jsonb`;
    const r = svc(
      sponsorInsert,
      placementInsert(P1, 'one'),
      placementInsert(P2, 'two', { status: 'paused' }),
      `select public.record_placement_impressions(${today}, 'session-hash-1', ${items([P1, P2, '00000000-0000-4000-8000-0000000000ff'])})`,
      `select public.record_placement_impressions(${today}, 'session-hash-1', ${items([P1])})`,
      `select public.record_placement_impressions(${today}, 'session-hash-2', ${items([P1])})`,
      `select impressions from public.placement_stats_daily where placement_id = '${P1}'`,
      `select count(*) from public.placement_stats_daily where placement_id = '${P2}'`,
    );
    expect(r.stderr).toBe('');
    // counted: 1 (P1 only), 0 (repeat), 1 (new session); total 2; the paused placement has no row
    expect(rows(r)).toEqual(['1', '0', '1', '2', '0']);
  });

  it('record_placement_impressions refuses a far day, a junk session and a big batch', () => {
    const base = [sponsorInsert, placementInsert()];
    expect(svc(...base, `select public.record_placement_impressions(${today} + 5, 'session-hash-1', '[]'::jsonb)`).stderr).toMatch(/day out of range/);
    expect(svc(...base, `select public.record_placement_impressions(${today}, 'x', '[]'::jsonb)`).stderr).toMatch(/bad session hash/);
    const big = JSON.stringify(Array.from({ length: 9 }, () => ({ placement_id: P1, page_path: '/' })));
    expect(svc(...base, `select public.record_placement_impressions(${today}, 'session-hash-1', '${big}'::jsonb)`).stderr).toMatch(/at most 8/);
  });

  it('rollup_placement_clicks recomputes a day from the click log, ignores bots and is idempotent', () => {
    const click = (slug, bot = false, path = '/matches/fictional/') => `insert into public.outbound_clicks (go_slug, page_path, is_bot) values ('${slug}', '${path}', ${bot})`;
    const r = svc(
      sponsorInsert,
      placementInsert(P1, 'one'),
      click('one'),
      click('one'),
      click('one', true),
      click('unknown-slug'),
      `select public.rollup_placement_clicks(${today})`,
      `select public.rollup_placement_clicks(${today})`,
      `select clicks from public.placement_stats_daily where placement_id = '${P1}'`,
      `select clicks from public.placement_page_stats_daily where placement_id = '${P1}' and page_path = '/matches/fictional/'`,
    );
    expect(r.stderr).toBe('');
    expect(rows(r).slice(-2)).toEqual(['2', '2']);
  });

  it('service_role cannot delete or truncate sponsors, placements or counters', () => {
    for (const t of ['sponsors', 'placements', 'placement_stats_daily', 'placement_page_stats_daily']) {
      expect(as('service_role', `delete from public.${t}`).stderr).toMatch(/permission denied/);
      expect(as('service_role', `truncate public.${t}`).stderr).toMatch(/permission denied/);
    }
  });

  for (const role of ['anon', 'authenticated']) {
    it(`${role} cannot read or write any placement table or call the functions`, () => {
      for (const t of ['sponsors', 'placements', 'placement_stats_daily', 'placement_page_stats_daily', 'placement_impression_seen']) {
        expect(as(role, `select * from public.${t}`).stderr).toMatch(/permission denied/);
        expect(as(role, `delete from public.${t}`).stderr).toMatch(/permission denied/);
      }
      expect(as(role, `select public.bump_stat('${P1}', ${today}, 1, 0)`).stderr).toMatch(/permission denied/);
      expect(as(role, `select public.record_placement_impressions(${today}, 'session-hash-1', '[]'::jsonb)`).stderr).toMatch(/permission denied/);
      expect(as(role, `select public.rollup_placement_clicks(${today})`).stderr).toMatch(/permission denied/);
    });
  }

  it('the self-check file returns ok', () => {
    const r = psqlFile(DB, join(ROOT, 'supabase/checks/0007_assertions.sql'), { quiet: true });
    expect(r.status).toBe(0);
    expect(r.stdout).toMatch(/ok: 0007_placements assertions passed/);
  });
});
