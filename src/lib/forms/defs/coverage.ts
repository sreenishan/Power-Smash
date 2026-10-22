// /book: coverage (spec 7.10): Event > Services > Contact, minimum first (D-025), permission question (D-019).
import { LEAD_LIMITS } from '../../contracts/lead-constants';
import type { FieldDef, FormDef, Option, StepDef } from '../types';
import { FILMING_PERMISSION_OPTIONS, finishForm, LEVEL_OPTIONS, budgetField, contactPreferenceField, emailField, nameField, phoneField, yesNo } from './common';

export interface CoverageFormOptions {
  /** Coverage packages from src/content/products.ts (group "organizers"). Empty = no package box. */
  packages: readonly Option[];
  /** Add-ons from products.ts (group "addons"). Empty = no add-on boxes. */
  addOns: readonly Option[];
}

export function coverageForm(options: CoverageFormOptions): FormDef {
  const services: FieldDef[] = [];
  if (options.packages.length > 0) {
    services.push({
      name: 'packageKey',
      label: 'Package',
      type: 'select',
      options: options.packages,
      optional: true,
      placeholder: 'Not sure yet',
      hint: 'Choose one if you know. We can suggest one later.',
      summary: true,
    });
  }
  services.push(
    { name: 'liveStream', label: 'Do you want a live stream?', type: 'radio', options: yesNo, optional: true, as: 'yesno', summary: true },
    {
      name: 'matchDays',
      label: 'How many match days?',
      type: 'number',
      inputMode: 'numeric',
      optional: true,
      placeholder: 'For example 2',
    },
  );
  if (options.addOns.length > 0) {
    services.push({ name: 'addOns', label: 'Add-ons', type: 'checks', options: options.addOns, optional: true, as: 'slugs' });
  }
  services.push(
    { name: 'endDate', label: 'Last day of the tournament', type: 'date', optional: true, group: 'About your event (optional)' },
    { name: 'venue', label: 'Venue', type: 'text', optional: true, maxLength: LEAD_LIMITS.shortText.max, group: 'About your event (optional)' },
    { name: 'district', label: 'District', type: 'text', optional: true, maxLength: LEAD_LIMITS.tinyText.max, group: 'About your event (optional)', summary: true },
    { name: 'level', label: 'Level', type: 'select', options: LEVEL_OPTIONS, optional: true, group: 'About your event (optional)', summary: true },
    {
      name: 'courts',
      label: 'Number of courts',
      type: 'number',
      inputMode: 'numeric',
      optional: true,
      group: 'About your event (optional)',
    },
    {
      name: 'categories',
      label: 'Categories',
      type: 'text',
      optional: true,
      as: 'list',
      placeholder: 'U13 boys singles, Open doubles',
      hint: 'Separate the categories with commas.',
      group: 'About your event (optional)',
    },
    {
      name: 'expectedEntries',
      label: 'Expected entries',
      type: 'number',
      inputMode: 'numeric',
      optional: true,
      hint: 'About how many players or teams.',
      group: 'About your event (optional)',
    },
  );

  const steps: StepDef[] = [
    {
      id: 'event',
      title: 'Event',
      intro: 'Just the basics. You can add the rest on the next steps, or on WhatsApp.',
      fields: [
        {
          name: 'eventName',
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
          requiredByForm: true,
          hint: 'A best guess is fine. We confirm the dates with you.',
          summary: true,
          errors: { required: 'Please pick the first day of the tournament.' },
        },
        nameField(),
        phoneField(),
      ],
    },
    {
      id: 'services',
      title: 'Services',
      intro: 'What would you like us to do? Everything on this step is optional.',
      fields: services,
    },
    {
      id: 'contact',
      title: 'Contact',
      intro: 'Last step. We use this to reply to you.',
      fields: [
        {
          name: 'organizerName',
          label: 'Who is organizing the tournament?',
          type: 'text',
          optional: true,
          maxLength: LEAD_LIMITS.organization.max,
          hint: 'The club, association or person who runs it.',
          group: 'Permission to film',
        },
        {
          name: 'filmingPermission',
          label:
            'Do you have written permission or agreement from the organizer or association for us to film the matches, publish them and earn money from them?',
          type: 'radio',
          options: FILMING_PERMISSION_OPTIONS,
          as: 'string',
          requiredByForm: true,
          hint: 'A WhatsApp message or an email counts as written. If it is not agreed yet, choose "Not yet" or "Not sure": we can help you ask.',
          group: 'Permission to film',
          errors: { required: 'Please choose one. "Not sure" is fine.' },
        },
        {
          name: 'organization',
          label: 'Your organization',
          type: 'text',
          optional: true,
          autoComplete: 'organization',
          maxLength: LEAD_LIMITS.organization.max,
          group: 'About you',
        },
        { ...emailField('Optional. We will use it only to reply to you.'), group: 'About you' },
        { ...contactPreferenceField(), group: 'About you' },
        budgetField('Optional. It helps us suggest the right package.', 'About you'),
        {
          name: 'notes',
          label: 'Anything else we should know?',
          type: 'textarea',
          optional: true,
          maxLength: LEAD_LIMITS.longText.max,
          group: 'About you',
        },
      ],
    },
  ];

  return finishForm({
    kind: 'coverage',
    steps,
    submitLabel: 'Send my request',
    noun: 'coverage request',
    messageField: 'notes',
    // /book?package=<key> (the Services page buttons) selects that package once the form is ready.
    preset: options.packages.length > 0 ? { param: 'package', field: 'packageKey' } : undefined,
  });
}
