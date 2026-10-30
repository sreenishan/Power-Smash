// The owner's Accounts actions (D-108). Shared by the memory store (tests, preview) and the Supabase store (Vercel function): both give
// it an AccountsBackend and, on the server, an InviteSender (Supabase Auth admin invite, secret key). The email address is passed
// to Supabase Auth only: it is never stored by Power Smash, never audited, never logged and never returned. Refusals come back as
// plain English in `errors.form`.
import { failResult, okResult, type Actor, type AdminErrorCode, type StoreResult } from '../types';
import { displayNameProblem, emailProblem, normaliseEmail, reasonProblem, tournamentsProblem } from './rules';
import {
  AccountsError,
  type AccountDto,
  type AccountsBackend,
  type AccountsStore,
  type InviteFailure,
  type InviteSender,
} from './types';

export interface AccountsServiceOptions {
  /** null = inviting is not available here (no secret key on the server, or the preview). */
  invites: InviteSender | null;
  /** ORGANIZER_ACCOUNTS_ENABLED exactly 'true' (read by the caller through runtime-env, never here). */
  organizerAccountsEnabled: boolean;
  /** Where the invitation link sends the person (the admin address). Optional: Supabase then uses the project's Site URL. */
  redirectTo?: string;
}

export const INVITE_MESSAGES: Record<InviteFailure | 'not_available' | 'not_recorded', string> = {
  already_registered: 'This email address already has a sign-in in Supabase. Use a different address, or ask Claude to look at it with you.',
  invalid_email: 'Supabase did not accept that email address. Check it and try again.',
  rate_limited: 'Supabase is limiting invitations for a while. Wait an hour and try again.',
  network: 'Supabase could not be reached. Nothing was sent. Try again in a minute.',
  unexpected: 'Supabase did not send the invitation. Nothing was saved. Try again later.',
  not_available: 'Invitations cannot be sent from here yet (the server is not set up for it, or this is the preview).',
  not_recorded:
    'The invitation email was sent, but the account was not saved here, so the person cannot do anything. Tell Claude: the sign-in must be removed in Supabase before you can invite this address again.',
};

const PASS: readonly AdminErrorCode[] = ['INVALID', 'NOT_FOUND', 'FORBIDDEN', 'BACKEND_ERROR'];
const NOT_FOUND_TEXT = 'That account, tournament or assignment no longer exists. Reload the page.';

function toFailure(e: unknown) {
  const code = (e as { code?: unknown })?.code;
  const detail = (e as { detail?: unknown })?.detail;
  if (e instanceof AccountsError || (typeof code === 'string' && (PASS as readonly string[]).includes(code))) {
    const c = code as AdminErrorCode;
    if (typeof detail === 'string' && detail !== '') return failResult(c, { form: detail });
    if (c === 'NOT_FOUND') return failResult(c, { form: NOT_FOUND_TEXT });
    return failResult(c);
  }
  return failResult('BACKEND_ERROR');
}

async function guard<T>(fn: () => Promise<StoreResult<T>>): Promise<StoreResult<T>> {
  try {
    return await fn();
  } catch (e) {
    return toFailure(e);
  }
}

const refuse = (field: string, message: string) => failResult('INVALID', { [field]: message });

