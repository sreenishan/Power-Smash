// The account rules shared by the owner's Accounts form (browser) and the server (zod schemas, service), and mirrored by migration
// 0019 (admin_create_account and the profiles_scoped_label check). A change here is a change on both sides: tests/admin/accounts-rules
// pins the SQL text to these numbers. Plain English for the owner.
import type { ScopedRole } from './types';

export const DISPLAY_NAME_MIN = 2;
export const DISPLAY_NAME_MAX = 60;
/** The SQL refuses a label with this many digits or more (no phone number in a label). */
export const DISPLAY_NAME_MAX_DIGITS = 6;
export const EMAIL_MAX = 254;
export const TOURNAMENTS_MIN = 1;
export const TOURNAMENTS_MAX = 50;
export const REASON_MIN = 3;
export const REASON_MAX = 500;

export const ROLE_LABEL: Record<ScopedRole, string> = { organizer: 'Organizer', scorer: 'Scorer' };

/** What each role may do, in the owner's words (the Accounts screen shows it beside the choice). */
export const ROLE_EXPLAIN: Record<ScopedRole, string> = {
  organizer:
    'Runs the tournaments you give them: events, entries, draws, courts, the order of play, and results (including confirming them). Cannot see rankings, money, players outside their tournaments, or anything else in the admin.',
  scorer: 'Records match scores for the tournaments you give them. Cannot confirm a result, publish anything or change anything else.',
};

/** The label of an account: a first name or a short name the owner chooses. Never an email address or a phone number. */
export function displayNameProblem(raw: string): string | null {
  const v = raw.trim();
  if (v.length < DISPLAY_NAME_MIN || v.length > DISPLAY_NAME_MAX) return `Give a name of ${DISPLAY_NAME_MIN} to ${DISPLAY_NAME_MAX} characters, for example a first name.`;
  // eslint-disable-next-line no-control-regex
  if (/[\u0000-\u001f\u007f]/.test(v)) return 'The name has a character that cannot be used.';
  if (v.includes('@')) return 'Do not put an email address in the name. The email goes in its own box.';
  if (v.replace(/[^0-9]/g, '').length > DISPLAY_NAME_MAX_DIGITS) return 'Do not put a phone number in the name.';
  return null;
}

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/** A light check only: Supabase Auth makes the final decision when it sends the invitation. */
export function emailProblem(raw: string): string | null {
  const v = raw.trim();
  if (v === '') return 'Type the email address the invitation should go to.';
  if (v.length > EMAIL_MAX || !EMAIL.test(v)) return 'That does not look like an email address.';
  return null;
}

export function tournamentsProblem(ids: readonly string[]): string | null {
  if (ids.length < TOURNAMENTS_MIN) return 'Choose at least one tournament.';
  if (ids.length > TOURNAMENTS_MAX) return `Choose at most ${TOURNAMENTS_MAX} tournaments.`;
  if (new Set(ids).size !== ids.length) return 'A tournament is chosen twice.';
  return null;
}

export function reasonProblem(raw: string): string | null {
  const v = raw.trim();
  return v.length < REASON_MIN || v.length > REASON_MAX ? `Write a short reason (${REASON_MIN} to ${REASON_MAX} characters). Only you see it, in the history.` : null;
}

/** Normalised email for the invite (trimmed, lower case). Never stored by Power Smash; only passed to Supabase Auth. */
export const normaliseEmail = (raw: string): string => raw.trim().toLowerCase();

// ----------------------------------------------------------------------------- the owner's warnings (plain English)

export const WARNINGS = {
  invite:
    'Supabase sends the invitation email from your project, in its own words. The person sets a password, then must set up a sign-in code app (two-step sign-in) before they can do anything. They see only the tournaments you tick here.',
  role: 'An organizer can see the names of every player entered in their tournaments, juniors included. Only invite people you trust with that.',
  revoke: 'They lose this tournament straight away. Their earlier changes stay, and the history keeps who made them.',
  disable: 'This ends the account straight away: every tournament is taken away and they can no longer sign in. It cannot be undone; to work with them again, invite them with a different email address.',
  switchOff: 'Organizer and scorer access is OFF. Invited people cannot do anything until you turn it on here AND the admin setting ORGANIZER_ACCOUNTS_ENABLED is set to true on Vercel.',
  switchOn: 'Organizer and scorer access is ON for the people listed below, for their tournaments only.',
  adminSwitchOff: 'The admin setting ORGANIZER_ACCOUNTS_ENABLED is not true, so organizers and scorers still cannot sign in. Only you can.',
} as const;

/** The two switches together, in one sentence for the top of the screen. */
export function accessSummary(databaseSwitchOn: boolean, adminSwitchOn: boolean): { tone: 'good' | 'warn'; text: string } {
  if (databaseSwitchOn && adminSwitchOn) return { tone: 'good', text: WARNINGS.switchOn };
  if (!databaseSwitchOn) return { tone: 'warn', text: WARNINGS.switchOff };
  return { tone: 'warn', text: WARNINGS.adminSwitchOff };
}
