// /partner: sponsorship enquiry (spec 7.11). Two steps (D-025: four fields first).
import { LEAD_LIMITS } from '../../contracts/lead-constants';
import type { FieldDef, FormDef, Option } from '../types';
import { budgetField, contactPreferenceField, emailField, finishForm, nameField, phoneField } from './common';

export interface SponsorshipFormOptions {
  /** Sponsor packages from src/content/sponsor-packages.ts. Empty = no package box. */
  packages: readonly Option[];
}

export function sponsorshipForm(options: SponsorshipFormOptions): FormDef {
  const plan: FieldDef[] = [];
  if (options.packages.length > 0) {
    plan.push({
      name: 'packageKey',
      label: 'Package you are interested in',
      type: 'select',
      options: options.packages,
      optional: true,
      placeholder: 'Not sure yet',
      hint: 'Choose one if you know. We can suggest one later.',
      summary: true,
    });
  }
  plan.push(
    {
      name: 'objectives',
      label: 'What do you want to achieve?',
      type: 'textarea',
      optional: true,
      maxLength: LEAD_LIMITS.longText.max,
      hint: 'For example more local awareness, or reaching tournament players.',
    },
    budgetField('Optional.'),
    {
      name: 'companyUrl',
      label: 'Company website',
      type: 'url',
      optional: true,
      inputMode: 'url',
      maxLength: LEAD_LIMITS.url.max,
      placeholder: 'https://',
      hint: 'Optional. It must start with https://',
    },
    emailField('Optional. We will use it only to reply to you.'),
    contactPreferenceField(),
  );

  return finishForm({
    kind: 'sponsorship',
    steps: [
      {
        id: 'about',
        title: 'About you',
        intro: 'Just the basics. You can add the rest on the next step.',
        fields: [
          nameField(),
          phoneField(),
          {
            name: 'company',
            label: 'Company or brand',
            type: 'text',
            maxLength: LEAD_LIMITS.organization.max,
            errors: { required: 'Please enter your company or brand name.' },
          },
          {
            name: 'startMonth',
            label: 'When would you like to start?',
            type: 'month',
            optional: true,
            hint: 'Pick a month. If your browser shows a plain box, type it like 2026-12.',
          },
        ],
      },
      { id: 'plan', title: 'Your plan', intro: 'Everything on this step is optional, but it helps us reply with something useful.', fields: plan },
    ],
    submitLabel: 'Send my enquiry',
    noun: 'sponsorship enquiry',
    messageField: 'objectives',
    // /partner?package=<key> (the package buttons) selects that package once the form is ready.
    preset: options.packages.length > 0 ? { param: 'package', field: 'packageKey' } : undefined,
  });
}
