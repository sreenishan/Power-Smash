// The public near-live contract (D-113): the view's column list is the SQL's, rows are checked field by field, and nobody protected
// is ever named (the second line of defence after the SQL faces view: D-012, D-109, D-116). Fictional names only.
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { LIVE_VIEW_COLUMNS, liveStatusText, parseLiveRow, toLiveMatchJson, type LiveViewRow } from '../../src/lib/live-scores/public';
import { liveRow } from './fixtures';

const sql = readFileSync('supabase/migrations/0021_live_scores.sql', 'utf8');
const checks = readFileSync('supabase/checks/0021_assertions.sql', 'utf8');

describe('the view columns', () => {
  it('LIVE_VIEW_COLUMNS is the SQL view column list, in order, and the check file pins the same list', () => {
    const body = sql.slice(sql.indexOf('create view api.public_competition_live'), sql.indexOf('from public.competition_matches m\njoin app.competition_public_match_ids'));
    const cols = [...body.matchAll(/(?:\bas ([a-z0-9_]+),?\s*$)|(?:^\s+(?:[a-z]+\.)?([a-z0-9_]+),?\s*$)/gm)].map((m) => m[1] ?? m[2]).filter((c) => c !== 'select');
    expect(cols).toEqual([...LIVE_VIEW_COLUMNS]);
    expect(checks).toContain(JSON.stringify([...LIVE_VIEW_COLUMNS]).replace(/","/g, '", "'));
  });
  it('the view names players only through the faces view and has no slug, entry id or private column', () => {
    expect(LIVE_VIEW_COLUMNS.some((c) => /slug|entry|phone|email|recorded_by|idempotency/.test(c))).toBe(false);
    expect(sql).toContain('left join app.competition_entry_faces fa on fa.entry_id = m.side_a_entry');
    expect(sql).toContain('coalesce(fa.is_protected, true) as side_a_protected');
    // the RPCs read a whole row into a %rowtype variable (house style); the VIEW never selects *
    expect(sql.slice(sql.indexOf('create view api.public_competition_live'))).not.toMatch(/select \*/i);
  });
});

describe('parseLiveRow', () => {
  it('accepts a good row', () => {
    expect(parseLiveRow(liveRow())).not.toBeNull();
  });
  it.each([
    ['match_id', 'not-a-uuid'],
    ['status', 'completed'],
    ['round_code', 'Z'],
    ['points_a', 31],
    ['points_b', -1],
    ['games_a', 4],
    ['game_number', 0],
    ['finished_games', [{ a: 21, b: 19, extra: 1 }]],
    ['finished_games', 'nope'],
    ['server_side', 'C'],
    ['last_update', 'yesterday'],
    ['is_live', 'true'],
    ['side_a_protected', null],
    ['live_window_seconds', 10],
    ['side_a_player1_name', 'x'.repeat(201)],
  ])('drops a row whose %s is %j', (k, v) => {
    expect(parseLiveRow(liveRow({ [k]: v } as never))).toBeNull();
  });
  it('drops anything that is not an object', () => {
    for (const v of [null, 1, 'row', []]) expect(parseLiveRow(v)).toBeNull();
  });
});

describe('toLiveMatchJson', () => {
  const json = (over: Parameters<typeof liveRow>[0] = {}) => toLiveMatchJson(parseLiveRow(liveRow(over)) as LiveViewRow);
  it('builds ready-to-show text', () => {
    const m = json();
    expect(m).toMatchObject({ sideA: 'Demo Arun', sideB: 'Demo Bala', status: 'live', isLive: true, statusText: 'Live', current: { a: 7, b: 5 }, gamesWon: { a: 1, b: 0 }, server: 'A' });
    expect(m.label).toBe('Final · Court 2');
    expect(m.lastUpdateText).toMatch(/IST$/);
  });
  it('"Live" only while points arrive; a paused match never says Live', () => {
    expect(json({ is_live: false }).statusText).toBe('Score may be out of date');
    expect(json({ is_live: false }).isLive).toBe(false);
    expect(json({ status: 'paused', is_live: true }).statusText).toBe('Paused');
    expect(json({ status: 'paused', is_live: true }).isLive).toBe(false);
    expect(liveStatusText({ status: 'live', is_live: true })).toBe('Live');
    // a match that has just started has no point yet: "Starting", never "out of date"
    expect(liveStatusText({ status: 'live', is_live: false, last_update: null })).toBe('Starting');
    expect(liveStatusText({ status: 'live', is_live: false, last_update: '2026-10-31T06:00:00.000Z' })).toBe('Score may be out of date');
    expect(liveStatusText({ status: 'paused', is_live: false, last_update: null })).toBe('Paused');
  });
  it('a protected side is never named, even if a name slipped through the view', () => {
    expect(json({ side_a_protected: true }).sideA).toBe('Protected player');
    expect(json({ side_a_player1_name: null }).sideA).toBe('Protected player');
  });
  it('a junior event names nobody (the view flag or the category or the age group)', () => {
    for (const over of [{ is_junior: true }, { category: 'BS' }, { age_group: 'U15' }, { category: 'ZZ' }]) {
      const m = json(over as never);
      expect([m.sideA, m.sideB]).toEqual(['Protected player', 'Protected player']);
    }
  });
  it('a doubles pair with one protected player is masked as a whole', () => {
    const m = json({ category: 'MD', side_a_player1_name: 'Demo Arun', side_a_player2_name: null, side_b_player1_name: 'Demo Bala', side_b_player2_name: 'Demo Chitra' });
    expect(m.sideA).toBe('Protected player / Protected player');
    expect(m.sideB).toBe('Demo Bala / Demo Chitra');
  });
  it('a group match reads "Group A" and an unknown court says so', () => {
    const m = json({ round_code: 'group', group_label: 'A', court_label: null });
    expect(m.label).toBe('Group A · Court to be confirmed');
  });
});
