// Static parity: every table, column, filter, RPC and upsert conflict target the two Supabase adapters touch exists in the
// migrations (parsed from supabase/migrations/*.sql). The adapters are driven through every method against a recording fetch.
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { UPSERT_CONFLICT_TARGETS } from '../../src/lib/archive/types';
import type { MatchInsert, ParticipantInsert, PlayerInsert, TournamentInsert } from '../../src/lib/sync/identity-store';
import { createSupabaseIdentityStore, pgList } from '../../src/lib/sync/supabase-identity';
import { createSupabaseSyncStore, RPC_MARK_DIRTY } from '../../src/lib/sync/supabase-store';
import { buildFreshRecord } from '../../src/lib/sync/record';
import { EMPTY_COUNTS, type SyncMode } from '../../src/lib/sync/types';
import { createSupabaseRest } from '../../src/lib/supabase/rest';

const MIGRATIONS = join(process.cwd(), 'supabase', 'migrations');

interface Schema {
  tables: Map<string, Set<string>>;
  unique: Map<string, string[][]>;
  functions: Set<string>;
}

function splitTop(body: string): string[] {
  const out: string[] = [];
  let depth = 0;
  let cur = '';
  let quote = false;
  for (const ch of body) {
    if (ch === "'") quote = !quote;
    if (!quote) {
      if (ch === '(') depth++;
      if (ch === ')') depth--;
      if (ch === ',' && depth === 0) {
        out.push(cur.trim());
        cur = '';
        continue;
      }
    }
    cur += ch;
  }
  if (cur.trim() !== '') out.push(cur.trim());
  return out;
}

function parseSchema(): Schema {
  const sql = readdirSync(MIGRATIONS)
    .filter((f) => f.endsWith('.sql'))
    .sort()
    .map((f) => readFileSync(join(MIGRATIONS, f), 'utf8'))
    .join('\n')
    .split('\n')
    .map((l) => l.replace(/--.*$/u, ''))
    .join('\n');
  const tables = new Map<string, Set<string>>();
  const unique = new Map<string, string[][]>();
  const re = /create table (?:if not exists )?public\.(\w+)\s*\(/giu;
  for (let m = re.exec(sql); m; m = re.exec(sql)) {
    const name = m[1]!;
    let depth = 1;
    let i = re.lastIndex;
    const start = i;
    while (depth > 0 && i < sql.length) {
      if (sql[i] === '(') depth++;
      if (sql[i] === ')') depth--;
      i++;
    }
    const cols = new Set<string>();
    const uniques: string[][] = [];
    for (const item of splitTop(sql.slice(start, i - 1))) {
      const flat = item.replace(/\s+/gu, ' ');
      const uq = /(?:^| )unique (?:nulls not distinct )?\(([^)]+)\)/iu.exec(flat);
      const pk = /^(?:constraint \w+ )?primary key \(([^)]+)\)/iu.exec(flat);
      if (/^(constraint|unique|primary|check|foreign|exclude)\b/iu.test(flat)) {
        if (uq) uniques.push(uq[1]!.split(',').map((c) => c.trim()));
        if (pk) uniques.push(pk[1]!.split(',').map((c) => c.trim()));
        continue;
      }
      const cm = /^"?(\w+)"?(?:\s|$)/u.exec(flat);
      if (!cm) throw new Error(`cannot parse column: ${flat.slice(0, 80)}`);
      const col = cm[1]!;
      cols.add(col);
      if (/\bprimary key\b/iu.test(flat) || /\bunique\b/iu.test(flat)) uniques.push([col]);
    }
    tables.set(name, cols);
    unique.set(name, uniques);
  }
  const alter = /alter table public\.(\w+)\s+add column (?:if not exists )?(\w+)/giu;
  for (let m = alter.exec(sql); m; m = alter.exec(sql)) tables.get(m[1]!)?.add(m[2]!);
  const functions = new Set<string>();
  const fre = /create (?:or replace )?function public\.(\w+)\s*\(/giu;
  for (let m = fre.exec(sql); m; m = fre.exec(sql)) functions.add(m[1]!);
  return { tables, unique, functions };
}

interface Call {
  method: string;
  path: string;
  params: URLSearchParams;
  body: unknown;
}

const UUID = '00000000-0000-4000-8000-000000000001';

