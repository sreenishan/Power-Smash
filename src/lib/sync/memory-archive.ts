/**
 * In-memory IdentityStore for tests and dry runs (fictional data only). It mimics the database rules around the identity step:
 * a player cannot be created adult_confirmed, a protected player has no profile data, the sync never lowers an age status,
 * unique keys (tournament series + year, slug, alias + player, match video) are enforced, participants follow the table checks.
 */
import { AGE_STATUS_RANK, ARCHIVE_SETTING_DEFAULTS, type AgeStatus, type ArchiveSettingValues, type AuditLogRow, type MatchParticipantRow, type MatchRow, type PlayerAliasRow, type PlayerRow, type SlugRedirectRow, type TournamentRow } from '../archive/types';
import type { AuditInsert, IdentityStore, MatchInsert, ParticipantInsert, PlayerAliasInsert, PlayerInsert, RedirectInsert, TournamentInsert } from './identity-store';

const EPOCH = '1970-01-01T00:00:00.000Z';

export class MemoryArchiveStore implements IdentityStore {
  settings: ArchiveSettingValues = { ...ARCHIVE_SETTING_DEFAULTS };
  readonly tournaments = new Map<string, TournamentRow>();
  readonly tournamentAliases: { alias_normalized: string; tournament_id: string }[] = [];
  readonly players = new Map<string, PlayerRow>();
  readonly playerAliases: PlayerAliasRow[] = [];
  readonly matches = new Map<string, MatchRow>();
  readonly participants = new Map<string, MatchParticipantRow>();
  readonly audit: AuditLogRow[] = [];
  readonly redirects = new Map<string, SlugRedirectRow>();
  /** Active tombstones (D-014). */
  readonly suppressedNameSet = new Set<string>();
  readonly suppressedPlayerSet = new Set<string>();
  readonly suppressedTournamentSet = new Set<string>();
  /** The parse_status etc. the identity step wrote to videos (id -> patch). */
  readonly videoReviews = new Map<string, { parse_status: string; review_reasons: string[]; hard_flags: string[] }>();
  /** Test hook: throw on the Nth insertMatch call. */
  failInsertMatchOnCall: number | null = null;
  private matchCalls = 0;
  private auditSeq = 0;

  /** `onVideoReview` lets a test apply the identity step's review patch to a MemorySyncStore row (the database does it with one PATCH). */
  constructor(private readonly onVideoReview?: (videoId: string, patch: { parse_status: 'parsed' | 'needs_review'; review_reasons: string[]; hard_flags: string[] }) => void) {}

  async getSettings(): Promise<ArchiveSettingValues> {
    return { ...this.settings };
  }
  async suppressedNames(normalised: readonly string[]): Promise<Set<string>> {
    return new Set(normalised.filter((n) => this.suppressedNameSet.has(n)));
  }
  async suppressedPlayerIds(ids: readonly string[]): Promise<Set<string>> {
    return new Set(ids.filter((n) => this.suppressedPlayerSet.has(n)));
  }
  async isTournamentSuppressed(id: string): Promise<boolean> {
    return this.suppressedTournamentSet.has(id);
  }

  async findTournament(seriesKey: string, editionYear: number | null): Promise<TournamentRow | null> {
    for (const t of this.tournaments.values()) if (t.series_key === seriesKey && t.edition_year === editionYear) return structuredClone(t);
    return null;
  }
  async findTournamentsByAlias(aliases: readonly string[]): Promise<TournamentRow[]> {
    const ids = new Set(this.tournamentAliases.filter((a) => aliases.includes(a.alias_normalized)).map((a) => a.tournament_id));
    return [...ids].flatMap((id) => (this.tournaments.has(id) ? [structuredClone(this.tournaments.get(id)!)] : []));
  }
  async insertTournament(row: TournamentInsert): Promise<void> {
    for (const t of this.tournaments.values()) {
      if (t.series_key === row.series_key && t.edition_year === row.edition_year) throw new Error('tournaments_series_edition_unique');
      if (t.slug === row.slug) throw new Error('tournaments_slug_key');
    }
    this.tournaments.set(row.id, { ...structuredClone(row), created_at: EPOCH, updated_at: EPOCH });
  }
  async updateTournament(id: string, patch: Parameters<IdentityStore['updateTournament']>[1]): Promise<void> {
    const t = this.tournaments.get(id);
    if (t) Object.assign(t, structuredClone(patch));
  }
  async addTournamentAlias(aliasNormalised: string, tournamentId: string): Promise<void> {
    if (!this.tournamentAliases.some((a) => a.alias_normalized === aliasNormalised && a.tournament_id === tournamentId)) this.tournamentAliases.push({ alias_normalized: aliasNormalised, tournament_id: tournamentId });
  }
  async isTournamentSlugTaken(slug: string): Promise<boolean> {
    return [...this.tournaments.values()].some((t) => t.slug === slug);
  }

