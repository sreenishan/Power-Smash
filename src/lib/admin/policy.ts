// Permission policy as DATA (D-006, D-007): which admin action each role may call, and the table x role x operation matrix the
// RLS policies and GRANTs must implement. Pure tables, so tests can assert invariants without a database. The SQL (SCHEMA worker,
// supabase/migrations) and the CI anon tests are reconciled against RLS_MATRIX; a mismatch is a bug in one of them.
// tests/admin/rls-matrix-schema.test.ts parses the migrations and fails when a table or api view is missing from, or extra in, the matrix.
// "owner" means the owner through the admin Worker (service_role behind a verified aal2 session); no database role of the owner exists.
import type { AdminRole } from './types';
import { ACCOUNT_ACTIONS } from './accounts/access';
import { REGISTRATION_ACTION_KINDS } from './registration/schemas';
import { INTERNATIONAL_ACTION_KINDS } from './international/schemas';
import { NOTICES_ACTION_KINDS } from './notices/schemas';

// ----------------------------------------------------------------------------- actions

export type ActionKind = 'read' | 'write';

export interface ActionPolicy {
  kind: ActionKind;
  /** Roles allowed once `editorsEnabled` is true. At launch (D-007) only the owner. */
  roles: readonly AdminRole[];
  /** Every privileged action needs a Supabase session at assurance level aal2 (D-006). Never false. */
  requiresAal2: true;
  /** Writes are audited through the store. */
  audited: boolean;
}

const ownerRead: ActionPolicy = { kind: 'read', roles: ['owner'], requiresAal2: true, audited: false };
const ownerWrite: ActionPolicy = { kind: 'write', roles: ['owner'], requiresAal2: true, audited: true };

/** One policy per action name of an area's kind table (the areas export their own read/write table; the policy stays data here). */
function kinds<K extends string, V>(table: Readonly<Record<K, V>>, to: (v: V) => ActionPolicy, override: Partial<Record<K, ActionPolicy>> = {}): Record<K, ActionPolicy> {
  const out = {} as Record<K, ActionPolicy>;
  for (const k of Object.keys(table) as K[]) out[k] = override[k] ?? to(table[k]);
  return out;
}

export const ADMIN_ACTIONS = {
  'dashboard': ownerRead,
  'review.list': ownerRead,
  'review.resolve': ownerWrite,
  'review.lock': ownerWrite,
  'players.search': ownerRead,
  'players.duplicates': ownerRead,
  'players.participants': ownerRead,
  'players.dismissDuplicate': ownerWrite,
  'players.merge': ownerWrite,
  'players.split': ownerWrite,
  'players.rename': ownerWrite,
  'players.getProfile': ownerRead,
  'players.updateProfile': ownerWrite,
  'players.confirmAdult': ownerWrite,
  'profileRequests.list': ownerRead,
  'profileRequests.resolve': ownerWrite,
  'tournaments.candidates': ownerRead,
  'tournaments.decide': ownerWrite,
  'tournaments.approved': ownerRead,
  'tournaments.details': ownerRead,
  'tournaments.update': ownerWrite,
  'tournaments.previewSubmission': ownerRead,
  'tournaments.addSubmission': ownerWrite,
  'tournaments.permission': ownerRead,
  'tournaments.setPermission': ownerWrite,
  'leads.list': ownerRead,
  'leads.update': ownerWrite,
  'payments.list': ownerRead,
  'payments.mark': ownerWrite,
  'submissions.list': ownerRead,
  'submissions.review': ownerWrite,
  'placements.list': ownerRead,
  'placements.create': ownerWrite,
  'placements.setStatus': ownerWrite,
  'products.list': ownerRead,
  'products.save': ownerWrite,
  'live.get': ownerRead,
  'live.save': ownerWrite,
  'posters.list': ownerRead,
  'settings.get': ownerRead,
  'settings.setProtectedMode': ownerWrite,
  'emergency.hide': ownerWrite,
  'emergency.release': ownerWrite,
  'site.syncNow': ownerWrite,
  'site.publishNow': ownerWrite,
  'audit.list': ownerRead,
  'undo': ownerWrite,
  // competitions (D-108 to D-114): owner only, over the 0017/0018 owner RPCs; engines run on the server (src/lib/admin/competition)
  'competition.tournaments': ownerRead,
  'competition.event': ownerRead,
  'competition.courts': ownerRead,
  'competition.rankings': ownerRead,
  'competition.ranking': ownerRead,
  'competition.settings': ownerRead,
  'competition.saveEvent': ownerWrite,
  'competition.addEntry': ownerWrite,
  'competition.withdrawEntry': ownerWrite,
  'competition.setEntry': ownerWrite,
  'competition.generateDraw': ownerWrite,
  'competition.publishDraw': ownerWrite,
  'competition.syncMatches': ownerWrite,
  'competition.saveMatch': ownerWrite,
  'competition.schedule': ownerWrite,
  'competition.recordResult': ownerWrite,
  'competition.confirmResult': ownerWrite,
  'competition.computeRanking': ownerWrite,
  'competition.publishRanking': ownerWrite,
  'competition.saveVenue': ownerWrite,
  'competition.saveCourt': ownerWrite,
  'competition.approvePointsTable': ownerWrite,
  // live scoring (D-113, 0021): reads and the two scoring writes reach assigned organizers and scorers through the per-tournament
  // check (accounts/access.ts SCOPED_ACTION_NEEDS, then app.require_competition_access); the live switch stays owner only
  'competition.liveMatches': ownerRead,
  'competition.liveMatch': ownerRead,
  'competition.liveSettings': ownerRead,
  'competition.liveScore': ownerWrite,
  'competition.liveStatus': ownerWrite,
  'competition.saveLiveSettings': ownerWrite,
  // organizer and scorer accounts (D-108, 0019): owner only
  ...ACCOUNT_ACTIONS,
  // registrations with manual payment checks (D-111, 0020): owner only
  ...kinds(REGISTRATION_ACTION_KINDS, (k) => (k === 'read' ? ownerRead : ownerWrite)),
  // international events listed with one official link (D-112, 0022): owner only
  ...kinds(INTERNATIONAL_ACTION_KINDS, (k) => (k === 'read' ? ownerRead : ownerWrite)),
  // site notices and the email updates list (D-114, 0023): owner only, except notices.staff (organizers and scorers read it too,
  // decided by accounts/access.ts STAFF_WIDE_ACTIONS; no tournament is involved)
  ...kinds(NOTICES_ACTION_KINDS, (k) => (k.kind === 'read' ? ownerRead : ownerWrite)),
} as const satisfies Record<string, ActionPolicy>;

