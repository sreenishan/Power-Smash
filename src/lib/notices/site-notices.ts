// In-site notices (D-114): short owner-entered messages, shown in a banner on public pages (audience 'public') or in the admin to
// signed-in organizers and scorers (audience 'staff'). The rules here are the TS twins of migration 0023 (app.notify_text_ok,
// app.site_notice_path_ok, app.site_notice_link_ok and the site_notices checks); tests/notices/site-notices.test.ts runs both on the
// same cases. No contact data in a notice: no email address, no phone number, no WhatsApp chat link.
// A link is either a page of this site (written through src/lib/urls.ts path()) or an outside https link to the brand's own public
// accounts; a WhatsApp link may only be a Channel link.
import { outboxTextProblem } from '../notify/outbox/payload';
import { path } from '../urls';

export const NOTICE_AUDIENCES = ['public', 'staff'] as const;
export type NoticeAudience = (typeof NOTICE_AUDIENCES)[number];

export const NOTICE_LIMITS = { titleMin: 2, titleMax: 120, bodyMax: 600, labelMin: 2, labelMax: 60, urlMax: 300 } as const;

/** app.site_notice_path_ok (0023): root-relative, lower case, slash at the end, never an endpoint. */
export const SITE_NOTICE_PATH_SQL = String.raw`^/[a-z0-9][a-z0-9/_-]{0,150}/$`;
const PATH_RE = new RegExp(SITE_NOTICE_PATH_SQL);

/** app.site_notice_link_ok (0023), one pattern per allowed site, in the SQL's order. */
export const SITE_NOTICE_LINK_PATTERNS = [
  // YouTube: a handle (or one of its tabs), a video, a playlist, a channel id, a short or a live page only (never /redirect or
  // /attribution_link, which can bounce a visitor to any site)
  String.raw`^https://(www\.)?youtube\.com/(@[A-Za-z0-9._-]{3,30}(/(videos|shorts|streams|playlists|featured))?/?|watch\?v=[A-Za-z0-9_-]{11}|playlist\?list=[A-Za-z0-9_-]{10,64}|channel/UC[A-Za-z0-9_-]{22}|(shorts|live)/[A-Za-z0-9_-]{11})$`,
  String.raw`^https://youtu\.be/[A-Za-z0-9_-]{6,20}$`,
  String.raw`^https://(www\.)?instagram\.com/[A-Za-z0-9/._-]{0,200}$`,
  String.raw`^https://(www\.)?facebook\.com/[A-Za-z0-9/._-]{0,200}$`,
  String.raw`^https://(www\.)?whatsapp\.com/channel/[A-Za-z0-9]{16,40}$`,
] as const;
const LINK_RES = SITE_NOTICE_LINK_PATTERNS.map((p) => new RegExp(p));

