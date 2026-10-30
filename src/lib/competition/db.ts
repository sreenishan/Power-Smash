// The competition database (migration supabase/migrations/0017_competition.sql): row types of the private tables (read by server code
// with the secret key only), the PUBLIC api views and their explicit columns (read by the build with the publishable key), and the owner
// RPC names. tests/competition/db.test.ts keeps these lists in step with the SQL, the same way src/lib/products/db.ts does for products.
//
// Safe defaults of wave 2 (see the migration header): organizer, scorer and player accounts exist in the data model but are OFF; every
// write is an owner-only RPC; juniors and unknown-age players are never named in a view (null name, is_protected = true, D-012);
// registration and payments are off (payments can only ever be manual verification); rankings are local, unofficial and unpublished
// until the owner publishes a snapshot AND switches rankings_public on; data providers are disabled until a licence is recorded.
import type { Ruleset } from './scoring';
import type { Category, MatchStatus, RoundCode, Side } from './types';

export type IsoInstant = string;
export type IsoDate = string;

// ------------------------------------------------------------------------------------------------ vocabularies (mirror the SQL checks)

export const EVENT_FORMATS = ['knockout', 'round_robin', 'groups_knockout'] as const;
export type EventFormat = (typeof EVENT_FORMATS)[number];

export const EVENT_STATUSES = ['draft', 'open', 'closed'] as const;
export type EventStatus = (typeof EVENT_STATUSES)[number];

/** Entry statuses. pending and confirmed count towards the capacity; withdrawn and rejected free the players. */
export const ENTRY_STATUSES = ['pending', 'confirmed', 'waitlisted', 'withdrawn', 'rejected'] as const;
export type EntryStatus = (typeof ENTRY_STATUSES)[number];
export const ACTIVE_ENTRY_STATUSES = ['pending', 'confirmed'] as const satisfies readonly EntryStatus[];

export const DRAW_STATUSES = ['draft', 'published', 'locked'] as const;
export type DrawStatus = (typeof DRAW_STATUSES)[number];

export const RESULT_SOURCES = ['admin', 'scorer', 'import'] as const;
export type ResultSource = (typeof RESULT_SOURCES)[number];

export const SCORE_EVENT_KINDS = ['first_server', 'rally', 'undo'] as const;
export type ScoreEventKind = (typeof SCORE_EVENT_KINDS)[number];

/** Inert until competition_settings.organizer_roles_enabled (off). profiles.role stays owner | editor. */
export const ASSIGNMENT_ROLES = ['organizer', 'scorer'] as const;
export type AssignmentRole = (typeof ASSIGNMENT_ROLES)[number];

export const OUTBOX_STATUSES = ['queued', 'sent', 'failed', 'skipped'] as const;
export type OutboxStatus = (typeof OUTBOX_STATUSES)[number];

export const PROVIDER_KINDS = ['licensed_api', 'licensed_file', 'owner_entry'] as const;
export type ProviderKind = (typeof PROVIDER_KINDS)[number];

export const LICENCE_STATUSES = ['unverified', 'licensed', 'expired', 'refused'] as const;
export type LicenceStatus = (typeof LICENCE_STATUSES)[number];

export const IMPORT_RUN_STATUSES = ['running', 'succeeded', 'failed', 'cancelled'] as const;
export type ImportRunStatus = (typeof IMPORT_RUN_STATUSES)[number];

export const PAYMENT_MODES = ['off', 'manual_verification'] as const;
export type PaymentMode = (typeof PAYMENT_MODES)[number];

/** The public status of a match: MatchStatus, except that a result not yet confirmed shows as 'awaiting_result'. */
export type PublicMatchStatus = MatchStatus | 'awaiting_result';

// ------------------------------------------------------------------------------------------------ private tables (service role only)

export interface CompetitionSettingsRow {
  id: 1;
  organizer_roles_enabled: boolean;
  player_accounts_enabled: boolean;
  registration_enabled: boolean;
  payment_mode: PaymentMode;
  rankings_public: boolean;
  updated_at: IsoInstant;
}