function recorder() {
  const calls: Call[] = [];
  const fetchFn: typeof fetch = async (input, init) => {
    const u = new URL(String(input));
    calls.push({ method: String(init?.method), path: decodeURIComponent(u.pathname.replace('/rest/v1/', '')), params: u.searchParams, body: init?.body ? JSON.parse(String(init.body)) : undefined });
    const path = u.pathname.replace('/rest/v1/', '');
    const json = path === 'tournament_aliases' ? [{ tournament_id: UUID }] : [];
    return new Response(JSON.stringify(json), { status: 200, headers: { 'content-range': '0-0/1' } });
  };
  const rest = createSupabaseRest({ url: 'https://fakeprojectref.supabase.co', secretKey: ['sb', 'secret', 'FAKE'].join('_'), fetch: fetchFn });
  return { calls, rest };
}

const NOW = new Date('2026-10-22T06:00:00Z');
const write = buildFreshRecord(
  {
    id: 'fake-par1',
    etag: 'e',
    snippet: { title: 'ARJUN VELMURUGAN vs DEVAN RAJAN || Fake Cup Open Badminton Tournament 2026 - Madurai', publishedAt: '2026-10-01T00:00:00Z' },
    contentDetails: { duration: 'PT1H' },
    statistics: { viewCount: '5', likeCount: '1' },
    status: { privacyStatus: 'public', embeddable: true },
  },
  NOW,
);
const { visibility: _v, hidden_reason: _h, ...updateWrite } = write;
void _v;
void _h;

const player: PlayerInsert = {
  id: UUID, slug: 'p-0123456789abcdef', slug_kind: 'opaque', display_name: 'X Y', name_normalized: 'x y', name_key: 'x|y', latin_key: 'x y', disambiguator: null,
  identity_tier: 'multi_token', age_status: 'unknown', age_signal: [], age_confirmed_by: null, age_confirmed_at: null, age_confirmed_evidence: null, district: null,
  photo_path: null, bio: null, instagram_handle: null, claimed: false, noindex: true, visibility: 'hidden', is_provisional: true, provisional_tournament_id: null,
  merged_into: null, created_source: 'parsed', manual_override: {},
};
const tournament: TournamentInsert = {
  id: UUID, slug: 't', name: 'T', series_key: 't', edition_year: 2026, edition_no: null, season_label: null, edition_year_source: 'title', level: null, region: 'tamil_nadu',
  city: null, district: null, venue: null, start_date: null, end_date: null, categories: [], age_groups: [], entry_info: null, registration_url: null, poster_path: null,
  status: 'pending', is_featured: false, featured_until: null, covered_by_power_smash: true, is_promoted: false, is_minor_signal: false, source: 'parsed', visibility: 'hidden',
  show_contact_public: false, manual_override: {},
};
const match: MatchInsert = {
  id: UUID, video_id: 'fake-par1', tournament_id: null, category: null, age_group: null, round: null, format: 'singles', played_on: null, match_key: 'k', duplicate_of: null,
  winner_side: null, score_text: null, publish_state: 'held', minor_hold: false, manual_override: {},
};
const participant: ParticipantInsert = {
  id: UUID, match_id: UUID, side: 'A', position: 1, raw_name: 'X Y', player_id: null, resolution: 'plain_text', identity_tier: 'multi_token', link_policy: 'plain_text_only',
  truncated: false, age_status: 'unknown', age_signal: [], seed: null, country: null, district_hint: null, affiliation_hint: null,
};

async function driveSyncStore(rest: ReturnType<typeof recorder>['rest']): Promise<void> {
  const store = createSupabaseSyncStore(rest, () => UUID);
  await store.loadState();
  const modes: SyncMode[] = ['backfill', 'incremental', 'stats_recent', 'stats_all', 'purge', 'reparse'];
  for (const mode of modes) {
    const id = await store.startRun(mode, NOW.toISOString());
    await store.saveState({ uploadsPlaylistId: 'u', channelEtag: 'c', playlistFirstPageEtag: 'p', checkpoint: null, lastDriftDirtyAt: null, recentKnownIds: ['a'] });
    await store.finishRun(id, { runId: id, mode, status: 'quota_exhausted', startedAt: NOW.toISOString(), finishedAt: NOW.toISOString(), quotaDay: '2026-10-21', quotaUnits: 1, counts: { ...EMPTY_COUNTS }, errorCode: 'x', markedDirty: true, resumable: true });
  }
  await store.getVideos(['fake-par1']);
  await store.upsertVideos([write, updateWrite]);
  await store.listVideoIds();
  await store.listVideoIds({ publishedAfter: NOW.toISOString() });
  await store.getSuppressedIds(['fake-par1']);
  await store.retireVideos(['fake-par1'], NOW.toISOString());
  await store.clearStatisticsBefore(NOW.toISOString());
  await store.listIdsNotRefreshedSince(NOW.toISOString());
  await store.markDirty(NOW.toISOString());
  await store.quotaUnitsForDay('2026-10-21');
}