export function noticePathOk(p: string): boolean {
  return p === '/' || (PATH_RE.test(p) && !p.includes('//') && !/^\/(api|go|cdn-cgi)\//.test(p));
}

export function noticeLinkOk(url: string): boolean {
  return url.length <= NOTICE_LIMITS.urlMax && outboxTextProblem(url, NOTICE_LIMITS.urlMax, false) === null && LINK_RES.some((re) => re.test(url));
}

/** What the owner types (the admin form and the save action). Empty strings count as empty. */
export interface NoticeInput {
  title: string;
  body: string | null;
  linkPath: string | null;
  linkUrl: string | null;
  linkLabel: string | null;
  audience: NoticeAudience;
  /** ISO instants (UTC) or null; the admin form builds them from an India-time date and time (src/lib/dates.ts istInstant). */
  startsAt: string | null;
  endsAt: string | null;
}

const blank = (v: string | null | undefined): string | null => {
  const t = (v ?? '').trim();
  return t === '' ? null : t;
};

/** The trimmed record as the database stores it. */
export function cleanNotice(input: NoticeInput): NoticeInput {
  return {
    title: input.title.trim(),
    body: blank(input.body),
    linkPath: blank(input.linkPath),
    linkUrl: blank(input.linkUrl),
    linkLabel: blank(input.linkLabel),
    audience: input.audience,
    startsAt: blank(input.startsAt),
    endsAt: blank(input.endsAt),
  };
}

/** Plain-English problems per field (empty object = fine). Mirrors admin_save_site_notice's refusals. */
export function noticeProblems(raw: NoticeInput): Record<string, string> {
  const n = cleanNotice(raw);
  const e: Record<string, string> = {};
  if (n.title.length < NOTICE_LIMITS.titleMin || n.title.length > NOTICE_LIMITS.titleMax) e.title = `Write a title of ${NOTICE_LIMITS.titleMin} to ${NOTICE_LIMITS.titleMax} characters.`;
  else if (outboxTextProblem(n.title, NOTICE_LIMITS.titleMax, false)) e.title = 'The title must not hold an email address, a phone number or a WhatsApp chat link.';
  if (n.body !== null && outboxTextProblem(n.body, NOTICE_LIMITS.bodyMax, true)) {
    e.body = n.body.length > NOTICE_LIMITS.bodyMax ? `Keep the text to ${NOTICE_LIMITS.bodyMax} characters.` : 'The text must not hold an email address, a phone number or a WhatsApp chat link.';
  }
  if (n.linkPath !== null && n.linkUrl !== null) e.link = 'Give one link only: a page of this site or an outside link.';
  else if (n.linkPath !== null && !noticePathOk(n.linkPath)) e.linkPath = 'Write a page of this site, starting and ending with /, for example /competitions/.';
  else if (n.linkUrl !== null && !noticeLinkOk(n.linkUrl)) e.linkUrl = 'An outside link can only go to Power Smash on YouTube, Instagram, Facebook or the WhatsApp Channel (https).';
  const hasLink = n.linkPath !== null || n.linkUrl !== null;
  if (hasLink && n.linkLabel === null) e.linkLabel = 'Write the words people tap, for example "See the draw".';
  else if (!hasLink && n.linkLabel !== null) e.linkLabel = 'Add the link these words go to, or clear the words.';
  else if (n.linkLabel !== null && (n.linkLabel.length < NOTICE_LIMITS.labelMin || n.linkLabel.length > NOTICE_LIMITS.labelMax || outboxTextProblem(n.linkLabel, NOTICE_LIMITS.labelMax, false))) {
    e.linkLabel = `Write ${NOTICE_LIMITS.labelMin} to ${NOTICE_LIMITS.labelMax} characters, without contact details.`;
  }
  if (!(NOTICE_AUDIENCES as readonly string[]).includes(n.audience)) e.audience = 'Choose who sees the notice.';
  const t = (v: string | null) => (v === null ? null : Date.parse(v));
  const s = t(n.startsAt);
  const en = t(n.endsAt);
  if (s !== null && Number.isNaN(s)) e.startsAt = 'Check the start date and time.';
  if (en !== null && Number.isNaN(en)) e.endsAt = 'Check the end date and time.';
  if (s !== null && en !== null && !Number.isNaN(s) && !Number.isNaN(en) && en <= s) e.endsAt = 'The end must be after the start.';
  return e;
}

/** A notice as visitors get it (api.public_site_notices columns). */
export interface PublicSiteNotice {
  id: string;
  title: string;
  body: string | null;
  link_path: string | null;
  link_url: string | null;
  link_label: string | null;
  starts_at: string | null;
  ends_at: string | null;
  updated_at: string;
}

export const PUBLIC_SITE_NOTICE_COLUMNS = ['id', 'title', 'body', 'link_path', 'link_url', 'link_label', 'starts_at', 'ends_at', 'updated_at'] as const satisfies readonly (keyof PublicSiteNotice)[];

/** Where a notice links to, or null. Internal pages go through path(); an outside link is used only when it passes the allow-list. */
export function noticeHref(n: Pick<PublicSiteNotice, 'link_path' | 'link_url'>): { href: string; external: boolean } | null {
  if (n.link_path && noticePathOk(n.link_path)) return { href: path(n.link_path), external: false };
  if (n.link_url && noticeLinkOk(n.link_url)) return { href: n.link_url, external: true };
  return null;
}

/**
 * The notices to show at `now` (the build time for static pages): window open, every text still passing the rules (a row that does
 * not is dropped, fail closed), newest change first, at most `max`.
 */
export function activeNotices(rows: readonly PublicSiteNotice[], now: Date, max = 3): PublicSiteNotice[] {
  const at = now.getTime();
  return rows
    .filter((n) => typeof n.id === 'string' && typeof n.title === 'string')
    .filter((n) => (n.starts_at === null || Date.parse(n.starts_at) <= at) && (n.ends_at === null || Date.parse(n.ends_at) > at))
    .filter((n) => Object.keys(noticeProblems({ title: n.title, body: n.body, linkPath: n.link_path, linkUrl: n.link_url, linkLabel: n.link_label, audience: 'public', startsAt: n.starts_at, endsAt: n.ends_at })).length === 0)
    .sort((a, b) => (a.updated_at < b.updated_at ? 1 : a.updated_at > b.updated_at ? -1 : a.id.localeCompare(b.id)))
    .slice(0, Math.max(0, max));
}
