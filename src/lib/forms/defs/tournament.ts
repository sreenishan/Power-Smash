// /tournaments/submit (spec 7.8, D-035): a pending submission. Poster = optional https link, no upload.
import { LEAD_LIMITS } from '../../contracts/lead-constants';
import type { FormDef } from '../types';
import { contactPreferenceField, emailField, finishForm, nameField, phoneField } from './common';

export interface TournamentFormOptions {
  /**
   * The exact text of CONSENT.tournamentPublicContact (src/content/consent.ts), shown as the label of the separate, unticked
   * "show my contact publicly" box. Passed in by the page so the consent file is not part of the first-loaded JavaScript.
   */
  publicContactText: string;
}

export function tournamentSubmissionForm(options: TournamentFormOptions): FormDef {
  return finishForm({
    kind: 'tournament_submission',
    steps: [
      {
        id: 'tournament',
        title: 'Tournament',
        intro: 'Just the basics. You can add the rest on the next steps.',
        fields: [
          {
            name: 'tournamentName',
            label: 'Tournament name',
            type: 'text',
            maxLength: LEAD_LIMITS.shortText.max,
            summary: true,
            errors: { required: 'Please enter the name of the tournament.' },
          },
          {
            name: 'startDate',
            label: 'First day of the tournament',
            type: 'date',
            summary: true,
            errors: { required: 'Please pick the first day of the tournament.' },
          },
          nameField('Contact person'),
          phoneField({ hint: 'A 10-digit mobile number, preferably on WhatsApp. You do not need to type +91.' }),
        ],
      },
      {
        id: 'details',
        title: 'Details',
        intro: 'Everything on this step is optional. The more you tell us, the better the listing.',
        fields: [
          {
            name: 'organization',
            label: 'Organizer or association',
            type: 'text',
            optional: true,
            autoComplete: 'organization',
            maxLength: LEAD_LIMITS.organization.max,
          },
          { name: 'endDate', label: 'Last day of the tournament', type: 'date', optional: true },
          { name: 'venue', label: 'Venue', type: 'text', optional: true, maxLength: LEAD_LIMITS.shortText.max },
          { name: 'city', label: 'City or town', type: 'text', optional: true, maxLength: LEAD_LIMITS.tinyText.max, summary: true },
          { name: 'district', label: 'District', type: 'text', optional: true, maxLength: LEAD_LIMITS.tinyText.max, summary: true },
          {
            name: 'categories',
            label: 'Categories',
            type: 'text',
            optional: true,
            as: 'list',
            placeholder: 'U13 boys singles, Open doubles',
            hint: 'Separate the categories with commas.',
          },
          {
            name: 'ageGroups',
            label: 'Age groups',
            type: 'text',
            optional: true,
            as: 'list',
            placeholder: 'U13, U15, Open',
            hint: 'Separate the age groups with commas.',
          },
          {
            name: 'entryFee',
            label: 'Entry fee',
            type: 'text',
            optional: true,
            maxLength: LEAD_LIMITS.tinyText.max,
            placeholder: 'Rs 500 per player',
            hint: 'Write it the way players will read it. Keep it short.',
            errors: { too_many_digits: 'Please remove any long number. Keep this short, for example Rs 500 per player.' },
          },
          {
            name: 'registrationDetails',
            label: 'How to register',
            type: 'textarea',
            optional: true,
            rows: 3,
            maxLength: LEAD_LIMITS.noteText.max,
            hint: 'Last date to register, who to ask, and so on.',
          },
          {
            name: 'registrationLink',
            label: 'Registration link',
            type: 'url',
            optional: true,
            inputMode: 'url',
            maxLength: LEAD_LIMITS.url.max,
            placeholder: 'https://',
            hint: 'Optional. It must start with https://',
          },
          {
            name: 'posterUrl',
            label: 'Poster link',
            type: 'url',
            optional: true,
            inputMode: 'url',
            maxLength: LEAD_LIMITS.url.max,
            placeholder: 'https://',
            hint: 'Optional. Put the poster picture online (for example on Google Drive) and paste the link here. You cannot upload a file on this page yet.',
          },
        ],
      },
      {
        id: 'listing',
        title: 'Listing',
        intro: 'Last step.',
        fields: [
          {
            name: 'listingType',
            label: 'Listing type',
            type: 'radio',
            options: [
              { value: 'free', label: 'Free listing' },
              { value: 'featured', label: 'Featured listing (pinned with a ribbon)' },
            ],
            hint: 'This only records your request. You do not pay on this page. We will contact you about a featured listing.',
            summary: true,
          },
          {
            name: 'publicContactConsent',
            label: options.publicContactText,
            type: 'checkbox',
            as: 'bool',
            optional: true,
          },
          {
            name: 'coverageInterest',
            label: "I'm interested in Power Smash coverage",
            type: 'checkbox',
            as: 'bool',
            optional: true,
          },
          emailField('Optional. We will use it only to reply to you.'),
          contactPreferenceField(),
        ],
      },
    ],
    submitLabel: 'Send tournament for listing',
    noun: 'tournament listing',
    messageField: 'registrationDetails',
  });
}
