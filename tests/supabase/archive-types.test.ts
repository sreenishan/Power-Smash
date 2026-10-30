// The TypeScript archive types (src/lib/archive/types.ts) must not drift from the SQL (migrations 0004-0006): every column list, every enum
// list and every view / RPC name is compared with the migration text. No database needed.
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
  ADMIN_RPCS,
  AGE_STATUSES,
  AGE_STATUS_RANK,
  ALIAS_STATUSES,
  API_VIEWS,
  API_VIEW_COLUMNS,
  ARCHIVE_SETTING_DEFAULTS,
  ARCHIVE_SETTING_KEYS,
  FORMATS,
  MATCH_LOCKABLE_FIELDS,
  MATCH_PUBLISH_STATES,
  PARSE_STATUSES,
  PARTICIPANT_RESOLUTIONS,
  PLAYER_CREATED_SOURCES,
  PLAYER_LOCKABLE_FIELDS,
  PROTECTED_MATCH_MODES,
  REGIONS,
  SIDES,
  SLUG_KINDS,
  SUPPRESSION_ACTIONS,
  SUPPRESSION_KINDS,
  SYNC_MODES,
  SYNC_STATUSES,
  TABLE_COLUMNS,
  TOURNAMENT_LEVELS,
  TOURNAMENT_LOCKABLE_FIELDS,
  TOURNAMENT_SOURCES,
  TOURNAMENT_STATUSES,
  UPSERT_CONFLICT_TARGETS,
  VIDEO_LOCKABLE_FIELDS,
  VISIBILITIES,
  PLAYER_VISIBILITIES,
  effectiveAgeStatus,
  isProtectedPlayer,
  mostRestrictiveAge,
} from '../../src/lib/archive/types';
import { CATEGORIES, ROUNDS } from '../../src/lib/parser/types';
import { statementsOf } from './migration-rules';

const read = (f: string) => readFileSync(`supabase/migrations/${f}`, 'utf8');
const SQL = ['0004_archive_core.sql', '0005_archive_safety.sql', '0006_archive_api.sql', '0009_archive_purge.sql'].map(read).join('\n');
const STATEMENTS = statementsOf(SQL);

/** Top-level comma split of a parenthesised body. */
function splitTop(body: string): string[] {
  const out: string[] = [];
  let depth = 0;
  let cur = '';
  let inString = false;
  for (let i = 0; i < body.length; i += 1) {
    const ch = body[i] as string;
    if (inString) {
      cur += ch;
      if (ch === "'") inString = false;
      continue;
    }
    if (ch === "'") {
      inString = true;
      cur += ch;
    } else if (ch === '(') {
      depth += 1;
      cur += ch;
    } else if (ch === ')') {
      depth -= 1;
      cur += ch;
    } else if (ch === ',' && depth === 0) {
      out.push(cur.trim());
      cur = '';
    } else cur += ch;
  }
  if (cur.trim()) out.push(cur.trim());
  return out;
}

function tableColumns(): Record<string, string[]> {
  const out: Record<string, string[]> = {};
  for (const s of STATEMENTS) {
    const m = /^create table public\.([a-z_]+) \((.*)\)$/i.exec(s);
    if (!m) continue;
    out[m[1] as string] = splitTop(m[2] as string)
      .filter((item) => !/^(constraint|primary key|unique|check|foreign key)\b/i.test(item))
      .map((item) => (/^([a-z_]+)\s/i.exec(item)?.[1] ?? item) as string);
  }
  return out;
}

/** The quoted values of `check (<column> in ('a', 'b'))` of a named constraint. */
function checkValues(constraint: string): string[] {
  const s = STATEMENTS.join('\n');
  const re = new RegExp(`constraint ${constraint} check \\(([^\\n]*?)\\)(?:,|\\s*\\)?$|\\n)`, 'm');
  const found = re.exec(s);
  expect(found, `constraint ${constraint} not found`).not.toBeNull();
  return [...(found?.[1] as string).matchAll(/'([^']+)'/g)].map((x) => x[1] as string);
}
const sorted = (a: readonly string[]) => [...a].sort();

describe('TS column lists equal the SQL columns', () => {
  const sqlColumns = tableColumns();
  for (const [table, cols] of Object.entries(TABLE_COLUMNS)) {
    it(`public.${table}`, () => {
      expect(sqlColumns[table], `table ${table} not in the migrations`).toBeDefined();
      expect(sorted(cols)).toEqual(sorted(sqlColumns[table] as string[]));
    });
  }
  it('every archive table of the migrations has a TS column list', () => {
    expect(Object.keys(sqlColumns).sort()).toEqual(Object.keys(TABLE_COLUMNS).sort());
  });
});

