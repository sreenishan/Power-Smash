// The owner's edit of an ADULT player's profile (district, academy, bio; D-012, D-100). PURE: one rule shared by the request schema
// (handler.ts), both stores and the Players screen, so all of them agree with the SQL in admin_update_player_profile (0012):
//  - only an adult_confirmed player has a profile; anyone else is refused with a plain-English reason (never emptied silently);
//  - text is trimmed and an empty field is "not stated" (null); district up to 60, academy up to 120, bio up to 600 characters;
//  - no control characters (a line break is allowed in the bio only).
import type { AgeStatus } from '../identity/types';

export const PROFILE_LIMITS = { district: 60, academy: 120, bio: 600 } as const;

export interface PlayerProfileFields {
  district: string | null;
  academy: string | null;
  bio: string | null;
}

export type PlayerProfileField = keyof PlayerProfileFields;
export type ProfileValidation = { ok: true; value: PlayerProfileFields } | { ok: false; errors: Partial<Record<PlayerProfileField | 'form', string>> };

export const PROFILE_ADULT_ONLY = 'Profile details can only be added after the player is confirmed as an adult.';

// eslint-disable-next-line no-control-regex
const CONTROL_SINGLE_LINE = /[\u0000-\u001f\u007f]/;
// eslint-disable-next-line no-control-regex
const CONTROL_MULTI_LINE = /[\u0000-\u0009\u000b\u000c\u000e-\u001f\u007f]/;

const tidy = (v: string | null | undefined): string | null => {
  const t = (v ?? '').trim();
  return t === '' ? null : t;
};

export function validatePlayerProfile(input: { district?: string | null; academy?: string | null; bio?: string | null }, ageStatus: AgeStatus): ProfileValidation {
  if (ageStatus !== 'adult_confirmed') return { ok: false, errors: { form: PROFILE_ADULT_ONLY } };
  const value: PlayerProfileFields = { district: tidy(input.district), academy: tidy(input.academy), bio: tidy(input.bio) };
  const errors: Partial<Record<PlayerProfileField, string>> = {};
  for (const field of ['district', 'academy', 'bio'] as const) {
    const v = value[field];
    if (v === null) continue;
    if (v.length > PROFILE_LIMITS[field]) errors[field] = `Up to ${PROFILE_LIMITS[field]} characters.`;
    else if ((field === 'bio' ? CONTROL_MULTI_LINE : CONTROL_SINGLE_LINE).test(v)) errors[field] = 'Remove the hidden control characters.';
  }
  return Object.keys(errors).length > 0 ? { ok: false, errors } : { ok: true, value };
}

/** The names of the fields that differ (what the audit records; never the text itself). */
export function changedProfileFields(before: PlayerProfileFields, after: PlayerProfileFields): PlayerProfileField[] {
  return (['district', 'academy', 'bio'] as const).filter((f) => before[f] !== after[f]);
}
