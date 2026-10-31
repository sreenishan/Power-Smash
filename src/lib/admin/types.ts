// Admin data contract (D-006, D-007). The ONLY way admin code reads or writes data is the `AdminStore` interface below.
// Three implementations: memory-store.ts (tests and the no-backend preview, fictional seed), supabase-store.ts (Worker, calls
// the SECURITY DEFINER RPCs from src/lib/archive/types.ts `AdminRpcArgs`), http-store.ts (the browser app, calls /api/admin/*).
import type { AgeStatus, ArchiveSettingKey, ProtectedMatchMode, SuppressionKind } from '../archive/types';
import type { InboxLead } from '../inbox/lead';
import type { LeadStatus } from '../inbox/status';
import type { Placement } from '../placements/schedule';
import type { PlacementInput } from '../placements/validate';
import type { PaymentRecord, Settlement } from '../pricing-admin/mark-paid';
import type { ProductEditInput, ProductRecord } from '../pricing-admin/product-edit';
import type { ReviewAction, VideoSubmission } from './submissions';
import type { PlayerProfileFields } from './player-profile';
import type { LiveEditInput, LiveSettings } from '../live/rules';
import type { TournamentDetails, TournamentDetailField, TournamentEditInput } from './tournament-edit';
import type { SubmissionPreview } from './submission-candidate';
import type { FilmingPermission, PermissionInput, PermissionStatus } from './filming-permission';
import type { CompetitionAdminStore } from './competition/types';
import type { AccountsStore } from './accounts/types';
import type { LiveScoringAdminStore } from './live-scoring/types';
import type { RegistrationAdminStore } from './registration/types';
import type { InternationalAdminStore } from './international/types';
import type { NoticesAdminStore } from './notices/types';
import type { RetentionAdminStore } from './retention/types';

export type { AgeStatus, ProtectedMatchMode };

export type AdminRole = 'owner' | 'editor';

/**
 * The verified caller, built by auth.ts from a verified JWT and a profiles lookup. Never from a request body. Since 0019 (D-108) an
 * invited organizer or scorer can be the caller too (only while ORGANIZER_ACCOUNTS_ENABLED is exactly 'true'); they reach only
 * the competition actions of their tournaments (accounts/access.ts, accounts/scoped-store.ts) and the staff notices.
 */
export interface Actor {
  userId: string;
  role: AdminRole | 'organizer' | 'scorer';
}

export type AdminErrorCode =
  | 'NOT_FOUND'
  | 'SAME_PLAYER'
  | 'ALREADY_MERGED'
  | 'SUPPRESSED'
  | 'MINOR_ADULT_MERGE_BLOCKED'
  | 'OVERRIDE_REASON_REQUIRED'
  | 'EMPTY_NAME'
  | 'ALIAS_NOT_OWNED'
  | 'REDIRECT_LOOP'
  | 'UNDO_UNAVAILABLE'
  | 'STALE'
  | 'INVALID'
  | 'UNAUTHORIZED'
  | 'FORBIDDEN'
  | 'BACKEND_ERROR';

/** A failure carries a code, and for a form (placement, price) the plain-English message per field. */
export type StoreFailure = { ok: false; code: AdminErrorCode; errors?: Record<string, string> };
export type StoreResult<T> = { ok: true; data: T } | StoreFailure;

export const okResult = <T>(data: T): StoreResult<T> => ({ ok: true, data });
export const failResult = (code: AdminErrorCode, errors?: Record<string, string>): StoreFailure => (errors ? { ok: false, code, errors } : { ok: false, code });

// ----------------------------------------------------------------------------- DTOs

export interface DashboardData {
  needsReview: number;
  duplicatePairs: number;
  openProfileRequests: number;
  tournamentCandidates: number;
  activeSuppressions: number;
  protectedModes: { unknown_match_mode: ProtectedMatchMode; minor_match_mode: ProtectedMatchMode };
  siteDirty: boolean;
  lastDeployStatus: string | null;
  lastDeployAt: string | null;
}

