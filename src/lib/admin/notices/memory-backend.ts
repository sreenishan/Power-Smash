// A FICTIONAL in-memory NoticesBackend for tests and the admin preview: invented notices and subscriber counts, no address at all.
// It applies the same rules as the 0023 RPCs (revision check, one announcement per id). Email is not "ready" unless a test says so,
// so Send now explains that email is not set up.
import type { DispatchSummary } from '../../notify/outbox/dispatcher';
import type { NoticeInput } from '../../notices/site-notices';
import { NoticesError, type NoticeRow, type NoticesBackend, type NotifySummary } from './types';

export interface MemoryNoticesOptions {
  now?: () => Date;
  newId?: () => string;
  /** Fictional count of active subscribers an announcement is queued for. */
  activeSubscribers?: number;
  emailReady?: boolean;
  dispatch?: () => Promise<DispatchSummary | null>;
}

export const MEMORY_NOTICES_SEED: readonly NoticeRow[] = [
  {
    id: 'c0230000-0000-4000-8000-000000000001',
    title: 'Sample notice: entries for the Sample City Open close on Friday',
    body: 'Fictional preview text.',
    linkPath: '/competitions/',
    linkUrl: null,
    linkLabel: 'See the competitions',
    audience: 'public',
    startsAt: null,
    endsAt: null,
    published: false,
    publishedAt: null,
    revision: 1,
    updatedAt: '2026-10-30T10:00:00.000Z',
  },
  {
    id: 'c0230000-0000-4000-8000-000000000002',
    title: 'Sample staff notice: bring the score sheets to the desk after each match',
    body: null,
    linkPath: null,
    linkUrl: null,
    linkLabel: null,
    audience: 'staff',
    startsAt: null,
    endsAt: null,
    published: true,
    publishedAt: '2026-10-30T10:00:00.000Z',
    revision: 2,
    updatedAt: '2026-10-30T10:00:00.000Z',
  },
];

export type MemoryNoticesBackend = NoticesBackend & { audit: Array<{ action: string; entityId: string; diff: Record<string, unknown> }> };

export function createMemoryNoticesBackend(o: MemoryNoticesOptions = {}): MemoryNoticesBackend {
  const now = o.now ?? (() => new Date());
  let counter = 0;
  const newId = o.newId ?? (() => `c0230000-0000-4000-8000-${String(100 + (counter += 1)).padStart(12, '0')}`);
  const notices = new Map<string, NoticeRow>(MEMORY_NOTICES_SEED.map((n) => [n.id, { ...n }]));
  const settings = { emailSubscribeOpen: false };
  const queued = new Set<string>();
  const audit: MemoryNoticesBackend['audit'] = [];
  const active = o.activeSubscribers ?? 3;

  return {
    audit,
    listNotices: async () => [...notices.values()].map((n) => ({ ...n })),
    saveNotice: async (_a, id: string | null, r: NoticeInput, expected: number | null) => {
      const stamp = now().toISOString();
      if (id === null) {
        const row: NoticeRow = { id: newId(), ...r, published: false, publishedAt: null, revision: 1, updatedAt: stamp };
        notices.set(row.id, row);
        audit.push({ action: 'create_site_notice', entityId: row.id, diff: { audience: r.audience } });
        return { id: row.id, revision: 1, created: true };
      }
      const cur = notices.get(id);
      if (!cur) throw new NoticesError('NOT_FOUND');
      if (expected === null || cur.revision !== expected) throw new NoticesError('STALE', 'The notice changed; reload it.');
      const next: NoticeRow = { ...cur, ...r, revision: cur.revision + 1, updatedAt: stamp };
      notices.set(id, next);
      audit.push({ action: 'update_site_notice', entityId: id, diff: { fields: Object.keys(r) } });
      return { id, revision: next.revision, created: false };
    },
    publishNotice: async (_a, id, published, expected) => {
      const cur = notices.get(id);
      if (!cur) throw new NoticesError('NOT_FOUND');
      if (cur.revision !== expected) throw new NoticesError('STALE', 'The notice changed; reload it.');
      if (cur.published === published) return { id, published, revision: cur.revision };
      const stamp = now().toISOString();
      const next: NoticeRow = { ...cur, published, publishedAt: published ? stamp : null, revision: cur.revision + 1, updatedAt: stamp };
      notices.set(id, next);
      audit.push({ action: published ? 'publish_site_notice' : 'unpublish_site_notice', entityId: id, diff: { audience: cur.audience } });
      return { id, published, revision: next.revision };
    },
    summary: async (): Promise<Omit<NotifySummary, 'emailReady'>> => ({
      emailSubscribeOpen: settings.emailSubscribeOpen,
      subscribers: { pending: 1, active, unsubscribed: 1 },
      outbox: { queued: queued.size * active, sending: 0, sent: 0, failed: 0, skipped: 0 },
    }),
    setSettings: async (_a, r) => {
      if (settings.emailSubscribeOpen === r.emailSubscribeOpen) return { emailSubscribeOpen: r.emailSubscribeOpen, fields: [] };
      settings.emailSubscribeOpen = r.emailSubscribeOpen;
      audit.push({ action: 'set_notify_settings', entityId: '1', diff: { fields: ['emailSubscribeOpen'] } });
      return { emailSubscribeOpen: r.emailSubscribeOpen, fields: ['emailSubscribeOpen'] };
    },
    queueAnnouncement: async (_a, r) => {
      if (queued.has(r.announcementId)) return { announcementId: r.announcementId, queued: 0, duplicates: active };
      queued.add(r.announcementId);
      audit.push({ action: 'queue_announcement', entityId: r.announcementId, diff: { queued: active } });
      return { announcementId: r.announcementId, queued: active, duplicates: 0 };
    },
    emailReady: () => o.emailReady === true,
    dispatch: o.dispatch ?? (async () => null),
  };
}
