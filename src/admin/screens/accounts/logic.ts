// Pure helpers of the owner's Accounts screen (D-108): the invite form check (the same rules the server uses, accounts/rules.ts),
// labels, and which tournaments can still be given to an account. No React here, so tests run without a browser.
import { displayNameProblem, emailProblem, reasonProblem, ROLE_LABEL, tournamentsProblem } from '../../../lib/admin/accounts/rules';
import type { AccountDto, AccountTournamentRef, AccountsStore, ScopedRole } from '../../../lib/admin/accounts/types';
import { ACCOUNTS_STORE_METHODS } from '../../../lib/admin/accounts/types';
import { formatDate, isIsoDate } from '../../../lib/dates';

export interface InviteForm {
  email: string;
  displayName: string;
  role: ScopedRole | '';
  tournamentIds: string[];
  reason: string;
}

export const EMPTY_INVITE: InviteForm = { email: '', displayName: '', role: '', tournamentIds: [], reason: '' };

/** Field errors of the invite form, or an empty object when it can be sent. */
export function inviteProblems(f: InviteForm): Record<string, string> {
  const out: Record<string, string> = {};
  const e = emailProblem(f.email);
  if (e) out['email'] = e;
  const n = displayNameProblem(f.displayName);
  if (n) out['displayName'] = n;
  if (f.role === '') out['role'] = 'Choose Organizer or Scorer.';
  const t = tournamentsProblem(f.tournamentIds);
  if (t) out['tournamentIds'] = t;
  const r = reasonProblem(f.reason);
  if (r) out['reason'] = r;
  return out;
}

export const roleLabel = (r: ScopedRole): string => ROLE_LABEL[r];

export function statusLabel(a: AccountDto): string {
  if (a.status === 'ended') return a.endedAt && !Number.isNaN(Date.parse(a.endedAt)) ? `Ended ${formatDate(new Date(a.endedAt))}` : 'Ended';
  return a.tournaments.length === 0 ? 'Active, no tournaments' : 'Active';
}

/** Tournaments not yet given to this account (an ended account gets none). */
export function assignableTournaments(a: AccountDto, all: readonly AccountTournamentRef[]): AccountTournamentRef[] {
  if (a.status !== 'active') return [];
  const has = new Set(a.tournaments.map((t) => t.tournamentId));
  return all.filter((t) => !has.has(t.id));
}

export function tournamentLabel(t: AccountTournamentRef): string {
  return t.startDate && isIsoDate(t.startDate) ? `${t.name} (${formatDate(t.startDate)})` : t.name;
}

/** The accounts part of the admin client, once the integrator has added it; null until then (the screen says so). */
export function accountsApiOf(client: unknown): AccountsStore | null {
  if (!client || typeof client !== 'object') return null;
  const c = client as Record<string, unknown>;
  return ACCOUNTS_STORE_METHODS.every((m) => typeof c[m] === 'function') ? (client as AccountsStore) : null;
}
