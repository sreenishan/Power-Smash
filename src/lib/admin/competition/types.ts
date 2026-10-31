// Admin data contract for competitions (D-108 to D-114, platform wave 3 "admin wiring"). The admin screens call these actions through
// the AdminStore (POST /api/admin/competition.<name>); every write goes through the 0017/0018 owner RPCs in the database, or through the
// memory backend's copy of the same rules in tests and the no-backend preview (fictional seed).
//
// Two layers:
//   CompetitionBackend   - the primitive reads and the RPC writes, one per database function (memory-backend.ts, supabase-backend.ts)
//   CompetitionAdminStore - what the screens call (service.ts): it loads the rows, runs the pure engines (draws, brackets, scheduling,
//                           scoring, local ranking) on the SERVER and stores the result through the backend.
// Owner-facing refusals carry a plain-English sentence in `errors.form` (or `errors.<field>`).
import type { AgeStatus } from '../../archive/types';
import type { Category } from '../../parser/types';
import type { Ruleset } from '../../competition/scoring';
import type { DrawStatus, EntryStatus, EventFormat, EventStatus } from '../../competition/db';
import type { MatchStatus, RoundCode, Side } from '../../competition/types';
import type { Finish } from '../../competition/stats/ranking';
import type { Actor, StoreResult } from '../types';

export type { DrawStatus, EntryStatus, EventFormat, EventStatus, Finish, MatchStatus, RoundCode, Ruleset, Side };

// ----------------------------------------------------------------------------- rows the backend returns (camelCase)

export interface CompTournamentRef {
  id: string;
  name: string;
  /** tournaments.level (TOURNAMENT_LEVELS) or null when not set: the ranking needs it. */
  level: string | null;
  startDate: string | null;
  endDate: string | null;
  /** tournaments.is_minor_signal (D-012): every event of such a tournament counts as junior. */
  minorSignal: boolean;
  status: string;
}

export interface CompEventRow {
  id: string;
  tournamentId: string;
  category: Category;
  ageGroup: string | null;
  /** The stored junior flag (a junior category or age group); the tournament's minor signal is added on top. */
  isJunior: boolean;
  format: EventFormat;
  ruleset: Ruleset;
  capacity: number | null;
  status: EventStatus;
}

export interface CompEntryRow {
  id: string;
  eventId: string;
  /** 1 player id (singles) or 2 (doubles). */
  players: string[];
  seed: number | null;
  status: EntryStatus;
}

export interface CompSlotRow {
  position: number;
  /** null = a bye. */
  entryId: string | null;
  group: string | null;
}

export interface CompDrawRow {
  id: string;
  eventId: string;
  /** The random seed the draw used (reproducible). */
  seed: number;
  status: DrawStatus;
  publishedAt: string | null;
  slots: CompSlotRow[];
}

export interface CompMatchRow {
  id: string;
  eventId: string;
  roundCode: RoundCode;
  matchNumber: number;
  groupLabel: string | null;
  /** Entry ids; null while not known yet. */
  sideA: string | null;
  sideB: string | null;
  scheduledAt: string | null;
  courtId: string | null;
  status: MatchStatus;
  winnerSide: Side | null;
  confirmed: boolean;
  /** Optimistic lock: send it back; a mismatch is refused with STALE. */
  revision: number;
}

export interface CompGameRow {
  matchId: string;
  gameNumber: number;
  a: number;
  b: number;
  finished: boolean;
}

export interface CompCourtRow {
  id: string;
  tournamentId: string;
  venueId: string | null;
  label: string;
  sort: number;
}

export interface CompVenueRow {
  id: string;
  name: string;
  city: string | null;
}

export interface CompPlayerRef {
  id: string;
  displayName: string;
  ageStatus: AgeStatus;
  /** Adults only (D-100); used for "keep one club apart" in a draw. */
  academy: string | null;
}

export interface CompSnapshotRow {
  id: string;
  label: string;
  category: Category | null;
  ageGroup: string | null;
  asOf: string;
  published: boolean;
  publishedAt: string | null;
  createdAt: string;
}

export interface CompSnapshotEntryRow {
  playerId: string;
  rank: number;
  points: number;
  eventsCounted: number;
}