/** Editable parsed fields of a match (per-field lock = `manual_override`, PC-20). Always labelled "by Power Smash" in the UI. */
export const PARSED_FIELDS = ['tournament', 'category', 'age_group', 'round', 'participants'] as const;
export type ParsedField = (typeof PARSED_FIELDS)[number];

export interface ReviewVideo {
  youtubeId: string;
  /** Byte-exact YouTube title (D-016): shown unmodified beside the parsed fields. */
  titleRaw: string;
  publishedAt: string | null;
  parsed: { tournament: string | null; category: string | null; age_group: string | null; round: string | null; participants: string | null };
  reviewReasons: string[];
  hardFlags: string[];
  confidencePoints: number | null;
  minorHold: boolean;
  locks: Partial<Record<ParsedField, true>>;
  overrideStale: boolean;
}

export interface ReviewResolveInput {
  videoId: string;
  decision: 'approve' | 'ignore' | 'keep_hidden';
  changes?: Partial<Record<ParsedField, string | null>>;
  lockFields?: ParsedField[];
  reason: string;
}

export interface PlayerSummary {
  id: string;
  slug: string;
  displayName: string;
  ageStatus: AgeStatus;
  visibility: 'public' | 'hidden';
  provisional: boolean;
  aliasCount: number;
  mergedInto: string | null;
  consentStatus: 'unknown' | 'parent_verified' | 'withdrawn';
}

export interface PlayerPage {
  items: PlayerSummary[];
  total: number;
}

/** A player's appearance in a match: the unit a split moves to the new person. Shows the raw YouTube title for context (D-016). */
export interface ParticipantDto {
  id: string;
  rawName: string;
  videoTitleRaw: string | null;
}

export interface DuplicatePairDto {
  a: PlayerSummary;
  b: PlayerSummary;
  distance: number;
  reason: 'same_name_key' | 'close_spelling';
  strength: 'strong' | 'weak';
  needsOverride: boolean;
}

export type ProfileRequestKind = 'claim' | 'correction' | 'removal' | 'junior';
export interface ProfileRequest {
  id: string;
  playerId: string | null;
  kind: ProfileRequestKind;
  status: 'new' | 'in_review' | 'resolved' | 'rejected';
  receivedAt: string;
  /** No phone, no email: first name or initial and a one-line summary only (privacy rule for owner-facing data). */
  summary: string;
}

export interface TournamentCandidate {
  id: string;
  name: string;
  seriesKey: string;
  editionYear: number | null;
  matchCount: number;
  region: 'tamil_nadu' | 'other_india' | 'international' | 'unknown';
  isPromoted: boolean;
  /** `submitted` = an organizer submitted it through the website (needs the submission checklist before approval). */
  source: 'parsed' | 'submitted' | 'admin';
  visibility: 'hidden' | 'listed_no_player_pages' | 'public';
  status: 'pending' | 'published' | 'completed' | 'cancelled' | 'rejected';
  /** Filming permission (D-019, D-105): absent or 'unknown' = not recorded (fail closed). */
  filmingPermission?: PermissionStatus;
  /** "Power Smash films this" (D-102): with no granted permission the admin shows the gap. */
  coveredByPowerSmash?: boolean;
  /** tournaments.is_minor_signal (D-012): a school, college or age-group tournament. Absent = false, as the column default. */
  isMinorSignal?: boolean;
}

export interface LeadUpdateInput {
  id: string;
  /** Move to this status (the status machine decides if it is allowed). */
  to?: LeadStatus;
  /** Needed when `to` is lost. */
  lostReason?: string | null;
  notes?: string | null;
  /** IST date YYYY-MM-DD or null to clear. Omit to leave unchanged. */
  followUpOn?: string | null;
  /** Deal value in integer paise or null to clear. Omit to leave unchanged. No default value exists. */
  valuePaise?: number | null;
}

