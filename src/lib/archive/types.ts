/**
 * Archive row and view types (M2, worker SCHEMA). Mirrors supabase/migrations/0004_archive_core.sql,
 * 0005_archive_safety.sql and 0006_archive_api.sql. Types and pure constants only; no I/O.
 *
 * Conventions (CLAUDE.md, D-005, D-012, D-017, D-030):
 *  - Instants are ISO-8601 strings (timestamptz, UTC). Event dates are 'YYYY-MM-DD' strings (Asia/Kolkata calendar).
 *  - NULL means "unknown" for category, round, age group, year (PC-23). There is no 'unknown' database value.
 *  - Row types (`*Row`) are PRIVATE: only the service_role (the sync, the admin Workers) reads them. The public build
 *    reads ONLY the `Public*` view shapes below, through the `api` schema with the publishable key.
 *  - The array/enum constants are the single TypeScript copy of the database check constraints. A test
 *    (tests/supabase/archive-types.test.ts) compares them with the SQL text so the two cannot drift.
 *  - This file is additive: other workers import from it, so new members may be added, existing ones are not renamed.
 */
import type {
  AgeGroup,
  AgeSignal,
  AgeStatus,
  Category,
  EntityBlockReason,
  HardFlag,
  IdentityTier,
  LinkPolicy,
  LiveStatus,
  ReviewReason,
  Round,
  VideoType,
  YearSource,
} from '../parser/types';

export type { AgeGroup, AgeSignal, AgeStatus, Category, IdentityTier, LinkPolicy, LiveStatus, Round, VideoType };

// ---------------------------------------------------------------------------
// Vocabulary (database enums are text columns with check constraints)
// ---------------------------------------------------------------------------

export const AGE_STATUSES = ['adult_confirmed', 'minor_confirmed', 'minor_suspected', 'unknown'] as const satisfies readonly AgeStatus[];

/** Restrictiveness rank used by merges, effective-status and the views (higher = more restrictive). */
export const AGE_STATUS_RANK: Readonly<Record<AgeStatus, number>> = {
  adult_confirmed: 0,
  unknown: 1,
  minor_suspected: 2,
  minor_confirmed: 3,
};

/** D-012: protected = every status except adult_confirmed. Same rule as the parser's `isProtectedAgeStatus`. */
export const isProtectedPlayer = (status: AgeStatus): boolean => status !== 'adult_confirmed';

/** The more restrictive of two statuses (merge rule, D-012). */
export function mostRestrictiveAge(a: AgeStatus, b: AgeStatus): AgeStatus {
  return AGE_STATUS_RANK[a] >= AGE_STATUS_RANK[b] ? a : b;
}

/** `videos.visibility` and `tournaments.visibility` (D-018 tri-state). New parser output starts `hidden` (SA-M31). */
export const VISIBILITIES = ['hidden', 'listed_no_player_pages', 'public'] as const;
export type Visibility = (typeof VISIBILITIES)[number];

/** `players.visibility`: players have no "listed" state. */
export const PLAYER_VISIBILITIES = ['hidden', 'public'] as const;
export type PlayerVisibility = (typeof PLAYER_VISIBILITIES)[number];

export const PARSE_STATUSES = ['parsed', 'needs_review', 'ignored'] as const;
export type ParseStatus = (typeof PARSE_STATUSES)[number];

export const TOURNAMENT_LEVELS = ['district', 'state', 'zonal', 'national', 'open', 'corporate', 'veterans', 'school_college', 'other'] as const;
export type TournamentLevel = (typeof TOURNAMENT_LEVELS)[number];

export const TOURNAMENT_STATUSES = ['pending', 'published', 'completed', 'cancelled', 'rejected'] as const;
export type TournamentStatus = (typeof TOURNAMENT_STATUSES)[number];

export const TOURNAMENT_SOURCES = ['parsed', 'submitted', 'admin'] as const;
export type TournamentSource = (typeof TOURNAMENT_SOURCES)[number];

/** Where a tournament is (D-018). Only `tamil_nadu` gets tournament and player pages by default. */
export const REGIONS = ['tamil_nadu', 'other_india', 'international', 'unknown'] as const;
export type Region = (typeof REGIONS)[number];

export const FORMATS = ['singles', 'doubles', 'unknown'] as const;
export type MatchFormat = (typeof FORMATS)[number];

export const SIDES = ['A', 'B'] as const;
export type Side = (typeof SIDES)[number];

export const MATCH_PUBLISH_STATES = ['held', 'published'] as const;
export type MatchPublishState = (typeof MATCH_PUBLISH_STATES)[number];