export interface TournamentEventRow {
  id: string;
  tournament_id: string;
  category: Category;
  age_group: string | null;
  format: EventFormat;
  ruleset: Ruleset;
  capacity: number | null;
  status: EventStatus;
  created_at: IsoInstant;
  updated_at: IsoInstant;
}

export interface VenueRow {
  id: string;
  name: string;
  city: string | null;
  created_at: IsoInstant;
}

export interface CourtRow {
  id: string;
  tournament_id: string;
  venue_id: string | null;
  label: string;
  sort: number;
  created_at: IsoInstant;
}

export interface EventEntryRow {
  id: string;
  event_id: string;
  player1_id: string;
  /** Doubles only. */
  player2_id: string | null;
  seed: number | null;
  status: EntryStatus;
  created_at: IsoInstant;
  updated_at: IsoInstant;
}

export interface DrawRow {
  id: string;
  event_id: string;
  /** The 32-bit seed given to seededRandom (types.ts), so the draw can be reproduced. */
  seed: number;
  status: DrawStatus;
  published_at: IsoInstant | null;
  created_at: IsoInstant;
  updated_at: IsoInstant;
}

export interface DrawSlotRow {
  draw_id: string;
  position: number;
  /** Null = a bye. */
  entry_id: string | null;
  group_label: string | null;
}

export interface CompetitionMatchRow {
  id: string;
  event_id: string;
  round_code: RoundCode;
  match_number: number;
  group_label: string | null;
  side_a_entry: string | null;
  side_b_entry: string | null;
  scheduled_at: IsoInstant | null;
  court_id: string | null;
  status: MatchStatus;
  winner_side: Side | null;
  confirmed: boolean;
  confirmed_at: IsoInstant | null;
  confirmed_by: string | null;
  result_source: ResultSource | null;
  /** Optimistic lock: the admin sends it back; a mismatch is refused with STALE. */
  revision: number;
  created_at: IsoInstant;
  updated_at: IsoInstant;
}

export interface MatchGameRow {
  match_id: string;
  game_number: number;
  points_a: number;
  points_b: number;
  /** False only for the last game of a retired or abandoned match. */
  finished: boolean;
}

export interface MatchScoreEventRow {
  id: number;
  match_id: string;
  seq: number;
  kind: ScoreEventKind;
  /** Null exactly for 'undo'. */
  side: Side | null;
  idempotency_key: string;
  recorded_by: string;
  recorded_at: IsoInstant;
}

export interface RankingSnapshotRow {
  id: string;
  label: string;
  category: Category | null;
  age_group: string | null;
  as_of: IsoDate;
  /** Always false: a local Power Smash table, not an official BWF ranking. */
  is_official: false;
  published: boolean;
  published_at: IsoInstant | null;
  created_by: string;
  created_at: IsoInstant;
}

export interface RankingEntryRow {
  snapshot_id: string;
  player_id: string;
  rank: number;
  points: number;
  events_counted: number;
}

export interface OrganizerAssignmentRow {
  id: string;
  profile_id: string;
  tournament_id: string;
  role: AssignmentRole;
  created_by: string;
  created_at: IsoInstant;
}

/** The recipient is a reference (exactly one of the two ids); no phone, email or address is ever copied here (D-029). */
export interface NotificationOutboxRow {
  id: string;
  kind: string;
  recipient_lead_id: string | null;
  recipient_profile_id: string | null;
  payload: Record<string, unknown>;
  idempotency_key: string;
  status: OutboxStatus;
  attempts: number;
  last_error_code: string | null;
  created_at: IsoInstant;
  sent_at: IsoInstant | null;
}

export interface DataProviderRow {
  id: string;
  name: string;
  kind: ProviderKind;
  licence_status: LicenceStatus;
  licence_ref: string | null;
  /** Only with a recorded licence (licence_status 'licensed' and a licence_ref). */
  enabled: boolean;
  created_at: IsoInstant;
  updated_at: IsoInstant;
}

