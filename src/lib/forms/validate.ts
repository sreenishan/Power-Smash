// Client-side validation for the form engine. NO zod here (the zod contract would add about 30 KB gzip to the page, see
// rules.ts); the rules are the contract's own primitives and limits, kept in step with the zod contract by
// tests/forms/parity.test.ts. The Worker validates again with the contract and is the authority: its `fieldErrors`
// answer is mapped onto the same field names by mapFieldErrors().
import { FIELD_ERROR_MESSAGES, type FieldErrorCode } from '../contracts/lead-constants';
import { checkValue, ruleFor } from './rules';
import { allFieldDefs } from './steps';
import type { FieldDef, FieldMessages, FormDef, Values } from './types';

export { allFieldDefs, firstErrorField, firstStepWithError } from './steps';

/** Payload paths that are not visitor fields. An error on one of these is a bug or a changed contract, not the visitor's fault. */
export const INTERNAL_PATHS = new Set(['kind', 'consent', 'token', 'idempotencyKey', 'source', 'website', 'lang', 'elapsedMs', '_']);

export interface MappedErrors {
  /** field name -> message, for fields shown in this form */
  fields: FieldMessages;
  /** Codes that point at something the visitor cannot fix (internal paths or fields this form does not show). */
  unmapped: string[];
}

function messageFor(field: FieldDef, code: string): string {
  return field.errors?.[code as FieldErrorCode] ?? (FIELD_ERROR_MESSAGES as Record<string, string>)[code] ?? FIELD_ERROR_MESSAGES.invalid;
}

/**
 * Turn the contract's `{ 'path.to.field': code }` (the server's `fieldErrors`) into messages keyed by the form's field names.
 */
export function mapFieldErrors(form: FormDef, codes: Record<string, string>): MappedErrors {
  const byName = new Map(allFieldDefs(form).map((f) => [f.name, f]));
  const fields: FieldMessages = {};
  const unmapped: string[] = [];
  for (const [path, code] of Object.entries(codes)) {
    const top = path.split('.')[0] ?? path;
    const field = byName.get(top);
    if (!field || INTERNAL_PATHS.has(top)) {
      unmapped.push(`${path}:${code}`);
      continue;
    }
    if (!(top in fields)) fields[top] = messageFor(field, code);
  }
  return { fields, unmapped };
}

const textOf = (v: unknown): string => (typeof v === 'string' ? v : '');

/** Both dates are real dates (inside the window) and the last day is before the first day. */
function isEndBeforeStart(values: Values, now?: Date): boolean {
  const start = textOf(values.startDate).trim();
  const end = textOf(values.endDate).trim();
  return start !== '' && end !== '' && checkValue({ kind: 'date' }, start, false, undefined, now) === null && checkValue({ kind: 'date' }, end, false, undefined, now) === null && end < start;
}

/**
 * The error CODE (contract vocabulary) for each field that is wrong in the current values. Exported for the parity tests.
 * Every value is checked in the form it is SENT: buildPayload trims it, so a pasted value with a stray line break or an
 * invisible mark at its edge is judged the same way here and by the server (review B-13). `now` is the clock for the date window.
 */
export function checkForm(form: FormDef, values: Values, now?: Date): Record<string, FieldErrorCode> {
  const codes: Record<string, FieldErrorCode> = {};
  const fields = allFieldDefs(form);

  for (const field of fields) {
    const raw = values[field.name];
    if (field.type === 'checkbox' || field.type === 'checks') continue;
    const required = !field.optional || field.requiredByForm === true;
    const allowed = field.options?.map((o) => o.value);
    const code = checkValue(ruleFor(field), textOf(raw).trim(), required, allowed, now);
    if (code) codes[field.name] = code;
  }

  // M3: a required consent box that is not ticked (the contract reports it on `<field>.given`; the client names the field).
  for (const field of fields) {
    if (field.type === 'checkbox' && field.requiredTick && values[field.name] !== true) codes[field.name] = 'consent_required';
  }

  // The contract checks end >= start only when everything else is fine; show it earlier.
  if (isEndBeforeStart(values, now) && !('endDate' in codes) && fields.some((f) => f.name === 'endDate')) {
    codes.endDate = 'invalid_date';
  }

  // Contact form: a phone number or an email address (the contract reports it on `phone`).
  if (form.kind === 'general' && textOf(values.phone).trim() === '' && textOf(values.email).trim() === '') {
    codes.phone = 'contact_required';
    delete codes.email;
  }
  return codes;
}

/** Messages for every error in the current values. */
export function validateValues(form: FormDef, values: Values, now?: Date): MappedErrors {
  const codes = checkForm(form, values, now);
  const byName = new Map(allFieldDefs(form).map((f) => [f.name, f]));
  const fields: FieldMessages = {};
  for (const [name, code] of Object.entries(codes)) {
    const field = byName.get(name);
    if (!field) continue;
    fields[name] = name === 'endDate' && isEndBeforeStart(values, now) ? 'The last day cannot be before the first day.' : messageFor(field, code);
  }
  return { fields, unmapped: [] };
}

/** Errors for the fields shown on one step only (so Next never complains about a later step). */
export function validateStep(form: FormDef, stepIndex: number, values: Values, now?: Date): FieldMessages {
  const step = form.steps[stepIndex];
  if (!step) return {};
  const names = new Set(step.fields.map((f) => f.name));
  const all = validateValues(form, values, now).fields;
  const out: FieldMessages = {};
  for (const [name, message] of Object.entries(all)) {
    if (names.has(name)) out[name] = message;
  }
  return out;
}