describe('TS enum lists equal the SQL check constraints', () => {
  const cases: Array<[string, readonly string[], string]> = [
    ['videos.visibility', VISIBILITIES, 'videos_visibility_check'],
    ['videos.parse_status', PARSE_STATUSES, 'videos_parse_status_check'],
    ['tournaments.level', TOURNAMENT_LEVELS, 'tournaments_level_check'],
    ['tournaments.region', REGIONS, 'tournaments_region_check'],
    ['tournaments.status', TOURNAMENT_STATUSES, 'tournaments_status_check'],
    ['tournaments.source', TOURNAMENT_SOURCES, 'tournaments_source_check'],
    ['tournaments.visibility', VISIBILITIES, 'tournaments_visibility_check'],
    ['players.age_status', AGE_STATUSES, 'players_age_status_check'],
    ['players.visibility', PLAYER_VISIBILITIES, 'players_visibility_check'],
    ['players.slug_kind', SLUG_KINDS, 'players_slug_kind_check'],
    ['players.created_source', PLAYER_CREATED_SOURCES, 'players_created_source_check'],
    ['player_aliases.status', ALIAS_STATUSES, 'player_aliases_status_check'],
    ['matches.format', FORMATS, 'matches_format_check'],
    ['matches.round', ROUNDS, 'matches_round_check'],
    ['matches.category', CATEGORIES, 'matches_category_check'],
    ['matches.publish_state', MATCH_PUBLISH_STATES, 'matches_publish_state_check'],
    ['match_participants.side', SIDES, 'match_participants_side_check'],
    ['match_participants.resolution', PARTICIPANT_RESOLUTIONS, 'match_participants_resolution_check'],
    ['match_participants.age_status', AGE_STATUSES, 'match_participants_age_check'],
    ['suppression.kind', SUPPRESSION_KINDS, 'suppression_kind_check'],
    ['suppression.action', SUPPRESSION_ACTIONS, 'suppression_action_check'],
    ['sync_runs.mode', SYNC_MODES, 'sync_runs_mode_check'],
    ['sync_runs.status', SYNC_STATUSES, 'sync_runs_status_check'],
  ];
  for (const [label, list, constraint] of cases) {
    it(label, () => {
      expect(sorted(checkValues(constraint))).toEqual(sorted(list));
    });
  }

  it('the lock lists equal the manual_override check constraints', () => {
    const lockKeys = (constraint: string) => {
      const m = new RegExp(`constraint ${constraint} check \\(manual_override <@ '\\{([^']*)\\}'`).exec(SQL.replace(/\s+/g, ' '));
      expect(m, constraint).not.toBeNull();
      return [...(m?.[1] as string).matchAll(/"([a-z_]+)": true/g)].map((x) => x[1] as string);
    };
    expect(sorted(lockKeys('videos_manual_override_check'))).toEqual(sorted(VIDEO_LOCKABLE_FIELDS));
    expect(sorted(lockKeys('matches_manual_override_check'))).toEqual(sorted(MATCH_LOCKABLE_FIELDS));
    expect(sorted(lockKeys('players_manual_override_check'))).toEqual(sorted(PLAYER_LOCKABLE_FIELDS));
    expect(sorted(lockKeys('tournaments_manual_override_check'))).toEqual(sorted(TOURNAMENT_LOCKABLE_FIELDS));
  });

  it('the settings: keys, allowed values and seeded defaults equal the SQL', () => {
    const flat = SQL.replace(/\s+/g, ' ');
    for (const key of ARCHIVE_SETTING_KEYS) expect(flat, key).toContain(`key = '${key}'`);
    for (const key of ['unknown_match_mode', 'minor_match_mode'] as const) {
      expect(flat).toContain(`(key = '${key}' and value in (${PROTECTED_MATCH_MODES.map((v) => `'${v}'`).join(', ')}))`);
    }
    // the owner's decisions (D-012, D-018) are the seeded defaults
    expect(ARCHIVE_SETTING_DEFAULTS).toEqual({ unknown_match_mode: 'noindex_minimal', minor_match_mode: 'hidden', non_tn_tournament_pages: 'off', auto_publish_clean_parses: 'true' });
    for (const [k, v] of Object.entries(ARCHIVE_SETTING_DEFAULTS)) expect(flat, k).toContain(`('${k}', '${v}')`);
  });
});

