// The registration form's pure parts (client side, no zod): the request body it sends and how it reads the answer. Tested on their
// own (tests/registration/form-logic.test.ts); the React island (src/components/registration/RegistrationForm.tsx) only draws.
import {
  REGISTRATION_ERROR_MESSAGES,
  REGISTRATION_FIELD_MESSAGES,
  REGISTRATION_HONEYPOT,
  checkRegistrationFields,
  clampElapsedMs,
  type RegistrationFieldCode,
  type RegistrationFieldValues,
  type RegistrationRequestBody,
  type RegistrationResponse,
} from './constants';

export interface RegistrationFormValues extends RegistrationFieldValues {
  whatsappOk: boolean;
}

export const EMPTY_REGISTRATION_VALUES: RegistrationFormValues = {
  player1Name: '',
  player2Name: '',
  phone: '',
  email: '',
  paymentReference: '',
  consent: false,
  whatsappOk: false,
};

/** Plain-English message per field from the shared codes. */
export function fieldMessages(codes: Record<string, RegistrationFieldCode>): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [k, c] of Object.entries(codes)) out[k] = REGISTRATION_FIELD_MESSAGES[c] ?? REGISTRATION_FIELD_MESSAGES.invalid;
  return out;
}

export type BuildResult = { ok: true; body: RegistrationRequestBody } | { ok: false; fieldErrors: Record<string, RegistrationFieldCode> };

/**
 * Checks the values with THE shared rules and builds the body. The phone and the reference are sent as typed (the server cleans them
 * again); a blank optional field is left out. The partner box is ignored for a singles event.
 */
export function buildRegistrationBody(
  input: {
    eventId: string;
    playersNeeded: 1 | 2;
    values: RegistrationFormValues;
    consent: { id: string; version: string };
    idempotencyKey: string;
    token: string;
    honeypot: string;
    elapsedMs: number;
  },
): BuildResult {
  const v = { ...input.values, player2Name: input.playersNeeded === 2 ? input.values.player2Name : '' };
  const checked = checkRegistrationFields(v, input.playersNeeded);
  if (!checked.ok) return checked;
  const c = checked.value;
  const body: RegistrationRequestBody = {
    eventId: input.eventId,
    player1Name: c.player1Name,
    phone: input.values.phone.trim(),
    whatsappOk: input.values.whatsappOk,
    // the tick itself travels too: the server refuses a body without given: true (D-028, as the lead contract does)
    consent: { id: input.consent.id, version: input.consent.version, given: input.values.consent === true },
    idempotencyKey: input.idempotencyKey,
    token: input.token,
    elapsedMs: clampElapsedMs(input.elapsedMs),
  };
  if (c.player2Name) body.player2Name = c.player2Name;
  if (c.email) body.email = c.email;
  if (c.paymentReference) body.paymentReference = c.paymentReference;
  if (input.honeypot !== '') (body as unknown as Record<string, unknown>)[REGISTRATION_HONEYPOT] = input.honeypot;
  return { ok: true, body };
}

export type ReadAnswer =
  | { kind: 'done'; ref: string; feePaise: number | null; waLink: string | null }
  | { kind: 'fields'; message: string; fieldErrors: Record<string, string>; resetCheck: boolean }
  | { kind: 'problem'; message: string; waLink: string | null; resetCheck: boolean; newKey: boolean; correlationId: string | null };

/** What the form does with an answer. A spent Turnstile token is reset after every answer that reached the server. */
export function readRegistrationAnswer(status: number, body: unknown): ReadAnswer {
  const r = body as RegistrationResponse | null;
  if (r && r.ok === true && typeof r.ref === 'string') {
    return { kind: 'done', ref: r.ref, feePaise: typeof r.feePaise === 'number' ? r.feePaise : null, waLink: typeof r.waLink === 'string' ? r.waLink : null };
  }
  if (r && r.ok === false && typeof r.code === 'string') {
    const message = REGISTRATION_ERROR_MESSAGES[r.code] ?? REGISTRATION_ERROR_MESSAGES.server;
    if (r.code === 'validation' && r.fieldErrors) return { kind: 'fields', message, fieldErrors: fieldMessages(r.fieldErrors), resetCheck: true };
    return {
      kind: 'problem',
      message,
      waLink: typeof r.waLink === 'string' ? r.waLink : null,
      resetCheck: true,
      newKey: r.code === 'duplicate',
      correlationId: typeof r.correlationId === 'string' ? r.correlationId : null,
    };
  }
  return { kind: 'problem', message: status >= 500 ? REGISTRATION_ERROR_MESSAGES.server : REGISTRATION_ERROR_MESSAGES.validation, waLink: null, resetCheck: true, newKey: false, correlationId: null };
}
