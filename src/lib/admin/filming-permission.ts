// The filming-permission record of a tournament (D-019, built as the safe default in D-105). PURE: one rule shared by the request schema
// (handler.ts), both admin stores and the Tournaments screen, so all of them agree with the SQL in admin_set_filming_permission (0016).
//  - A tournament without a record is `unknown`: FAIL CLOSED. Coverage marked "Power Smash films this", a live stream or sponsor overlays
//    need `granted` with that scope; the admin shows the gap (D-019: "the admin warns and shows the gap").
//  - `granted` needs who granted it (name and role) and the date (not in the future, India time), and filming in its scope.
//  - The record is PRIVATE (the granting person's name is personal data, D-029): owner only, never in the public build, and the audit
//    holds the status and scope, never the name or the proof reference.
// D-019 itself is still "proposed" (owner approval and a lawyer's review of the templates); this stores what the owner states.
import { isIsoDate } from '../dates';

export const PERMISSION_STATUSES = ['unknown', 'requested', 'granted', 'refused', 'not_required'] as const;
export type PermissionStatus = (typeof PERMISSION_STATUSES)[number];
export const EXCLUSIVE_PARTNER = ['unknown', 'yes', 'no'] as const;
export type ExclusivePartner = (typeof EXCLUSIVE_PARTNER)[number];

export const PERMISSION_LIMITS = { grantedByName: 120, grantedByRole: 80, documentRef: 300 } as const;

export interface FilmingPermission {
  status: PermissionStatus;
  grantedByName: string | null;
  grantedByRole: string | null;
  /** YYYY-MM-DD (India time), or null. */
  grantedOn: string | null;
  scopeFilming: boolean;
  scopeYoutube: boolean;
  scopeLiveStream: boolean;
  scopeSponsorOverlays: boolean;
  exclusivePartner: ExclusivePartner;
  /** Where the proof is kept (for example "WhatsApp from the secretary, saved in Drive"); never a file or a link to private storage. */
  documentRef: string | null;
}

export const NO_PERMISSION: FilmingPermission = {
  status: 'unknown', grantedByName: null, grantedByRole: null, grantedOn: null, scopeFilming: false, scopeYoutube: false, scopeLiveStream: false,
  scopeSponsorOverlays: false, exclusivePartner: 'unknown', documentRef: null,
};

export const PERMISSION_FIELDS: readonly (keyof FilmingPermission)[] = [
  'status', 'grantedByName', 'grantedByRole', 'grantedOn', 'scopeFilming', 'scopeYoutube', 'scopeLiveStream', 'scopeSponsorOverlays', 'exclusivePartner', 'documentRef',
];

export const STATUS_LABEL: Record<PermissionStatus, string> = {
  unknown: 'Not recorded',
  requested: 'Asked, no answer yet',
  granted: 'Granted',
  refused: 'Refused',
  not_required: 'Not needed',
};

export const PERMISSION_MESSAGES = {
  status: 'Pick a status from the list.',
  grantedByName: `Who gave permission (up to ${PERMISSION_LIMITS.grantedByName} characters, one line).`,
  grantedByRole: `Their role, for example "Secretary, district association" (up to ${PERMISSION_LIMITS.grantedByRole} characters).`,
  grantedOn: 'Write the date as YYYY-MM-DD, today or earlier.',
  scopeFilming: 'Granted permission must at least cover filming.',
  exclusivePartner: 'Pick yes, no or not known.',
  documentRef: `Where the proof is kept (up to ${PERMISSION_LIMITS.documentRef} characters, one line).`,
} as const;

export type PermissionInput = Omit<FilmingPermission, 'status' | 'exclusivePartner'> & { status: string; exclusivePartner: string };
export type PermissionValidation = { ok: true; value: FilmingPermission } | { ok: false; errors: Partial<Record<keyof FilmingPermission, string>> };

// eslint-disable-next-line no-control-regex
const CONTROL = /[\u0000-\u001f\u007f-\u009f\u2028\u2029]/;
const charCount = (text: string): number => [...text].length;
const tidy = (v: string | null | undefined): string | null => {
  const t = (v ?? '').trim();
  return t === '' ? null : t;
};

