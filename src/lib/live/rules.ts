// The /live pin and past-streams list (spec 7.13, D-101). PURE: one rule shared by src/content/live.ts (the build), both admin stores, the
// request schema and the admin Live screen, so all of them agree with the SQL in admin_save_live (0013):
//  - a video id is exactly 11 characters from [A-Za-z0-9_-]; the owner may paste a YouTube link instead and the id is read from it;
//  - at most 20 past streams, no id twice; a title is the one YouTube shows (D-016), trimmed, 1 to 100 characters, no control characters;
//  - a date is a real calendar date written YYYY-MM-DD (India time), or empty.

export const LIVE_LIMITS = { pastStreams: 20, title: 100 } as const;

export interface PastStream {
  /** The 11-character YouTube video id. */
  readonly videoId: string;
  /** The title exactly as on YouTube (never edited, D-016). */
  readonly title: string;
  /** When it was streamed, YYYY-MM-DD (India time), or null. */
  readonly date: string | null;
}

export interface LiveSettings {
  /** The stream to show at the top of /live, or null for none. */
  readonly pinnedVideoId: string | null;
  /** Older streams the owner wants listed, in the owner's order. Empty = the section is hidden. */
  readonly pastStreams: readonly PastStream[];
}

export const NO_LIVE: LiveSettings = { pinnedVideoId: null, pastStreams: [] };

/** YouTube video ids are exactly 11 characters from this set. */
const VIDEO_ID = /^[A-Za-z0-9_-]{11}$/;
export const isVideoId = (value: unknown): value is string => typeof value === 'string' && VIDEO_ID.test(value);

const YOUTUBE_HOSTS = new Set(['youtube.com', 'www.youtube.com', 'm.youtube.com', 'music.youtube.com', 'youtu.be', 'www.youtu.be']);

/**
 * The video id in what the owner pasted: a bare id, or a YouTube link (watch?v=, youtu.be/, /live/, /shorts/, /embed/). Anything else,
 * including a link to another site, gives null. Only https or http links on YouTube's own hosts count.
 */