export type AdminActionName = keyof typeof ADMIN_ACTIONS;

/**
 * The single action that may run at aal1 (S2-8): asks whether the signed-in owner may enrol a first TOTP factor. It is deliberately NOT in
 * ADMIN_ACTIONS (every entry there needs aal2); it needs a valid token and an owner profile, reveals nothing else and changes nothing.
 */
export const ENROL_CHECK_ACTION = 'session.enrolCheck';

/**
 * Asks which role this aal2 session has, so the admin app shows the right areas (D-108). Like the enrol check it is NOT in
 * ADMIN_ACTIONS: it changes nothing and reveals only the caller's own role, and only for a role that may use the admin now.
 */
export const SESSION_ROLE_ACTION = 'session.role';

export function isAdminAction(name: string): name is AdminActionName {
  return Object.prototype.hasOwnProperty.call(ADMIN_ACTIONS, name);
}

/** Editors exist in profiles.role but are DISABLED until the matrix and RLS CI tests pass (D-007). */
export function isActionAllowed(role: AdminRole | null, action: AdminActionName, opts: { editorsEnabled: boolean }): boolean {
  if (role === null) return false;
  if (role === 'editor' && !opts.editorsEnabled) return false;
  return (ADMIN_ACTIONS[action].roles as readonly AdminRole[]).includes(role);
}

// ----------------------------------------------------------------------------- RLS matrix

export type DbRole = 'anon' | 'authenticated' | 'editor' | 'owner';
export type DbOp = 'select' | 'insert' | 'update' | 'delete';
export const DB_ROLES: readonly DbRole[] = ['anon', 'authenticated', 'editor', 'owner'];
export const DB_OPS: readonly DbOp[] = ['select', 'insert', 'update', 'delete'];

/** `authenticated` = a signed-in user with no profile row or an unknown role: treated like anon. */
type Grants = Readonly<Record<DbRole, readonly DbOp[]>>;

const NONE: Grants = { anon: [], authenticated: [], editor: [], owner: [] };
const OWNER_READ: Grants = { ...NONE, owner: ['select'] };
/** Owner reads directly; every write goes through a SECURITY DEFINER RPC that audits (D-006). */
const OWNER_READ_RPC_WRITE = OWNER_READ;
const PUBLIC_VIEW: Grants = { anon: ['select'], authenticated: ['select'], editor: ['select'], owner: ['select'] };

export interface TablePolicy {
  /** Private = holds personal data or owner-only business data: never reachable by anon. */
  private: boolean;
  grants: Grants;
}