/** The ranking points table the owner approved (D-110). Saving it through the admin IS the approval. */
export interface ApprovedPointsTable {
  label: string;
  /** Points by tournament level x finish; whole numbers 0 or more. A finish not listed scores 0. */
  levels: Record<string, Partial<Record<Finish, number>>>;
  windowDays: number;
  bestN: number;
  approvedAt: string;
}

export interface CompSettings {
  rankingsPublic: boolean;
  registrationEnabled: boolean;
  /** null = no table approved yet: no ranking can be calculated. */
  pointsTable: ApprovedPointsTable | null;
}

// ----------------------------------------------------------------------------- RPC record shapes (the admin sends the whole record)

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
  players: string[];
  seed: number | null;
  status: 'pending' | 'confirmed' | 'waitlisted';
}
export interface SetEntryRecord {
  status: 'pending' | 'confirmed' | 'waitlisted' | 'rejected';
  seed: number | null;
}
export interface SaveDrawRecord {
  seed: number;
  slots: { position: number; entryId: string | null; group: string | null }[];
}
export interface SaveMatchRecord {
  eventId: string;
  roundCode: RoundCode;
  matchNumber: number;
  groupLabel: string | null;
  sideA: string | null;
  sideB: string | null;
  scheduledAt: string | null;
  courtId: string | null;
}
export type ResultStatus = 'completed' | 'walkover' | 'retired' | 'abandoned';
export interface RecordResultRecord {
  status: ResultStatus;
  games: { a: number; b: number }[];
  walkoverWinner: Side | null;
  retiringSide: Side | null;
}
export interface SaveRankingRecord {
  label: string;
  category: Category | null;
  ageGroup: string | null;
  asOf: string;
  entries: { playerId: string; rank: number; points: number; eventsCounted: number }[];
}
export interface SaveVenueRecord {
  name: string;
  city: string | null;
}
export interface SaveCourtRecord {
  tournamentId: string;
  venueId: string | null;
  label: string;
  sort: number;
}
export interface PointsTableRecord {
  label: string;
  levels: Record<string, Partial<Record<Finish, number>>>;
  windowDays: number;
  bestN: number;
}

/** A refusal from the backend: the code and, for the database's own INVALID/STALE/NOT_FOUND messages, the plain-English sentence. */
export class CompetitionError extends Error {
  constructor(
    readonly code: 'INVALID' | 'NOT_FOUND' | 'STALE' | 'FORBIDDEN' | 'BACKEND_ERROR',
    readonly detail?: string,
  ) {
    super(code);
  }
}

/** The primitive operations. Reads return rows; writes are the RPCs (each audits and checks the owner in the database). */
export interface CompetitionBackend {
  listTournaments(): Promise<CompTournamentRef[]>;
  getTournament(id: string): Promise<CompTournamentRef | null>;
  listEvents(filter: { tournamentIds?: string[]; ids?: string[] }): Promise<CompEventRow[]>;
  listEntries(eventIds: string[]): Promise<CompEntryRow[]>;
  getDraw(eventId: string): Promise<CompDrawRow | null>;
  listDraws(eventIds: string[]): Promise<Omit<CompDrawRow, 'slots'>[]>;
  listMatches(eventIds: string[]): Promise<CompMatchRow[]>;
  listGames(matchIds: string[]): Promise<CompGameRow[]>;
  listCourts(tournamentId: string): Promise<CompCourtRow[]>;
  listVenues(): Promise<CompVenueRow[]>;
  getPlayers(ids: string[]): Promise<CompPlayerRef[]>;
  getMatch(id: string): Promise<CompMatchRow | null>;
  /** Newest first, with the number of rows. */
  listSnapshots(): Promise<(CompSnapshotRow & { rows: number })[]>;
  /** One snapshot by id (any age), or null. */
  getSnapshot(snapshotId: string): Promise<(CompSnapshotRow & { rows: number }) | null>;
  getSnapshotEntries(snapshotId: string): Promise<CompSnapshotEntryRow[]>;
  /**
   * The players (of `ids`) competition pages may name: app.competition_named_players (0018: adult_confirmed, public, not provisional,
   * unmerged, not suppressed; no archive match needed). Only these are ranked: anyone else would be dropped from the public ranking
   * view and leave a gap that points at them (D-012, D-109). A null actor (no verified owner) gets nobody from the database backend:
   * fail closed.
   */
  rankablePlayerIds(actor: Actor | null, ids: string[]): Promise<string[]>;
  getSettings(): Promise<CompSettings>;
  /**
   * Organizer path (0024): players whose matching name holds `query` (already normalised), for adding entries to events of `tournamentId`.
   * Only id, display name and the naming flag (admin_competition_search_players; 'run' access in the database).
   */
  searchPlayersForTournament(actor: Actor, tournamentId: string, query: string, limit: number, offset: number): Promise<OrganizerPlayerPage>;
  /** Organizer path (0024): a NEW provisional, hidden, unknown-age player scoped to the tournament (admin_competition_create_player). */
  createProvisionalPlayer(actor: Actor, tournamentId: string, record: { name: string; nameNormalized: string }, reason: string): Promise<OrganizerPlayerDto>;
  /** Organizer path (0024): of the players entered in one event, the ones competition pages may name (admin_competition_event_naming). */
  eventNamedPlayerIds(actor: Actor, eventId: string): Promise<string[]>;