export function videoIdFrom(input: string): string | null {
  const text = input.trim();
  if (isVideoId(text)) return text;
  let url: URL;
  try {
    url = new URL(/^[a-z]+:\/\//i.test(text) ? text : `https://${text}`);
  } catch {
    return null;
  }
  if (url.protocol !== 'https:' && url.protocol !== 'http:') return null;
  if (url.username || url.password || url.port) return null;
  const host = url.hostname.toLowerCase();
  if (!YOUTUBE_HOSTS.has(host)) return null;
  const parts = url.pathname.split('/').filter(Boolean);
  let id: string | null | undefined;
  if (host.endsWith('youtu.be')) id = parts.length === 1 ? parts[0] : null;
  else if (parts.length === 1 && parts[0] === 'watch') id = url.searchParams.get('v');
  else if (parts.length === 2 && ['live', 'shorts', 'embed'].includes(parts[0]!)) id = parts[1];
  return isVideoId(id) ? id : null;
}

// Control characters: C0, DEL and C1, plus the Unicode line and paragraph separators. Wider than strictly needed, so the form never
// accepts a title that the SQL check (`[[:cntrl:]]` under a UTF-8 locale) would refuse with a vague error.
// eslint-disable-next-line no-control-regex
const CONTROL = /[\u0000-\u001f\u007f-\u009f\u2028\u2029]/;

/** Characters as PostgreSQL length() counts them (code points), not UTF-16 units: an emoji counts as one. */
export const charCount = (text: string): number => [...text].length;

/** A real calendar date written YYYY-MM-DD (2026-02-30 is refused). */
export function isIsoDate(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const [y, m, d] = value.split('-').map(Number) as [number, number, number];
  const t = new Date(Date.UTC(y, m - 1, d));
  return t.getUTCFullYear() === y && t.getUTCMonth() === m - 1 && t.getUTCDate() === d;
}

/** What the admin form sends: the pin and each past stream as typed (a link or an id), empty text = not stated. */
export interface LiveEditInput {
  pinned: string | null;
  past: readonly { video: string; title: string; date: string | null }[];
}

export type LiveValidation = { ok: true; value: LiveSettings } | { ok: false; errors: Record<string, string> };

export const LIVE_MESSAGES = {
  pinned: 'Paste the YouTube link of the stream, or its 11-character video id. Leave it empty for no stream.',
  video: 'Paste the YouTube link of the video, or its 11-character video id.',
  twice: 'This video is listed twice.',
  title: `Type the title exactly as YouTube shows it (1 to ${LIVE_LIMITS.title} characters, one line).`,
  date: 'Write the date as YYYY-MM-DD, for example 2026-10-01, or leave it empty.',
  tooMany: `At most ${LIVE_LIMITS.pastStreams} past streams.`,
} as const;

/** Checks and cleans the owner's edit. Errors are keyed `pinned`, `form`, and `past.<n>.video|title|date` (n from 0). */
export function validateLiveEdit(input: LiveEditInput): LiveValidation {
  const errors: Record<string, string> = {};
  const pinnedText = (input.pinned ?? '').trim();
  const pinnedVideoId = pinnedText === '' ? null : videoIdFrom(pinnedText);
  if (pinnedText !== '' && pinnedVideoId === null) errors.pinned = LIVE_MESSAGES.pinned;
  if (input.past.length > LIVE_LIMITS.pastStreams) errors.form = LIVE_MESSAGES.tooMany;
  const seen = new Set<string>();
  const pastStreams: PastStream[] = [];
  input.past.forEach((row, i) => {
    const videoId = videoIdFrom(row.video ?? '');
    if (videoId === null) errors[`past.${i}.video`] = LIVE_MESSAGES.video;
    else if (seen.has(videoId)) errors[`past.${i}.video`] = LIVE_MESSAGES.twice;
    else seen.add(videoId);
    const title = (row.title ?? '').trim();
    if (charCount(title) < 1 || charCount(title) > LIVE_LIMITS.title || CONTROL.test(title)) errors[`past.${i}.title`] = LIVE_MESSAGES.title;
    const dateText = (row.date ?? '').trim();
    const date = dateText === '' ? null : dateText;
    if (date !== null && !isIsoDate(date)) errors[`past.${i}.date`] = LIVE_MESSAGES.date;
    if (videoId !== null) pastStreams.push({ videoId, title, date });
  });
  return Object.keys(errors).length > 0 ? { ok: false, errors } : { ok: true, value: { pinnedVideoId, pastStreams } };
}

/** The names of what changed (what the audit records; never a title). */
export function liveChanges(before: LiveSettings, after: LiveSettings): ('pinned' | 'past')[] {
  const out: ('pinned' | 'past')[] = [];
  if (before.pinnedVideoId !== after.pinnedVideoId) out.push('pinned');
  const same =
    before.pastStreams.length === after.pastStreams.length &&
    before.pastStreams.every((s, i) => {
      const t = after.pastStreams[i]!;
      return s.videoId === t.videoId && s.title === t.title && s.date === t.date;
    });
  if (!same) out.push('past');
  return out;
}

/** Problems with stored or owner-edited settings, as readable sentences (empty = fine). The /live page throws on them at build time. */
export function liveProblems(settings: LiveSettings): string[] {
  const problems: string[] = [];
  if (settings.pinnedVideoId !== null && !isVideoId(settings.pinnedVideoId)) {
    problems.push('pinnedVideoId must be the 11-character YouTube video id (letters, digits, - and _), or null.');
  }
  if (settings.pastStreams.length > LIVE_LIMITS.pastStreams) problems.push(`At most ${LIVE_LIMITS.pastStreams} past streams.`);
  const seen = new Set<string>();
  for (const stream of settings.pastStreams) {
    if (!isVideoId(stream.videoId)) problems.push(`Past stream "${stream.videoId}": the video id must be 11 characters (letters, digits, - and _).`);
    if (seen.has(stream.videoId)) problems.push(`Past stream "${stream.videoId}": listed twice.`);
    seen.add(stream.videoId);
    const title = stream.title;
    if (title.trim() === '' || title !== title.trim() || charCount(title) > LIVE_LIMITS.title || CONTROL.test(title)) {
      problems.push(`Past stream "${stream.videoId}": the title must be 1 to ${LIVE_LIMITS.title} characters on one line, with no spaces at either end.`);
    }
    if (stream.date !== null && !isIsoDate(stream.date)) problems.push(`Past stream "${stream.videoId}": the date must be YYYY-MM-DD or null.`);
  }
  return problems;
}