export const RLS_MATRIX = {
  // public API views (explicit columns, masking in SQL): the only thing anon can read
  'api.public_videos': { private: false, grants: PUBLIC_VIEW },
  'api.public_matches': { private: false, grants: PUBLIC_VIEW },
  'api.public_match_participants': { private: false, grants: PUBLIC_VIEW },
  'api.public_players': { private: false, grants: PUBLIC_VIEW },
  'api.public_tournaments': { private: false, grants: PUBLIC_VIEW },
  'api.public_slug_redirects': { private: false, grants: PUBLIC_VIEW },
  'api.public_archive_modes': { private: false, grants: PUBLIC_VIEW },
  // 0011_products.sql (D-099): visible products only, explicit columns
  'api.public_products': { private: false, grants: PUBLIC_VIEW },
  // 0013_live_pin.sql (D-101): the /live pin and past streams, explicit columns
  'api.public_live_settings': { private: false, grants: PUBLIC_VIEW },
  'api.public_live_past_streams': { private: false, grants: PUBLIC_VIEW },
  // 0017_competition.sql (D-109 to D-113): public competition data, protected players never named; explicit columns
  'api.public_competition_events': { private: false, grants: PUBLIC_VIEW },
  'api.public_competition_draws': { private: false, grants: PUBLIC_VIEW },
  'api.public_competition_draw_slots': { private: false, grants: PUBLIC_VIEW },
  'api.public_competition_matches': { private: false, grants: PUBLIC_VIEW },
  'api.public_competition_match_games': { private: false, grants: PUBLIC_VIEW },
  'api.public_competition_rankings': { private: false, grants: PUBLIC_VIEW },
  // 0020_registrations.sql (D-111): event id + fee of open adult events; the payee payment texts. No name, no contact data
  'api.public_registration_events': { private: false, grants: PUBLIC_VIEW },
  'api.public_registration_payment': { private: false, grants: PUBLIC_VIEW },
  // 0021_live_scores.sql (D-113): live and paused matches only while the owner's switch is on; names only through the competition faces
  'api.public_competition_live': { private: false, grants: PUBLIC_VIEW },
  // 0022_international_links.sql (D-112): published international events whose link is on an allowed website
  'api.public_international_events': { private: false, grants: PUBLIC_VIEW },
  // 0023_notifications.sql (D-114): published public notices in their window; the email sign-up switch
  'api.public_site_notices': { private: false, grants: PUBLIC_VIEW },
  'api.public_notify_settings': { private: false, grants: PUBLIC_VIEW },
  // archive base tables: owner reads, writes only via RPC
  'videos': { private: true, grants: OWNER_READ_RPC_WRITE },
  'video_title_history': { private: true, grants: OWNER_READ },
  'players': { private: true, grants: OWNER_READ_RPC_WRITE },
  'player_aliases': { private: true, grants: OWNER_READ_RPC_WRITE },
  'player_dup_dismissed': { private: true, grants: OWNER_READ_RPC_WRITE },
  'matches': { private: true, grants: OWNER_READ_RPC_WRITE },
  'match_participants': { private: true, grants: OWNER_READ_RPC_WRITE },
  'tournaments': { private: true, grants: OWNER_READ_RPC_WRITE },
  'tournament_aliases': { private: true, grants: OWNER_READ_RPC_WRITE },
  'slug_redirects': { private: true, grants: OWNER_READ_RPC_WRITE },
  'suppression': { private: true, grants: OWNER_READ_RPC_WRITE },
  'archive_settings': { private: true, grants: OWNER_READ_RPC_WRITE },
  'site_state': { private: true, grants: OWNER_READ_RPC_WRITE },
  'sync_runs': { private: true, grants: OWNER_READ },
  // private business data (D-005, D-029)
  'tournament_private': { private: true, grants: OWNER_READ_RPC_WRITE },
  'leads': { private: true, grants: OWNER_READ_RPC_WRITE },
  'lead_events': { private: true, grants: OWNER_READ },
  'notice_versions': { private: true, grants: OWNER_READ },
  'consent_events': { private: true, grants: OWNER_READ },
  'profile_requests': { private: true, grants: OWNER_READ_RPC_WRITE },
  'sponsors': { private: true, grants: OWNER_READ_RPC_WRITE },
  'placements': { private: true, grants: OWNER_READ_RPC_WRITE },
  // 0011_products.sql (D-099): the owner's prices; writes only through admin_save_product
  'products': { private: true, grants: OWNER_READ_RPC_WRITE },
  // 0013_live_pin.sql (D-101): the /live pin and past streams; writes only through admin_save_live
  'live_settings': { private: true, grants: OWNER_READ_RPC_WRITE },
  'live_past_streams': { private: true, grants: OWNER_READ_RPC_WRITE },
  // 0015_submitted_tournaments.sql (D-103): which organizer submission became which tournament; ids only, written by admin_add_submitted_tournament
  'tournament_submissions': { private: true, grants: OWNER_READ_RPC_WRITE },
  // 0016_filming_permission.sql (D-019, D-105): who granted filming permission (a person's name); written by admin_set_filming_permission
  'tournament_permissions': { private: true, grants: OWNER_READ_RPC_WRITE },
  // 0017_competition.sql (D-108 to D-114): the competition core; owner reads, writes only through the admin_* competition RPCs
  'competition_settings': { private: true, grants: OWNER_READ_RPC_WRITE },
  'tournament_events': { private: true, grants: OWNER_READ_RPC_WRITE },
  'venues': { private: true, grants: OWNER_READ_RPC_WRITE },
  'courts': { private: true, grants: OWNER_READ_RPC_WRITE },
  'event_entries': { private: true, grants: OWNER_READ_RPC_WRITE },
  'event_entry_players': { private: true, grants: OWNER_READ_RPC_WRITE },
  'draws': { private: true, grants: OWNER_READ_RPC_WRITE },
  'draw_slots': { private: true, grants: OWNER_READ_RPC_WRITE },
  'competition_matches': { private: true, grants: OWNER_READ_RPC_WRITE },
  'match_games': { private: true, grants: OWNER_READ_RPC_WRITE },
  'match_score_events': { private: true, grants: OWNER_READ_RPC_WRITE },
  'ranking_snapshots': { private: true, grants: OWNER_READ_RPC_WRITE },
  'ranking_entries': { private: true, grants: OWNER_READ_RPC_WRITE },
  // 0019: organizer_assignments (and the organizer/scorer rows of profiles) are written only by the owner account RPCs; read by the
  // admin function for the role and the per-tournament check. Organizers and scorers have no database role of their own.
  'organizer_assignments': { private: true, grants: OWNER_READ_RPC_WRITE },
  'notification_outbox': { private: true, grants: OWNER_READ_RPC_WRITE },
  'data_providers': { private: true, grants: OWNER_READ_RPC_WRITE },
  'data_import_runs': { private: true, grants: OWNER_READ_RPC_WRITE },
  'external_record_mappings': { private: true, grants: OWNER_READ_RPC_WRITE },
  'placement_stats_daily': { private: true, grants: OWNER_READ },
  'placement_page_stats_daily': { private: true, grants: OWNER_READ },
  // 0020_registrations.sql (D-111): contact phone, email, names as typed and payment references; written only by the registration RPCs
  'event_registrations': { private: true, grants: OWNER_READ_RPC_WRITE },
  // 0021_live_scores.sql (D-113): the current score per match, written only by admin_live_score / admin_live_match_status
  'match_live_state': { private: true, grants: OWNER_READ },
  // 0022_international_links.sql (D-112): owner-entered international events and the allowed websites; writes only through the owner RPCs
  'international_events': { private: true, grants: OWNER_READ_RPC_WRITE },
  'international_settings': { private: true, grants: OWNER_READ_RPC_WRITE },
  // 0023_notifications.sql (D-114): the email list (addresses), the sign-up switch and the owner's notices; writes only through RPCs
  'notify_subscribers': { private: true, grants: OWNER_READ_RPC_WRITE },
  'notify_settings': { private: true, grants: OWNER_READ_RPC_WRITE },
  'site_notices': { private: true, grants: OWNER_READ_RPC_WRITE },
  // Worker-only plumbing: no admin access at all
  'events': { private: true, grants: NONE },
  'outbound_clicks': { private: true, grants: NONE },
  'rate_limit_hits': { private: true, grants: NONE },
  'daily_salts': { private: true, grants: NONE },
  'placement_impression_seen': { private: true, grants: NONE },
  // identity and audit
  'profiles': { private: true, grants: OWNER_READ },
  'audit_log': { private: true, grants: OWNER_READ },
} as const satisfies Record<string, TablePolicy>;

export type MatrixTable = keyof typeof RLS_MATRIX;

export function isAllowedOp(table: MatrixTable, role: DbRole, op: DbOp, opts: { editorsEnabled?: boolean } = {}): boolean {
  if (role === 'editor' && !opts.editorsEnabled) return false;
  return (RLS_MATRIX[table].grants[role] as readonly DbOp[]).includes(op);
}