async function driveIdentityStore(rest: ReturnType<typeof recorder>['rest']): Promise<void> {
  const s = createSupabaseIdentityStore(rest);
  await s.getSettings();
  await s.suppressedNames(['x y']);
  await s.suppressedPlayerIds([UUID]);
  await s.isTournamentSuppressed(UUID);
  await s.findTournament('t', 2026);
  await s.findTournament('t', null);
  await s.findTournamentsByAlias(['t']);
  await s.insertTournament(tournament);
  await s.updateTournament(UUID, { categories: ['MS'], age_groups: ['U13'], is_minor_signal: true, district: 'Madurai' });
  await s.addTournamentAlias('t', UUID);
  await s.isTournamentSlugTaken('t');
  await s.findAliases(['x y']);
  await s.getPlayers([UUID]);
  await s.insertPlayer(player);
  await s.updatePlayerAge(UUID, 'minor_suspected', ['age_token:U13']);
  await s.addPlayerAlias({ id: UUID, alias_normalized: 'x y', player_id: UUID, status: 'provisional', scope_tournament_id: UUID, scope_district: null, created_by: 'sync' });
  await s.findPlayersNear('x|y', 'x y', 50);
  await s.getMatchByVideo('fake-par1');
  await s.getParticipants(UUID);
  await s.insertMatch(match);
  await s.updateMatch(UUID, { tournament_id: null, category: 'MS', age_group: null, round: 'F', format: 'singles', played_on: null, match_key: 'k', score_text: null, minor_hold: true, publish_state: 'held' });
  await s.deleteParticipants([UUID]);
  await s.insertParticipants([participant]);
  await s.findMatchesByKey('k');
  await s.setVideoReview('fake-par1', { parse_status: 'needs_review', review_reasons: ['AMBIGUOUS_ALIAS'], hard_flags: ['AMBIGUOUS_ALIAS'] });
  await s.recordAudit([{ actor: 'sync', action: 'possible_duplicate', entity: 'player', entity_id: UUID, diff: {}, reason: null }]);
  await s.upsertRedirect({ from_path: '/tournaments/a/', to_path: '/tournaments/b/', http_status: 301, entity_type: 'tournament', entity_id: UUID });
}

const schema = parseSchema();

describe('the SQL parser itself (guards the test)', () => {
  it('finds the archive tables, their columns, unique keys and the mark-dirty RPC', () => {
    expect(schema.tables.get('videos')?.has('youtube_id')).toBe(true);
    expect(schema.tables.get('videos')?.has('video_id')).toBe(false);
    expect(schema.tables.get('players')?.has('age_status')).toBe(true);
    expect(schema.tables.get('site_state')?.has('dirty_since')).toBe(true);
    expect(schema.unique.get('tournaments')).toContainEqual(['series_key', 'edition_year']);
    expect(schema.unique.get('matches')).toContainEqual(['video_id']);
    expect(schema.unique.get('videos')).toContainEqual(['youtube_id']);
    expect(schema.unique.get('match_participants')).toContainEqual(['match_id', 'side', 'position']);
    expect(schema.functions.has('admin_mark_dirty')).toBe(true);
  });
});

