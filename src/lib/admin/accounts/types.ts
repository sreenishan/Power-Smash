// Organizer and scorer accounts (D-108, platform wave 4): the data contract. Shared by the server (service, backends) and the owner's
// Accounts screen. The role and the tournaments come only from the database (profiles, organizer_assignments, migration 0019), never
// from a token or a request body. No email address is stored or returned here: it stays in Supabase Auth.
import type { Actor, AdminRole, StoreResult } from '../types';

export const SCOPED_ROLES = ['organizer', 'scorer'] as const;
export type ScopedRole = (typeof SCOPED_ROLES)[number];
/** Every role profiles.role can hold after 0019. The integrator widens `AdminRole` (types.ts) to this. */
export type PlatformRole = AdminRole | ScopedRole;

/** The verified caller with the widened role (built by auth.ts authorizePlatform). */
export interface PlatformActor {
  userId: string;
  role: PlatformRole;
}

export const isScopedRole = (r: unknown): r is ScopedRole => r === 'organizer' || r === 'scorer';

/** One row of public.profiles for an organizer or scorer. */
export interface AccountRow {
  id: string;
  role: ScopedRole;
  displayName: string;
  createdAt: string;
  disabledAt: string | null;
}

/** One row of public.organizer_assignments (active while revokedAt is null). */
export interface AssignmentRow {
  id: string;
  profileId: string;
  tournamentId: string;
  role: ScopedRole;
  createdAt: string;
  revokedAt: string | null;
}

export interface AccountTournamentRef {
  id: string;
  name: string;
  startDate: string | null;
}

export interface CreateAccountRecord {
  role: ScopedRole;
  displayName: string;
  tournamentIds: string[];
}

/** The primitive operations. Reads are service-role selects; writes are the owner RPCs of 0019 (each audits and checks the owner). */
export interface AccountsBackend {
  listAccounts(): Promise<AccountRow[]>;
  /** Every assignment (active and revoked) of these accounts. */
  listAssignments(profileIds: readonly string[]): Promise<AssignmentRow[]>;
  listTournaments(): Promise<AccountTournamentRef[]>;
  /** competition_settings.organizer_roles_enabled (the database switch). */
  getOrganizerAccess(): Promise<boolean>;
  createAccount(actor: Actor, userId: string, record: CreateAccountRecord, reason: string): Promise<{ id: string; role: ScopedRole; tournaments: number }>;
  assignTournament(actor: Actor, profileId: string, tournamentId: string, reason: string): Promise<{ id: string }>;
  revokeAssignment(actor: Actor, assignmentId: string, reason: string): Promise<{ id: string; revoked: true }>;
  disableAccount(actor: Actor, profileId: string, reason: string): Promise<{ id: string; disabled: true; assignmentsRevoked: number }>;
  setOrganizerAccess(actor: Actor, enabled: boolean, reason: string): Promise<{ enabled: boolean; changed: boolean }>;
}

export type InviteFailure = 'already_registered' | 'invalid_email' | 'rate_limited' | 'network' | 'unexpected';
export type InviteResult = { ok: true; userId: string } | { ok: false; code: InviteFailure };

/** Sends the Supabase Auth invitation (secret key, server only). gotrue.ts createGoTrueAdmin implements it. */
export interface InviteSender {
  invite(email: string, opts: { redirectTo?: string }): Promise<InviteResult>;
  /** Best effort: blocks the person's sign-in in Supabase Auth too. The database refusal does not wait for it. */
  ban?(userId: string): Promise<boolean>;
}

// ----------------------------------------------------------------------------- what the screen gets

export interface AccountAssignmentDto {
  assignmentId: string;
  tournamentId: string;
  tournamentName: string;
}

export interface AccountDto {
  id: string;
  role: ScopedRole;
  displayName: string;
  status: 'active' | 'ended';
  createdAt: string;
  endedAt: string | null;
  /** Active assignments only. */
  tournaments: AccountAssignmentDto[];
}

export interface AccountsOverview {
  /** The database switch (competition_settings.organizer_roles_enabled). */
  databaseSwitchOn: boolean;
  /** The admin switch (ORGANIZER_ACCOUNTS_ENABLED exactly 'true'). Both must be on before an organizer or scorer can do anything. */
  adminSwitchOn: boolean;
  /** False when the invite cannot be sent from here (no secret key on the server, or the preview). */
  canInvite: boolean;
  accounts: AccountDto[];
  tournaments: AccountTournamentRef[];
}

export interface InviteInput {
  email: string;
  role: ScopedRole;
  displayName: string;
  tournamentIds: string[];
  reason: string;
}

export interface AccountsStore {
  accountsList(): Promise<StoreResult<AccountsOverview>>;
  accountsInvite(actor: Actor, input: InviteInput): Promise<StoreResult<{ id: string; role: ScopedRole; tournaments: number }>>;
  accountsAssign(actor: Actor, input: { profileId: string; tournamentId: string; reason: string }): Promise<StoreResult<{ id: string }>>;
  accountsRevokeAssignment(actor: Actor, input: { assignmentId: string; reason: string }): Promise<StoreResult<{ id: string; revoked: true }>>;
  accountsDisable(actor: Actor, input: { profileId: string; reason: string }): Promise<StoreResult<{ id: string; disabled: true; assignmentsRevoked: number; signInBlocked: boolean }>>;
  accountsSetAccess(actor: Actor, input: { enabled: boolean; reason: string }): Promise<StoreResult<{ enabled: boolean; changed: boolean }>>;
}

/** Every accounts method name, for the stores that delegate to the service (like COMPETITION_STORE_METHODS). */
export const ACCOUNTS_STORE_METHODS = ['accountsList', 'accountsInvite', 'accountsAssign', 'accountsRevokeAssignment', 'accountsDisable', 'accountsSetAccess'] as const satisfies readonly (keyof AccountsStore)[];

/** A refusal from the backend: the code and, for the database's own INVALID/NOT_FOUND messages, the plain-English sentence. */
export class AccountsError extends Error {
  constructor(
    readonly code: 'INVALID' | 'NOT_FOUND' | 'FORBIDDEN' | 'BACKEND_ERROR',
    readonly detail?: string,
  ) {
    super(code);
  }
}
