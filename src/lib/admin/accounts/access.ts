// Who may do what (D-108), as DATA shared by the server (auth, the scoped competition store) and the admin app (navigation, buttons).
// The database enforces the same thing on its own (migration 0019, app.require_competition_access): hiding a button is never the
// protection, and a TS mistake still meets the SQL check.
//
//   owner      everything, as before.
//   organizer  the Competitions area for the tournaments assigned to them: events, entries, draws, matches, courts, the order of play,
//              results including confirming them. NOT rankings, the points table, venues, settings, or anything outside competitions.
//   scorer     record results (never confirm, never publish) for matches of the tournaments assigned to them, and read what that needs.
//   editor     unchanged (off, D-007); never a competition role.
import type { ActionPolicy } from '../policy';
import { isScopedRole, type PlatformRole, type ScopedRole } from './types';

/** read = see it; run = organizer work; score = record a result. Matches p_needed of app.require_competition_access ('run' | 'score'). */
export type AccessNeed = 'read' | 'run' | 'score';

/**
 * Live scoring (D-113, 0021): the match list and console are reads, a tap and a status change are 'score'; the live switch is owner
 * only. Written out here (not imported from live-scoring/schemas.ts, which pulls zod into the admin app); a test pins it to
 * LIVE_SCORING_ACCESS.
 */
export const LIVE_SCOPED: Readonly<Record<string, AccessNeed>> = {
  'competition.liveMatches': 'read',
  'competition.liveMatch': 'read',
  'competition.liveScore': 'score',
  'competition.liveStatus': 'score',
};

const ORGANIZER: Readonly<Record<string, AccessNeed>> = {
  'competition.tournaments': 'read',
  'competition.event': 'read',
  'competition.courts': 'read',
  'competition.saveEvent': 'run',
  'competition.addEntry': 'run',
  'competition.withdrawEntry': 'run',
  'competition.setEntry': 'run',
  'competition.generateDraw': 'run',
  'competition.publishDraw': 'run',
  'competition.syncMatches': 'run',
  'competition.saveMatch': 'run',
  'competition.schedule': 'run',
  'competition.recordResult': 'score',
  'competition.confirmResult': 'run',
  'competition.saveCourt': 'run',
  ...LIVE_SCOPED,
};

const SCORER: Readonly<Record<string, AccessNeed>> = {
  'competition.tournaments': 'read',
  'competition.event': 'read',
  'competition.recordResult': 'score',
  ...LIVE_SCOPED,
};

/** The role-to-action map for the scoped roles. Anything not listed is refused (rankings, venues, settings, every other area). */
export const SCOPED_ACTION_NEEDS: Readonly<Record<ScopedRole, Readonly<Record<string, AccessNeed>>>> = { organizer: ORGANIZER, scorer: SCORER };

/** Never reachable by a scoped role, even by mistake in the map above (a test pins this). */
export const OWNER_ONLY_COMPETITION_ACTIONS = [
  'competition.rankings',
  'competition.ranking',
  'competition.settings',
  'competition.computeRanking',
  'competition.publishRanking',
  'competition.saveVenue',
  'competition.approvePointsTable',
  'competition.liveSettings',
  'competition.saveLiveSettings',
] as const;

/**
 * Actions an organizer or scorer may call that touch no tournament and hold nothing private (D-114: the published staff notices).
 * No per-tournament check applies; the server switch still does.
 */
export const STAFF_WIDE_ACTIONS = ['notices.staff'] as const;

export function isStaffWideAction(action: string): boolean {
  return (STAFF_WIDE_ACTIONS as readonly string[]).includes(action);
}

export function scopedNeed(role: ScopedRole, action: string): AccessNeed | null {
  if ((OWNER_ONLY_COMPETITION_ACTIONS as readonly string[]).includes(action)) return null;
  return Object.prototype.hasOwnProperty.call(SCOPED_ACTION_NEEDS[role], action) ? (SCOPED_ACTION_NEEDS[role][action] as AccessNeed) : null;
}

