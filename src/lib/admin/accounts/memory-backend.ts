// AccountsBackend in memory (tests and the no-backend preview). Mirrors the 0019 RPCs: owner only, the same checks, an audit entry
// per write with ids and counts only. Fictional data only. Also a memory ScopeResolver and assignment reader over the competition
// memory state, so the scoped store can be exercised without a database.
import type { Actor } from '../types';
import type { MemoryCompetitionState } from '../competition/memory-backend';
import { displayNameProblem, tournamentsProblem } from './rules';
import type { ActiveAssignment, ScopeDeps } from './scoped-store';
import { AccountsError, type AccountRow, type AccountTournamentRef, type AccountsBackend, type AssignmentRow, type InviteFailure, type InviteSender, type ScopedRole } from './types';

export interface MemoryAccountsState {
  /** Owner and editor ids (profiles rows that are not organizer or scorer). */
  staff: { id: string; role: 'owner' | 'editor' }[];
  accounts: AccountRow[];
  assignments: AssignmentRow[];
  organizerAccess: boolean;
}

export function emptyAccountsState(ownerId: string): MemoryAccountsState {
  return { staff: [{ id: ownerId, role: 'owner' }], accounts: [], assignments: [], organizerAccess: false };
}

export interface MemoryAccountsDeps {
  state: () => MemoryAccountsState;
  tournaments: () => AccountTournamentRef[];
  audit: (actor: Actor, action: string, entity: string, entityId: string, reason: string) => void;
  now: () => Date;
  newId: () => string;
}

const invalid = (m: string): never => {
  throw new AccountsError('INVALID', m);
};
const notFound = (m: string): never => {
  throw new AccountsError('NOT_FOUND', m.charAt(0).toUpperCase() + m.slice(1));
};

export function createMemoryAccountsBackend(d: MemoryAccountsDeps): AccountsBackend {
  const requireOwner = (actor: Actor) => {
    if (!d.state().staff.some((s) => s.id === actor.userId && s.role === 'owner')) throw new AccountsError('FORBIDDEN');
  };
  const iso = () => d.now().toISOString();
  const copy = <T>(x: T): T => JSON.parse(JSON.stringify(x)) as T;

  return {
    listAccounts: async () => copy(d.state().accounts),
    listAssignments: async (ids) => copy(d.state().assignments.filter((a) => ids.includes(a.profileId))),
    listTournaments: async () => copy(d.tournaments()),
    getOrganizerAccess: async () => d.state().organizerAccess,

    createAccount: async (actor, userId, record, reason) => {
      requireOwner(actor);
      const s = d.state();
      if (record.role !== 'organizer' && record.role !== 'scorer') invalid('the role must be organizer or scorer');
      const nameProblem = displayNameProblem(record.displayName);
      if (nameProblem) invalid('the name must be 2 to 60 characters, with no email address or phone number');
      const tp = tournamentsProblem(record.tournamentIds);
      if (tp) invalid(tp);
      for (const t of record.tournamentIds) if (!d.tournaments().some((x) => x.id === t)) notFound('tournament not found');
      if (s.staff.some((x) => x.id === userId) || s.accounts.some((x) => x.id === userId)) invalid('this person already has an account');
      s.accounts.push({ id: userId, role: record.role, displayName: record.displayName.trim(), createdAt: iso(), disabledAt: null });
      for (const t of record.tournamentIds) s.assignments.push({ id: d.newId(), profileId: userId, tournamentId: t, role: record.role, createdAt: iso(), revokedAt: null });
      d.audit(actor, 'create_account', 'profiles', userId, reason);
      return { id: userId, role: record.role, tournaments: record.tournamentIds.length };
    },

    assignTournament: async (actor, profileId, tournamentId, reason) => {
      requireOwner(actor);
      const s = d.state();
      const acc = s.accounts.find((a) => a.id === profileId);
      if (!acc) return notFound('account not found');
      if (acc.disabledAt !== null) invalid('this account has been ended; invite the person again instead');
      if (!d.tournaments().some((t) => t.id === tournamentId)) notFound('tournament not found');
      if (s.assignments.some((a) => a.profileId === profileId && a.tournamentId === tournamentId && a.role === acc.role && a.revokedAt === null)) invalid('this person already has this tournament');
      const id = d.newId();
      s.assignments.push({ id, profileId, tournamentId, role: acc.role, createdAt: iso(), revokedAt: null });
      d.audit(actor, 'assign_tournament', 'organizer_assignments', id, reason);
      return { id };
    },

    revokeAssignment: async (actor, assignmentId, reason) => {
      requireOwner(actor);
      const a = d.state().assignments.find((x) => x.id === assignmentId);
      if (!a) return notFound('assignment not found');
      if (a.revokedAt !== null) invalid('this assignment has already been removed');
      a.revokedAt = iso();
      d.audit(actor, 'revoke_assignment', 'organizer_assignments', a.id, reason);
      return { id: a.id, revoked: true as const };
    },

    disableAccount: async (actor, profileId, reason) => {
      requireOwner(actor);
      const s = d.state();
      const acc = s.accounts.find((a) => a.id === profileId);
      if (!acc) return notFound('account not found');
      if (acc.disabledAt !== null) invalid('this account has already been ended');
      acc.disabledAt = iso();
      let n = 0;
      for (const a of s.assignments) {
        if (a.profileId === profileId && a.revokedAt === null) {
          a.revokedAt = acc.disabledAt;
          n += 1;
        }
      }
      d.audit(actor, 'disable_account', 'profiles', profileId, reason);
      return { id: profileId, disabled: true as const, assignmentsRevoked: n };
    },

    setOrganizerAccess: async (actor, enabled, reason) => {
      requireOwner(actor);
      const s = d.state();
      const changed = s.organizerAccess !== enabled;
      s.organizerAccess = enabled;
      d.audit(actor, 'set_organizer_access', 'competition_settings', '1', reason);
      return { enabled, changed };
    },
  };
}