  async findAliases(normalised: readonly string[]): Promise<PlayerAliasRow[]> {
    return this.playerAliases.filter((a) => normalised.includes(a.alias_normalized)).map((a) => structuredClone(a));
  }
  async getPlayers(ids: readonly string[]): Promise<PlayerRow[]> {
    return ids.flatMap((id) => (this.players.has(id) ? [structuredClone(this.players.get(id)!)] : []));
  }
  async insertPlayer(row: PlayerInsert): Promise<void> {
    if (row.age_status === 'adult_confirmed') throw new Error('a player cannot be created as adult_confirmed outside an admin action');
    if ((row.district || row.photo_path || row.bio || row.instagram_handle || !row.noindex || row.visibility !== 'hidden' || row.slug_kind !== 'opaque')) {
      throw new Error('players_protected_rules');
    }
    if ([...this.players.values()].some((p) => p.slug === row.slug)) throw new Error('players_slug_key');
    this.players.set(row.id, { ...structuredClone(row), created_at: EPOCH, updated_at: EPOCH });
  }
  async updatePlayerAge(id: string, status: AgeStatus, signals: string[]): Promise<void> {
    const p = this.players.get(id);
    if (!p) return;
    // trigger players_guard: never lower a status, signals only accumulate
    if (AGE_STATUS_RANK[status] >= AGE_STATUS_RANK[p.age_status]) p.age_status = status;
    p.age_signal = [...new Set([...p.age_signal, ...signals])].sort() as PlayerRow['age_signal'];
  }
  async addPlayerAlias(row: PlayerAliasInsert): Promise<void> {
    if (this.playerAliases.some((a) => a.alias_normalized === row.alias_normalized && a.player_id === row.player_id)) return;
    this.playerAliases.push({ ...structuredClone(row), created_at: EPOCH });
  }
  async findPlayersNear(nameKey: string | null, latinPrefix: string | null, limit: number): Promise<PlayerRow[]> {
    return [...this.players.values()]
      .filter((p) => p.merged_into === null && ((nameKey !== null && p.name_key === nameKey) || (latinPrefix !== null && p.latin_key !== null && p.latin_key.startsWith(latinPrefix))))
      .slice(0, limit)
      .map((p) => structuredClone(p));
  }

  async getMatchByVideo(videoId: string): Promise<MatchRow | null> {
    for (const m of this.matches.values()) if (m.video_id === videoId) return structuredClone(m);
    return null;
  }
  async getParticipants(matchId: string): Promise<MatchParticipantRow[]> {
    return [...this.participants.values()].filter((p) => p.match_id === matchId).map((p) => structuredClone(p));
  }
  async insertMatch(row: MatchInsert): Promise<void> {
    this.matchCalls++;
    if (this.failInsertMatchOnCall === this.matchCalls) throw new Error('memory_archive_forced_failure');
    if ([...this.matches.values()].some((m) => m.video_id === row.video_id)) throw new Error('matches_video_unique');
    const held = row.minor_hold ? 'held' : row.publish_state;
    this.matches.set(row.id, { ...structuredClone(row), publish_state: held, created_at: EPOCH, updated_at: EPOCH });
  }
  async updateMatch(id: string, patch: Parameters<IdentityStore['updateMatch']>[1]): Promise<void> {
    const m = this.matches.get(id);
    if (!m) return;
    const lock = m.manual_override; // trigger matches_guard puts a locked field back
    for (const [k, v] of Object.entries(patch)) if (!(lock as Record<string, boolean | undefined>)[k]) (m as unknown as Record<string, unknown>)[k] = v;
    if (m.minor_hold) m.publish_state = 'held';
  }
  async deleteParticipants(ids: readonly string[]): Promise<void> {
    for (const id of ids) this.participants.delete(id);
  }
  async insertParticipants(rows: readonly ParticipantInsert[]): Promise<void> {
    for (const r of rows) {
      if ([...this.participants.values()].some((p) => p.match_id === r.match_id && p.side === r.side && p.position === r.position)) throw new Error('match_participants_position_unique');
      if ((r.resolution === 'exact_alias' || r.resolution === 'provisional' || r.resolution === 'manual') !== (r.player_id !== null)) throw new Error('match_participants_link_matches_resolution');
      if (r.resolution !== 'manual' && r.player_id !== null && !(r.link_policy === 'provisional_ok' && r.identity_tier === 'multi_token' && !r.truncated)) throw new Error('match_participants_tier_rule');
      let row: MatchParticipantRow = { ...structuredClone(r), created_at: EPOCH };
      if (row.player_id !== null && this.suppressedPlayerSet.has(row.player_id)) row = { ...row, player_id: null, resolution: 'suppressed' };
      this.participants.set(row.id, row);
    }
  }
  async findMatchesByKey(matchKey: string): Promise<MatchRow[]> {
    return [...this.matches.values()].filter((m) => m.match_key === matchKey).map((m) => structuredClone(m));
  }

  async setVideoReview(videoId: string, patch: { parse_status: 'parsed' | 'needs_review'; review_reasons: string[]; hard_flags: string[] }): Promise<void> {
    this.videoReviews.set(videoId, structuredClone(patch));
    this.onVideoReview?.(videoId, patch);
  }
  async recordAudit(rows: readonly AuditInsert[]): Promise<void> {
    for (const r of rows) this.audit.push({ ...structuredClone(r), id: ++this.auditSeq, ts: EPOCH });
  }
  async upsertRedirect(row: RedirectInsert): Promise<void> {
    this.redirects.set(row.from_path, { ...structuredClone(row), created_at: EPOCH });
  }
}
