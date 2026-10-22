// Field factories, option lists and initial values shared by the four forms (spec 7.8, 7.10, 7.11, 7.15; D-019, D-025).
// Field names match src/lib/contracts/lead.ts. English only in M1 (OT-32). Copy is plain and promises nothing the owner has
// not decided: no prices, no reply times. Nothing here is ever pre-ticked.
import { LEAD_LIMITS } from '../../contracts/lead-constants';
import type { FieldDef, FormDef, Option, Values } from '../types';

export const CONTACT_PREFERENCE_OPTIONS: readonly Option[] = [
  { value: 'whatsapp', label: 'WhatsApp' },
  { value: 'call', label: 'Phone call' },
  { value: 'email', label: 'Email' },
];

/** C-18: Yes / Not yet / Not sure. The values are the contract's (D-019: yes, no, unsure). */
export const FILMING_PERMISSION_OPTIONS: readonly Option[] = [
  { value: 'yes', label: 'Yes' },
  { value: 'no', label: 'Not yet' },
  { value: 'unsure', label: 'Not sure' },
];


export const LEVEL_OPTIONS: readonly Option[] = ['District', 'State', 'South India', 'Open', 'Other'].map((v) => ({ value: v, label: v }));

export const yesNo: readonly Option[] = [
  { value: 'yes', label: 'Yes' },
  { value: 'no', label: 'No' },
];

// ---------------------------------------------------------------------------------------------------------------
// Field factories shared by the forms
// ---------------------------------------------------------------------------------------------------------------

export const nameField = (label = 'Your name'): FieldDef => ({
  name: 'name',
  label,
  type: 'text',
  autoComplete: 'name',
  maxLength: LEAD_LIMITS.name.max,
});

export const phoneField = (opts: { optional?: boolean; hint?: string } = {}): FieldDef => ({
  name: 'phone',
  label: opts.optional ? 'Phone number' : 'Phone or WhatsApp number',
  type: 'tel',
  autoComplete: 'tel',
  inputMode: 'tel',
  maxLength: 24,
  hint: opts.hint ?? 'A 10-digit mobile number. You do not need to type +91.',
  optional: opts.optional,
});

export const emailField = (hint?: string, optional = true): FieldDef => ({
  name: 'email',
  label: 'Email',
  type: 'email',
  autoComplete: 'email',
  inputMode: 'email',
  maxLength: LEAD_LIMITS.email.max,
  optional,
  hint,
});

/**
 * The visitor's own budget, as a short amount or range. The contract refuses any run of more than 6 digits in single-line
 * text (a phone number pasted into a text box is a spam signal), so the error says "write amounts with commas" instead of
 * the generic "remove phone numbers" text.
 */
export const budgetField = (hint: string, group?: string): FieldDef => ({
  name: 'budgetRange',
  label: 'Your budget',
  type: 'text',
  optional: true,
  maxLength: LEAD_LIMITS.tinyText.max,
  hint: `${hint} A short amount or range in rupees is enough. You can write more in the notes.`,
  group,
  errors: {
    too_many_digits: 'Please remove any long number. Write amounts with commas, for example 25,000.',
    html_not_allowed: 'Please use letters and numbers only.',
  },
});

export const contactPreferenceField = (): FieldDef => ({
  name: 'contactPreference',
  label: 'How should we reach you?',
  type: 'radio',
  options: CONTACT_PREFERENCE_OPTIONS,
  optional: true,
});

/** Starting values: nothing typed, nothing ticked. The one pre-selected radio is the free tournament listing (never a consent). */
export function initialValues(form: Pick<FormDef, 'kind' | 'steps'>): Values {
  const values: Values = {};
  for (const step of form.steps) {
    for (const f of step.fields) {
      values[f.name] = f.type === 'checkbox' ? false : f.type === 'checks' ? [] : '';
    }
  }
  if (form.kind === 'tournament_submission') values.listingType = 'free';
  return values;
}

/** Every form definition goes through here last: it adds the starting values (see FormDef.initial). */
export function finishForm(form: Omit<FormDef, 'initial'>): FormDef {
  return { ...form, initial: initialValues(form) };
}

export function allFields(form: FormDef): FieldDef[] {
  return form.steps.flatMap((s) => [...s.fields]);
}