  saveEvent(actor: Actor, id: string | null, record: SaveEventRecord, reason: string): Promise<{ id: string; created: boolean; fields: string[] }>;
  addEntry(actor: Actor, eventId: string, record: AddEntryRecord, reason: string): Promise<{ id: string; status: string }>;
  withdrawEntry(actor: Actor, entryId: string, reason: string): Promise<{ id: string; status: 'withdrawn'; inPublishedDraw: boolean }>;
  setEntry(actor: Actor, entryId: string, record: SetEntryRecord, reason: string): Promise<{ id: string; status: string; seed: number | null; draftDrawCleared: boolean }>;
  saveDraw(actor: Actor, eventId: string, record: SaveDrawRecord, reason: string): Promise<{ id: string; status: 'draft'; slots: number }>;
  publishDraw(actor: Actor, drawId: string, reason: string): Promise<{ id: string; status: 'published' }>;
  saveMatch(actor: Actor, id: string | null, record: SaveMatchRecord, expectedRevision: number | null, reason: string): Promise<{ id: string; revision: number }>;
  recordResult(actor: Actor, matchId: string, record: RecordResultRecord, expectedRevision: number, reason: string): Promise<{ id: string; status: string; winnerSide: Side | null; confirmed: false; revision: number }>;
  confirmResult(actor: Actor, matchId: string, expectedRevision: number, reason: string): Promise<{ id: string; confirmed: true; revision: number }>;
  saveRankingSnapshot(actor: Actor, record: SaveRankingRecord, reason: string): Promise<{ id: string; rows: number; published: false }>;
  publishRankingSnapshot(actor: Actor, snapshotId: string, reason: string): Promise<{ id: string; published: true; publiclyVisible: boolean }>;
  saveVenue(actor: Actor, id: string | null, record: SaveVenueRecord, reason: string): Promise<{ id: string; created: boolean }>;
  saveCourt(actor: Actor, id: string | null, record: SaveCourtRecord, reason: string): Promise<{ id: string; created: boolean }>;
  setPointsTable(actor: Actor, record: PointsTableRecord, reason: string): Promise<{ approvedAt: string }>;
}

// ----------------------------------------------------------------------------- what the screens get

/** A player as an organizer's search sees it (0024): no age status, no profile, no contact field. */
export interface OrganizerPlayerDto {
  id: string;
  displayName: string;
  /** Competition pages may name this player (app.competition_named_players). false = shown as "Protected player". */
  named: boolean;
}

/** One player found by the organizer search (0024): id and name only. No naming flag: that would tell an organizer who is an adult
 * (D-012); the "On the site" badge comes from the event preview once the player is entered. */
export interface OrganizerPlayerHit {
  id: string;
  displayName: string;
}

export interface OrganizerPlayerPage {
  items: OrganizerPlayerHit[];
  hasMore: boolean;
}

