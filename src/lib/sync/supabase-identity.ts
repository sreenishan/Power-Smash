/**
 * IdentityStore over Supabase REST (same conventions as supabase-store.ts). Real table and column names from migrations 0004 and
 * 0005; row types and column lists from src/lib/archive/types.ts; mocked-fetch tested only. Every read uses explicit columns.
 *
 * The database enforces the rules this layer relies on, whatever the code does: protected-player check and trigger (D-012),
 * suppression triggers (D-014), field locks on matches and tournaments (PC-20), unique keys used as upsert targets (PC-21),
 * participant table checks (PC-01, PC-18). Possible duplicates are written to the append-only `audit_log` (actor "sync").
 */
import {
  ARCHIVE_SETTING_DEFAULTS,
  ARCHIVE_SETTING_KEYS,
  MATCH_COLUMNS,
  MATCH_PARTICIPANT_COLUMNS,
  PLAYER_ALIAS_COLUMNS,
  PLAYER_COLUMNS,
  TOURNAMENT_COLUMNS,
  UPSERT_CONFLICT_TARGETS,
  type ArchiveSettingValues,
  type MatchParticipantRow,
  type MatchRow,
  type PlayerAliasRow,
  type PlayerRow,
  type TournamentRow,
} from '../archive/types';
import type { Row, SupabaseRest } from '../supabase/rest';
import type { IdentityStore } from './identity-store';

export const PAGE_SIZE = 1000;
const BATCH = 50;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/u;

/** PostgREST list literal: each value double-quoted (backslash and quote escaped), the whole list URL-encoded. */
export function pgList(values: readonly string[]): string {
  return `in.(${encodeURIComponent(values.map((v) => `"${v.replaceAll('\\', '\\\\').replaceAll('"', '\\"')}"`).join(','))})`;
}

function batches<T>(items: readonly T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
  return out;
}

const eq = (v: string): string => `eq.${encodeURIComponent(v)}`;

