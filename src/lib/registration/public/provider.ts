// Registration data for the static registration pages: which events take registrations now (with the owner's fee in paise) and the
// owner's payment texts. Read ONCE per build, like the competition pages (D-009):
//  - the FICTIONAL seed (default): invented payee and texts, for builds and tests;
//  - Supabase: api.public_registration_events and api.public_registration_payment (migration 0020) with the PUBLISHABLE key, only
//    when PS_COMPETITION_SOURCE is exactly "supabase" and the URL and key are set (the same rule as the competition pages).
// Neither view holds a name or contact: they hold an event id, a fee, and the payee's public payment details.
import { readAllRows, type CompetitionSupabaseOptions } from '../../competition/public/supabase-provider';
import type { EnvLike } from '../../competition/in-build';

export interface RegistrationEventRow {
  event_id: string;
  /** Integer paise set by the owner, or null (no fee is shown). */
  entry_fee_paise: number | null;
}

export interface RegistrationPaymentRow {
  payment_instructions: string | null;
  upi_id: string | null;
  payee_name: string | null;
}

export interface RawRegistrationData {
  events: readonly RegistrationEventRow[];
  /** Null when registration is switched off (the view is empty). */
  payment: RegistrationPaymentRow | null;
}

export interface RegistrationProvider {
  readonly id: 'seed' | 'supabase';
  load(): Promise<RawRegistrationData>;
}

export const REGISTRATION_EVENT_COLUMNS = ['event_id', 'entry_fee_paise'] as const satisfies readonly (keyof RegistrationEventRow)[];
export const REGISTRATION_PAYMENT_COLUMNS = ['payment_instructions', 'upi_id', 'payee_name'] as const satisfies readonly (keyof RegistrationPaymentRow)[];

/**
 * FICTIONAL: two events of the competition seed ("Sample City Open 2026", src/lib/competition/public/seed.ts) take registrations: the
 * men's singles with a sample fee, the mixed doubles with none. The junior event is listed too, to prove the page model leaves it out.
 * The fee is sample data for the developer build only; a real fee is always the owner's setting.
 */
export const SEED_REGISTRATION_DATA: RawRegistrationData = {
  events: [
    { event_id: 'ce-ms', entry_fee_paise: 50_000 },
    { event_id: 'ce-xd', entry_fee_paise: null },
    { event_id: 'ce-bs', entry_fee_paise: 30_000 },
  ],
  payment: {
    payment_instructions: 'Sample instructions: pay the entry fee by UPI, then type the payment reference in the form.',
    upi_id: 'sample-payee@okdemo',
    payee_name: 'Sample Payee',
  },
};

export const registrationSeedProvider: RegistrationProvider = { id: 'seed', load: async () => SEED_REGISTRATION_DATA };

const cleanFee = (v: unknown): number | null => (typeof v === 'number' && Number.isInteger(v) && v > 0 && v <= 100_000_000 ? v : null);
const cleanText = (v: unknown, max: number): string | null => (typeof v === 'string' && v.trim() !== '' && v.length <= max ? v.trim() : null);

export function createRegistrationSupabaseProvider(opts: CompetitionSupabaseOptions): RegistrationProvider {
  return {
    id: 'supabase',
    load: async () => {
      const [events, payment] = await Promise.all([
        readAllRows<RegistrationEventRow>(opts, 'public_registration_events', REGISTRATION_EVENT_COLUMNS, 'event_id.asc'),
        readAllRows<RegistrationPaymentRow>(opts, 'public_registration_payment', REGISTRATION_PAYMENT_COLUMNS, 'payee_name.asc.nullslast'),
      ]);
      const p = payment[0];
      return {
        events: events.filter((e) => typeof e.event_id === 'string').map((e) => ({ event_id: e.event_id, entry_fee_paise: cleanFee(e.entry_fee_paise) })),
        payment: p ? { payment_instructions: cleanText(p.payment_instructions, 1000), upi_id: cleanText(p.upi_id, 130), payee_name: cleanText(p.payee_name, 80) } : null,
      };
    },
  };
}

export function selectRegistrationProvider(env: EnvLike, fetchImpl: typeof fetch = fetch): RegistrationProvider {
  if (env.PS_COMPETITION_SOURCE === 'supabase') {
    const url = (env.PUBLIC_SUPABASE_URL ?? '').trim();
    const key = (env.PUBLIC_SUPABASE_PUBLISHABLE_KEY ?? '').trim();
    if (url && key) return createRegistrationSupabaseProvider({ url, publishableKey: key, fetch: fetchImpl });
  }
  return registrationSeedProvider;
}
