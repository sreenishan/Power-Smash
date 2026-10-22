// /live (spec 7.13), the unblocked slice: what the owner pins by hand. NO API calls and no live data here. The later version reads the
// cached live status (RSS plus a targeted videos.list call, spec 7.13); until then the owner pastes a YouTube video id below and the
// page shows a click-to-load player for it. Empty by default: the player section is hidden until an id is set (D-034).
//
// How to pin a stream: set `pinnedVideoId` to the 11-character id from the video address (youtube.com/watch?v=<THIS PART>), build, deploy.
// Clear it (null) when the stream is over. `pastStreams` is optional: owner-picked ids with the title exactly as YouTube shows it.

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
  /** Older streams the owner wants listed. Empty = the section is hidden. */
  readonly pastStreams: readonly PastStream[];
}

export const live: LiveSettings = {
  pinnedVideoId: null,
  pastStreams: [],
};

/** YouTube video ids are exactly 11 characters from this set. */
const VIDEO_ID = /^[A-Za-z0-9_-]{11}$/;
export const isVideoId = (value: unknown): value is string => typeof value === 'string' && VIDEO_ID.test(value);

/** The privacy-enhanced embed address (no cookies until the visitor plays). The CSP allows exactly this host (src/lib/infra/headers.ts). */
export const YOUTUBE_EMBED_ORIGIN = 'https://www.youtube-nocookie.com';

export function embedUrl(videoId: string): string | null {
  return isVideoId(videoId) ? `${YOUTUBE_EMBED_ORIGIN}/embed/${videoId}?autoplay=1&rel=0&playsinline=1` : null;
}

/** The ordinary YouTube page for a video: the link for visitors without JavaScript, and the "Watch on YouTube" link. */
export function watchUrl(videoId: string): string | null {
  return isVideoId(videoId) ? `https://www.youtube.com/watch?v=${videoId}` : null;
}

/** Problems with the owner-edited settings, as readable sentences (empty = fine). The page throws on them at build time. */
export function liveProblems(settings: LiveSettings = live): string[] {
  const problems: string[] = [];
  if (settings.pinnedVideoId !== null && !isVideoId(settings.pinnedVideoId)) {
    problems.push('pinnedVideoId must be the 11-character YouTube video id (letters, digits, - and _), or null.');
  }
  const seen = new Set<string>();
  for (const stream of settings.pastStreams) {
    if (!isVideoId(stream.videoId)) problems.push(`Past stream "${stream.videoId}": the video id must be 11 characters (letters, digits, - and _).`);
    if (seen.has(stream.videoId)) problems.push(`Past stream "${stream.videoId}": listed twice.`);
    seen.add(stream.videoId);
    if (stream.title.trim() === '') problems.push(`Past stream "${stream.videoId}": the title is empty.`);
    if (stream.date !== null && !/^\d{4}-\d{2}-\d{2}$/.test(stream.date)) problems.push(`Past stream "${stream.videoId}": the date must be YYYY-MM-DD or null.`);
  }
  return problems;
}

export function assertValidLive(settings: LiveSettings = live): void {
  const problems = liveProblems(settings);
  if (problems.length > 0) throw new Error(`src/content/live.ts has problems:\n- ${problems.join('\n- ')}`);
}
