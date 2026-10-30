// Supabase REST provider for /international/ (D-112). Reads ONLY api.public_international_events with the PUBLISHABLE key (D-005),
// explicit columns, ordered by a unique key, paginated at the REST cap of 1,000 rows. The build job never holds the secret key.
// Written and tested with a MOCKED fetch only.
import { isAcceptableSupabaseUrl } from '../../supabase/rest';
import { INTERNATIONAL_COLUMNS, INTERNATIONAL_VIEW, type InternationalProvider, type PublicInternationalEventRow } from './provider';

export const REST_PAGE_SIZE = 1000;
/** A guard against a runaway loop: 20 pages = 20,000 events. */
export const MAX_REST_PAGES = 20;

export interface InternationalSupabaseOptions {
  /** Project URL, https://<ref>.supabase.co */
  url: string;
  /** The PUBLISHABLE key (never the secret key). */
  publishableKey: string;
  fetch: typeof fetch;
  allowLocalUrl?: boolean;
}

export function createInternationalSupabaseProvider(opts: InternationalSupabaseOptions): InternationalProvider {
  if (!opts.publishableKey) throw new Error('international_publishable_key_missing');
  if (!isAcceptableSupabaseUrl(opts.url, opts.allowLocalUrl === true)) throw new Error('supabase_url_refused');
  return {
    id: 'supabase',
    async load(): Promise<PublicInternationalEventRow[]> {
      const base = `${opts.url.replace(/\/+$/, '')}/rest/v1/${INTERNATIONAL_VIEW}`;
      const select = INTERNATIONAL_COLUMNS.join(',');
      const rows: PublicInternationalEventRow[] = [];
      for (let page = 0; page < MAX_REST_PAGES; page += 1) {
        const url = `${base}?select=${encodeURIComponent(select)}&order=${encodeURIComponent('start_date.asc,id.asc')}&limit=${REST_PAGE_SIZE}&offset=${page * REST_PAGE_SIZE}`;
        const res = await opts.fetch(url, { method: 'GET', headers: { apikey: opts.publishableKey, accept: 'application/json', 'accept-profile': 'api' } });
        // never echo the response body (it could hold anything); the status code is enough
        if (!res.ok) throw new Error(`international_read_failed_${res.status}`);
        const body: unknown = await res.json();
        if (!Array.isArray(body)) throw new Error('international_read_bad_shape');
        rows.push(...(body as PublicInternationalEventRow[]));
        if (body.length < REST_PAGE_SIZE) return rows;
      }
      throw new Error('international_read_too_many_pages');
    },
  };
}
