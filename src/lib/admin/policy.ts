// Permission policy as DATA (D-006, D-007): which admin action each role may call, and the table x role x operation matrix the
// RLS policies and GRANTs must implement. Pure tables, so tests can assert invariants without a database. The SQL (SCHEMA worker,
// supabase/migrations) and the CI anon tests are reconciled against RLS_MATRIX; a mismatch is a bug in one of them.
// tests/admin/rls-matrix-schema.test.ts parses the migrations and fails when a table or api view is missing from, or extra in, the matrix.
// "owner" means the owner through the admin Worker (service_role behind a verified aal2 session); no database role of the owner exists.
import type { AdminRole } from './types';

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
} as const satisfies Record<string, ActionPolicy>;

export type AdminActionName = keyof typeof ADMIN_ACTIONS;

/**
 * The single action that may run at aal1 (S2-8): asks whether the signed-in owner may enrol a first TOTP factor. It is deliberately NOT in
 * ADMIN_ACTIONS (every entry there needs aal2); it needs a valid token and an owner profile, reveals nothing else and changes nothing.
 */
export const ENROL_CHECK_ACTION = 'session.enrolCheck';

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
  'placement_stats_daily': { private: true, grants: OWNER_READ },
  'placement_page_stats_daily': { private: true, grants: OWNER_READ },
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
