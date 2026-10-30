// InternationalBackend over Supabase PostgREST (the Vercel admin function only; secret key, service_role). Reads select explicit
// columns (never select *), paged at 1,000 rows; writes are only the owner RPCs of migration 0022 with the VERIFIED actor id as p_actor.
// The deps are the same `select` and `rpc` the competition backend gets from src/lib/admin/supabase-store.ts.
import type { InternationalBackend, InternationalEventRow, InternationalSaveHostsResult, InternationalSetPublishedResult } from './types';

export interface SupabaseInternationalDeps {
  select: <T>(table: string, query: string) => Promise<T[]>;
  rpc: <T>(name: string, args: Record<string, unknown>) => Promise<T>;
}

const PAGE = 1000;

export const INTERNATIONAL_ADMIN_COLUMNS = {
  international_events: 'id,name,level_text,start_date,end_date,city,country,official_url,published,revision,created_at,updated_at',
  international_settings: 'extra_hosts',
} as const;

type EventDb = {
  id: string; name: string; level_text: string | null; start_date: string; end_date: string; city: string | null; country: string;
  official_url: string; published: boolean; revision: number; created_at: string; updated_at: string;
};

const rowOf = (r: EventDb): InternationalEventRow => ({
  id: r.id, name: r.name, levelText: r.level_text, startDate: r.start_date, endDate: r.end_date, city: r.city, country: r.country,
  officialUrl: r.official_url, published: r.published === true, revision: r.revision, createdAt: r.created_at, updatedAt: r.updated_at,
});

export function createSupabaseInternationalBackend(deps: SupabaseInternationalDeps): InternationalBackend {
  const { select, rpc } = deps;
  return {
    listEvents: async () => {
      const out: InternationalEventRow[] = [];
      for (let offset = 0; offset < 50 * PAGE; offset += PAGE) {
        const page = await select<EventDb>('international_events', `select=${INTERNATIONAL_ADMIN_COLUMNS.international_events}&order=start_date.desc,id.asc&limit=${PAGE}&offset=${offset}`);
        out.push(...page.map(rowOf));
        if (page.length < PAGE) break;
      }
      return out;
    },
    getExtraHosts: async () => {
      const [r] = await select<{ extra_hosts: string[] | null }>('international_settings', `select=${INTERNATIONAL_ADMIN_COLUMNS.international_settings}&id=eq.1&limit=1`);
      return Array.isArray(r?.extra_hosts) ? r.extra_hosts.filter((h): h is string => typeof h === 'string') : [];
    },
    saveEvent: (a, id, record, expected, reason) =>
      rpc('admin_save_international_event', { p_actor: a.userId, p_id: id, p_record: record, p_expected_revision: expected, p_reason: reason }),
    setPublished: (a, id, published, expected, reason) =>
      rpc<InternationalSetPublishedResult>('admin_set_international_event_published', { p_actor: a.userId, p_id: id, p_published: published, p_expected_revision: expected, p_reason: reason }),
    setHosts: (a, hosts, reason) => rpc<InternationalSaveHostsResult>('admin_set_international_hosts', { p_actor: a.userId, p_hosts: hosts, p_reason: reason }),
  };
}