export const ALIAS_STATUSES = ['confirmed', 'provisional', 'rejected'] as const;
export type AliasStatus = (typeof ALIAS_STATUSES)[number];

export const PARTICIPANT_RESOLUTIONS = ['exact_alias', 'provisional', 'plain_text', 'blocked', 'suppressed', 'manual'] as const;
export type ParticipantResolution = (typeof PARTICIPANT_RESOLUTIONS)[number];

export const SLUG_KINDS = ['named', 'opaque'] as const;
export type SlugKind = (typeof SLUG_KINDS)[number];

export const PLAYER_CREATED_SOURCES = ['parsed', 'admin', 'claim'] as const;
export type PlayerCreatedSource = (typeof PLAYER_CREATED_SOURCES)[number];

export const SUPPRESSION_KINDS = ['youtube_id', 'player_id', 'name_normalized', 'tournament_id'] as const;
export type SuppressionKind = (typeof SUPPRESSION_KINDS)[number];

export const SUPPRESSION_ACTIONS = ['hide', 'erase'] as const;
export type SuppressionAction = (typeof SUPPRESSION_ACTIONS)[number];

export const REDIRECT_STATUSES = [301, 410] as const;
export type RedirectStatus = (typeof REDIRECT_STATUSES)[number];
export const REDIRECT_ENTITY_TYPES = ['player', 'tournament', 'match', 'video', 'other'] as const;
export type RedirectEntityType = (typeof REDIRECT_ENTITY_TYPES)[number];

export const SYNC_MODES = ['full', 'incremental', 'backfill', 'reparse', 'weekly_check', 'live_status'] as const;
export type SyncMode = (typeof SYNC_MODES)[number];
export const SYNC_STATUSES = ['running', 'ok', 'partial', 'failed'] as const;
export type SyncStatus = (typeof SYNC_STATUSES)[number];

// ---------------------------------------------------------------------------
// Settings (archive_settings: key -> text value). Every key has an allowed-value list, enforced by the database.
// ---------------------------------------------------------------------------

/** D-012: how a protected match page is built. Never "full": a protected participant always costs the full page. */
export const PROTECTED_MATCH_MODES = ['noindex_minimal', 'hidden'] as const;
export type ProtectedMatchMode = (typeof PROTECTED_MATCH_MODES)[number];

export const ARCHIVE_SETTING_KEYS = ['unknown_match_mode', 'minor_match_mode', 'non_tn_tournament_pages', 'auto_publish_clean_parses'] as const;
export type ArchiveSettingKey = (typeof ARCHIVE_SETTING_KEYS)[number];

export type ArchiveSettingValues = {
  /** `unknown` age participants (the majority). Owner default: a minimal noindex page. */
  unknown_match_mode: ProtectedMatchMode;
  /** `minor_suspected` and `minor_confirmed` participants. Owner default: hidden. */
  minor_match_mode: ProtectedMatchMode;
  /** D-018: tournament pages for non-Tamil-Nadu events. Owner default: off (listed videos only). */
  non_tn_tournament_pages: 'off' | 'on';
  /** D-013: clean parses (no hard flag, no minor hold) publish without review. */
  auto_publish_clean_parses: 'true' | 'false';
};

/** Launch defaults written by migration 0005. They are the owner's decisions (D-012, D-018), not guesses. */
export const ARCHIVE_SETTING_DEFAULTS: Readonly<ArchiveSettingValues> = {
  unknown_match_mode: 'noindex_minimal',
  minor_match_mode: 'hidden',
  non_tn_tournament_pages: 'off',
  auto_publish_clean_parses: 'true',
};

export type ArchiveSettingRow = { key: ArchiveSettingKey; value: string; updated_at: string; updated_by: string | null };

// ---------------------------------------------------------------------------
// Field-level locks (manual_override, PC-20). A key set to `true` means: the sync and a reparse must not change that field.
// ---------------------------------------------------------------------------

export const VIDEO_LOCKABLE_FIELDS = ['type', 'parse_status', 'is_international', 'visibility'] as const;
export type VideoLockableField = (typeof VIDEO_LOCKABLE_FIELDS)[number];
export const MATCH_LOCKABLE_FIELDS = ['tournament_id', 'category', 'age_group', 'round', 'format', 'played_on', 'participants'] as const;
export type MatchLockableField = (typeof MATCH_LOCKABLE_FIELDS)[number];
export const PLAYER_LOCKABLE_FIELDS = ['display_name', 'district', 'disambiguator', 'slug'] as const;
export type PlayerLockableField = (typeof PLAYER_LOCKABLE_FIELDS)[number];
export const TOURNAMENT_LOCKABLE_FIELDS = ['name', 'edition_year', 'level', 'region', 'visibility', 'city', 'district'] as const;
export type TournamentLockableField = (typeof TOURNAMENT_LOCKABLE_FIELDS)[number];

