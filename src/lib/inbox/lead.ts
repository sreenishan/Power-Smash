// The lead as the admin inbox sees it (a view model of `public.leads`, 0001) and the mapper from a database row. PURE.
// Contact fields (name, phone, email) are PRIVATE personal data: this model exists only in owner-only admin code.
import { isLeadStatus } from './status';
import type { LeadStatus } from './status';

// The last two arrive with supabase/proposed/0003_lead_kinds_m3.sql (once applied they show in the inbox like any other kind).
export const LEAD_TYPES = ['coverage', 'sponsorship', 'player_product', 'featured_listing', 'academy_listing', 'general', 'tournament_submission', 'video_submission', 'alerts_signup', 'profile_request', 'content_removal'] as const;
export type LeadType = (typeof LEAD_TYPES)[number];

export const TYPE_LABELS: Readonly<Record<LeadType, string>> = {
  coverage: 'Tournament coverage',
  sponsorship: 'Sponsorship',
  player_product: 'Player product',
  featured_listing: 'Featured listing',
  academy_listing: 'Academy listing',
  general: 'General',
  tournament_submission: 'Tournament listing',
  video_submission: 'Video submission',
  alerts_signup: 'Alerts sign-up',
  profile_request: 'Profile request',
  content_removal: 'Content removal request',
};

export interface InboxLead {
  id: string;
  refCode: string;
  type: LeadType;
  status: LeadStatus;
  name: string;
  organization: string | null;
  /** Digits with the country code, no plus. */
  phone: string | null;
  email: string | null;
  whatsappOk: boolean;
  /** Integer paise set by the owner; null = not set. */
  valuePaise: number | null;
  sourcePath: string | null;
  /** IST calendar date YYYY-MM-DD. */
  followUpOn: string | null;
  notes: string | null;
  lostReason: string | null;
  /** ISO instant (UTC). */
  createdAt: string;
}

type Row = Record<string, unknown>;
const str = (v: unknown): string | null => (typeof v === 'string' && v !== '' ? v : null);

export const isLeadType = (value: unknown): value is LeadType => typeof value === 'string' && (LEAD_TYPES as readonly string[]).includes(value);

/** Row of `public.leads` (or the explicit-column select the admin uses) to the view model; null when the row is unusable. */
export function toInboxLead(row: Row): InboxLead | null {
  const id = str(row.id);
  const ref = str(row.ref_code);
  const created = str(row.created_at);
  if (!id || !ref || !created || !isLeadType(row.type) || !isLeadStatus(row.status)) return null;
  const value = row.value_paise;
  return {
    id,
    refCode: ref,
    type: row.type,
    status: row.status,
    name: typeof row.name === 'string' ? row.name : '',
    organization: str(row.organization),
    phone: str(row.phone),
    email: str(row.email),
    whatsappOk: row.whatsapp_ok === true,
    // PostgREST returns bigint as a number when it is safe, otherwise as a string: accept both, refuse anything else
    valuePaise: typeof value === 'number' && Number.isSafeInteger(value) && value >= 0 ? value : typeof value === 'string' && /^\d{1,15}$/.test(value) ? Number(value) : null,
    sourcePath: str(row.source_path),
    followUpOn: str(row.follow_up_on),
    notes: str(row.notes),
    lostReason: str(row.lost_reason),
    createdAt: created,
  };
}

/** The explicit column list for the admin's select (no `select *`). */
export const INBOX_COLUMNS = 'id,ref_code,type,status,name,organization,phone,email,whatsapp_ok,value_paise,source_path,follow_up_on,notes,lost_reason,created_at';
