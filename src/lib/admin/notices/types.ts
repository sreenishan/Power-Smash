// Notices and notifications in the admin (D-114). The owner writes notices (shown in the site, or to signed-in organizers and scorers),
// switches the email sign-up on or off, emails an announcement to the confirmed subscribers, and starts the sending. The admin shows
// COUNTS of subscribers only, never an address.
import type { DispatchSummary } from '../../notify/outbox/dispatcher';
import type { NoticeAudience, NoticeInput } from '../../notices/site-notices';
import type { Actor, StoreResult } from '../types';

export interface NoticeRow {
  id: string;
  title: string;
  body: string | null;
  linkPath: string | null;
  linkUrl: string | null;
  linkLabel: string | null;
  audience: NoticeAudience;
  startsAt: string | null;
  endsAt: string | null;
  published: boolean;
  publishedAt: string | null;
  revision: number;
  updatedAt: string;
}

/** What organizers and scorers see in the admin (published staff notices whose window is open). */
export type StaffNotice = Pick<NoticeRow, 'id' | 'title' | 'body' | 'linkPath' | 'linkUrl' | 'linkLabel' | 'updatedAt'>;

export interface NotifySummary {
  emailSubscribeOpen: boolean;
  subscribers: { pending: number; active: number; unsubscribed: number };
  outbox: { queued: number; sending: number; sent: number; failed: number; skipped: number };
  /** Can email be sent at all on this server (EMAIL_ENABLED exactly "true", key, From, https origin, HMAC)? Never the values. */
  emailReady: boolean;
}

// ----------------------------------------------------------------------------- the backend (primitive reads and the 0023 RPCs)

export interface NoticesBackend {
  listNotices(): Promise<NoticeRow[]>;
  saveNotice(actor: Actor, id: string | null, record: NoticeInput, expectedRevision: number | null, reason: string): Promise<{ id: string; revision: number; created: boolean }>;
  publishNotice(actor: Actor, id: string, published: boolean, expectedRevision: number, reason: string): Promise<{ id: string; published: boolean; revision: number }>;
  summary(actor: Actor): Promise<Omit<NotifySummary, 'emailReady'>>;
  setSettings(actor: Actor, record: { emailSubscribeOpen: boolean }, reason: string): Promise<{ emailSubscribeOpen: boolean; fields: string[] }>;
  queueAnnouncement(actor: Actor, record: { announcementId: string; subject: string; body: string }, reason: string): Promise<{ announcementId: string; queued: number; duplicates: number }>;
  /** Whether this server can send email at all (no values). */
  emailReady(): boolean;
  /** Runs the dispatcher once (null = sending is not set up on this server). */
  dispatch(): Promise<DispatchSummary | null>;
}

// ----------------------------------------------------------------------------- the store methods the integrator adds to AdminStore

export interface NoticesAdminStore {
  noticesList(): Promise<StoreResult<NoticeRow[]>>;
  noticesStaff(): Promise<StoreResult<StaffNotice[]>>;
  noticesSave(actor: Actor, input: NoticeInput & { id: string | null; expectedRevision: number | null; reason: string }): Promise<StoreResult<{ id: string; revision: number; created: boolean }>>;
  noticesPublish(actor: Actor, input: { id: string; published: boolean; expectedRevision: number; reason: string }): Promise<StoreResult<{ id: string; published: boolean; revision: number }>>;
  notifySummary(actor: Actor): Promise<StoreResult<NotifySummary>>;
  notifySaveSettings(actor: Actor, input: { emailSubscribeOpen: boolean; reason: string }): Promise<StoreResult<{ emailSubscribeOpen: boolean; fields: string[] }>>;
  notifyQueueAnnouncement(actor: Actor, input: { announcementId: string; title: string; body: string; reason: string }): Promise<StoreResult<{ announcementId: string; queued: number; duplicates: number }>>;
  notifyDispatch(actor: Actor): Promise<StoreResult<DispatchSummary>>;
}

export class NoticesError extends Error {
  constructor(
    readonly code: 'INVALID' | 'NOT_FOUND' | 'STALE' | 'FORBIDDEN' | 'BACKEND_ERROR',
    readonly detail?: string,
  ) {
    super(code);
  }
}