export type ManualOverride<F extends string> = Partial<Record<F, true>>;

// ---------------------------------------------------------------------------
// Private row types (service_role only)
// ---------------------------------------------------------------------------

export type VideoRow = {
  youtube_id: string; // primary key and the idempotent upsert key (D-017)
  title_raw: string; // byte-exact, displayed unmodified (D-016)
  title_normalized: string;
  /** Private: YouTube descriptions can hold phone numbers (D-029). Never in a view. */
  description: string | null;
  published_at: string | null;
  duration_s: number | null;
  /** YouTube API statistics: refreshed or deleted before day 30 (D-016). `stats_fetched_at` proves it. */
  views: number | null;
  likes: number | null;
  stats_fetched_at: string | null;
  thumbnail_url: string | null;
  embeddable: boolean | null;
  type: VideoType;
  live_status: LiveStatus;
  was_live: boolean;
  is_international: boolean;
  parse_status: ParseStatus;
  parser_version: string | null;
  /** Integer points 0..100 (`ParseResult.confidencePoints`). */
  parse_confidence: number | null;
  hard_flags: HardFlag[];
  review_reasons: ReviewReason[];
  /** The whole `ParseResult` as stored JSON, so the review queue can say why (PC-22). */
  parse_result: Record<string, unknown> | null;
  minor_hold: boolean;
  entity_block_reason: EntityBlockReason | null;
  visibility: Visibility;
  hidden_reason: string | null;
  hidden_at: string | null;
  manual_override: ManualOverride<VideoLockableField>;
  /** A locked field exists but the title changed since the lock: ask the owner (PC-20). */
  override_stale: boolean;
  playlist_source: 'UUSH' | 'UULF' | 'UULV' | null;
  last_synced_at: string | null;
  etag: string | null;
  created_at: string;
  updated_at: string;
};

/** What the sync writes: everything not generated by the database. */
export type VideoUpsert = Omit<VideoRow, 'created_at' | 'updated_at' | 'hidden_at' | 'hidden_reason' | 'manual_override' | 'override_stale' | 'visibility'> & {
  /** Omit for a new row (the database default is `hidden`). The sync never sends `visibility` for an existing row. */
  visibility?: Visibility;
};

export type VideoTitleHistoryRow = { id: number; youtube_id: string; title_raw: string; seen_at: string };

export type TournamentRow = {
  id: string;
  slug: string;
  name: string;
  series_key: string; // not null: the (series_key, edition_year) unique constraint is the idempotent upsert key (PC-11)
  edition_year: number | null;
  edition_no: number | null;
  season_label: string | null;
  edition_year_source: YearSource;
  level: TournamentLevel | null;
  region: Region;
  city: string | null;
  district: string | null;
  venue: string | null;
  start_date: string | null;
  end_date: string | null;
  categories: Category[];
  age_groups: string[];
  entry_info: string | null;
  registration_url: string | null;
  poster_path: string | null; // a Storage path, never in dist/ (D-009)
  status: TournamentStatus;
  is_featured: boolean;
  featured_until: string | null;
  covered_by_power_smash: boolean;
  /** Owner promotion: a page exists even with fewer than 3 matches (D-013). */
  is_promoted: boolean;
  /** A school or college event is a minor signal for its participants (D-012). */
  is_minor_signal: boolean;
  source: TournamentSource;
  visibility: Visibility;
  show_contact_public: boolean;
  manual_override: ManualOverride<TournamentLockableField>;
  created_at: string;
  updated_at: string;
};

/** Private organizer contact (separate table on purpose; never in a public view, D-005, D-029). */
export type TournamentPrivateRow = {
  tournament_id: string;
  organizer_name: string | null;
  organizer_phone: string | null;
  organizer_email: string | null;
  /** Evidence of the consent notice shown when the organizer submitted the event (C-10). */
  consent_notice_id: string | null;
  consent_notice_version: string | null;
  consent_at: string | null;
  created_at: string;
  updated_at: string;
};

export type TournamentAliasRow = { id: string; alias_normalized: string; tournament_id: string; created_at: string };

