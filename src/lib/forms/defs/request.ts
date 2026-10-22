// /request (spec 7.5 footer, 15.3, 15.6, D-012, D-015, D-019): ONE form for profile requests (claim a profile, correct details, hide a
// profile) and content-removal requests (remove a video or other content), with a type selector. The page sends kind
// `content_removal` for "remove" and `profile_request` for the rest (FormDef.kindBy). It carries the request NOTICE
// (CONSENT.requestNotice, id and version stored; a notice, not a tick box).
// Privacy: no email is asked for, the link or description is text only (the website never fetches or opens it), the details box says not to
// write a child's full name, and the WhatsApp fallback text carries ONLY the request type (no messageField, nothing else is `summary`).
// A parent or guardian is verified LATER by a one-time code on their own phone: the form says so plainly and does not pretend otherwise.
import { LEAD_LIMITS, REQUEST_RELATIONSHIPS, REQUEST_TYPES } from '../../contracts/lead-constants';
import type { FormDef, Option } from '../types';
import { finishForm, nameField, phoneField } from './common';

export const REQUEST_TYPE_LABELS: Record<(typeof REQUEST_TYPES)[number], string> = {
  claim_profile: 'Claim my profile',
  correct_details: 'Correct details on a profile',
  hide_profile: 'Hide a profile (a player, or a parent or guardian for a player)',
  remove_content: 'Remove a video or other content',
};
export const REQUEST_TYPE_OPTIONS: readonly Option[] = REQUEST_TYPES.map((value) => ({ value, label: REQUEST_TYPE_LABELS[value] }));

export const RELATIONSHIP_LABELS: Record<(typeof REQUEST_RELATIONSHIPS)[number], string> = {
  self: 'I am the person this is about',
  parent_guardian: 'I am the parent or guardian of the player',
  coach: 'I am a coach',
  rights_holder: 'I own the video or content (rights holder)',
  other: 'Something else',
};
export const RELATIONSHIP_OPTIONS: readonly Option[] = REQUEST_RELATIONSHIPS.map((value) => ({ value, label: RELATIONSHIP_LABELS[value] }));

const CHOOSE = { required: 'Please choose one.', invalid: 'Please choose one.' } as const;

/** What the form says about verifying a parent or guardian. Shown with the relationship question and on the page. */
export const PARENT_VERIFICATION_NOTE =
  'If you are a parent or guardian, we will later ask you to confirm it is you with a one-time code sent to your own phone. That check is not switched on yet, so sending this form does not hide or remove anything by itself.';

/** Kinds the form sends, for tests: the form's own kind, and the one a "remove" choice sends. */
export const REQUEST_KINDS = { profile: 'profile_request', removal: 'content_removal' } as const;

export function requestForm(): FormDef {
  return finishForm({
    kind: REQUEST_KINDS.profile,
    kindBy: { field: 'requestType', kinds: { remove_content: REQUEST_KINDS.removal } },
    noticeKey: 'requestNotice',
    steps: [
      {
        id: 'request',
        title: 'Request',
        fields: [
          { name: 'requestType', label: 'What do you need?', type: 'radio', options: REQUEST_TYPE_OPTIONS, summary: true, errors: CHOOSE },
          {
            name: 'what',
            label: 'Link or description of the profile, video or page',
            type: 'text',
            maxLength: LEAD_LIMITS.requestWhat.max,
            hint: 'Paste the page address, or describe it in a few words, for example the title of the video. We read it by hand: the website never opens the link.',
            errors: { required: 'Please tell us which profile, video or page this is about.' },
          },
          { name: 'relationship', label: 'You are', type: 'radio', options: RELATIONSHIP_OPTIONS, hint: PARENT_VERIFICATION_NOTE, errors: CHOOSE },
          nameField('Your name'),
          phoneField({ hint: 'A 10-digit mobile or WhatsApp number. We reply on it. You do not need to type +91.' }),
          {
            name: 'details',
            label: 'Anything else we should know?',
            type: 'textarea',
            optional: true,
            maxLength: LEAD_LIMITS.longText.max,
            hint: 'Optional. Please do not write a child\'s full name, school or address here: the link or page address is enough.',
          },
        ],
      },
    ],
    submitLabel: 'Send my request',
    noun: 'request',
  });
}
