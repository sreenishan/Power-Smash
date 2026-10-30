// The two database calls of /api/register, over the SECURITY DEFINER RPCs of migration 0020 (service_role, secret key). Nothing else:
// the endpoint never reads or writes the registrations table directly. The interface lets tests use a fake.
import type { SupabaseRest } from '../supabase/rest';
import { makeRefCode } from '../leads/ref';

export type LookupOutcome = { outcome: 'none' } | { outcome: 'same'; ref: string } | { outcome: 'different' };

export type SubmitOutcome =
  | { outcome: 'created'; id: string; ref: string; feePaise: number | null; category: string | null; ageGroup: string | null }
  | { outcome: 'replay'; ref: string }
  | { outcome: 'conflict' | 'closed' | 'full' | 'already_registered' | 'partner_required' | 'partner_not_allowed' | 'ref_taken' };

/** The record registration_submit takes (every key present; see 0020). */
export interface SubmitRecord {
  ref: string;
  idempotencyKey: string;
  eventId: string;
  player1Name: string;
  player2Name: string | null;
  phone: string;
  email: string | null;
  whatsappOk: boolean;
  paymentReference: string | null;
  consentId: string;
  consentVersion: string;
  consentText: string;
  ipHash: string | null;
}

export interface RegistrationStore {
  lookup(idempotencyKey: string, eventId: string, phone: string): Promise<LookupOutcome>;
  submit(record: SubmitRecord): Promise<SubmitOutcome>;
}

const SUBMIT_OUTCOMES = new Set(['created', 'replay', 'conflict', 'closed', 'full', 'already_registered', 'partner_required', 'partner_not_allowed', 'ref_taken']);

/** Reads the RPC answer defensively: anything unexpected is an error (the handler answers `degraded`), never a guessed success. */
export function parseSubmitOutcome(raw: unknown): SubmitOutcome {
  const o = raw as { outcome?: unknown; id?: unknown; ref?: unknown; feePaise?: unknown; category?: unknown; ageGroup?: unknown } | null;
  if (!o || typeof o.outcome !== 'string' || !SUBMIT_OUTCOMES.has(o.outcome)) throw new Error('registration_submit: unexpected answer');
  if (o.outcome === 'created') {
    if (typeof o.id !== 'string' || typeof o.ref !== 'string') throw new Error('registration_submit: unexpected answer');
    const fee = typeof o.feePaise === 'number' && Number.isInteger(o.feePaise) && o.feePaise > 0 ? o.feePaise : null;
    const category = typeof o.category === 'string' && /^[A-Z]{2}$/.test(o.category) ? o.category : null;
    const ageGroup = typeof o.ageGroup === 'string' && /^[A-Za-z0-9_+]{1,20}$/.test(o.ageGroup) ? o.ageGroup : null;
    return { outcome: 'created', id: o.id, ref: o.ref, feePaise: fee, category, ageGroup };
  }
  if (o.outcome === 'replay') {
    if (typeof o.ref !== 'string') throw new Error('registration_submit: unexpected answer');
    return { outcome: 'replay', ref: o.ref };
  }
  return { outcome: o.outcome as Exclude<SubmitOutcome['outcome'], 'created' | 'replay'> };
}

export function parseLookupOutcome(raw: unknown): LookupOutcome {
  const o = raw as { outcome?: unknown; ref?: unknown } | null;
  if (o?.outcome === 'none' || o?.outcome === 'different') return { outcome: o.outcome };
  if (o?.outcome === 'same' && typeof o.ref === 'string') return { outcome: 'same', ref: o.ref };
  throw new Error('registration_lookup: unexpected answer');
}

export function createRegistrationStore(db: SupabaseRest): RegistrationStore {
  return {
    lookup: async (idempotencyKey, eventId, phone) => parseLookupOutcome(await db.rpc('registration_lookup', { p_key: idempotencyKey, p_event: eventId, p_phone: phone })),
    submit: async (record) => parseSubmitOutcome(await db.rpc('registration_submit', { p_record: { ...record } })),
  };
}

/** PSR-<IST year>-<6 characters>: the lead reference generator with its own prefix, so the owner can tell the two apart. */
export function makeRegistrationRef(now: Date, randomBytes: (n: number) => Uint8Array): string {
  return `PSR-${makeRefCode(now, randomBytes).slice(3)}`;
}