export function createSupabaseIdentityStore(rest: SupabaseRest): IdentityStore {
  const sel = {
    tournaments: TOURNAMENT_COLUMNS.join(','),
    players: PLAYER_COLUMNS.join(','),
    aliases: PLAYER_ALIAS_COLUMNS.join(','),
    matches: MATCH_COLUMNS.join(','),
    participants: MATCH_PARTICIPANT_COLUMNS.join(','),
  };
  const uuids = (ids: readonly string[]): string[] => ids.filter((i) => UUID.test(i));

  return {
    async getSettings() {
      const rows = await rest.select<{ key: string; value: string }>('archive_settings', `select=key,value&key=${pgList(ARCHIVE_SETTING_KEYS)}`);
      const out: Record<string, string> = { ...ARCHIVE_SETTING_DEFAULTS };
      for (const r of rows) if ((ARCHIVE_SETTING_KEYS as readonly string[]).includes(r.key)) out[r.key] = r.value;
      return out as unknown as ArchiveSettingValues;
    },

    async suppressedNames(normalised) {
      const found = new Set<string>();
      for (const group of batches([...normalised], BATCH)) {
        const rows = await rest.select<{ value: string }>('suppression', `select=value&kind=eq.name_normalized&released_at=is.null&value=${pgList(group)}&limit=${PAGE_SIZE}`);
        for (const r of rows) found.add(r.value);
      }
      return found;
    },
    async suppressedPlayerIds(ids) {
      const found = new Set<string>();
      for (const group of batches(uuids(ids), BATCH)) {
        const rows = await rest.select<{ value: string }>('suppression', `select=value&kind=eq.player_id&released_at=is.null&value=${pgList(group)}&limit=${PAGE_SIZE}`);
        for (const r of rows) found.add(r.value);
      }
      return found;
    },
    async isTournamentSuppressed(id) {
      if (!UUID.test(id)) return false;
      const rows = await rest.select('suppression', `select=value&kind=eq.tournament_id&released_at=is.null&value=${eq(id)}&limit=1`);
      return rows.length > 0;
    },

    async findTournament(seriesKey, editionYear) {
      const year = editionYear === null ? 'is.null' : `eq.${editionYear}`;
      const rows = await rest.select<TournamentRow>('tournaments', `select=${sel.tournaments}&series_key=${eq(seriesKey)}&edition_year=${year}&limit=1`);
      return rows[0] ?? null;
    },
    async findTournamentsByAlias(aliases) {
      if (aliases.length === 0) return [];
      const links = await rest.select<{ tournament_id: string }>('tournament_aliases', `select=tournament_id&alias_normalized=${pgList(aliases)}&limit=${PAGE_SIZE}`);
      const ids = uuids([...new Set(links.map((l) => l.tournament_id))]);
      if (ids.length === 0) return [];
      return rest.select<TournamentRow>('tournaments', `select=${sel.tournaments}&id=${pgList(ids)}&limit=${PAGE_SIZE}`);
    },
    async insertTournament(row) {
      await rest.insert('tournaments', row as unknown as Row);
    },
    async updateTournament(id, patch) {
      await rest.update('tournaments', `id=${eq(id)}`, patch as Row);
    },
    async addTournamentAlias(aliasNormalised, tournamentId) {
      await rest.insert('tournament_aliases', { alias_normalized: aliasNormalised, tournament_id: tournamentId }, { onConflict: UPSERT_CONFLICT_TARGETS.tournament_aliases, ignoreDuplicates: true });
    },
    async isTournamentSlugTaken(slug) {
      const rows = await rest.select('tournaments', `select=slug&slug=${eq(slug)}&limit=1`);
      return rows.length > 0;
    },

    async findAliases(normalised) {
      const out: PlayerAliasRow[] = [];
      for (const group of batches([...normalised], BATCH)) out.push(...(await rest.select<PlayerAliasRow>('player_aliases', `select=${sel.aliases}&alias_normalized=${pgList(group)}&limit=${PAGE_SIZE}`)));
      return out;
    },
    async getPlayers(ids) {
      const out: PlayerRow[] = [];
      for (const group of batches(uuids(ids), BATCH)) out.push(...(await rest.select<PlayerRow>('players', `select=${sel.players}&id=${pgList(group)}&limit=${PAGE_SIZE}`)));
      return out;
    },
    async insertPlayer(row) {
      await rest.insert('players', row as unknown as Row);
    },
    async updatePlayerAge(id, status, signals) {
      await rest.update('players', `id=${eq(id)}`, { age_status: status, age_signal: signals });
    },
    async addPlayerAlias(row) {
      await rest.insert('player_aliases', row as unknown as Row, { onConflict: UPSERT_CONFLICT_TARGETS.player_aliases, ignoreDuplicates: true });
    },
    async findPlayersNear(nameKey, latinPrefix, limit) {
      const out = new Map<string, PlayerRow>();
      const cap = Math.min(limit, PAGE_SIZE);
      if (nameKey !== null) for (const p of await rest.select<PlayerRow>('players', `select=${sel.players}&merged_into=is.null&name_key=${eq(nameKey)}&limit=${cap}`)) out.set(p.id, p);
      if (latinPrefix !== null && /^[a-z0-9 ]{1,10}$/u.test(latinPrefix)) {
        for (const p of await rest.select<PlayerRow>('players', `select=${sel.players}&merged_into=is.null&latin_key=like.${encodeURIComponent(`${latinPrefix}*`)}&limit=${cap}`)) out.set(p.id, p);
      }
      return [...out.values()].slice(0, limit);
    },

    async getMatchByVideo(videoId) {
      const rows = await rest.select<MatchRow>('matches', `select=${sel.matches}&video_id=${eq(videoId)}&limit=1`);
      return rows[0] ?? null;
    },
    async getParticipants(matchId) {
      return rest.select<MatchParticipantRow>('match_participants', `select=${sel.participants}&match_id=${eq(matchId)}&order=side.asc,position.asc&limit=${PAGE_SIZE}`);
    },
    async insertMatch(row) {
      await rest.insert('matches', row as unknown as Row, { onConflict: UPSERT_CONFLICT_TARGETS.matches, ignoreDuplicates: true });
    },
    async updateMatch(id, patch) {
      await rest.update('matches', `id=${eq(id)}`, patch as Row);
    },
    async deleteParticipants(ids) {
      for (const group of batches(uuids(ids), BATCH)) await rest.remove('match_participants', `id=${pgList(group)}`);
    },
    async insertParticipants(rows) {
      for (const group of batches([...rows], BATCH)) await rest.insert('match_participants', group as unknown as Row[], { onConflict: UPSERT_CONFLICT_TARGETS.match_participants });
    },
    async findMatchesByKey(matchKey) {
      return rest.select<MatchRow>('matches', `select=${sel.matches}&match_key=${eq(matchKey)}&limit=50`);
    },

    async setVideoReview(videoId, patch) {
      await rest.update('videos', `youtube_id=${eq(videoId)}`, patch as Row);
    },
    async recordAudit(rows) {
      for (const group of batches([...rows], BATCH)) await rest.insert('audit_log', group as unknown as Row[]);
    },
    async upsertRedirect(row) {
      await rest.insert('slug_redirects', row as unknown as Row, { onConflict: UPSERT_CONFLICT_TARGETS.slug_redirects });
    },
  };
}