export type PlayerRow = {
  id: string;
  /** Named slug only for adult_confirmed players; opaque (`p-` plus random hex) otherwise. Persisted once assigned (PC-14). */
  slug: string;
  slug_kind: SlugKind;
  display_name: string;
  name_normalized: string;
  name_key: string | null;
  latin_key: string | null;
  disambiguator: string | null;
  identity_tier: IdentityTier;
  age_status: AgeStatus; // default 'unknown'
  age_signal: AgeSignal[];
  age_confirmed_by: string | null;
  age_confirmed_at: string | null;
  age_confirmed_evidence: string | null;
  /** Null for every protected player (database check): district, photo, bio and handle exist only for adults. */
  district: string | null;
  photo_path: string | null;
  bio: string | null;
  instagram_handle: string | null;
  claimed: boolean;
  noindex: boolean; // forced true for protected players
  visibility: PlayerVisibility;
  is_provisional: boolean;
  provisional_tournament_id: string | null;
  merged_into: string | null;
  created_source: PlayerCreatedSource;
  manual_override: ManualOverride<PlayerLockableField>;
  created_at: string;
  updated_at: string;
};

export type PlayerAliasRow = {
  id: string;
  alias_normalized: string;
  player_id: string;
  status: AliasStatus; // `rejected` makes a split stick (PC-02)
  scope_tournament_id: string | null;
  scope_district: string | null;
  created_by: string | null;
  created_at: string;
};

export type MatchRow = {
  id: string;
  video_id: string; // unique
  /** Persisted match slug (PC-14). `named` only while every participant is adult_confirmed; the view masks it otherwise. */
  slug?: string; // always present when read; optional so inserts may omit it (the trigger fills the opaque default)
  slug_kind?: SlugKind;
  tournament_id: string | null;
  category: Category | null;
  age_group: AgeGroup | null;
  round: Round | null;
  format: MatchFormat;
  played_on: string | null;
  match_key: string | null;
  /** Another match row that is the same match (PC-19): excluded from counts and from public views. */
  duplicate_of: string | null;
  winner_side: Side | null;
  score_text: string | null;
  /** A real minor signal or a hard flag: held out of publication until an admin approves (D-012, PC-03). */
  publish_state: MatchPublishState;
  minor_hold: boolean;
  manual_override: ManualOverride<MatchLockableField>;
  created_at: string;
  updated_at: string;
};

export type MatchParticipantRow = {
  id: string;
  match_id: string;
  side: Side;
  position: number;
  raw_name: string;
  player_id: string | null;
  resolution: ParticipantResolution;
  identity_tier: IdentityTier;
  link_policy: LinkPolicy;
  truncated: boolean;
  /** Per participation (PC-13). Combine with the player's status through `effectiveAgeStatus`. */
  age_status: AgeStatus;
  age_signal: AgeSignal[];
  seed: number | null;
  country: string | null;
  district_hint: string | null;
  affiliation_hint: string | null;
  created_at: string;
};

/** Mirror of the SQL `app.effective_age_status`: the most restrictive of the participation and the linked player. */
export function effectiveAgeStatus(participation: AgeStatus, player: AgeStatus | null): AgeStatus {
  if (player === 'adult_confirmed' && participation === 'unknown') return 'adult_confirmed';
  if (player === null) return participation;
  return mostRestrictiveAge(participation, player);
}

export type SuppressionRow = {
  id: string;
  kind: SuppressionKind;
  value: string;
  action: SuppressionAction;
  reason: string;
  requested_by: string | null;
  received_at: string; // proves the service level (D-014)
  created_by: string;
  created_at: string;
  released_at: string | null;
  released_by: string | null;
  release_reason: string | null;
};

export type SlugRedirectRow = {
  from_path: string;
  to_path: string | null; // null iff http_status = 410
  http_status: RedirectStatus;
  entity_type: RedirectEntityType;
  entity_id: string | null;
  created_at: string;
};

export type SyncRunRow = {
  id: string;
  mode: SyncMode;
  started_at: string;
  finished_at: string | null;
  status: SyncStatus;
  counts: Record<string, number>;
  quota_units: number | null;
  error: string | null;
  trigger: string | null;
};

/** Single row (id = 1): the dirty flag the nightly or manual deploy reads (D-008). */
export type SiteStateRow = {
  id: 1;
  dirty: boolean;
  dirty_since: string | null;
  dirty_reason: string | null;
  urgent: boolean;
  last_deploy_requested_at: string | null;
  last_deploy_at: string | null;
  last_deploy_status: string | null;
  updated_at: string;
};

export type AuditLogRow = {
  id: number;
  ts: string;
  actor: string;
  action: string;
  entity: string;
  entity_id: string | null;
  diff: Record<string, unknown> | null;
  reason: string | null;
};

// ---------------------------------------------------------------------------
// PUBLIC `api` views (explicit columns, masking in SQL, read with the publishable key)
// Names are `api.<name>`; `API_VIEWS` below is checked against the SQL by a test.
// ---------------------------------------------------------------------------

