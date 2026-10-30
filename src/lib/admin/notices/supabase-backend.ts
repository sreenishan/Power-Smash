// NoticesBackend over Supabase PostgREST (the Vercel admin function only; secret key, service_role). Reads select explicit columns of
// site_notices (never select *), paged at 1,000 rows; writes are only the owner RPCs of 0023 with the VERIFIED actor id as p_actor.
// The deps are the same `select` and `rpc` the competition backend gets from src/lib/admin/supabase-store.ts, plus two optional
// functions the integrator builds from the runtime settings: `emailReady` and `dispatch` (src/lib/notices/dispatch.ts
// createSubscriberDispatch). Without them sending is "not set up" (fail closed).
import type { DispatchSummary } from '../../notify/outbox/dispatcher';
import type { NoticeAudience } from '../../notices/site-notices';
import type { NoticeRow, NoticesBackend } from './types';

export interface SupabaseNoticesDeps {
  select: <T>(table: string, query: string) => Promise<T[]>;
  rpc: <T>(name: string, args: Record<string, unknown>) => Promise<T>;
  emailReady?: () => boolean;
  dispatch?: () => Promise<DispatchSummary | null>;
}

const PAGE = 1000;

export const NOTICES_COLUMNS = 'id,title,body,link_path,link_url,link_label,audience,starts_at,ends_at,published,published_at,revision,updated_at';

/** The owner RPCs whose plain INVALID sentences should reach the owner (the integrator adds them to COMPETITION_DETAIL_RPCS). */
export const NOTICES_DETAIL_RPCS = ['admin_save_site_notice', 'admin_publish_site_notice', 'admin_set_notify_settings', 'admin_queue_subscriber_announcement'] as const;

type NoticeDb = {
  id: string;
  title: string;
  body: string | null;
  link_path: string | null;
  link_url: string | null;
  link_label: string | null;
  audience: NoticeAudience;
  starts_at: string | null;
  ends_at: string | null;
  published: boolean;
  published_at: string | null;
  revision: number;
  updated_at: string;
};

const rowOf = (n: NoticeDb): NoticeRow => ({
  id: n.id,
  title: n.title,
  body: n.body,
  linkPath: n.link_path,
  linkUrl: n.link_url,
  linkLabel: n.link_label,
  audience: n.audience,
  startsAt: n.starts_at,
  endsAt: n.ends_at,
  published: n.published,
  publishedAt: n.published_at,
  revision: n.revision,
  updatedAt: n.updated_at,
});

export function createSupabaseNoticesBackend(deps: SupabaseNoticesDeps): NoticesBackend {
  const { select, rpc } = deps;
  return {
    listNotices: async () => {
      const out: NoticeDb[] = [];
      for (let offset = 0; offset < 100 * PAGE; offset += PAGE) {
        const page = await select<NoticeDb>('site_notices', `select=${NOTICES_COLUMNS}&order=updated_at.desc,id.asc&limit=${PAGE}&offset=${offset}`);
        out.push(...page);
        if (page.length < PAGE) break;
      }
      return out.map(rowOf);
    },
    saveNotice: (a, id, r, expected, reason) =>
      rpc('admin_save_site_notice', {
        p_actor: a.userId,
        p_id: id,
        p_record: { title: r.title, body: r.body, linkPath: r.linkPath, linkUrl: r.linkUrl, linkLabel: r.linkLabel, audience: r.audience, startsAt: r.startsAt, endsAt: r.endsAt },
        p_expected_revision: expected,
        p_reason: reason,
      }),
    publishNotice: (a, id, published, expected, reason) => rpc('admin_publish_site_notice', { p_actor: a.userId, p_id: id, p_published: published, p_expected_revision: expected, p_reason: reason }),
    summary: (a) => rpc('admin_notify_summary', { p_actor: a.userId }),
    setSettings: (a, record, reason) => rpc('admin_set_notify_settings', { p_actor: a.userId, p_record: record, p_reason: reason }),
    queueAnnouncement: (a, record, reason) => rpc('admin_queue_subscriber_announcement', { p_actor: a.userId, p_record: record, p_reason: reason }),
    emailReady: () => deps.emailReady?.() === true,
    dispatch: async () => (deps.dispatch ? deps.dispatch() : null),
  };
}
