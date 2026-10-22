// The "WhatsApp fallback" summary for a form that could not be sent (brief item 3, D-029): the visitor's non-personal
// choices (package, level, district, event name and date...) plus their own free-text message. Never name, phone, email,
// organisation or company: those fields are simply never flagged `summary: true` (a test enforces it).
import { formatDate } from '../dates';
import type { FallbackSummary } from './whatsapp-prefill';
import type { FieldDef, FormDef, Values } from './types';

function display(field: FieldDef, raw: unknown): string {
  if (typeof raw !== 'string') return '';
  const text = raw.trim();
  if (text === '') return '';
  if (field.type === 'date') {
    try {
      return formatDate(text);
    } catch {
      return '';
    }
  }
  if (field.type === 'select' || field.type === 'radio') {
    return field.options?.find((o) => o.value === text)?.label ?? '';
  }
  return text;
}

export function fallbackSummary(form: FormDef, values: Values): FallbackSummary {
  const choices: string[] = [];
  for (const step of form.steps) {
    for (const field of step.fields) {
      if (!field.summary) continue;
      const text = display(field, values[field.name]);
      if (text !== '') choices.push(`${field.label}: ${text}`);
    }
  }
  const raw = form.messageField ? values[form.messageField] : '';
  return { choices, message: typeof raw === 'string' ? raw : '' };
}

/** Field names that hold personal data. None may be flagged `summary`. */
export const PERSONAL_FIELD_NAMES: readonly string[] = [
  'name',
  'phone',
  'email',
  'organization',
  'company',
  'companyUrl',
  'organizerName',
  'contactPreference',
];