export interface CompetitionPlayerDto {
  id: string;
  displayName: string;
  ageStatus: AgeStatus;
  /** Not adult_confirmed (D-012): never named on the public site. The owner still sees the name here. */
  isProtected: boolean;
}

export interface CompetitionEntryDto {
  id: string;
  players: CompetitionPlayerDto[];
  seed: number | null;
  status: EntryStatus;
  /** A protected player in the entry, or a junior event: shown publicly as "Protected player" (D-109). */
  isProtected: boolean;
}

export interface CompetitionEventSummary {
  id: string;
  tournamentId: string;
  category: Category;
  ageGroup: string | null;
  /** Junior category or age group, or a tournament with a minor signal: nobody is named publicly (D-109). */
  isJunior: boolean;
  format: EventFormat;
  status: EventStatus;
  capacity: number | null;
  /** Pending and confirmed entries (they count towards the capacity). */
  activeEntries: number;
  confirmedEntries: number;
  drawStatus: DrawStatus | null;
  matchCount: number;
  confirmedResults: number;
}

export interface CompetitionTournamentDto {
  id: string;
  name: string;
  level: string | null;
  startDate: string | null;
  endDate: string | null;
  events: CompetitionEventSummary[];
}

export interface CompetitionMatchDto {
  id: string;
  /** Short name, for example "MS QF match 3". */
  label: string;
  roundCode: RoundCode;
  matchNumber: number;
  groupLabel: string | null;
  sideA: string | null;
  sideB: string | null;
  scheduledAt: string | null;
  courtId: string | null;
  courtLabel: string | null;
  status: MatchStatus;
  winnerSide: Side | null;
  confirmed: boolean;
  revision: number;
  games: { a: number; b: number; finished: boolean }[];
}

export interface CompetitionDrawDto {
  id: string;
  seed: number;
  status: DrawStatus;
  publishedAt: string | null;
  slots: CompSlotRow[];
}

export interface CompetitionEventDetail {
  tournament: { id: string; name: string; level: string | null; startDate: string | null; endDate: string | null };
  event: CompEventRow & { isJunior: boolean };
  entries: CompetitionEntryDto[];
  draw: CompetitionDrawDto | null;
  matches: CompetitionMatchDto[];
  courts: CompCourtRow[];
}

export interface CompetitionCourtsData {
  venues: CompVenueRow[];
  courts: CompCourtRow[];
}

export interface CompetitionSnapshotSummary extends CompSnapshotRow {
  rows: number;
}

export interface CompetitionRankingRowDto {
  playerId: string;
  displayName: string;
  rank: number;
  points: number;
  eventsCounted: number;
  /**
   * The player's CURRENT profile means competition pages may not name them (app.competition_named_players), or the ranking is a junior
   * one. Fail closed: true unless the player is named by that rule right now. A ranking with any such row cannot be published.
   */
  isProtected: boolean;
}

export interface CompetitionRankingDetail {
  snapshot: CompetitionSnapshotSummary;
  rows: CompetitionRankingRowDto[];
  /** "Power Smash local ranking, not an official BWF ranking" (D-110). */
  disclaimer: string;
  /** Published AND the public switch on: only then is it on the website. */
  publiclyVisible: boolean;
}

export interface CompetitionSettingsDto {
  rankingsPublic: boolean;
  registrationEnabled: boolean;
  pointsTable: ApprovedPointsTable | null;
  /** Plain English: what the approved table does (or that none is approved). */
  pointsTableSummary: string;
}

// ----------------------------------------------------------------------------- action inputs

