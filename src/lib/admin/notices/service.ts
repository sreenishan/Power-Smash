// The notices and notification admin actions (D-114), shared by the memory store (tests, preview) and the Supabase store (the Vercel
// admin function): both give it a NoticesBackend. Every write is one owner RPC of migration 0023 that checks the owner and audits;
// refusals come back as plain English in `errors`. The same text rules run here first (src/lib/notices/site-notices.ts), so the owner
// gets a field error before the round trip.
import { renderSubscriberAnnouncement } from '../../notices/emails';
import { cleanNotice, noticeProblems } from '../../notices/site-notices';
import { failResult, okResult, type AdminErrorCode, type StoreResult } from '../types';
import { NoticesError, type NoticesAdminStore, type NoticesBackend, type StaffNotice } from './types';

const PASS_THROUGH: readonly AdminErrorCode[] = ['INVALID', 'NOT_FOUND', 'STALE', 'FORBIDDEN', 'BACKEND_ERROR'];

function toFailure(e: unknown) {
  const code = (e as { code?: unknown })?.code;
  const detail = (e as { detail?: unknown })?.detail;
  if (e instanceof NoticesError || (typeof code === 'string' && (PASS_THROUGH as readonly string[]).includes(code))) {
    const c = code as AdminErrorCode;
    return typeof detail === 'string' && detail !== '' ? failResult(c, { form: detail }) : failResult(c);
  }
  return failResult('BACKEND_ERROR');
}

async function guard<T>(fn: () => Promise<StoreResult<T>>): Promise<StoreResult<T>> {
  try {
    return await fn();
  } catch (e) {
    return toFailure(e);
  }
}

/** Shown when the owner presses Send now but this server cannot send email. */
export const EMAIL_NOT_READY = 'Email sending is not set up yet. Your announcement stays in the queue and goes out once email is switched on.';

export interface NoticesServiceOptions {
  now?: () => Date;
}

const newestFirst = (x: { updatedAt: string; id: string }, y: { updatedAt: string; id: string }) => (x.updatedAt < y.updatedAt ? 1 : x.updatedAt > y.updatedAt ? -1 : x.id.localeCompare(y.id));

export function createNoticesService(b: NoticesBackend, opts: NoticesServiceOptions = {}): NoticesAdminStore {
  const now = opts.now ?? (() => new Date());
  return {
    noticesList: () => guard(async () => okResult((await b.listNotices()).sort(newestFirst))),
    noticesStaff: () =>
      guard(async () => {
        const at = now().getTime();
        const rows: StaffNotice[] = (await b.listNotices())
          .filter((n) => n.published && n.audience === 'staff')
          .filter((n) => (n.startsAt === null || Date.parse(n.startsAt) <= at) && (n.endsAt === null || Date.parse(n.endsAt) > at))
          .sort(newestFirst)
          .map(({ id, title, body, linkPath, linkUrl, linkLabel, updatedAt }) => ({ id, title, body, linkPath, linkUrl, linkLabel, updatedAt }));
        return okResult(rows);
      }),
    noticesSave: (actor, input) =>
      guard(async () => {
        const { id, expectedRevision, reason, ...fields } = input;
        const problems = noticeProblems(fields);
        if (Object.keys(problems).length > 0) return failResult('INVALID', problems);
        if (id !== null && expectedRevision === null) return failResult('STALE');
        return okResult(await b.saveNotice(actor, id, cleanNotice(fields), expectedRevision, reason));
      }),
    noticesPublish: (actor, input) => guard(async () => okResult(await b.publishNotice(actor, input.id, input.published, input.expectedRevision, input.reason))),
    notifySummary: (actor) => guard(async () => okResult({ ...(await b.summary(actor)), emailReady: b.emailReady() })),
    notifySaveSettings: (actor, input) => guard(async () => okResult(await b.setSettings(actor, { emailSubscribeOpen: input.emailSubscribeOpen }, input.reason))),
    notifyQueueAnnouncement: (actor, input) =>
      guard(async () => {
        const r = renderSubscriberAnnouncement({ title: input.title, body: input.body });
        if (!r.ok) return failResult('INVALID', r.errors);
        return okResult(await b.queueAnnouncement(actor, { announcementId: input.announcementId, subject: r.subject, body: r.body }, input.reason));
      }),
    notifyDispatch: () =>
      guard(async () => {
        if (!b.emailReady()) return failResult('INVALID', { form: EMAIL_NOT_READY });
        const r = await b.dispatch();
        if (!r) return failResult('INVALID', { form: EMAIL_NOT_READY });
        return okResult(r);
      }),
  };
}