export const API_VIEWS = [
  'public_videos',
  'public_matches',
  'public_match_participants',
  'public_players',
  'public_tournaments',
  'public_slug_redirects',
  'public_archive_modes',
] as const;
export type ApiViewName = (typeof API_VIEWS)[number];

/** A video the site may list. Protected-match rules already applied: a hidden match never appears here. */
export type PublicVideo = {
  youtube_id: string;
  title_raw: string;
  published_at: string | null;
  duration_s: number | null;
  views: number | null;
  likes: number | null;
  stats_fetched_at: string | null;
  thumbnail_url: string | null;
  embeddable: boolean | null;
  type: VideoType;
  live_status: LiveStatus;
  was_live: boolean;
  visibility: Exclude<Visibility, 'hidden'>;
  /** `full` = every participant is adult_confirmed; `minimal` = page exists, noindex, raw title only; `none` = no parsed match. */
  page_mode: 'full' | 'minimal' | 'none';
  noindex: boolean;
};

export type PublicMatch = {
  id: string;
  video_id: string;
  /** Named slug only for a `full` match; otherwise the opaque `match-` + 16 hex (never a protected name). */
  slug: string;
  /** Null unless the tournament itself is public. */
  tournament_id: string | null;
  category: Category | null;
  /** Null in minimal mode (an age group is itself a minor signal). */
  age_group: AgeGroup | null;
  round: Round | null;
  format: MatchFormat;
  played_on: string | null;
  page_mode: 'full' | 'minimal';
  noindex: boolean;
};

/** Present ONLY for `full` matches: names of adults. `player_slug` is non-null only when that player has a public page. */
export type PublicMatchParticipant = {
  match_id: string;
  side: Side;
  position: number;
  raw_name: string;
  player_slug: string | null;
};

export type PublicPlayer = {
  id: string;
  slug: string;
  display_name: string;
  disambiguator: string | null;
  district: string | null;
  photo_path: string | null;
  bio: string | null;
  instagram_handle: string | null;
  claimed: boolean;
  noindex: boolean;
  /** 0012 (D-100): adults only, appended last. */
  academy: string | null;
};

export type PublicTournament = {
  id: string;
  slug: string;
  name: string;
  series_key: string | null;
  edition_year: number | null;
  edition_no: number | null;
  season_label: string | null;
  level: TournamentLevel | null;
  region: Region;
  city: string | null;
  district: string | null;
  venue: string | null;
  start_date: string | null;
  end_date: string | null;
  categories: Category[];
  entry_info: string | null;
  registration_url: string | null;
  poster_path: string | null;
  status: TournamentStatus;
  is_featured: boolean;
  featured_until: string | null;
  covered_by_power_smash: boolean;
  visibility: Exclude<Visibility, 'hidden'>;
  /** Organizer name only when `show_contact_public` (consent). No phone, no email, ever. */
  organizer_name: string | null;
  match_count: number;
  /** D-013/D-018: 3 or more matches or promoted, and region rules. Build a page only when true. */
  page_eligible: boolean;
};

/** Only 301 rows whose target is public. 410 (gone) paths are private by design: see docs/m2/schema-notes.md. */
export type PublicSlugRedirect = { from_path: string; to_path: string; entity_type: RedirectEntityType };

export type PublicArchiveMode = { key: 'unknown_match_mode' | 'minor_match_mode' | 'non_tn_tournament_pages'; value: string };

// ---------------------------------------------------------------------------
// Admin RPC signatures (SECURITY DEFINER, service_role only, each writes an audit_log row and marks the site dirty)
// The Worker verifies the JWT (aal2) and passes the verified user id as `p_actor`.
// ---------------------------------------------------------------------------

