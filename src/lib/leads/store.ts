// Database side of the lead endpoint (private tables, Supabase REST with the secret key). See supabase/migrations/0001_*.
// Nothing here logs or throws a request value: errors are SupabaseError (status + Postgres code + constraint only).
import { CONSENT } from '../../content/consent';
import { COMMON_LEAD_KEYS, type LeadRequest } from '../contracts/lead';
import type { LeadKind } from '../contracts/lead-constants';
import { SupabaseError, type SupabaseRest } from '../supabase/rest';

export const LEAD_REF_CONSTRAINT = 'leads_ref_code_uq';
export const LEAD_IDEMPOTENCY_CONSTRAINT = 'leads_idempotency_key_uq';

export interface StoredLeadRef {
  id: string;
  ref: string;
  kind: string;
  phone: string | null;
  email: string | null;
}

/** District (or city) shown in the alert; never the venue or free text. */
export function districtOf(req: LeadRequest): string | undefined {
  if (req.kind === 'coverage') return req.district;
  if (req.kind === 'tournament_submission') return req.district ?? req.city;
  return undefined;
}

/** Everything that is not a common column goes to `payload` (jsonb), minus the ones with their own column. */
export function payloadOf(req: LeadRequest): Record<string, unknown> {
  const skip = new Set<string>([...COMMON_LEAD_KEYS, 'budgetRange']);
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(req)) {
    if (!skip.has(k) && v !== undefined) out[k] = v;
  }
  return out;
}

export interface LeadRowInput {
  id: string;
  ref: string;
  req: LeadRequest;
  consentAtIso: string;
  ipHash: string | null;
  idempotencyKey: string | null;
  parentLeadId?: string;
  /** Override for child coverage leads created from a tournament listing. */
  kindOverride?: LeadKind;
  payloadOverride?: Record<string, unknown>;
}

export function toLeadRow(i: LeadRowInput): Record<string, unknown> {
  const { req } = i;
  const budgetRange = req.kind === 'coverage' || req.kind === 'sponsorship' ? req.budgetRange : undefined;
  return {
    id: i.id,
    ref_code: i.ref,
    type: i.kindOverride ?? req.kind,
    status: 'new',
    name: req.name,
    organization: req.organization ?? null,
    phone: req.phone ?? null,
    email: req.email ?? null,
    whatsapp_ok: req.whatsappOk,
    contact_preference: req.contactPreference ?? null,
    lang: req.lang,
    budget_range: budgetRange ?? null,
    source_path: req.source?.path ?? null,
    utm: req.source?.utm ?? null,
    payload: i.payloadOverride ?? payloadOf(req),
    idempotency_key: i.idempotencyKey,
    parent_lead_id: i.parentLeadId ?? null,
    consent_id: req.consent.id,
    consent_version: req.consent.version,
    consent_at: i.consentAtIso,
    ip_hash: i.ipHash,
    alert_state: 'pending',
  };
}

// ---------------------------------------------------------------------------------------------------------------
// Consent evidence (C-10, D-028): notice_versions (the text and its SHA-256 per notice id and version) and the append-only
// consent_events (one row per notice or consent per lead). Migration 0002_consent_records.sql.
// ---------------------------------------------------------------------------------------------------------------

export interface ConsentEntry {
  /** Notice id from src/content/consent.ts, e.g. `lead-notice`. */
  id: string;
  /** The version the form says it showed (stored as supplied, deviation 7 in leadbackend-notes). */
  version: string;
  /** true = given or shown-and-submitted; false = the optional box was left unticked. */
  given: boolean;
}

/** The notices and consents this request carries: the lead notice always, the public-contact box for a tournament listing. */
export function consentEntriesOf(req: LeadRequest): ConsentEntry[] {
  const out: ConsentEntry[] = [{ id: req.consent.id, version: req.consent.version, given: true }];
  if (req.kind === 'tournament_submission' && req.publicContactConsent) {
    out.push({ id: req.publicContactConsent.id, version: req.publicContactConsent.version, given: req.publicContactConsent.given });
  }
  // M3: each separate tick box the visitor had to tick (the server accepts the request only when every one is `given: true`).
  if (req.kind === 'video_submission') {
    for (const c of [req.adultConfirmation, req.videoRights, req.videoLicence, req.videoRemoval]) out.push({ id: c.id, version: c.version, given: c.given });
  }
  if (req.kind === 'alerts_signup') {
    for (const c of [req.alertsConsent, req.adultConfirmation]) out.push({ id: c.id, version: c.version, given: c.given });
  }
  return out;
}

