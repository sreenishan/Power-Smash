// Pure helpers of the Registrations screen (tested in tests/registration/admin-logic.test.ts). Plain English for the owner; money is
// typed in rupees and kept as integer paise (parsePaiseField, the Mark paid parser). Nothing is ever filled in for the owner.
import { formatInr } from '../../../lib/money';
import { parsePaiseField } from '../../../lib/admin/money-input';
import type { RegistrationDto, RegistrationEventSummary, RegistrationStatus } from '../../../lib/admin/registration/types';
import type { ConvertPlayerChoice } from '../../../lib/admin/registration/types';

export const STATUS_LABEL: Record<RegistrationStatus, string> = {
  submitted: 'New',
  payment_verified: 'Payment checked',
  converted: 'Added to entries',
  rejected: 'Rejected',
};

export const AGE_WORDS: Record<string, string> = {
  adult_confirmed: 'adult (confirmed)',
  unknown: 'age unknown',
  minor_suspected: 'maybe under 18',
  minor_confirmed: 'under 18',
};

export function eventTitle(e: Pick<RegistrationEventSummary, 'category' | 'ageGroup' | 'tournamentName'>): string {
  return `${e.category}${e.ageGroup ? ` ${e.ageGroup.replace(/_/g, ' ')}` : ''} · ${e.tournamentName}`;
}

/** "₹500" or "No fee set". */
export function feeLabel(paise: number | null): string {
  return paise === null ? 'No fee set' : formatInr(paise, { trimZeroPaise: true });
}

/** The owner's fee box: blank = no fee (null); a positive amount in rupees becomes paise; zero is refused (leave it empty instead). */
export function parseFee(input: string): { ok: true; paise: number | null } | { ok: false; error: string } {
  const r = parsePaiseField(input);
  if (!r.ok) return { ok: false, error: r.error };
  if (r.paise !== null && r.paise < 1) return { ok: false, error: 'Leave the fee empty for no fee.' };
  if (r.paise !== null && r.paise > 100_000_000) return { ok: false, error: 'That fee is too large. Check it.' };
  return { ok: true, paise: r.paise };
}

/** The amount received: required; 0 is allowed (the owner waived the fee). */
export function parseAmountReceived(input: string): { ok: true; paise: number } | { ok: false; error: string } {
  if (input.trim() === '') return { ok: false, error: 'Type the amount you received, in rupees (0 if you waive the fee).' };
  const r = parsePaiseField(input, { allowZero: true });
  if (!r.ok) return { ok: false, error: r.error };
  if (r.paise === null || r.paise > 100_000_000) return { ok: false, error: 'Check the amount.' };
  return { ok: true, paise: r.paise };
}

/** Rupees text for a stored paise value, to start the box from the owner's own fee (never a made-up number). */
export function rupeesText(paise: number | null): string {
  if (paise === null) return '';
  return paise % 100 === 0 ? String(paise / 100) : (paise / 100).toFixed(2);
}

/** "new" or the id of an existing player record, per typed name. */
export type NameChoice = 'new' | string;

/**
 * The starting choice for every typed name is ALWAYS a new record (age unknown, never named). A name typed by a member of the public is
 * a self-claim (D-012): it must never pick an existing record, and so inherit someone's confirmed-adult status, by itself. Matching
 * records are only suggestions the owner ticks on purpose.
 */
export function initialChoices(r: Pick<RegistrationDto, 'names'>): NameChoice[] {
  return r.names.map(() => 'new');
}

/** The plain warning beside an existing record that would name the person publicly (a confirmed adult record), or null. */
export function existingRecordWarning(ageStatus: string): string | null {
  return ageStatus === 'adult_confirmed'
    ? 'This record is a confirmed adult, so picking it shows this name on the website. Pick it only if you know it is the same person, not just the same name.'
    : null;
}

/** True when the owner's choices would put a confirmed-adult record (a publicly named person) on this registration. */
export function choicesNamePublicly(r: Pick<RegistrationDto, 'names'>, choices: readonly NameChoice[]): boolean {
  return r.names.some((n, i) => {
    const c = choices[i] ?? 'new';
    return c !== 'new' && n.candidates.some((x) => x.id === c && x.ageStatus === 'adult_confirmed');
  });
}

/** The question shown before recording less than the fee (an amount typed on a phone is easy to get wrong), or null. */
export function underpaidQuestion(amountPaise: number, feePaise: number | null): string | null {
  if (feePaise === null || amountPaise === 0 || amountPaise >= feePaise) return null;
  return `You received less than the fee of ${feeLabel(feePaise)}. Record ${feeLabel(amountPaise)} anyway?`;
}

/** The convert request from the owner's choices; new records use the typed name (D-012: the record starts with unknown age). */
export function convertChoices(r: Pick<RegistrationDto, 'names'>, choices: readonly NameChoice[]): ConvertPlayerChoice[] {
  return r.names.map((n, i) => {
    const c = choices[i] ?? 'new';
    return c === 'new' ? { newName: n.typed } : { playerId: c };
  });
}

/** What the owner can do next with a registration. */
export function nextSteps(r: Pick<RegistrationDto, 'status' | 'needsVerification'>): { verify: boolean; convert: boolean; reject: boolean } {
  const open = r.status === 'submitted' || r.status === 'payment_verified';
  return { verify: open, convert: open && !r.needsVerification, reject: open };
}

export function settingsSummary(enabled: boolean): string {
  return enabled
    ? 'Registration is switched on here. Visitors can register only for events you open below, and only once the website switch is on too.'
    : 'Registration is switched off. Nobody can register on the website.';
}