/** Everything the owner types on the Mark paid screen. Every figure is integer paise typed by the owner: nothing has a default. */
export interface MarkPaidRequest {
  leadId: string;
  /** razorpay | upi_manual | bank_transfer | cash */
  provider: string;
  providerRef?: string | null;
  paidOn: string;
  grossPaise: number;
  gatewayFeePaise?: number | null;
  gstOnFeePaise?: number | null;
  tdsPaise?: number | null;
  tdsCertificateReceived?: boolean | null;
  tdsCertificateOn?: string | null;
  documentType: string;
  /** true, false or null (not set yet: only a payment receipt may be issued). */
  gstRegistered: boolean | null;
  reverseCharge?: boolean | null;
  invoiceTotalPaise?: number | null;
}
export interface MarkPaidResult {
  record: PaymentRecord;
  settlement: Settlement;
  warnings: string[];
  /** The enquiry status after the payment. */
  leadStatus: LeadStatus;
}
export interface SubmissionReviewRequest {
  id: string;
  action: ReviewAction;
  reason?: string | null;
  youtubeId?: string | null;
}
export type { VideoSubmission };

export interface SponsorDto {
  id: string;
  name: string;
  website: string | null;
  active: boolean;
}
export interface PlacementsData {
  sponsors: SponsorDto[];
  placements: Placement[];
}
export type PlacementCreateInput = Omit<PlacementInput, 'id' | 'sponsorWebsite' | 'status'>;

export interface ProductItem {
  slug: string;
  group: string;
  record: ProductRecord;
}
export type ProductSaveInput = ProductEditInput & { slug: string };

/** The admin Live screen's save (D-101): what the owner typed, plus a reason for the audit. */
export type LiveSaveInput = LiveEditInput & { reason: string };

/** The admin's tournament details save (D-102): the tournament id, what the owner typed, and a reason for the audit. */
export type TournamentUpdateInput = TournamentEditInput & {
  id: string;
  reason: string;
  /** The details as the form showed them: the save is refused (STALE) if the tournament changed since, e.g. the sync added a category. */
  expected: TournamentDetails;
};

export interface PosterTarget {
  slug: string;
  title: string;
  kind: 'channel' | 'tournament';
}

export interface AuditEntry {
  id: number;
  ts: string;
  actor: string;
  action: string;
  entity: string;
  entityId: string | null;
  reason: string | null;
}

export interface MergeInput {
  keepId: string;
  dropId: string;
  reason: string;
  /** Required only for minor + adult_confirmed: the owner's written reason, logged. */
  overrideReason?: string;
}
export interface SplitInput {
  playerId: string;
  newDisplayName: string;
  /** match_participants rows that belong to the new person. */
  participantIds: string[];
  moveAliasIds?: string[];
  reason: string;
}
export interface RenameInput {
  playerId: string;
  newDisplayName: string;
  keepOldAsAlias?: boolean;
  reason: string;
}
/** The owner's edit of an ADULT player's profile (D-100). Empty text means "not stated". */
export interface PlayerProfileInput {
  playerId: string;
  district: string | null;
  academy: string | null;
  bio: string | null;
  reason: string;
}
export interface ConfirmAdultInput {
  playerIds: string[];
  evidence: string;
  reason: string;
}
export interface ConfirmAdultResult {
  confirmed: string[];
  rejected: { id: string; code: string }[];
}

export interface EmergencyHideInput {
  kind: SuppressionKind;
  value: string;
  reason: string;
  receivedAt?: string;
  requestedBy?: string;
}
export interface EmergencyHideOutcome {
  suppressionId: string;
  hiddenAt: string;
  videosHidden: number;
  playersHidden: number;
  tournamentsHidden: number;
  redirectsRemoved: number;
  /** D-014 step 5: only the owner can do these. */
  ownerChecklist: string[];
}

/** Serializable "how to take this back" description returned with a result. Replayed through the `undo` action. */
export type UndoDescriptor =
  | { kind: 'set_setting'; key: 'unknown_match_mode' | 'minor_match_mode'; value: ProtectedMatchMode }
  | { kind: 'release_suppression'; suppressionId: string }
  | { kind: 'restore_age'; entries: { id: string; status: Exclude<AgeStatus, 'adult_confirmed'> }[] }
  | { kind: 'merge'; token: string };

