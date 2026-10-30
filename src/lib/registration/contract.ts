// The /api/register request contract (server and tests only: it uses zod). Two steps:
//  1. the SHAPE (zod, strict: an unknown key such as an age group or a card field is refused, never silently kept);
//  2. the FIELD RULES, the same function the form runs (checkRegistrationFields in ./constants.ts), so client and server agree.
// Input values are never echoed back; only field codes are returned.
import { z } from 'zod';
import {
  REGISTRATION_LIMITS,
  checkRegistrationFields,
  clampElapsedMs,
  type CleanRegistrationFields,
  type RegistrationFieldCode,
} from './constants';
import { REGISTRATION_CONSENT } from './consent';

const uuid = z.uuid();
const optString = (max: number) => z.string().max(max).optional();

/** The request body, strict. Lengths here are generous outer bounds; the exact rules are the shared field rules. */
export const registrationRequestSchema = z
  .object({
    eventId: uuid,
    player1Name: z.string().max(400),
    player2Name: optString(400),
    phone: z.string().max(64),
    email: optString(400),
    whatsappOk: z.boolean().optional(),
    paymentReference: optString(120),
    // given: the tick box, checked HERE too (a scripted client that never ticked is refused with consent_required, D-028)
    consent: z.object({ id: z.string().max(60), version: z.string().max(40), given: z.boolean() }).strict(),
    idempotencyKey: uuid,
    token: z.string().max(REGISTRATION_LIMITS.turnstileToken.max).regex(/^[A-Za-z0-9._-]*$/),
    website: optString(400),
    elapsedMs: z.unknown().optional(),
  })
  .strict();

export interface RegistrationRequest extends CleanRegistrationFields {
  eventId: string;
  whatsappOk: boolean;
  consent: { id: string; version: string };
  idempotencyKey: string;
  token: string;
  website: string;
  elapsedMs: number | undefined;
}

export type ValidateRegistrationResult = { ok: true; data: RegistrationRequest } | { ok: false; fieldErrors: Record<string, RegistrationFieldCode> };

const SHAPE_FIELDS = new Set(['eventId', 'player1Name', 'player2Name', 'phone', 'email', 'whatsappOk', 'paymentReference', 'consent', 'idempotencyKey', 'token', 'website', 'elapsedMs']);

/**
 * Validates a parsed JSON body. `playersNeeded` is unknown to the server before the database is asked, so the shape step accepts an
 * optional partner and the field rules run with "1 or 2" decided by whether a partner was typed; the database refuses a mismatch with
 * the event's category (partner_required / partner_not_allowed outcomes of registration_submit).
 */
export function validateRegistrationRequest(body: unknown): ValidateRegistrationResult {
  if (body === null || typeof body !== 'object' || Array.isArray(body)) return { ok: false, fieldErrors: { _: 'invalid' } };
  const parsed = registrationRequestSchema.safeParse(body);
  if (!parsed.success) {
    const fieldErrors: Record<string, RegistrationFieldCode> = {};
    for (const issue of parsed.error.issues) {
      const top = issue.path.length > 0 ? String(issue.path[0]) : '_';
      // an unknown key (for example a self-claimed age group) is reported under '_' by its name only if it is one of ours
      const key = issue.code === 'unrecognized_keys' ? '_' : SHAPE_FIELDS.has(top) ? top : '_';
      if (!fieldErrors[key]) fieldErrors[key] = issue.code === 'invalid_type' && (body as Record<string, unknown>)[top] === undefined ? 'required' : 'invalid';
    }
    return { ok: false, fieldErrors };
  }
  const b = parsed.data;
  if (b.token === '') return { ok: false, fieldErrors: { token: 'required' } };
  const consentOk = b.consent.given === true && b.consent.id === REGISTRATION_CONSENT.id && b.consent.version === REGISTRATION_CONSENT.version;
  const partnerTyped = (b.player2Name ?? '').trim() !== '';
  const fields = checkRegistrationFields(
    { player1Name: b.player1Name, player2Name: b.player2Name ?? '', phone: b.phone, email: b.email ?? '', paymentReference: b.paymentReference ?? '', consent: consentOk },
    partnerTyped ? 2 : 1,
  );
  if (!fields.ok) return fields;
  return {
    ok: true,
    data: {
      ...fields.value,
      eventId: b.eventId.toLowerCase(),
      whatsappOk: b.whatsappOk === true,
      consent: { id: b.consent.id, version: b.consent.version },
      idempotencyKey: b.idempotencyKey.toLowerCase(),
      token: b.token,
      website: b.website ?? '',
      elapsedMs: b.elapsedMs === undefined ? undefined : clampElapsedMs(b.elapsedMs),
    },
  };
}