export interface DataImportRunRow {
  id: string;
  provider_id: string;
  status: ImportRunStatus;
  records_seen: number;
  records_written: number;
  error_code: string | null;
  started_at: IsoInstant;
  finished_at: IsoInstant | null;
}

export interface ExternalRecordMappingRow {
  id: string;
  provider_id: string;
  external_type: string;
  external_id: string;
  internal_table: 'players' | 'tournaments' | 'tournament_events' | 'competition_matches';
  internal_id: string;
  import_run_id: string | null;
  created_at: IsoInstant;
}

// ------------------------------------------------------------------------------------------------ public api views (publishable key)
// A name and slug appear ONLY for an eligible adult in a non-junior event; everyone else is null with is_protected = true (D-012).

export interface PublicCompetitionEvent {
  id: string;
  tournament_id: string;
  category: Category;
  age_group: string | null;
  format: EventFormat;
  status: Exclude<EventStatus, 'draft'>;
  capacity: number | null;
  ruleset: Ruleset;
}

export interface PublicCompetitionDraw {
  id: string;
  event_id: string;
  status: Exclude<DrawStatus, 'draft'>;
  seed: number;
  published_at: IsoInstant;
}

export interface PublicCompetitionDrawSlot {
  draw_id: string;
  position: number;
  group_label: string | null;
  entry_id: string | null;
  is_bye: boolean;
  seed: number | null;
  player1_slug: string | null;
  player1_name: string | null;
  player2_slug: string | null;
  player2_name: string | null;
  is_protected: boolean;
}

export interface PublicCompetitionMatch {
  id: string;
  event_id: string;
  round_code: RoundCode;
  match_number: number;
  group_label: string | null;
  scheduled_at: IsoInstant | null;
  court_label: string | null;
  status: PublicMatchStatus;
  side_a_entry: string | null;
  side_a_player1_slug: string | null;
  side_a_player1_name: string | null;
  side_a_player2_slug: string | null;
  side_a_player2_name: string | null;
  side_a_protected: boolean;
  side_b_entry: string | null;
  side_b_player1_slug: string | null;
  side_b_player1_name: string | null;
  side_b_player2_slug: string | null;
  side_b_player2_name: string | null;
  side_b_protected: boolean;
  /** Null until the result is confirmed. */
  winner_side: Side | null;
  result_confirmed: boolean;
  updated_at: IsoInstant;
}

/** Games of CONFIRMED results only. */
export interface PublicCompetitionMatchGame {
  match_id: string;
  game_number: number;
  points_a: number;
  points_b: number;
  finished: boolean;
}

/** Published snapshots only, and only while competition_settings.rankings_public is on. Not an official BWF ranking. */
export interface PublicCompetitionRanking {
  snapshot_id: string;
  label: string;
  category: Category | null;
  age_group: string | null;
  as_of: IsoDate;
  published_at: IsoInstant;
  rank: number;
  points: number;
  events_counted: number;
  player_slug: string | null;
  player_name: string | null;
  is_protected: boolean;
}

export const COMPETITION_VIEW_COLUMNS = {
  public_competition_events: ['id', 'tournament_id', 'category', 'age_group', 'format', 'status', 'capacity', 'ruleset'],
  public_competition_draws: ['id', 'event_id', 'status', 'seed', 'published_at'],
  public_competition_draw_slots: [
    'draw_id', 'position', 'group_label', 'entry_id', 'is_bye', 'seed', 'player1_slug', 'player1_name', 'player2_slug', 'player2_name', 'is_protected',
  ],
  public_competition_matches: [
    'id', 'event_id', 'round_code', 'match_number', 'group_label', 'scheduled_at', 'court_label', 'status',
    'side_a_entry', 'side_a_player1_slug', 'side_a_player1_name', 'side_a_player2_slug', 'side_a_player2_name', 'side_a_protected',
    'side_b_entry', 'side_b_player1_slug', 'side_b_player1_name', 'side_b_player2_slug', 'side_b_player2_name', 'side_b_protected',
    'winner_side', 'result_confirmed', 'updated_at',
  ],
  public_competition_match_games: ['match_id', 'game_number', 'points_a', 'points_b', 'finished'],
  public_competition_rankings: [
    'snapshot_id', 'label', 'category', 'age_group', 'as_of', 'published_at', 'rank', 'points', 'events_counted', 'player_slug', 'player_name', 'is_protected',
  ],
} as const satisfies {
  public_competition_events: readonly (keyof PublicCompetitionEvent)[];
  public_competition_draws: readonly (keyof PublicCompetitionDraw)[];
  public_competition_draw_slots: readonly (keyof PublicCompetitionDrawSlot)[];
  public_competition_matches: readonly (keyof PublicCompetitionMatch)[];
  public_competition_match_games: readonly (keyof PublicCompetitionMatchGame)[];
  public_competition_rankings: readonly (keyof PublicCompetitionRanking)[];
};