describe('views and RPCs', () => {
  it('API_VIEWS equals the views created in schema api, and the column lists equal their select lists', () => {
    // the LATEST definition of each archive view wins: 0012 re-creates api.public_players with academy appended (D-100)
    const latest = new Map<string, string>();
    for (const s of [...STATEMENTS, ...statementsOf(read('0012_player_profile.sql'))]) {
      const name = /^create (?:or replace )?view api\.([a-z_]+)/i.exec(s)?.[1];
      if (name) latest.set(name, s);
    }
    const created = [...latest.values()];
    expect([...latest.keys()].sort()).toEqual(sorted(API_VIEWS));
    for (const s of created) {
      const name = /^create (?:or replace )?view api\.([a-z_]+)/i.exec(s)?.[1] as keyof typeof API_VIEW_COLUMNS;
      const select = /\bas select (.*?) from public\./i.exec(s)?.[1] as string;
      expect(select, name).toBeDefined();
      const cols = splitTop(select).map((item) => {
        const alias = /\bas ([a-z_]+)$/i.exec(item)?.[1];
        if (alias) return alias;
        const plain = /^(?:[a-z_]+\.)?([a-z_]+)$/i.exec(item.trim())?.[1];
        expect(plain, `${name}: cannot read a column name from "${item}"`).toBeDefined();
        return plain as string;
      });
      expect(cols, name).toEqual([...API_VIEW_COLUMNS[name]]);
    }
  });

  it('ADMIN_RPCS equals the admin functions of the SQL', () => {
    const fns = STATEMENTS.map((s) => /^create (?:or replace )?function public\.(admin_[a-z_]+)\(/i.exec(s)?.[1]).filter(Boolean) as string[];
    expect(sorted(fns)).toEqual(sorted(ADMIN_RPCS));
  });

  it('upsert conflict targets name real unique keys', () => {
    const flat = SQL.replace(/\s+/g, ' ');
    expect(flat).toContain('youtube_id text primary key');
    expect(flat).toContain('constraint matches_video_unique unique (video_id)');
    expect(flat).toContain('constraint match_participants_position_unique unique (match_id, side, position)');
    expect(flat).toContain('constraint player_aliases_unique unique (alias_normalized, player_id)');
    expect(flat).toContain('constraint tournament_aliases_unique unique (alias_normalized, tournament_id)');
    expect(flat).toContain('constraint tournaments_series_edition_unique unique nulls not distinct (series_key, edition_year)');
    expect(flat).toContain('from_path text primary key');
    expect(flat).toContain('constraint suppression_kind_value_unique unique (kind, value)');
    expect(Object.keys(UPSERT_CONFLICT_TARGETS).sort()).toEqual(['archive_settings', 'match_participants', 'matches', 'player_aliases', 'slug_redirects', 'suppression', 'tournament_aliases', 'tournaments', 'videos']);
  });
});

describe('age helpers mirror the SQL', () => {
  it('the rank order equals app.age_rank', () => {
    const flat = SQL.replace(/\s+/g, ' ');
    for (const [status, rank] of Object.entries(AGE_STATUS_RANK)) expect(flat, status).toContain(`when '${status}' then ${rank}`);
  });
  it('protected is everything except adult_confirmed (D-012)', () => {
    expect(AGE_STATUSES.filter(isProtectedPlayer).sort()).toEqual(['minor_confirmed', 'minor_suspected', 'unknown']);
  });
  it('merge: the more restrictive status wins', () => {
    expect(mostRestrictiveAge('adult_confirmed', 'unknown')).toBe('unknown');
    expect(mostRestrictiveAge('minor_suspected', 'adult_confirmed')).toBe('minor_suspected');
    expect(mostRestrictiveAge('minor_confirmed', 'minor_suspected')).toBe('minor_confirmed');
  });
  it('effective status: a parser unknown does not override an adult_confirmed player, a minor signal always wins', () => {
    expect(effectiveAgeStatus('unknown', 'adult_confirmed')).toBe('adult_confirmed');
    expect(effectiveAgeStatus('unknown', null)).toBe('unknown');
    expect(effectiveAgeStatus('minor_suspected', 'adult_confirmed')).toBe('minor_suspected');
    expect(effectiveAgeStatus('unknown', 'minor_suspected')).toBe('minor_suspected');
    expect(effectiveAgeStatus('adult_confirmed', 'unknown')).toBe('unknown');
  });
});
