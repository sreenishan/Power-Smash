// Protected-status rules for identity operations (D-012, D-013, PC-13, SEC-02). PURE.
//   - merge: the result takes the MORE RESTRICTIVE status; a merge between a minor status and adult_confirmed is blocked
//     unless the caller passes a logged override with a written reason.
//   - split: the new player inherits the parent's status exactly, and is provisional (no profile page until reviewed).
//   - confirm adult: only an admin review may lift protection, never from minor_confirmed (needs age proof, D-015).
import type { AgeStatus, ConsentStatus, IdPlayer, OverrideRecord } from './types';

const RANK: Record<AgeStatus, number> = { adult_confirmed: 0, unknown: 1, minor_suspected: 2, minor_confirmed: 3 };
const CONSENT_RANK: Record<ConsentStatus, number> = { parent_verified: 0, unknown: 1, withdrawn: 2 };

export function isMinorStatus(s: AgeStatus): boolean {
  return s === 'minor_suspected' || s === 'minor_confirmed';
}

/** The more restrictive of two statuses (adult_confirmed < unknown < minor_suspected < minor_confirmed). */
export function mergeAgeStatus(a: AgeStatus, b: AgeStatus): AgeStatus {
  return RANK[a] >= RANK[b] ? a : b;
}

export function mergeConsentStatus(a: ConsentStatus, b: ConsentStatus): ConsentStatus {
  return CONSENT_RANK[a] >= CONSENT_RANK[b] ? a : b;
}

export type MergeStatusDecision =
  | { allowed: true; ageStatus: AgeStatus; consentStatus: ConsentStatus; overrideLogged: OverrideRecord | null }
  | { allowed: false; code: 'MINOR_ADULT_MERGE_BLOCKED' | 'OVERRIDE_REASON_REQUIRED' };

export function decideMergeStatus(keep: IdPlayer, drop: IdPlayer, override?: OverrideRecord | null): MergeStatusDecision {
  const crossesMinorAdult =
    (isMinorStatus(keep.ageStatus) && drop.ageStatus === 'adult_confirmed') ||
    (isMinorStatus(drop.ageStatus) && keep.ageStatus === 'adult_confirmed');
  let overrideLogged: OverrideRecord | null = null;
  if (crossesMinorAdult) {
    if (!override) return { allowed: false, code: 'MINOR_ADULT_MERGE_BLOCKED' };
    if (override.reason.trim() === '') return { allowed: false, code: 'OVERRIDE_REASON_REQUIRED' };
    overrideLogged = { reason: override.reason.trim() };
  }
  return {
    allowed: true,
    ageStatus: mergeAgeStatus(keep.ageStatus, drop.ageStatus),
    consentStatus: mergeConsentStatus(keep.consentStatus, drop.consentStatus),
    overrideLogged,
  };
}

/** Split: the new person inherits status, signals and consent of the parent; always provisional. */
export function inheritForSplit(parent: IdPlayer): Pick<IdPlayer, 'ageStatus' | 'ageSignals' | 'consentStatus' | 'provisional'> {
  return {
    ageStatus: parent.ageStatus,
    ageSignals: [...parent.ageSignals],
    consentStatus: parent.consentStatus,
    provisional: true,
  };
}

export type ConfirmAdultDecision = { ok: true } | { ok: false; code: 'ALREADY_ADULT' | 'MINOR_CONFIRMED_NEEDS_AGE_PROOF' | 'MERGED' | 'CONSENT_WITHDRAWN' };

export function canConfirmAdult(p: IdPlayer): ConfirmAdultDecision {
  if (p.mergedInto) return { ok: false, code: 'MERGED' };
  if (p.ageStatus === 'adult_confirmed') return { ok: false, code: 'ALREADY_ADULT' };
  if (p.ageStatus === 'minor_confirmed') return { ok: false, code: 'MINOR_CONFIRMED_NEEDS_AGE_PROOF' };
  if (p.consentStatus === 'withdrawn') return { ok: false, code: 'CONSENT_WITHDRAWN' };
  return { ok: true };
}

export const MAX_BULK_CONFIRM = 200;
