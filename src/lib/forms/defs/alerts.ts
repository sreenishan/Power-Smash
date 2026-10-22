// /alerts (spec 8.7, D-026): the email alerts sign-up. NO phone number is collected. Two separate tick boxes, never pre-ticked:
// the alerts consent and the 18+ confirmation (labels are the exact CONSENT texts). Double opt-in is pending the email path:
// nothing is sent today (EMAIL_ENABLED is off), and the confirmation screen says so (confirmation-text.ts).
import { CONSENT } from '../../../content/consent';
import { ALERT_INTERESTS, LEAD_LIMITS } from '../../contracts/lead-constants';
import type { FormDef, Option } from '../types';
import { emailField, finishForm, nameField } from './common';

export const INTEREST_LABELS: Record<(typeof ALERT_INTERESTS)[number], string> = {
  tournaments: 'New tournaments in Tamil Nadu',
  'new-videos': 'New match videos',
};
export const INTEREST_OPTIONS: readonly Option[] = ALERT_INTERESTS.map((value) => ({ value, label: INTEREST_LABELS[value] }));

export function alertsSignupForm(): FormDef {
  return finishForm({
    kind: 'alerts_signup',
    steps: [
      {
        id: 'signup',
        title: 'Sign up',
        fields: [
          nameField('Your name'),
          emailField('We will use it only for these alerts.', false),
          { name: 'district', label: 'Your district', type: 'text', optional: true, maxLength: LEAD_LIMITS.tinyText.max, hint: 'Optional. It helps us pick the right tournaments.' },
          { name: 'interests', label: 'What would you like to hear about?', type: 'checks', optional: true, options: INTEREST_OPTIONS, as: 'slugs' },
          { name: 'alertsConsent', label: CONSENT.alertsSignup.text, type: 'checkbox', as: 'bool', consentKey: 'alertsSignup', requiredTick: true },
          { name: 'adultConfirmation', label: CONSENT.adultConfirmation.text, type: 'checkbox', as: 'bool', consentKey: 'adultConfirmation', requiredTick: true },
        ],
      },
    ],
    submitLabel: 'Sign up for alerts',
    noun: 'alerts sign-up',
  });
}
