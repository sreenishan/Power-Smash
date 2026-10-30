// RegistrationBackend over Supabase PostgREST (the Vercel admin function only; secret key, service_role). Reads select explicit
// columns (never select *), paged at 1,000 rows; writes are only the owner RPCs of 0020 with the VERIFIED actor id as p_actor.
// The deps are the same `select` and `rpc` the competition backend gets from src/lib/admin/supabase-store.ts.
import type { AgeStatus } from '../../archive/types';
import type { RegistrationBackend, RegistrationRow, RegistrationSettings, RegistrationStatus } from './types';

export interface SupabaseRegistrationDeps {
  select: <T>(table: string, query: string) => Promise<T[]>;
  rpc: <T>(name: string, args: Record<string, unknown>) => Promise<T>;
}

const PAGE = 1000;
const CHUNK = 80;
const enc = encodeURIComponent;
const list = (ids: readonly string[]): string => `(${ids.map((x) => enc(x)).join(',')})`;

export const REGISTRATION_COLUMNS = {
  event_registrations:
    'id,ref,event_id,player1_name,player2_name,contact_phone,contact_email,whatsapp_ok,payment_reference,fee_paise_at_submit,status,payment_verified_amount_paise,payment_verified_at,entry_id,converted_at,rejected_reason,rejected_at,revision,created_at',
  tournament_events: 'id,tournament_id,category,age_group,is_junior,status,capacity,registration_open,entry_fee_paise,tournaments(name,level,is_minor_signal)',
  competition_settings: 'registration_enabled,registration_payment_instructions,registration_upi_id,registration_payee_name',
  players: 'id,display_name,age_status,name_normalized',
} as const;

type RegDb = {
  id: string; ref: string; event_id: string; player1_name: string; player2_name: string | null; contact_phone: string; contact_email: string | null;
  whatsapp_ok: boolean; payment_reference: string | null; fee_paise_at_submit: number | null; status: RegistrationStatus; payment_verified_amount_paise: number | null;
  payment_verified_at: string | null; entry_id: string | null; converted_at: string | null; rejected_reason: string | null; rejected_at: string | null; revision: number; created_at: string;
};
type EventDb = {
  id: string; tournament_id: string; category: string; age_group: string | null; is_junior: boolean; status: string; capacity: number | null;
  registration_open: boolean; entry_fee_paise: number | null; tournaments: { name: string; level: string | null; is_minor_signal: boolean | null } | null;
};

const rowOf = (r: RegDb): RegistrationRow => ({
  id: r.id, ref: r.ref, eventId: r.event_id, player1Name: r.player1_name, player2Name: r.player2_name, phone: r.contact_phone, email: r.contact_email,
  whatsappOk: r.whatsapp_ok, paymentReference: r.payment_reference, feePaiseAtSubmit: r.fee_paise_at_submit, status: r.status,
  verifiedAmountPaise: r.payment_verified_amount_paise, verifiedAt: r.payment_verified_at, entryId: r.entry_id, convertedAt: r.converted_at,
  rejectedReason: r.rejected_reason, rejectedAt: r.rejected_at, revision: r.revision, createdAt: r.created_at,
});

// Junior the way 0020 decides it (app.registration_event_is_junior): the event, a minor signal (unknown counts) or school/college level.
const eventOf = (e: EventDb) => ({
  id: e.id,
  tournamentId: e.tournament_id,
  tournamentName: e.tournaments?.name ?? '(tournament)',
  category: e.category,
  ageGroup: e.age_group,
  status: e.status,
  junior: e.is_junior || e.tournaments?.is_minor_signal !== false || e.tournaments?.level === 'school_college',
  capacity: e.capacity,
  registrationOpen: e.registration_open,
  entryFeePaise: e.entry_fee_paise,
});