export function createAccountsService(b: AccountsBackend, opts: AccountsServiceOptions): AccountsStore {
  return {
    accountsList: () =>
      guard(async () => {
        const [accounts, tournaments, databaseSwitchOn] = await Promise.all([b.listAccounts(), b.listTournaments(), b.getOrganizerAccess()]);
        const assignments = accounts.length === 0 ? [] : await b.listAssignments(accounts.map((a) => a.id));
        const name = new Map(tournaments.map((t) => [t.id, t.name]));
        const dto: AccountDto[] = accounts
          .map((a) => ({
            id: a.id,
            role: a.role,
            displayName: a.displayName,
            status: a.disabledAt === null ? ('active' as const) : ('ended' as const),
            createdAt: a.createdAt,
            endedAt: a.disabledAt,
            tournaments: assignments
              .filter((x) => x.profileId === a.id && x.revokedAt === null)
              .map((x) => ({ assignmentId: x.id, tournamentId: x.tournamentId, tournamentName: name.get(x.tournamentId) ?? 'Tournament not found' }))
              .sort((x, y) => x.tournamentName.localeCompare(y.tournamentName)),
          }))
          // active first, then by name
          .sort((x, y) => (x.status === y.status ? x.displayName.localeCompare(y.displayName) : x.status === 'active' ? -1 : 1));
        return okResult({ databaseSwitchOn, adminSwitchOn: opts.organizerAccountsEnabled, canInvite: opts.invites !== null, accounts: dto, tournaments });
      }),

    accountsInvite: (actor: Actor, input) =>
      guard(async () => {
        const problems: Record<string, string> = {};
        const e = emailProblem(input.email);
        if (e) problems['email'] = e;
        const n = displayNameProblem(input.displayName);
        if (n) problems['displayName'] = n;
        const t = tournamentsProblem(input.tournamentIds);
        if (t) problems['tournamentIds'] = t;
        const r = reasonProblem(input.reason);
        if (r) problems['reason'] = r;
        if (input.role !== 'organizer' && input.role !== 'scorer') problems['role'] = 'Choose Organizer or Scorer.';
        if (Object.keys(problems).length > 0) return failResult('INVALID', problems);
        if (!opts.invites) return refuse('form', INVITE_MESSAGES.not_available);
        // every tournament must exist BEFORE anything is sent (an email cannot be unsent)
        const known = new Set((await b.listTournaments()).map((x) => x.id));
        if (input.tournamentIds.some((id) => !known.has(id))) return refuse('tournamentIds', 'A chosen tournament no longer exists. Reload the page.');

        const sent = await opts.invites.invite(normaliseEmail(input.email), opts.redirectTo ? { redirectTo: opts.redirectTo } : {});
        if (!sent.ok) return refuse(sent.code === 'invalid_email' || sent.code === 'already_registered' ? 'email' : 'form', INVITE_MESSAGES[sent.code]);
        try {
          const saved = await b.createAccount(actor, sent.userId, { role: input.role, displayName: input.displayName.trim(), tournamentIds: [...input.tournamentIds] }, input.reason.trim());
          return okResult(saved);
        } catch {
          return refuse('form', INVITE_MESSAGES.not_recorded);
        }
      }),

    accountsAssign: (actor, input) =>
      guard(async () => {
        const r = reasonProblem(input.reason);
        if (r) return refuse('reason', r);
        return okResult(await b.assignTournament(actor, input.profileId, input.tournamentId, input.reason.trim()));
      }),

    accountsRevokeAssignment: (actor, input) =>
      guard(async () => {
        const r = reasonProblem(input.reason);
        if (r) return refuse('reason', r);
        return okResult(await b.revokeAssignment(actor, input.assignmentId, input.reason.trim()));
      }),

    accountsDisable: (actor, input) =>
      guard(async () => {
        const r = reasonProblem(input.reason);
        if (r) return refuse('reason', r);
        // the database refusal comes first and does not depend on Supabase Auth; the ban is extra, best effort
        const done = await b.disableAccount(actor, input.profileId, input.reason.trim());
        let signInBlocked = false;
        if (opts.invites?.ban) {
          try {
            signInBlocked = await opts.invites.ban(input.profileId);
          } catch {
            signInBlocked = false;
          }
        }
        return okResult({ ...done, signInBlocked });
      }),

    accountsSetAccess: (actor, input) =>
      guard(async () => {
        const r = reasonProblem(input.reason);
        if (r) return refuse('reason', r);
        return okResult(await b.setOrganizerAccess(actor, input.enabled, input.reason.trim()));
      }),
  };
}
