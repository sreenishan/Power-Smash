// /live (spec 7.13): what the owner pins by hand. NO API calls and no live data here. The later version reads the cached live status
// (RSS plus a targeted videos.list call, spec 7.13). Empty by default: the player section is hidden until an id is set (D-034).
//
// Two sources (D-101), chosen at build time by src/lib/live/source.ts:
//   - this file (the default): set `pinnedVideoId` to the 11-character id from the video address (youtube.com/watch?v=<THIS PART>),
//     build, deploy; clear it (null) when the stream is over. `pastStreams` is optional: owner-picked ids with the title exactly as YouTube
//     shows it.
//   - the database (only when the build variable PS_LIVE_SOURCE is exactly "supabase"): the owner sets both from the admin Live screen.
// The rules for both live in src/lib/live/rules.ts (shared with the admin and the SQL in migration 0013).
import { liveProblems as problemsOf, type LiveSettings } from '../lib/live/rules';

export type { LiveSettings, PastStream } from '../lib/live/rules';
export { isVideoId } from '../lib/live/rules';
import { isVideoId } from '../lib/live/rules';

export const live: LiveSettings = {
  pinnedVideoId: null,
  pastStreams: [],
};

/** The privacy-enhanced embed address (no cookies until the visitor plays). The CSP allows exactly this host (src/lib/infra/headers.ts). */
export const YOUTUBE_EMBED_ORIGIN = 'https://www.youtube-nocookie.com';

export function embedUrl(videoId: string): string | null {
  return isVideoId(videoId) ? `${YOUTUBE_EMBED_ORIGIN}/embed/${videoId}?autoplay=1&rel=0&playsinline=1` : null;
}

/** The ordinary YouTube page for a video: the link for visitors without JavaScript, and the "Watch on YouTube" link. */
export function watchUrl(videoId: string): string | null {
  return isVideoId(videoId) ? `https://www.youtube.com/watch?v=${videoId}` : null;
}

/** Problems with the settings, as readable sentences (empty = fine). The page throws on them at build time. */
export function liveProblems(settings: LiveSettings = live): string[] {
  return problemsOf(settings);
}

export function assertValidLive(settings: LiveSettings = live, origin = 'src/content/live.ts'): void {
  const problems = liveProblems(settings);
  if (problems.length > 0) throw new Error(`${origin} has problems:\n- ${problems.join('\n- ')}`);
}