export type AdminRpcArgs = {
  admin_merge_players: { p_actor: string; p_from: string; p_into: string; p_reason: string; p_override_age: boolean };
  admin_split_player: { p_actor: string; p_player: string; p_participant_ids: string[]; p_new_display_name: string; p_new_name_normalized: string; p_reason: string; p_new_slug: string | null };
  admin_rename_player: { p_actor: string; p_player: string; p_display_name: string; p_name_normalized: string; p_reason: string; p_new_slug: string | null };
  admin_set_age_status: { p_actor: string; p_player_ids: string[]; p_status: AgeStatus; p_evidence: string | null; p_reason: string; /** needed to lift minor_confirmed to adult_confirmed; audited (S2-9) */ p_override_minor?: boolean };
  admin_emergency_hide: { p_actor: string; p_kind: SuppressionKind; p_value: string; p_reason: string; p_received_at: string | null; p_requested_by: string | null };
  admin_release_suppression: { p_actor: string; p_suppression_id: string; p_reason: string };
  admin_update_video: { p_actor: string; p_video_id: string; p_changes: Partial<Pick<VideoRow, VideoLockableField>>; p_lock: boolean; p_reason: string };
  admin_update_match: { p_actor: string; p_match_id: string; p_changes: Record<string, unknown>; p_lock: boolean; p_reason: string };
  admin_update_player: { p_actor: string; p_player: string; p_changes: Record<string, unknown>; p_reason: string };
  admin_mark_dirty: { p_actor: string; p_reason: string; p_urgent: boolean };
  /** 0009: 30-day rule (D-016). Deletes old title history and the match of retired videos, blanks API fields, keeps tombstones. Idempotent. 1..30 days. Returns counts. */
  admin_purge_stale_api_data: { p_actor: string; p_older_than_days?: number };
};
export const ADMIN_RPCS = [
  'admin_merge_players',
  'admin_split_player',
  'admin_rename_player',
  'admin_set_age_status',
  'admin_emergency_hide',
  'admin_release_suppression',
  'admin_update_video',
  'admin_update_match',
  'admin_update_player',
  'admin_mark_dirty',
  'admin_purge_stale_api_data',
] as const satisfies readonly (keyof AdminRpcArgs)[];

/** What `admin_emergency_hide` returns: the owner's checklist (D-014 step 5) plus counts. */
export type EmergencyHideResult = {
  suppression_id: string;
  hidden_at: string;
  videos_hidden: number;
  players_hidden: number;
  tournaments_hidden: number;
  redirects_removed: number;
  /** Steps only the owner can do: always all four. */
  owner_checklist: ['deploy_now', 'purge_cache_for_urls', 'set_youtube_video_private', 'search_console_removals_request'];
};

/** The sync's table order and idempotent conflict targets (PC-21): one transaction per video. */
export const UPSERT_CONFLICT_TARGETS = {
  videos: 'youtube_id',
  matches: 'video_id',
  match_participants: 'match_id,side,position',
  player_aliases: 'alias_normalized,player_id',
  tournament_aliases: 'alias_normalized,tournament_id',
  tournaments: 'series_key,edition_year',
  slug_redirects: 'from_path',
  archive_settings: 'key',
  suppression: 'kind,value',
} as const;

// ---------------------------------------------------------------------------
// Column lists (runtime copies of the table and view columns)
// ---------------------------------------------------------------------------
// Compile time: each list must name only columns of its row type AND cover every key of it (the `_ExactColumns` tuple below fails the
// type check otherwise). Run time: tests/supabase/archive-types.test.ts compares every list with the SQL of the migrations, so a column
// added in SQL but not here (or the reverse) fails the test suite. Use these for explicit `select=` lists: never `select=*`.

type Keys<R> = Extract<keyof R, string>;
type AssertTrue<T extends true> = T;
type CoversAll<R, C extends readonly string[]> = [Exclude<Keys<R>, C[number]>] extends [never] ? true : false;