export interface WithUndo<T> {
  result: T;
  undo?: UndoDescriptor;
}

export const PROTECTED_MODE_KEYS = ['unknown_match_mode', 'minor_match_mode'] as const satisfies readonly ArchiveSettingKey[];
export type ProtectedModeKey = (typeof PROTECTED_MODE_KEYS)[number];

// ----------------------------------------------------------------------------- the store

/** The competition actions (D-108 to D-114) are in ./competition/types.ts; every store implements them through ./competition/service.ts. */
export interface AdminStore
  extends CompetitionAdminStore,
    AccountsStore,
    LiveScoringAdminStore,
    RegistrationAdminStore,
    InternationalAdminStore,
    NoticesAdminStore,
    RetentionAdminStore {
  getDashboard(): Promise<StoreResult<DashboardData>>;
  listReviewQueue(opts: { limit: number; offset: number }): Promise<StoreResult<ReviewVideo[]>>;
  resolveReview(actor: Actor, input: ReviewResolveInput): Promise<StoreResult<{ videoId: string }>>;
  setFieldLock(actor: Actor, input: { videoId: string; field: ParsedField; locked: boolean }): Promise<StoreResult<{ videoId: string }>>;

  searchPlayers(opts: { query: string; limit: number; offset: number }): Promise<StoreResult<PlayerPage>>;
  listDuplicates(opts: { limit: number }): Promise<StoreResult<DuplicatePairDto[]>>;
  listParticipants(opts: { playerId: string; limit: number }): Promise<StoreResult<ParticipantDto[]>>;
  dismissDuplicate(actor: Actor, input: { aId: string; bId: string; reason: string }): Promise<StoreResult<{ dismissed: true }>>;
  mergePlayers(actor: Actor, input: MergeInput): Promise<StoreResult<WithUndo<{ keepId: string; dropId: string }>>>;
  splitPlayer(actor: Actor, input: SplitInput): Promise<StoreResult<{ newPlayerId: string }>>;
  renamePlayer(actor: Actor, input: RenameInput): Promise<StoreResult<{ playerId: string; slug: string }>>;
  /** null = the player is not adult_confirmed, so there is no profile (D-012): a protected player's fields never leave the store. */
  getPlayerProfile(opts: { playerId: string }): Promise<StoreResult<PlayerProfileFields | null>>;
  updatePlayerProfile(actor: Actor, input: PlayerProfileInput): Promise<StoreResult<{ playerId: string; fields: string[] }>>;
  confirmAdultBulk(actor: Actor, input: ConfirmAdultInput): Promise<StoreResult<WithUndo<ConfirmAdultResult>>>;

  listProfileRequests(): Promise<StoreResult<ProfileRequest[]>>;
  resolveProfileRequest(actor: Actor, input: { id: string; decision: 'resolve' | 'reject'; reason: string }): Promise<StoreResult<{ id: string }>>;

  listTournamentCandidates(): Promise<StoreResult<TournamentCandidate[]>>;
  decideTournament(actor: Actor, input: { id: string; decision: 'promote' | 'reject' | 'hide'; reason: string }): Promise<StoreResult<{ id: string }>>;
  /** Approved tournaments (published or completed), newest first, so their details can be corrected (D-102). */
  listApprovedTournaments(): Promise<StoreResult<TournamentCandidate[]>>;
  /** What adding an organizer's tournament_submission lead to the tournament list would create (D-103). No contact detail. */
  previewSubmission(opts: { leadId: string }): Promise<StoreResult<SubmissionPreview>>;
  /** Adds the submission as a pending, hidden "Submitted by organizers" candidate. Computed again here, never taken from the browser. */
  addSubmission(actor: Actor, input: { leadId: string; reason: string }): Promise<StoreResult<{ tournamentId: string; slug: string }>>;
  /** The filming-permission record (D-019, D-105); no record = unknown. Private: holds the granting person's name. */
  getFilmingPermission(opts: { tournamentId: string }): Promise<StoreResult<FilmingPermission>>;
  /** Audits the status and scope only, never the name, role or proof reference. */
  setFilmingPermission(actor: Actor, input: PermissionInput & { tournamentId: string; reason: string }): Promise<StoreResult<{ tournamentId: string; permission: FilmingPermission; fields: string[] }>>;
  getTournamentDetails(opts: { id: string }): Promise<StoreResult<TournamentDetails>>;
  /** Name, level, place, dates, categories, featured and covered (D-102). Audits the changed fields' names; locks name/level/city/district against the sync. */
  updateTournamentDetails(actor: Actor, input: TournamentUpdateInput): Promise<StoreResult<{ id: string; details: TournamentDetails; fields: TournamentDetailField[] }>>;

  listLeads(opts: { limit: number }): Promise<StoreResult<InboxLead[]>>;
  /** Status move, notes, follow-up date and value for one lead. Validated with src/lib/inbox; audited; the audit row never holds the notes text. */
  updateLead(actor: Actor, input: LeadUpdateInput): Promise<StoreResult<{ lead: InboxLead }>>;

  /** Payments recorded against one enquiry (oldest first). */
  listPayments(opts: { leadId: string }): Promise<StoreResult<PaymentRecord[]>>;
  /** Record a payment typed by the owner and move the enquiry along the status machine. Audited first. */
  markPaid(actor: Actor, input: MarkPaidRequest): Promise<StoreResult<MarkPaidResult>>;

  listSubmissions(opts: { limit: number }): Promise<StoreResult<VideoSubmission[]>>;
  /** new > approved > uploaded | rejected. Audited first; the link is never fetched. */
  reviewSubmission(actor: Actor, input: SubmissionReviewRequest): Promise<StoreResult<{ submission: VideoSubmission }>>;

  listPlacements(): Promise<StoreResult<PlacementsData>>;
  /** A new placement starts as a draft; the link must be on the sponsor's registered website. */
  createPlacement(actor: Actor, input: PlacementCreateInput): Promise<StoreResult<{ id: string }>>;
  setPlacementStatus(actor: Actor, input: { id: string; status: 'active' | 'paused' | 'ended' }): Promise<StoreResult<{ id: string }>>;

  listProducts(): Promise<StoreResult<ProductItem[]>>;
  /** Prices are integer paise typed by the owner; there is no default price, fee, tax rate or discount. */
  saveProduct(actor: Actor, input: ProductSaveInput): Promise<StoreResult<ProductItem>>;

  listPosterTargets(): Promise<StoreResult<PosterTarget[]>>;

  /** The /live pin and past streams as stored (D-101). */
  getLive(): Promise<StoreResult<LiveSettings>>;
  /** Saves the pin and the whole past-streams list; the owner may paste YouTube links (the id is read from them). Audits the changed parts' names. */
  saveLive(actor: Actor, input: LiveSaveInput): Promise<StoreResult<{ settings: LiveSettings; fields: string[] }>>;

  getProtectedModes(): Promise<StoreResult<DashboardData['protectedModes']>>;
  setProtectedMode(actor: Actor, input: { key: ProtectedModeKey; value: ProtectedMatchMode; reason: string }): Promise<StoreResult<WithUndo<{ key: ProtectedModeKey; value: ProtectedMatchMode }>>>;

  emergencyHide(actor: Actor, input: EmergencyHideInput): Promise<StoreResult<WithUndo<EmergencyHideOutcome>>>;
  releaseSuppression(actor: Actor, input: { suppressionId: string; reason: string }): Promise<StoreResult<{ suppressionId: string }>>;

  /** Marks the site dirty (D-008) and writes an audit row; used by sync-now and publish-now. */
  recordDispatch(actor: Actor, input: { kind: 'sync' | 'publish'; ok: boolean }): Promise<StoreResult<{ recorded: true }>>;
  listAudit(opts: { limit: number }): Promise<StoreResult<AuditEntry[]>>;
  undo(actor: Actor, descriptor: UndoDescriptor): Promise<StoreResult<{ undone: true }>>;
}
