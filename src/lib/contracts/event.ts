// First-party event contract for POST /api/event (spec 16, D-029, D-028). Owner: Lead-backend worker.
// Events carry NO personal data by construction: the name must be on the allow-list, the page is a bare path, and every
// prop key is allow-listed per event with a slug-like value (lowercase letters, digits, `_ . : -`, at most 40 characters,
// no run of 6 or more digits, so a phone number cannot ride along). Anything else is dropped, not stored.
// Extend additively: a new name in EVENT_NAMES (lead-constants.ts) needs an entry in EVENT_PROP_KEYS.
import { z } from 'zod';
import { EVENT_NAMES, type EventName } from './lead-constants';
import { cleanSitePath } from './site-path';

export * from './lead-constants';

/** Allowed prop keys per event. Values: slug string, boolean or integer 0-100000. */
export const EVENT_PROP_KEYS: Record<EventName, readonly string[]> = {
  whatsapp_click: ['context', 'page_type'], // where the button was (sticky, header, confirmation, package_card...)
  share_click: ['channel', 'page_type'], // whatsapp, copy, native...
  form_start: ['form', 'kind'],
  form_submit: ['form', 'kind', 'ok'],
  form_error: ['form', 'kind', 'code'],
  outbound_click: ['target', 'placement'],
};

const SLUG_VALUE = /^[a-z0-9][a-z0-9_.:-]{0,39}$/;

export function cleanEventProps(name: EventName, raw: Record<string, unknown> | undefined): Record<string, string | number | boolean> {
  const out: Record<string, string | number | boolean> = {};
  if (!raw) return out;
  for (const key of EVENT_PROP_KEYS[name]) {
    const v = raw[key];
    if (typeof v === 'boolean') out[key] = v;
    else if (typeof v === 'number' && Number.isInteger(v) && v >= 0 && v <= 100_000) out[key] = v;
    else if (typeof v === 'string' && SLUG_VALUE.test(v) && !/\d{6,}/.test(v)) out[key] = v;
  }
  return out;
}

/** A bare URL path with no query or fragment (no UTM, no tokens), at most 200 characters, ONE leading slash (S-14); anything else becomes null. */
export const cleanEventPath = cleanSitePath;

export const eventRequestSchema = z.object({
  name: z.enum(EVENT_NAMES),
  path: z.string().max(2000).optional(),
  props: z.record(z.string().max(60), z.unknown()).optional(),
});

export interface CleanEvent {
  name: EventName;
  path: string | null;
  props: Record<string, string | number | boolean>;
}

export function validateEvent(body: unknown): { ok: true; event: CleanEvent } | { ok: false } {
  const parsed = eventRequestSchema.safeParse(body);
  if (!parsed.success) return { ok: false };
  const { name, path, props } = parsed.data;
  return { ok: true, event: { name, path: cleanEventPath(path), props: cleanEventProps(name, props) } };
}