export type CompetitionView = keyof typeof COMPETITION_VIEW_COLUMNS;
export const COMPETITION_VIEWS = Object.keys(COMPETITION_VIEW_COLUMNS) as CompetitionView[];

// ------------------------------------------------------------------------------------------------ owner RPCs (service role; owner only)
// Every RPC takes the verified actor id first and a reason last; errors start 'FORBIDDEN:', 'INVALID:', 'NOT_FOUND:' or 'STALE:'.

export const COMPETITION_RPCS = [
  'admin_save_event',
  'admin_add_entry',
  'admin_withdraw_entry',
  'admin_save_draw',
  'admin_publish_draw',
  'admin_save_match',
  'admin_record_result',
  'admin_confirm_result',
  'admin_save_ranking_snapshot',
  'admin_publish_ranking_snapshot',
] as const;
export type CompetitionRpc = (typeof COMPETITION_RPCS)[number];

export const COMPETITION_ERROR_PREFIXES = ['FORBIDDEN', 'INVALID', 'NOT_FOUND', 'STALE'] as const;
export type CompetitionErrorCode = (typeof COMPETITION_ERROR_PREFIXES)[number];

/** The code at the start of a database error message ('INVALID: ...' -> 'INVALID'), or null for anything else. */
export function competitionErrorCode(message: string): CompetitionErrorCode | null {
  const m = /^([A-Z_]+):/.exec(message);
  const code = m?.[1];
  return code !== undefined && (COMPETITION_ERROR_PREFIXES as readonly string[]).includes(code) ? (code as CompetitionErrorCode) : null;
}

/** Record shapes the RPCs accept (the admin sends the whole record; unknown or missing keys are refused). */
export interface SaveEventRecord {
  tournamentId: string;
  category: Category;
  ageGroup: string | null;
  format: EventFormat;
  ruleset: Ruleset;
  capacity: number | null;
  status: EventStatus;
}

export interface AddEntryRecord {
  players: readonly [string] | readonly [string, string];
  seed: number | null;
  status: 'pending' | 'confirmed' | 'waitlisted';
}

export interface SaveDrawRecord {
  seed: number;
  slots: readonly { position: number; entryId: string | null; group: string | null }[];
}

export interface SaveMatchRecord {
  eventId: string;
  roundCode: RoundCode;
  matchNumber: number;
  groupLabel: string | null;
  sideA: string | null;
  sideB: string | null;
  scheduledAt: IsoInstant | null;
  courtId: string | null;
}

export interface RecordResultRecord {
  status: 'completed' | 'walkover' | 'retired' | 'abandoned';
  games: readonly { a: number; b: number }[];
  walkoverWinner: Side | null;
  retiringSide: Side | null;
}

export interface SaveRankingSnapshotRecord {
  label: string;
  category: Category | null;
  ageGroup: string | null;
  asOf: IsoDate;
  entries: readonly { playerId: string; rank: number; points: number; eventsCounted: number }[];
}

// ------------------------------------------------------------------------------------------------ mirrors of the SQL rule functions
// Pure TS copies of app.competition_age_group_ok, app.competition_age_is_junior and app.competition_outbox_payload_ok, so the admin
// can refuse a value before the round trip. tests/competition/db.test.ts checks the SQL still holds these patterns.

