// Pure helpers of the Notices screen (tests/notices/admin-logic.test.ts). Plain English for the owner. Dates are typed as India date
// and time and stored as instants (src/lib/dates.ts istInstant / splitIst, D-030). Nothing is filled in for the owner.
import { formatInstantIst, isHhMm, isIsoDate, istInstant, splitIst } from '../../../lib/dates';
import type { NoticeRow, NotifySummary } from '../../../lib/admin/notices/types';
import type { NoticeAudience, NoticeInput } from '../../../lib/notices/site-notices';

export interface NoticeForm {
  title: string;
  body: string;
  linkKind: 'none' | 'page' | 'outside';
  linkPath: string;
  linkUrl: string;
  linkLabel: string;
  audience: NoticeAudience;
  startDate: string;
  startTime: string;
  endDate: string;
  endTime: string;
  reason: string;
}

export const EMPTY_NOTICE_FORM: NoticeForm = {
  title: '',
  body: '',
  linkKind: 'none',
  linkPath: '',
  linkUrl: '',
  linkLabel: '',
  audience: 'public',
  startDate: '',
  startTime: '',
  endDate: '',
  endTime: '',
  reason: '',
};

export const AUDIENCE_LABEL: Record<NoticeAudience, string> = {
  public: 'Everyone on the website',
  staff: 'Organizers and scorers (in the admin)',
};

export function formOf(n: NoticeRow): NoticeForm {
  const s = splitIst(n.startsAt);
  const e = splitIst(n.endsAt);
  return {
    title: n.title,
    body: n.body ?? '',
    linkKind: n.linkPath ? 'page' : n.linkUrl ? 'outside' : 'none',
    linkPath: n.linkPath ?? '',
    linkUrl: n.linkUrl ?? '',
    linkLabel: n.linkLabel ?? '',
    audience: n.audience,
    startDate: s.date,
    startTime: s.time,
    endDate: e.date,
    endTime: e.time,
    reason: '',
  };
}

/** An India date and time to an instant: both empty = none; a date alone = start of that day (00:00); else both must be valid. */
function when(date: string, time: string, field: string, errors: Record<string, string>): string | null {
  const d = date.trim();
  const t = time.trim();
  if (d === '' && t === '') return null;
  if (!isIsoDate(d)) {
    errors[field] = 'Pick a date.';
    return null;
  }
  if (t !== '' && !isHhMm(t)) {
    errors[field] = 'Write the time as hours and minutes, for example 09:30.';
    return null;
  }
  return istInstant(d, t === '' ? '00:00' : t);
}

/** The form as the save action's input, or the field problems in plain English. */
export function noticeInputOf(f: NoticeForm): { ok: true; input: NoticeInput } | { ok: false; errors: Record<string, string> } {
  const errors: Record<string, string> = {};
  const startsAt = when(f.startDate, f.startTime, 'startsAt', errors);
  const endsAt = when(f.endDate, f.endTime, 'endsAt', errors);
  if (Object.keys(errors).length > 0) return { ok: false, errors };
  return {
    ok: true,
    input: {
      title: f.title,
      body: f.body.trim() === '' ? null : f.body,
      linkPath: f.linkKind === 'page' ? f.linkPath : null,
      linkUrl: f.linkKind === 'outside' ? f.linkUrl : null,
      linkLabel: f.linkKind === 'none' ? null : f.linkLabel,
      audience: f.audience,
      startsAt,
      endsAt,
    },
  };
}

/** One line about where a notice stands. */
export function noticeStatus(n: Pick<NoticeRow, 'published' | 'startsAt' | 'endsAt' | 'audience'>, now: Date): string {
  if (!n.published) return 'Not published (only you can see it).';
  const at = now.getTime();
  if (n.endsAt && Date.parse(n.endsAt) <= at) return `Ended ${formatInstantIst(n.endsAt)}.`;
  if (n.startsAt && Date.parse(n.startsAt) > at) return `Published; shows from ${formatInstantIst(n.startsAt)}.`;
  return n.audience === 'public' ? 'Published; on the website after the next site update.' : 'Published; organizers and scorers see it now.';
}

export function summaryLines(s: NotifySummary): string[] {
  return [
    `Email sign-up: ${s.emailSubscribeOpen ? 'open' : 'closed'}.`,
    `Confirmed subscribers: ${s.subscribers.active}. Waiting for confirmation: ${s.subscribers.pending}. Unsubscribed: ${s.subscribers.unsubscribed}.`,
    `Emails waiting to go: ${s.outbox.queued + s.outbox.sending}. Sent: ${s.outbox.sent}. Failed: ${s.outbox.failed}. Not sent (no consent or switched off): ${s.outbox.skipped}.`,
    s.emailReady ? 'Email sending is set up on the server.' : 'Email sending is not set up on the server yet: nothing is sent.',
  ];
}

/** A new announcement id (one per composed message, so pressing Queue twice never queues it twice). */
export function newAnnouncementId(): string {
  return globalThis.crypto.randomUUID();
}

/**
 * The website pages are built ahead of time: a notice's start and end times are applied when the site is next published, not at
 * that minute (nothing publishes the site by itself yet). The owner is told so in plain words beside the time fields (D-125).
 */
export const NOTICE_TIMING_HINTS = {
  start: 'Empty = from the next site update after you publish it. A time you set takes effect at the first site update after that time.',
  end: 'Empty = until you take it down. The notice leaves the pages at the first site update after this time.',
  note: 'The website is updated when you press "Publish now" on the dashboard. To start or end a notice on time, press "Publish now" just after the start or end time.',
} as const;

/** Notices are public: a hint to keep contact details and player names out (the privacy page says notices hold no contact details). */
export const NOTICE_TEXT_HINT = 'Up to 600 characters. No phone numbers or email addresses, and do not name players here.';
