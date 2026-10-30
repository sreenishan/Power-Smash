// The public international events data (D-112): the row shape of api.public_international_events (migration 0022) and the provider
// interface. The column list below is the view's, in order, and is checked against the SQL by tests/international/sql.test.ts.
// Nothing here comes from the linked sites: every field is typed in by the owner.

export const INTERNATIONAL_VIEW = 'public_international_events' as const;

/** The explicit columns of api.public_international_events, in the view's order (never select *). */
export const INTERNATIONAL_COLUMNS = ['id', 'name', 'level_text', 'start_date', 'end_date', 'city', 'country', 'official_url'] as const;

export interface PublicInternationalEventRow {
  id: string;
  name: string;
  level_text: string | null;
  start_date: string;
  end_date: string;
  city: string | null;
  country: string;
  official_url: string;
}

export type InternationalSource = 'seed' | 'supabase';

export interface InternationalProvider {
  readonly id: InternationalSource;
  load(): Promise<PublicInternationalEventRow[]>;
}