/** Does an active assignment with this role satisfy the need? Same rule as the SQL: run needs organizer; score and read either. */
export function assignmentSatisfies(assignmentRole: ScopedRole, need: AccessNeed): boolean {
  return need === 'run' ? assignmentRole === 'organizer' : true;
}

// ----------------------------------------------------------------------------- the account actions (owner only)

const ownerRead: ActionPolicy = { kind: 'read', roles: ['owner'], requiresAal2: true, audited: false };
const ownerWrite: ActionPolicy = { kind: 'write', roles: ['owner'], requiresAal2: true, audited: true };

/** The integrator adds these to ADMIN_ACTIONS (policy.ts). */
export const ACCOUNT_ACTIONS = {
  'accounts.list': ownerRead,
  'accounts.invite': ownerWrite,
  'accounts.assign': ownerWrite,
  'accounts.revokeAssignment': ownerWrite,
  'accounts.disable': ownerWrite,
  'accounts.setAccess': ownerWrite,
} as const satisfies Record<string, ActionPolicy>;

export type AccountActionName = keyof typeof ACCOUNT_ACTIONS;

export function isAccountAction(name: string): name is AccountActionName {
  return Object.prototype.hasOwnProperty.call(ACCOUNT_ACTIONS, name);
}

// ----------------------------------------------------------------------------- the profiles row -> role (fail closed)

/** The role a profiles row grants: an ended (disabled) organizer or scorer has none; an unknown role has none. */
export function roleFromProfileRow(row: { role?: unknown; disabled_at?: unknown } | null | undefined): PlatformRole | null {
  if (!row) return null;
  const role = row.role;
  if (role === 'owner' || role === 'editor') return role;
  if (isScopedRole(role)) return row.disabled_at === null || row.disabled_at === undefined ? role : null;
  return null;
}

/** Server switch ORGANIZER_ACCOUNTS_ENABLED: on only when exactly 'true' (never trimmed, never case-folded). */
export function organizerAccountsEnabled(value: unknown): boolean {
  return value === 'true';
}

// ----------------------------------------------------------------------------- what the admin app shows each role

/** Admin areas (the AdminApp tab keys) a role may open. null = every area (the owner). */
export function navAreasFor(role: PlatformRole): readonly string[] | null {
  if (role === 'owner') return null;
  // the Competitions area and the phone scoring console (D-113); a scorer lands on the console
  if (isScopedRole(role)) return role === 'scorer' ? ['scoring', 'competitions'] : ['competitions', 'scoring'];
  return [];
}

export interface CompetitionCapabilities {
  rankings: boolean;
  venues: boolean;
  addEvent: boolean;
  editEvent: boolean;
  entries: boolean;
  draw: boolean;
  schedule: boolean;
  courts: boolean;
  updateMatches: boolean;
  editMatch: boolean;
  recordResult: boolean;
  confirmResult: boolean;
  /** A scorer sees "Protected player" for anyone who is not a confirmed adult, and for everyone in a junior event (D-109). */
  seesProtectedNames: boolean;
}

/** The buttons and sub-pages of the Competitions area for a role. Derived from the same map the server enforces. */
export function competitionUiFor(role: PlatformRole): CompetitionCapabilities {
  if (role === 'owner') {
    return { rankings: true, venues: true, addEvent: true, editEvent: true, entries: true, draw: true, schedule: true, courts: true, updateMatches: true, editMatch: true, recordResult: true, confirmResult: true, seesProtectedNames: true };
  }
  const can = (action: string): boolean => isScopedRole(role) && scopedNeed(role, action) !== null;
  return {
    rankings: false,
    venues: false,
    addEvent: can('competition.saveEvent'),
    editEvent: can('competition.saveEvent'),
    entries: can('competition.addEntry'),
    draw: can('competition.generateDraw'),
    schedule: can('competition.schedule'),
    courts: can('competition.saveCourt'),
    updateMatches: can('competition.syncMatches'),
    editMatch: can('competition.saveMatch'),
    recordResult: can('competition.recordResult'),
    confirmResult: can('competition.confirmResult'),
    seesProtectedNames: role === 'organizer',
  };
}