export interface SaveEventInput extends SaveEventRecord {
  id: string | null;
  reason: string;
}
export interface AddEntryInput extends AddEntryRecord {
  eventId: string;
  reason: string;
}
export interface SetEntryInput extends SetEntryRecord {
  entryId: string;
  reason: string;
}
export interface GenerateDrawInput {
  eventId: string;
  /** The random seed: give the recorded one to make the same draw again; leave it out for a new random draw. */
  seed?: number | null;
  /** Keep two players of one academy or club apart in round 1 when possible (knockout only). */
  separateClubs: boolean;
  /** How many seeds to use (seeds above this count are drawn like everyone else). 0 = no seeds. */
  seeds: number;
  /** Groups + knockout only. */
  groupCount?: number | null;
  advancePerGroup?: number | null;
  reason: string;
}
export interface SaveMatchInput extends SaveMatchRecord {
  id: string | null;
  expectedRevision: number | null;
  reason: string;
}
export interface ScheduleInput {
  tournamentId: string;
  /** Leave out for every event of the tournament. */
  eventIds?: string[];
  windows: { date: string; start: string; end: string }[];
  durationMinutes: number;
  restMinutes: number;
  /** Leave out for every court of the tournament. */
  courtIds?: string[];
  /** false = preview only. true = save, with `expected` (the revisions the preview showed). */
  save: boolean;
  expected?: Record<string, number>;
  reason: string;
}
export interface RecordResultInput extends RecordResultRecord {
  matchId: string;
  expectedRevision: number;
  reason: string;
}
export interface ConfirmResultInput {
  matchId: string;
  expectedRevision: number;
  reason: string;
}
export interface ComputeRankingInput {
  label: string;
  category: Category | null;
  ageGroup: string | null;
  asOf: string;
  reason: string;
}
export interface SaveVenueInput extends SaveVenueRecord {
  id: string | null;
  reason: string;
}
export interface SaveCourtInput extends SaveCourtRecord {
  id: string | null;
  reason: string;
}
export interface ApprovePointsTableInput extends PointsTableRecord {
  reason: string;
}
export interface SearchPlayersInput {
  tournamentId: string;
  /** Part of the name, 3 to 80 characters. */
  q: string;
  limit: number;
  offset: number;
}
export interface CreatePlayerInput {
  tournamentId: string;
  name: string;
  reason: string;
}

// ----------------------------------------------------------------------------- action outputs

export interface GenerateDrawResult {
  drawId: string;
  seed: number;
  status: 'draft';
  format: EventFormat;
  slots: CompSlotRow[];
  /** Plain-English notes: byes, club clashes that could not be separated, groups. */
  notes: string[];
}
export interface MatchSyncOutcome {
  created: number;
  updated: number;
  /** Matches whose players were filled in from a confirmed result: { matchId, side, entryId }. */
  advanced: { matchId: string; side: Side; entryId: string }[];
  /** Plain English: anything that could not be done. */
  problems: string[];
}
export interface PublishDrawResult extends MatchSyncOutcome {
  drawId: string;
  status: 'published';
}
export interface ScheduleResultDto {
  placed: { matchId: string; label: string; courtId: string; courtLabel: string; start: string; end: string; revision: number }[];
  unplaced: { matchId: string; label: string; reason: string }[];
  conflicts: { kind: string; matchIds: string[]; message: string }[];
  saved: number;
  /** Plain English: anything that could not be saved. */
  problems: string[];
  /** The revisions the preview read: send them back as `expected` to save. */
  revisions: Record<string, number>;
}
export interface RecordResultResult {
  id: string;
  status: string;
  winnerSide: Side | null;
  confirmed: false;
  revision: number;
}
export interface ConfirmResultResult extends MatchSyncOutcome {
  id: string;
  confirmed: true;
  revision: number;
}
export interface ComputeRankingResult {
  snapshotId: string;
  rows: number;
  /** Players left out because competition pages may not name them (protected, D-109: app.competition_named_players). */
  protectedLeftOut: number;
  /** Plain English: results left out and why. */
  excluded: string[];
  formula: string;
  disclaimer: string;
  published: false;
}

/** The competition part of the AdminStore. Method names start with `competition` (actions `competition.<name>`). */
export interface CompetitionAdminStore {
  competitionTournaments(): Promise<StoreResult<CompetitionTournamentDto[]>>;
  /** `actor` is the verified owner (the handler passes it). Without one nobody is named: every player and entry reads protected. */
  competitionEvent(opts: { eventId: string }, actor?: Actor): Promise<StoreResult<CompetitionEventDetail>>;
  competitionCourts(opts: { tournamentId: string }): Promise<StoreResult<CompetitionCourtsData>>;
  competitionRankings(): Promise<StoreResult<CompetitionSnapshotSummary[]>>;
  /** `actor` is the verified owner (the handler passes it). Without one the database backend names nobody: every row reads protected. */
  competitionRanking(opts: { snapshotId: string }, actor?: Actor): Promise<StoreResult<CompetitionRankingDetail>>;
  competitionSettings(): Promise<StoreResult<CompetitionSettingsDto>>;