export const VIDEO_COLUMNS = [
  'youtube_id', 'title_raw', 'title_normalized', 'description', 'published_at', 'duration_s', 'views', 'likes', 'stats_fetched_at',
  'thumbnail_url', 'embeddable', 'type', 'live_status', 'was_live', 'is_international', 'parse_status', 'parser_version', 'parse_confidence',
  'hard_flags', 'review_reasons', 'parse_result', 'minor_hold', 'entity_block_reason', 'visibility', 'hidden_reason', 'hidden_at',
  'manual_override', 'override_stale', 'playlist_source', 'last_synced_at', 'etag', 'created_at', 'updated_at',
] as const satisfies readonly Keys<VideoRow>[];
export const VIDEO_TITLE_HISTORY_COLUMNS = ['id', 'youtube_id', 'title_raw', 'seen_at'] as const satisfies readonly Keys<VideoTitleHistoryRow>[];
export const TOURNAMENT_COLUMNS = [
  'id', 'slug', 'name', 'series_key', 'edition_year', 'edition_no', 'season_label', 'edition_year_source', 'level', 'region', 'city',
  'district', 'venue', 'start_date', 'end_date', 'categories', 'age_groups', 'entry_info', 'registration_url', 'poster_path', 'status',
  'is_featured', 'featured_until', 'covered_by_power_smash', 'is_promoted', 'is_minor_signal', 'source', 'visibility', 'show_contact_public',
  'manual_override', 'created_at', 'updated_at',
] as const satisfies readonly Keys<TournamentRow>[];
export const TOURNAMENT_PRIVATE_COLUMNS = [
  'tournament_id', 'organizer_name', 'organizer_phone', 'organizer_email', 'consent_notice_id', 'consent_notice_version', 'consent_at',
  'created_at', 'updated_at',
] as const satisfies readonly Keys<TournamentPrivateRow>[];
export const TOURNAMENT_ALIAS_COLUMNS = ['id', 'alias_normalized', 'tournament_id', 'created_at'] as const satisfies readonly Keys<TournamentAliasRow>[];
export const PLAYER_COLUMNS = [
  'id', 'slug', 'slug_kind', 'display_name', 'name_normalized', 'name_key', 'latin_key', 'disambiguator', 'identity_tier', 'age_status',
  'age_signal', 'age_confirmed_by', 'age_confirmed_at', 'age_confirmed_evidence', 'district', 'photo_path', 'bio', 'instagram_handle',
  'claimed', 'noindex', 'visibility', 'is_provisional', 'provisional_tournament_id', 'merged_into', 'created_source', 'manual_override',
  'created_at', 'updated_at',
] as const satisfies readonly Keys<PlayerRow>[];
export const PLAYER_ALIAS_COLUMNS = [
  'id', 'alias_normalized', 'player_id', 'status', 'scope_tournament_id', 'scope_district', 'created_by', 'created_at',
] as const satisfies readonly Keys<PlayerAliasRow>[];
export const MATCH_COLUMNS = [
  'id', 'video_id', 'slug', 'slug_kind', 'tournament_id', 'category', 'age_group', 'round', 'format', 'played_on', 'match_key', 'duplicate_of', 'winner_side',
  'score_text', 'publish_state', 'minor_hold', 'manual_override', 'created_at', 'updated_at',
] as const satisfies readonly Keys<MatchRow>[];
export const MATCH_PARTICIPANT_COLUMNS = [
  'id', 'match_id', 'side', 'position', 'raw_name', 'player_id', 'resolution', 'identity_tier', 'link_policy', 'truncated', 'age_status',
  'age_signal', 'seed', 'country', 'district_hint', 'affiliation_hint', 'created_at',
] as const satisfies readonly Keys<MatchParticipantRow>[];
export const SLUG_REDIRECT_COLUMNS = ['from_path', 'to_path', 'http_status', 'entity_type', 'entity_id', 'created_at'] as const satisfies readonly Keys<SlugRedirectRow>[];
export const SYNC_RUN_COLUMNS = ['id', 'mode', 'started_at', 'finished_at', 'status', 'counts', 'quota_units', 'error', 'trigger'] as const satisfies readonly Keys<SyncRunRow>[];
export const ARCHIVE_SETTING_COLUMNS = ['key', 'value', 'updated_at', 'updated_by'] as const satisfies readonly Keys<ArchiveSettingRow>[];
export const SITE_STATE_COLUMNS = [
  'id', 'dirty', 'dirty_since', 'dirty_reason', 'urgent', 'last_deploy_requested_at', 'last_deploy_at', 'last_deploy_status', 'updated_at',
] as const satisfies readonly Keys<SiteStateRow>[];
export const AUDIT_LOG_COLUMNS = ['id', 'ts', 'actor', 'action', 'entity', 'entity_id', 'diff', 'reason'] as const satisfies readonly Keys<AuditLogRow>[];
export const SUPPRESSION_COLUMNS = [
  'id', 'kind', 'value', 'action', 'reason', 'requested_by', 'received_at', 'created_by', 'created_at', 'released_at', 'released_by', 'release_reason',
] as const satisfies readonly Keys<SuppressionRow>[];

/** Every private table with its column list (table name -> columns). The test compares each with the migrations. */
export const TABLE_COLUMNS = {
  videos: VIDEO_COLUMNS,
  video_title_history: VIDEO_TITLE_HISTORY_COLUMNS,
  tournaments: TOURNAMENT_COLUMNS,
  tournament_private: TOURNAMENT_PRIVATE_COLUMNS,
  tournament_aliases: TOURNAMENT_ALIAS_COLUMNS,
  players: PLAYER_COLUMNS,
  player_aliases: PLAYER_ALIAS_COLUMNS,
  matches: MATCH_COLUMNS,
  match_participants: MATCH_PARTICIPANT_COLUMNS,
  slug_redirects: SLUG_REDIRECT_COLUMNS,
  sync_runs: SYNC_RUN_COLUMNS,
  archive_settings: ARCHIVE_SETTING_COLUMNS,
  site_state: SITE_STATE_COLUMNS,
  audit_log: AUDIT_LOG_COLUMNS,
  suppression: SUPPRESSION_COLUMNS,
} as const;

