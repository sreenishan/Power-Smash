/**
 * The store the identity-resolution step runs against (spec 10.5, PC-01, PC-02, PC-11, PC-18, D-012, D-013, D-014).
 * Implemented by `memory-archive.ts` (tests, dry runs) and `supabase-identity.ts` (REST, mocked-fetch tested only).
 * Row types come from src/lib/archive/types.ts. Ids are made by the caller (uuid), so inserts need no read-back.
 */
import type {
  AgeStatus,
  ArchiveSettingValues,
  AuditLogRow,
  MatchParticipantRow,
  MatchRow,
  PlayerAliasRow,
  PlayerRow,
  SlugRedirectRow,
  TournamentRow,
} from '../archive/types';

type Generated = 'created_at' | 'updated_at';

export type PlayerInsert = Omit<PlayerRow, Generated>;
export type TournamentInsert = Omit<TournamentRow, Generated>;
export type MatchInsert = Omit<MatchRow, Generated>;
export type ParticipantInsert = Omit<MatchParticipantRow, 'created_at'>;
export type PlayerAliasInsert = Omit<PlayerAliasRow, 'created_at'>;
export type AuditInsert = Omit<AuditLogRow, 'id' | 'ts'>;
export type RedirectInsert = Omit<SlugRedirectRow, 'created_at'>;

export interface IdentityStore {
  /** archive_settings with the owner's defaults filled in for a missing key. */
  getSettings(): Promise<ArchiveSettingValues>;

  // suppression tombstones (D-014); only ACTIVE (not released) rows count
  suppressedNames(normalised: readonly string[]): Promise<Set<string>>;
  suppressedPlayerIds(ids: readonly string[]): Promise<Set<string>>;
  isTournamentSuppressed(id: string): Promise<boolean>;

  // tournaments (PC-11: the key is series_key + edition_year; spelling variants are aliases)
  findTournament(seriesKey: string, editionYear: number | null): Promise<TournamentRow | null>;
  findTournamentsByAlias(aliases: readonly string[]): Promise<TournamentRow[]>;
  insertTournament(row: TournamentInsert): Promise<void>;
  updateTournament(id: string, patch: Partial<Pick<TournamentRow, 'categories' | 'age_groups' | 'is_minor_signal' | 'district'>>): Promise<void>;
  addTournamentAlias(aliasNormalised: string, tournamentId: string): Promise<void>;
  isTournamentSlugTaken(slug: string): Promise<boolean>;

  // players and aliases (PC-02: an alias is never a key; more than one candidate is ambiguous)
  findAliases(normalised: readonly string[]): Promise<PlayerAliasRow[]>;
  getPlayers(ids: readonly string[]): Promise<PlayerRow[]>;
  insertPlayer(row: PlayerInsert): Promise<void>;
  /** Raise a PROTECTED player's status and merge signals (the database never lowers a status, D-012). */
  updatePlayerAge(id: string, status: AgeStatus, signals: string[]): Promise<void>;
  addPlayerAlias(row: PlayerAliasInsert): Promise<void>;
  /** Live players with this name key or a Latin key starting with the prefix (candidates for the duplicate queue only). */
  findPlayersNear(nameKey: string | null, latinPrefix: string | null, limit: number): Promise<PlayerRow[]>;

  // matches and participants
  getMatchByVideo(videoId: string): Promise<MatchRow | null>;
  getParticipants(matchId: string): Promise<MatchParticipantRow[]>;
  insertMatch(row: MatchInsert): Promise<void>;
  updateMatch(id: string, patch: Partial<Pick<MatchRow, 'tournament_id' | 'category' | 'age_group' | 'round' | 'format' | 'played_on' | 'match_key' | 'score_text' | 'minor_hold' | 'publish_state'>>): Promise<void>;
  deleteParticipants(ids: readonly string[]): Promise<void>;
  insertParticipants(rows: readonly ParticipantInsert[]): Promise<void>;
  findMatchesByKey(matchKey: string): Promise<MatchRow[]>;

  /** The video's review state after the identity step (AMBIGUOUS_ALIAS added or cleared). Respects the parse_status lock in the database. */
  setVideoReview(videoId: string, patch: { parse_status: 'parsed' | 'needs_review'; review_reasons: string[]; hard_flags: string[] }): Promise<void>;

  /** The admin's queue: possible duplicates are WRITTEN here and never merged (append-only audit_log, actor "sync"). */
  recordAudit(rows: readonly AuditInsert[]): Promise<void>;
  upsertRedirect(row: RedirectInsert): Promise<void>;
}
