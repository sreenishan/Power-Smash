// /contact: the general form (spec 7.15). One step. A phone number or an email address is needed (the contract says so).
import { LEAD_LIMITS } from '../../contracts/lead-constants';
import type { FormDef, Option } from '../types';
import { emailField, finishForm, nameField, phoneField } from './common';

export interface GeneralFormOptions {
  /**
   * The allow-list for `/contact?topic=<key>` (R-TOPIC): product and sponsor package keys with their names. A key in the list
   * pre-fills the message with "I would like to know more about: <name>". The text never comes from the address bar.
   */
  topics?: readonly Option[];
}

/** The start of the pre-filled message for /contact?topic=<key>. */
export const TOPIC_MESSAGE_PREFIX = 'I would like to know more about: ';

export function generalForm(options: GeneralFormOptions = {}): FormDef {
  const topics = options.topics ?? [];
  return finishForm({
    kind: 'general',
    steps: [
      {
        id: 'message',
        title: 'Message',
        fields: [
          nameField(),
          phoneField({ optional: true, hint: 'Give a phone number, an email address, or both.' }),
          emailField('Give a phone number, an email address, or both.'),
          {
            name: 'message',
            label: 'Your message',
            type: 'textarea',
            rows: 5,
            maxLength: LEAD_LIMITS.longText.max,
            errors: { required: 'Please write your message.', too_short: 'Please write a little more so we can help.' },
          },
        ],
      },
    ],
    submitLabel: 'Send message',
    noun: 'message',
    messageField: 'message',
    preset: topics.length > 0 ? { param: 'topic', field: 'message', options: topics, prefix: TOPIC_MESSAGE_PREFIX } : undefined,
  });
}