/** Columns of the PUBLIC views (what a `select=` list may name). Matches the `Public*` types above. */
export const API_VIEW_COLUMNS = {
  public_videos: [
    'youtube_id', 'title_raw', 'published_at', 'duration_s', 'views', 'likes', 'stats_fetched_at', 'thumbnail_url', 'embeddable', 'type',
    'live_status', 'was_live', 'visibility', 'page_mode', 'noindex',
  ],
  public_matches: ['id', 'video_id', 'slug', 'tournament_id', 'category', 'age_group', 'round', 'format', 'played_on', 'page_mode', 'noindex'],
  public_match_participants: ['match_id', 'side', 'position', 'raw_name', 'player_slug'],
  public_players: ['id', 'slug', 'display_name', 'disambiguator', 'district', 'photo_path', 'bio', 'instagram_handle', 'claimed', 'noindex', 'academy'],
  public_tournaments: [
    'id', 'slug', 'name', 'series_key', 'edition_year', 'edition_no', 'season_label', 'level', 'region', 'city', 'district', 'venue',
    'start_date', 'end_date', 'categories', 'entry_info', 'registration_url', 'poster_path', 'status', 'is_featured', 'featured_until',
    'covered_by_power_smash', 'visibility', 'organizer_name', 'match_count', 'page_eligible',
  ],
  public_slug_redirects: ['from_path', 'to_path', 'entity_type'],
  public_archive_modes: ['key', 'value'],
} as const satisfies {
  public_videos: readonly Keys<PublicVideo>[];
  public_matches: readonly Keys<PublicMatch>[];
  public_match_participants: readonly Keys<PublicMatchParticipant>[];
  public_players: readonly Keys<PublicPlayer>[];
  public_tournaments: readonly Keys<PublicTournament>[];
  public_slug_redirects: readonly Keys<PublicSlugRedirect>[];
  public_archive_modes: readonly Keys<PublicArchiveMode>[];
};

// Compile-time exhaustiveness: a row-type key missing from its column list is a type error.
export type _ExactColumns = [
  AssertTrue<CoversAll<VideoRow, typeof VIDEO_COLUMNS>>,
  AssertTrue<CoversAll<VideoTitleHistoryRow, typeof VIDEO_TITLE_HISTORY_COLUMNS>>,
  AssertTrue<CoversAll<TournamentRow, typeof TOURNAMENT_COLUMNS>>,
  AssertTrue<CoversAll<TournamentPrivateRow, typeof TOURNAMENT_PRIVATE_COLUMNS>>,
  AssertTrue<CoversAll<TournamentAliasRow, typeof TOURNAMENT_ALIAS_COLUMNS>>,
  AssertTrue<CoversAll<PlayerRow, typeof PLAYER_COLUMNS>>,
  AssertTrue<CoversAll<PlayerAliasRow, typeof PLAYER_ALIAS_COLUMNS>>,
  AssertTrue<CoversAll<MatchRow, typeof MATCH_COLUMNS>>,
  AssertTrue<CoversAll<MatchParticipantRow, typeof MATCH_PARTICIPANT_COLUMNS>>,
  AssertTrue<CoversAll<SlugRedirectRow, typeof SLUG_REDIRECT_COLUMNS>>,
  AssertTrue<CoversAll<SyncRunRow, typeof SYNC_RUN_COLUMNS>>,
  AssertTrue<CoversAll<ArchiveSettingRow, typeof ARCHIVE_SETTING_COLUMNS>>,
  AssertTrue<CoversAll<SiteStateRow, typeof SITE_STATE_COLUMNS>>,
  AssertTrue<CoversAll<AuditLogRow, typeof AUDIT_LOG_COLUMNS>>,
  AssertTrue<CoversAll<SuppressionRow, typeof SUPPRESSION_COLUMNS>>,
  AssertTrue<CoversAll<PublicVideo, (typeof API_VIEW_COLUMNS)['public_videos']>>,
  AssertTrue<CoversAll<PublicMatch, (typeof API_VIEW_COLUMNS)['public_matches']>>,
  AssertTrue<CoversAll<PublicMatchParticipant, (typeof API_VIEW_COLUMNS)['public_match_participants']>>,
  AssertTrue<CoversAll<PublicPlayer, (typeof API_VIEW_COLUMNS)['public_players']>>,
  AssertTrue<CoversAll<PublicTournament, (typeof API_VIEW_COLUMNS)['public_tournaments']>>,
  AssertTrue<CoversAll<PublicSlugRedirect, (typeof API_VIEW_COLUMNS)['public_slug_redirects']>>,
  AssertTrue<CoversAll<PublicArchiveMode, (typeof API_VIEW_COLUMNS)['public_archive_modes']>>,
];