/** The canonical AgeGroup vocabulary of src/lib/parser/types.ts (PC-13). Anything else ('U-17', 'Under17', 'U17B') is refused. */
export const COMPETITION_AGE_GROUP_PATTERN = String.raw`^(U[0-9]{1,2}|[0-9]{1,2}\+|senior|open|veterans|masters|sub_junior|junior|youth|cadet|mini)$`;
const AGE_GROUP_RE = new RegExp(COMPETITION_AGE_GROUP_PATTERN);

export function isCompetitionAgeGroup(value: string | null): boolean {
  return value === null || AGE_GROUP_RE.test(value);
}

/**
 * FAIL CLOSED (D-012): adult ONLY when null, senior, open, veterans, masters, U20 and above, or 19+ and above. Every other value,
 * an unrecognised spelling included, counts as junior, and nobody is named in a junior event or ranking.
 */
export function isJuniorAgeGroup(value: string | null): boolean {
  if (value === null) return false;
  if (value === 'senior' || value === 'open' || value === 'veterans' || value === 'masters') return false;
  const u = /^U([0-9]{1,2})$/.exec(value);
  if (u) return Number(u[1]) < 20;
  const plus = /^([0-9]{1,2})\+$/.exec(value);
  if (plus) return Number(plus[1]) < 19;
  return true;
}

/** An outbox payload value: a reference or a code, never contact data (D-029). */
export type OutboxPayloadValue = string | number | boolean | null;
export type OutboxPayload = Readonly<Record<string, OutboxPayloadValue>>;

const OUTBOX_KEY_RE = /^[A-Za-z][A-Za-z0-9_]{0,39}$/;
const OUTBOX_CONTACT_KEY_RE = /(phone|mail|whatsapp|mobile|address|addr|contact|name|msisdn|recipient)/;
const OUTBOX_SHORT_CONTACT_KEY_RE = /^(to|wa|tel|cc|bcc)(_|$)/;
const OUTBOX_UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const OUTBOX_DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const OUTBOX_INSTANT_RE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2}(\.\d{1,6})?)?(Z|[+-]\d{2}:\d{2})$/;
const OUTBOX_CODE_RE = /^[A-Za-z][A-Za-z0-9_:-]{0,79}$/;

/**
 * Mirrors app.competition_outbox_payload_ok: a FLAT object; keys are identifiers and never contact-like (any case); values are null, a
 * boolean, a whole number 0..999999, a uuid, a date, an ISO instant or a code (no run of 7+ digits). Returns null when fine, else the
 * reason. (The SQL also caps the JSON text at 2,000 characters.)
 */
export function outboxPayloadProblem(payload: unknown): string | null {
  if (payload === null || typeof payload !== 'object' || Array.isArray(payload)) return 'the payload must be an object';
  if (JSON.stringify(payload).length > 2000) return 'the payload is too long';
  for (const [key, value] of Object.entries(payload as Record<string, unknown>)) {
    if (!OUTBOX_KEY_RE.test(key)) return `the key "${key}" is not an identifier`;
    const lower = key.toLowerCase();
    if (OUTBOX_CONTACT_KEY_RE.test(lower) || OUTBOX_SHORT_CONTACT_KEY_RE.test(lower)) return `the key "${key}" looks like contact data`;
    if (value === null || typeof value === 'boolean') continue;
    if (typeof value === 'number') {
      if (Number.isInteger(value) && value >= 0 && value <= 999999) continue;
      return `the value of "${key}" is not a small whole number`;
    }
    if (typeof value === 'string') {
      if (OUTBOX_UUID_RE.test(value) || OUTBOX_DATE_RE.test(value) || OUTBOX_INSTANT_RE.test(value)) continue;
      if (OUTBOX_CODE_RE.test(value) && !/[0-9]{7,}/.test(value)) continue;
      return `the value of "${key}" is not a reference or a code`;
    }
    return `the value of "${key}" must not be a nested object or list`;
  }
  return null;
}