export async function sha256Hex(text: string): Promise<string> {
  const digest = new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text)));
  return Array.from(digest, (b) => b.toString(16).padStart(2, '0')).join('');
}

/** The notice this server build holds for an id (from src/content/consent.ts), or null for an unknown id. */
function currentNotice(id: string): { id: string; version: string; text: string } | null {
  for (const n of Object.values(CONSENT)) if (n.id === id) return n;
  return null;
}

/**
 * Rows for notice_versions (only for versions this build knows, with the SHA-256 of the exact text) and consent_events.
 * A version the server does not know (an old open tab) is still recorded as supplied, with `notice_sha256` null.
 */
export async function consentRows(leadId: string, entries: readonly ConsentEntry[]): Promise<{ notices: Array<Record<string, unknown>>; events: Array<Record<string, unknown>> }> {
  const notices = new Map<string, Record<string, unknown>>();
  const events: Array<Record<string, unknown>> = [];
  for (const e of entries) {
    const known = currentNotice(e.id);
    const exact = known !== null && known.version === e.version ? known : null;
    const sha256 = exact ? await sha256Hex(exact.text) : null;
    if (exact && sha256) notices.set(`${exact.id}|${exact.version}`, { id: exact.id, version: exact.version, sha256, text: exact.text });
    events.push({ lead_id: leadId, notice_id: e.id, notice_version: e.version, notice_sha256: sha256, given: e.given, channel: 'web_form' });
  }
  return { notices: [...notices.values()], events };
}

/** A coverage lead derived from a tournament listing with the coverage checkbox ticked (spec 7.8). */
export function coverageChildPayload(req: Extract<LeadRequest, { kind: 'tournament_submission' }>): Record<string, unknown> {
  const out: Record<string, unknown> = { from: 'tournament_submission', eventName: req.tournamentName, startDate: req.startDate };
  if (req.endDate) out.endDate = req.endDate;
  if (req.venue) out.venue = req.venue;
  if (req.district ?? req.city) out.district = req.district ?? req.city;
  if (req.categories) out.categories = req.categories;
  if (req.organization) out.organizerName = req.organization;
  return out;
}

/** Deterministic UUID from a key and a label, so a retried request derives the same child key (no duplicate child lead). */
export async function deriveUuid(key: string, label: string): Promise<string> {
  const digest = new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(`${key}|${label}`)));
  const b = digest.slice(0, 16);
  b[6] = ((b[6] as number) & 0x0f) | 0x50; // version 5 layout
  b[8] = ((b[8] as number) & 0x3f) | 0x80; // RFC 4122 variant
  const h = Array.from(b, (x) => x.toString(16).padStart(2, '0')).join('');
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`;
}

export function createLeadStore(db: SupabaseRest) {
  return {
    async findByIdempotencyKey(key: string): Promise<StoredLeadRef | null> {
      const rows = await db.select<{ id: string; ref_code: string; type: string; phone: string | null; email: string | null }>(
        'leads',
        `idempotency_key=eq.${encodeURIComponent(key)}&select=id,ref_code,type,phone,email&limit=1`,
      );
      const r = rows[0];
      return r ? { id: r.id, ref: r.ref_code, kind: r.type, phone: r.phone, email: r.email } : null;
    },
    async insertLead(row: Record<string, unknown>, options?: { ignoreDuplicates?: boolean }): Promise<void> {
      await db.insert('leads', row, options?.ignoreDuplicates ? { onConflict: 'idempotency_key', ignoreDuplicates: true } : undefined);
    },
    /** Append the consent evidence for one stored lead; makes sure the notice text and hash exist in notice_versions. */
    async recordConsent(leadId: string, entries: readonly ConsentEntry[]): Promise<void> {
      const { notices, events } = await consentRows(leadId, entries);
      await Promise.all([
        notices.length > 0 ? db.insert('notice_versions', notices, { onConflict: 'id,version', ignoreDuplicates: true }) : Promise.resolve(),
        db.insert('consent_events', events),
      ]);
    },
    async recordAlert(leadId: string, state: 'sent' | 'failed', meta: Record<string, string>, atIso: string): Promise<void> {
      await Promise.all([
        db.update('leads', `id=eq.${encodeURIComponent(leadId)}`, { alert_state: state, alert_attempted_at: atIso }),
        db.insert('lead_events', { lead_id: leadId, event: state === 'sent' ? 'alert_sent' : 'alert_failed', meta }),
      ]);
    },
  };
}

export type LeadStore = ReturnType<typeof createLeadStore>;

export const isConstraint = (e: unknown, name: string): boolean => e instanceof SupabaseError && e.isUniqueViolation && e.constraint === name;
