// /submit-video (spec 7.12, D-019, D-028): the "send your match video" form. A link only: no file upload in Phase 1.
// The link is stored as text for the owner to open; the website never fetches it. Rights flow: who owns the footage, the
// organizer's name and permission, whether under-18 players can be recognised, then four SEPARATE tick boxes (never pre-ticked)
// whose labels are the exact CONSENT texts (src/content/consent.ts) and whose ids and versions are stored with the submission.
import { CONSENT } from '../../../content/consent';
import { FOOTAGE_SOURCES, LEAD_LIMITS, VIDEO_SHARE_HOSTS, VIDEO_SUBMITTER_ROLES } from '../../contracts/lead-constants';
import type { FormDef, Option } from '../types';
import { FILMING_PERMISSION_OPTIONS, contactPreferenceField, emailField, finishForm, nameField, phoneField } from './common';

export const ROLE_LABELS: Record<(typeof VIDEO_SUBMITTER_ROLES)[number], string> = {
  player: 'Player',
  parent_guardian: 'Parent or guardian',
  coach: 'Coach',
  organizer: 'Organizer',
  other: 'Other',
};
export const ROLE_OPTIONS: readonly Option[] = VIDEO_SUBMITTER_ROLES.map((value) => ({ value, label: ROLE_LABELS[value] }));

export const FOOTAGE_LABELS: Record<(typeof FOOTAGE_SOURCES)[number], string> = {
  self: 'I filmed it myself, as a spectator or family member',
  asked_by_organizer: 'The organizer asked me or hired me to film it',
  organizer_owns: 'The organizer owns the footage',
  other: 'Something else (tell us in the notes)',
};
export const FOOTAGE_OPTIONS: readonly Option[] = FOOTAGE_SOURCES.map((value) => ({ value, label: FOOTAGE_LABELS[value] }));

/** Minors question: Yes / No / Not sure; the values are the contract's (yes, no, unsure). */
export const MINORS_OPTIONS: readonly Option[] = [
  { value: 'yes', label: 'Yes' },
  { value: 'no', label: 'No' },
  { value: 'unsure', label: 'Not sure' },
];

const CHOOSE = { required: 'Please choose one.', invalid: 'Please choose one.' } as const;

const hostHint = `Paste a share link, for example from Google Drive (make sure anyone with the link can view it). It must start with https://. Nothing is uploaded here, and we never open the link automatically. Common hosts: ${VIDEO_SHARE_HOSTS.slice(0, 4).join(', ')}.`;

export function submitVideoForm(): FormDef {
  return finishForm({
    kind: 'video_submission',
    steps: [
      {
        id: 'video',
        title: 'Your video',
        intro: 'The link to your video, and how to reach you.',
        fields: [
          {
            name: 'videoUrl',
            label: 'Video link',
            type: 'url',
            inputMode: 'url',
            maxLength: LEAD_LIMITS.url.max,
            placeholder: 'https://',
            hint: hostHint,
            errors: { required: 'Please paste the link to your video.' },
          },
          nameField('Your name'),
          { name: 'role', label: 'You are the', type: 'radio', options: ROLE_OPTIONS, summary: true, errors: CHOOSE },
          phoneField({ hint: 'A 10-digit mobile number. We may use it to confirm your permission before anything is published. You do not need to type +91.' }),
        ],
      },
      {
        id: 'match',
        title: 'The match',
        intro: 'Everything on this step is optional, but it helps us find the right match.',
        fields: [
          { name: 'tournamentName', label: 'Tournament', type: 'text', optional: true, maxLength: LEAD_LIMITS.shortText.max },
          { name: 'matchDate', label: 'Date of the match', type: 'date', optional: true },
          { name: 'category', label: 'Category', type: 'text', optional: true, maxLength: LEAD_LIMITS.tinyText.max, placeholder: 'U15 boys singles' },
          { name: 'round', label: 'Round', type: 'text', optional: true, maxLength: LEAD_LIMITS.tinyText.max, placeholder: 'Quarter-final' },
          {
            name: 'players',
            label: 'Players on each side',
            type: 'text',
            optional: true,
            maxLength: LEAD_LIMITS.shortText.max,
            placeholder: 'A and B vs C and D',
            hint: 'Write the names the way you know them.',
          },
          { name: 'notes', label: 'Anything else we should know', type: 'textarea', optional: true, rows: 3, maxLength: LEAD_LIMITS.longText.max },
        ],
      },
      {
        id: 'rights',
        title: 'Rights',
        intro: 'We only publish a video when we are sure we may. Please answer honestly.',
        fields: [
          { name: 'footageSource', label: 'Who owns this footage?', type: 'radio', options: FOOTAGE_OPTIONS, errors: CHOOSE },
          {
            name: 'organizerName',
            label: 'Organizer or association',
            type: 'text',
            optional: true,
            maxLength: LEAD_LIMITS.organization.max,
            hint: 'If the organizer asked you to film, or owns the footage, write their name.',
          },
          {
            name: 'filmingPermission',
            label: 'Has the organizer agreed in writing (a message or email is fine) to filming and publishing?',
            type: 'radio',
            optional: true,
            options: FILMING_PERMISSION_OPTIONS,
          },
          {
            name: 'minorsVisible',
            label: 'Can players under 18 be recognised in the video?',
            type: 'radio',
            options: MINORS_OPTIONS,
            hint: 'If yes or not sure, we check more carefully and may ask a parent or guardian to confirm before we publish.',
            errors: CHOOSE,
          },
          emailField('Optional. We will use it only to reply about this video.'),
          contactPreferenceField(),
          {
            name: 'adultConfirmation',
            label: CONSENT.adultConfirmation.text,
            type: 'checkbox',
            as: 'bool',
            consentKey: 'adultConfirmation',
            requiredTick: true,
            group: 'Please confirm all four',
          },
          { name: 'videoRights', label: CONSENT.videoRights.text, type: 'checkbox', as: 'bool', consentKey: 'videoRights', requiredTick: true },
          { name: 'videoLicence', label: CONSENT.videoLicence.text, type: 'checkbox', as: 'bool', consentKey: 'videoLicence', requiredTick: true },
          { name: 'videoRemoval', label: CONSENT.videoRemoval.text, type: 'checkbox', as: 'bool', consentKey: 'videoRemoval', requiredTick: true },
        ],
      },
    ],
    submitLabel: 'Send my video link',
    noun: 'video submission',
    messageField: 'notes',
  });
}