/**
 * The memory scope: the caller's active assignments (none when the account is ended or the database switch is off, like the SQL), and
 * the tournament of each competition record from the competition memory state.
 */
export function createMemoryScopeDeps(accounts: () => MemoryAccountsState, competition: () => MemoryCompetitionState): ScopeDeps {
  return {
    assignments: async (userId): Promise<ActiveAssignment[]> => {
      const s = accounts();
      const acc = s.accounts.find((a) => a.id === userId);
      if (!s.organizerAccess || !acc || acc.disabledAt !== null) return [];
      return s.assignments.filter((a) => a.profileId === userId && a.revokedAt === null && a.role === acc.role).map((a) => ({ tournamentId: a.tournamentId, role: a.role as ScopedRole }));
    },
    resolver: {
      tournamentOf: async (kind, id) => {
        const c = competition();
        const eventT = (eventId: string | undefined) => c.events.find((e) => e.id === eventId)?.tournamentId ?? null;
        if (kind === 'event') return eventT(id);
        if (kind === 'entry') return eventT(c.entries.find((e) => e.id === id)?.eventId);
        if (kind === 'draw') return eventT(c.draws.find((x) => x.id === id)?.eventId);
        if (kind === 'match') return eventT(c.matches.find((m) => m.id === id)?.eventId);
        if (kind === 'court') return c.courts.find((x) => x.id === id)?.tournamentId ?? null;
        return null;
      },
    },
  };
}

/** A fake invite sender for tests and the preview: no email is ever sent. Records nothing about the address. */
export function createFakeInviteSender(newUserId: () => string, opts: { fail?: InviteFailure } = {}): InviteSender & { sent: number; banned: string[] } {
  const self = {
    sent: 0,
    banned: [] as string[],
    invite: async () => {
      if (opts.fail) return { ok: false as const, code: opts.fail };
      self.sent += 1;
      return { ok: true as const, userId: newUserId() };
    },
    ban: async (userId: string) => {
      self.banned.push(userId);
      return true;
    },
  };
  return self;
}