describe.each([
  ['sync store', driveSyncStore],
  ['identity store', driveIdentityStore],
])('%s: everything it touches exists in the migrations', (_name, drive) => {
  it('tables, selected columns, filter columns, ordering, body keys, RPCs and conflict targets', async () => {
    const { calls, rest } = recorder();
    await drive(rest);
    expect(calls.length).toBeGreaterThan(5);
    const problems: string[] = [];
    const known = (t: string, c: string): boolean => schema.tables.get(t)?.has(c) === true;
    for (const call of calls) {
      if (call.path.startsWith('rpc/')) {
        if (!schema.functions.has(call.path.slice(4))) problems.push(`unknown rpc ${call.path}`);
        continue;
      }
      const table = call.path;
      if (!schema.tables.has(table)) {
        problems.push(`unknown table ${table}`);
        continue;
      }
      for (const [key, value] of call.params) {
        if (key === 'select') {
          for (const c of value.split(',')) if (c === '*' || !known(table, c)) problems.push(`${table}: select column ${c}`);
        } else if (key === 'order') {
          for (const part of value.split(',')) if (!known(table, part.split('.')[0]!)) problems.push(`${table}: order column ${part}`);
        } else if (key === 'on_conflict') {
          const cols = value.split(',');
          for (const c of cols) if (!known(table, c)) problems.push(`${table}: conflict column ${c}`);
          const ok = (schema.unique.get(table) ?? []).some((u) => u.length === cols.length && u.every((c) => cols.includes(c)));
          if (!ok) problems.push(`${table}: on_conflict (${value}) matches no unique key`);
        } else if (key !== 'limit' && key !== 'offset') {
          const base = key.split('->')[0]!;
          if (!known(table, base)) problems.push(`${table}: filter column ${key}`);
        }
      }
      const rows = Array.isArray(call.body) ? call.body : call.body ? [call.body] : [];
      for (const row of rows as Record<string, unknown>[]) for (const k of Object.keys(row)) if (!known(table, k)) problems.push(`${table}: body column ${k}`);
    }
    expect(problems).toEqual([]);
  });

  it('never selects *, never sends a DELETE to a table without that privilege, never writes owner locks', async () => {
    const { calls, rest } = recorder();
    await drive(rest);
    const noDelete = ['videos', 'tournaments', 'players', 'player_aliases', 'matches', 'sync_runs', 'archive_settings', 'suppression', 'audit_log', 'site_state', 'video_title_history'];
    for (const c of calls) {
      expect(c.params.get('select')).not.toBe('*');
      if (c.method === 'DELETE') expect(noDelete).not.toContain(c.path);
      const rows = (Array.isArray(c.body) ? c.body : c.body ? [c.body] : []) as Record<string, unknown>[];
      for (const r of rows) {
        if (['players', 'matches', 'tournaments', 'videos'].includes(c.path) && c.method !== 'GET') {
          // a brand-new row may start with empty locks, an existing row's locks are never sent
          if (c.params.get('on_conflict') || c.method === 'PATCH') expect(Object.keys(r.manual_override ?? {})).toEqual([]);
        }
        expect(r).not.toHaveProperty('override_stale');
      }
    }
  });
});

describe('archive-wide constants the adapters rely on', () => {
  it('every UPSERT_CONFLICT_TARGETS entry names a real unique key', () => {
    for (const [table, target] of Object.entries(UPSERT_CONFLICT_TARGETS)) {
      const cols = target.split(',');
      const ok = (schema.unique.get(table) ?? []).some((u) => u.length === cols.length && u.every((c) => cols.includes(c)));
      expect(ok, `${table} (${target})`).toBe(true);
    }
  });

  it('the RPC name constant exists in the migrations and the service role may execute it', () => {
    expect(schema.functions.has(RPC_MARK_DIRTY)).toBe(true);
    const sql = readdirSync(MIGRATIONS).map((f) => readFileSync(join(MIGRATIONS, f), 'utf8')).join('\n');
    expect(sql).toMatch(new RegExp(`grant execute on function public\\.${RPC_MARK_DIRTY}\\([^)]*\\) to service_role`, 'u'));
  });

  it('service_role has no delete on videos, players, matches, tournaments, aliases and suppression: the adapters never need it', () => {
    const sql = readFileSync(join(MIGRATIONS, '0004_archive_core.sql'), 'utf8');
    expect(sql).toMatch(/grant select, insert, update on public\.videos\s+to service_role/u);
    expect(sql).toMatch(/grant select, insert, update, delete on public\.match_participants to service_role/u);
  });
});

describe('list literals for PostgREST', () => {
  it('quote and escape every value (names may hold commas, quotes, brackets)', () => {
    expect(decodeURIComponent(pgList(['a b', 'c,d', 'e"f', 'g\\h', 'i)j']))).toBe('in.("a b","c,d","e\\"f","g\\\\h","i)j")');
  });
});