export function createSupabaseRegistrationBackend(deps: SupabaseRegistrationDeps): RegistrationBackend {
  const { select, rpc } = deps;
  async function all<T>(table: string, query: string): Promise<T[]> {
    const out: T[] = [];
    for (let offset = 0; offset < 100 * PAGE; offset += PAGE) {
      const page = await select<T>(table, `${query}&limit=${PAGE}&offset=${offset}`);
      out.push(...page);
      if (page.length < PAGE) break;
    }
    return out;
  }
  async function byIds<T>(table: string, cols: string, column: string, ids: readonly string[], order: string): Promise<T[]> {
    const unique = [...new Set(ids)];
    const out: T[] = [];
    for (let i = 0; i < unique.length; i += CHUNK) out.push(...(await all<T>(table, `select=${cols}&${column}=in.${list(unique.slice(i, i + CHUNK))}&order=${order}`)));
    return out;
  }

  return {
    getSettings: async (): Promise<RegistrationSettings> => {
      const [r] = await select<{ registration_enabled: boolean; registration_payment_instructions: string | null; registration_upi_id: string | null; registration_payee_name: string | null }>(
        'competition_settings',
        `select=${REGISTRATION_COLUMNS.competition_settings}&id=eq.1&limit=1`,
      );
      if (!r) return { enabled: false, paymentInstructions: null, upiId: null, payeeName: null };
      return { enabled: r.registration_enabled === true, paymentInstructions: r.registration_payment_instructions, upiId: r.registration_upi_id, payeeName: r.registration_payee_name };
    },
    listEvents: async () => (await all<EventDb>('tournament_events', `select=${REGISTRATION_COLUMNS.tournament_events}&status=neq.draft&order=created_at.desc,id.asc`)).map(eventOf),
    getEvent: async (id) => {
      const [e] = await select<EventDb>('tournament_events', `select=${REGISTRATION_COLUMNS.tournament_events}&id=eq.${enc(id)}&limit=1`);
      return e ? eventOf(e) : null;
    },
    listRegistrations: async (eventIds) => (await byIds<RegDb>('event_registrations', REGISTRATION_COLUMNS.event_registrations, 'event_id', eventIds, 'created_at.asc,id.asc')).map(rowOf),
    // name keys may hold spaces and punctuation: each value is double-quoted for PostgREST's in.() list (a quote or backslash escaped)
    findPlayers: async (keys) => {
      const unique = [...new Set(keys)].filter((k) => k.length > 0 && k.length <= 120);
      const out: Array<{ id: string; displayName: string; ageStatus: AgeStatus; nameNormalized: string }> = [];
      for (let i = 0; i < unique.length; i += CHUNK) {
        const quoted = unique.slice(i, i + CHUNK).map((k) => enc(`"${k.replace(/["\\]/g, (c) => `\\${c}`)}"`)).join(',');
        const rows = await all<{ id: string; display_name: string; age_status: AgeStatus; name_normalized: string }>(
          'players',
          `select=${REGISTRATION_COLUMNS.players}&merged_into=is.null&name_normalized=in.(${quoted})&order=id.asc`,
        );
        out.push(...rows.map((p) => ({ id: p.id, displayName: p.display_name, ageStatus: p.age_status, nameNormalized: p.name_normalized })));
      }
      return out;
    },

    setSettings: (a, record, reason) => rpc('admin_set_registration_settings', { p_actor: a.userId, p_record: record, p_reason: reason }),
    setEventRegistration: (a, eventId, record, reason) => rpc('admin_set_event_registration', { p_actor: a.userId, p_event: eventId, p_record: record, p_reason: reason }),
    verifyPayment: (a, id, record, expected, reason) => rpc('admin_verify_registration_payment', { p_actor: a.userId, p_registration: id, p_record: record, p_expected_revision: expected, p_reason: reason }),
    convert: (a, id, record, expected, reason) => rpc('admin_convert_registration', { p_actor: a.userId, p_registration: id, p_record: record, p_expected_revision: expected, p_reason: reason }),
    reject: (a, id, expected, reason) => rpc('admin_reject_registration', { p_actor: a.userId, p_registration: id, p_expected_revision: expected, p_reason: reason }),
  };
}