/** Checks and cleans the owner's entry. `today` is the India calendar date (YYYY-MM-DD) from an injected clock. */
export function validatePermission(input: PermissionInput, today: string): PermissionValidation {
  const errors: Partial<Record<keyof FilmingPermission, string>> = {};
  const status = (PERMISSION_STATUSES as readonly string[]).includes(input.status) ? (input.status as PermissionStatus) : null;
  if (status === null) errors.status = PERMISSION_MESSAGES.status;
  const exclusivePartner = (EXCLUSIVE_PARTNER as readonly string[]).includes(input.exclusivePartner) ? (input.exclusivePartner as ExclusivePartner) : null;
  if (exclusivePartner === null) errors.exclusivePartner = PERMISSION_MESSAGES.exclusivePartner;

  const text = (field: 'grantedByName' | 'grantedByRole' | 'documentRef'): string | null => {
    const v = tidy(input[field]);
    if (v !== null && (charCount(v) > PERMISSION_LIMITS[field] || CONTROL.test(v))) errors[field] = PERMISSION_MESSAGES[field];
    return v;
  };
  const grantedByName = text('grantedByName');
  const grantedByRole = text('grantedByRole');
  const documentRef = text('documentRef');
  const grantedOn = tidy(input.grantedOn);
  if (grantedOn !== null && (!isIsoDate(grantedOn) || grantedOn > today)) errors.grantedOn = PERMISSION_MESSAGES.grantedOn;

  const scopeFilming = input.scopeFilming === true;
  if (status === 'granted') {
    if (grantedByName === null && !errors.grantedByName) errors.grantedByName = PERMISSION_MESSAGES.grantedByName;
    if (grantedByRole === null && !errors.grantedByRole) errors.grantedByRole = PERMISSION_MESSAGES.grantedByRole;
    if (grantedOn === null && !errors.grantedOn) errors.grantedOn = PERMISSION_MESSAGES.grantedOn;
    if (!scopeFilming) errors.scopeFilming = PERMISSION_MESSAGES.scopeFilming;
  }
  if (Object.keys(errors).length > 0 || status === null || exclusivePartner === null) return { ok: false, errors };
  return {
    ok: true,
    value: {
      status, grantedByName, grantedByRole, grantedOn, scopeFilming, scopeYoutube: input.scopeYoutube === true, scopeLiveStream: input.scopeLiveStream === true,
      scopeSponsorOverlays: input.scopeSponsorOverlays === true, exclusivePartner, documentRef,
    },
  };
}

export function changedPermissionFields(before: FilmingPermission, after: FilmingPermission): (keyof FilmingPermission)[] {
  return PERMISSION_FIELDS.filter((f) => before[f] !== after[f]);
}

/** What a tournament may carry, from its permission (fail closed: anything but `granted` with that scope is no). */
export function permissionAllows(p: FilmingPermission | null | undefined): { coverage: boolean; liveStream: boolean; sponsorOverlays: boolean } {
  const granted = p?.status === 'granted' && p.scopeFilming;
  return { coverage: granted, liveStream: granted && p.scopeLiveStream, sponsorOverlays: granted && p.scopeSponsorOverlays };
}

/** The gap the admin shows on a tournament marked "Power Smash films this" (D-019), or null when there is none. */
export function coverageGap(coveredByPowerSmash: boolean, status: PermissionStatus | null | undefined): string | null {
  if (!coveredByPowerSmash || status === 'granted') return null;
  return GAP_TEXT[status ?? 'unknown'];
}

// One plain sentence per status (the review found that a sentence built from the label contradicted itself for "Not needed"). Fail closed:
// "Not needed" still shows a reminder, because D-019 asks for a written grant before coverage and only the lawyer can say when none is.
const GAP_TEXT: Record<Exclude<PermissionStatus, 'granted'>, string> = {
  unknown: 'Marked "Power Smash films this", but filming permission is not recorded. Record the organizer\'s permission before you film or publish.',
  requested: 'Marked "Power Smash films this", but the organizer has not answered your permission request yet. Wait for their written yes before you film or publish.',
  refused: 'Marked "Power Smash films this", but the organizer refused filming permission. Do not film or publish this tournament.',
  not_required: 'Marked "Power Smash films this", and you recorded permission as not needed. Write why under "Where the proof is". This reminder stays until your lawyer confirms when permission is not needed.',
};
