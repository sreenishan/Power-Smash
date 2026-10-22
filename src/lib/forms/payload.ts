// Form values -> the JSON body of POST /api/lead (contract: src/lib/contracts/lead.ts). Pure; no zod import, so a test or
// a page can use it without the validation library.
import { CONSENT } from '../../content/consent';
import { ELAPSED_MS_MAX, type LeadKind } from '../contracts/lead-constants';
import { readAttribution } from './attribution';
import type { FieldDef, FormDef, Values } from './types';

export interface PayloadMeta {
  /** A UUID (the contract requires z.uuid). */
  idempotencyKey: string;
  /** Turnstile response token. */
  token: string;
  /** location.pathname */
  page: string;
  /** location.search (only the utm_* values are read) */
  search: string;
  /** Milliseconds from the first interaction to submit (minimum fill time, D-029). Clamped to 0..24 h before sending. */
  elapsedMs?: number;
  /** Value of the honeypot field. Normally the empty string. */
  honeypot: string;
}

const asString = (v: unknown): string => (typeof v === 'string' ? v.trim() : '');

/**
 * Whole milliseconds inside 0..24 h (ELAPSED_MS_MAX, the same limit the server clamps to, R-ELAPSED); the client never sends more.
 * Not a number at all: undefined (the field is left out; it is optional).
 */
export function clampElapsed(ms: number): number | undefined {
  if (Number.isNaN(ms)) return undefined;
  return Math.min(ELAPSED_MS_MAX, Math.max(0, Math.round(ms)));
}

/** Split "a, b\nc" into ["a","b","c"]. Empty pieces are dropped. */
export function splitList(text: string): string[] {
  return text
    .split(/[,\n]/)
    .map((s) => s.trim())
    .filter((s) => s !== '');
}

function fieldEntry(field: FieldDef, raw: unknown): { key: string; value: unknown } | null {
  const as = field.as ?? (field.type === 'checkbox' ? 'bool' : field.type === 'checks' ? 'slugs' : 'string');
  switch (as) {
    case 'bool':
      return { key: field.name, value: raw === true };
    case 'slugs': {
      const list = Array.isArray(raw) ? raw.filter((x): x is string => typeof x === 'string') : [];
      return list.length > 0 ? { key: field.name, value: list } : null;
    }
    case 'list': {
      const list = splitList(asString(raw));
      return list.length > 0 ? { key: field.name, value: list } : null;
    }
    case 'yesno': {
      const s = asString(raw);
      return s === 'yes' ? { key: field.name, value: true } : s === 'no' ? { key: field.name, value: false } : null;
    }
    default: {
      const s = asString(raw);
      return s === '' ? null : { key: field.name, value: s };
    }
  }
}

/** The kind this submission is sent as: the form's own, unless a box decides (the request form, see FormDef.kindBy). */
export function kindOf(form: FormDef, values: Values): LeadKind {
  const by = form.kindBy;
  const chosen = by ? values[by.field] : undefined;
  return (typeof chosen === 'string' && by?.kinds[chosen]) || form.kind;
}

export function buildPayload(form: FormDef, values: Values, meta: PayloadMeta): Record<string, unknown> {
  const payload: Record<string, unknown> = { kind: kindOf(form, values) };
  for (const step of form.steps) {
    for (const field of step.fields) {
      if (field.name === 'publicContactConsent' || field.consentKey) continue; // nested below
      const entry = fieldEntry(field, values[field.name]);
      if (entry) payload[entry.key] = entry.value;
    }
  }

  // The visitor picked WhatsApp as the way to reach them: tell the owner the number is on WhatsApp.
  payload.whatsappOk = asString(values.contactPreference) === 'whatsapp';

  // The separate "show my registration contact publicly" tick box (D-028). Always sent so the choice is on record.
  if (form.kind === 'tournament_submission') {
    payload.publicContactConsent = {
      id: CONSENT.tournamentPublicContact.id,
      version: CONSENT.tournamentPublicContact.version,
      given: values.publicContactConsent === true,
    };
  }

  // M3: the separate required consent boxes (video rights, licence, removal, adult confirmation, alerts): id, version, and the tick.
  for (const step of form.steps) {
    for (const field of step.fields) {
      if (!field.consentKey) continue;
      const c = CONSENT[field.consentKey];
      payload[field.name] = { id: c.id, version: c.version, given: values[field.name] === true };
    }
  }

  payload.lang = 'en';
  payload.source = readAttribution(meta.page, meta.search);
  payload.idempotencyKey = meta.idempotencyKey;
  payload.token = meta.token;
  // The notice shown on every form (D-028): store which text version the visitor saw.
  const notice = CONSENT[form.noticeKey ?? 'leadNotice'];
  payload.consent = { id: notice.id, version: notice.version };
  payload.website = meta.honeypot;
  const elapsed = meta.elapsedMs === undefined ? undefined : clampElapsed(meta.elapsedMs);
  if (elapsed !== undefined) payload.elapsedMs = elapsed;
  return payload;
}