  competitionSaveEvent(actor: Actor, input: SaveEventInput): Promise<StoreResult<{ id: string; created: boolean; fields: string[] }>>;
  competitionAddEntry(actor: Actor, input: AddEntryInput): Promise<StoreResult<{ id: string; status: string }>>;
  competitionWithdrawEntry(actor: Actor, input: { entryId: string; reason: string }): Promise<StoreResult<{ id: string; status: 'withdrawn'; inPublishedDraw: boolean }>>;
  competitionSetEntry(actor: Actor, input: SetEntryInput): Promise<StoreResult<{ id: string; status: string; seed: number | null; draftDrawCleared: boolean }>>;
  competitionGenerateDraw(actor: Actor, input: GenerateDrawInput): Promise<StoreResult<GenerateDrawResult>>;
  competitionPublishDraw(actor: Actor, input: { eventId: string; drawId: string; reason: string }): Promise<StoreResult<PublishDrawResult>>;
  competitionSyncMatches(actor: Actor, input: { eventId: string; reason: string }): Promise<StoreResult<MatchSyncOutcome>>;
  competitionSaveMatch(actor: Actor, input: SaveMatchInput): Promise<StoreResult<{ id: string; revision: number }>>;
  competitionSchedule(actor: Actor, input: ScheduleInput): Promise<StoreResult<ScheduleResultDto>>;
  competitionRecordResult(actor: Actor, input: RecordResultInput): Promise<StoreResult<RecordResultResult>>;
  competitionConfirmResult(actor: Actor, input: ConfirmResultInput): Promise<StoreResult<ConfirmResultResult>>;
  competitionComputeRanking(actor: Actor, input: ComputeRankingInput): Promise<StoreResult<ComputeRankingResult>>;
  competitionPublishRanking(actor: Actor, input: { snapshotId: string; reason: string }): Promise<StoreResult<{ id: string; published: true; publiclyVisible: boolean }>>;
  competitionSaveVenue(actor: Actor, input: SaveVenueInput): Promise<StoreResult<{ id: string; created: boolean }>>;
  competitionSaveCourt(actor: Actor, input: SaveCourtInput): Promise<StoreResult<{ id: string; created: boolean }>>;
  competitionApprovePointsTable(actor: Actor, input: ApprovePointsTableInput): Promise<StoreResult<{ approvedAt: string }>>;
  /** Find a player to enter (organizers; the owner may use it too). Scoped to one tournament the caller runs. */
  competitionSearchPlayers(actor: Actor, input: SearchPlayersInput): Promise<StoreResult<OrganizerPlayerPage>>;
  /** Add a NEW provisional, hidden, unknown-age player when nobody matches. Never edits an existing player. */
  competitionCreatePlayer(actor: Actor, input: CreatePlayerInput): Promise<StoreResult<OrganizerPlayerDto>>;
}

/** Every competition method name, for the stores that delegate to the service. */
export const COMPETITION_STORE_METHODS = [
  'competitionTournaments',
  'competitionEvent',
  'competitionCourts',
  'competitionRankings',
  'competitionRanking',
  'competitionSettings',
  'competitionSaveEvent',
  'competitionAddEntry',
  'competitionWithdrawEntry',
  'competitionSetEntry',
  'competitionGenerateDraw',
  'competitionPublishDraw',
  'competitionSyncMatches',
  'competitionSaveMatch',
  'competitionSchedule',
  'competitionRecordResult',
  'competitionConfirmResult',
  'competitionComputeRanking',
  'competitionPublishRanking',
  'competitionSaveVenue',
  'competitionSaveCourt',
  'competitionApprovePointsTable',
  'competitionSearchPlayers',
  'competitionCreatePlayer',
] as const satisfies readonly (keyof CompetitionAdminStore)[];
