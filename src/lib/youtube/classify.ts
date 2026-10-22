/**
 * Video classification (D-033, VF-C10, VF-C11, D-018). Pure functions.
 *
 * - LIVE: `snippet.liveBroadcastContent` of `live` or `upcoming` drives live status. `liveStreamingDetails` stays on a video
 *   after the stream ends, so its mere presence only sets `wasLive` / `liveStatus = completed`, never `live` (spec 10.6 was wrong).
 * - SHORTS: the Data API has no Shorts flag and "180 seconds or less" is wrong for landscape video (only square or vertical
 *   video up to 3 minutes is a Short since 2024-10-15). Signals, strongest first: membership of the UUSH (Shorts) playlist, an
 *   injected set; the RSS `/shorts/` link; UULF/UULV membership (then NOT a Short); the 180 s duration rule with a #shorts
 *   hashtag or no "vs". A short-length video with no playlist signal at all is flagged `shortUncertain` for review.
 * - INTERNATIONAL / broadcast: the parser's `isInternational` -> hidden by default, no entity rows (spec 10.6, D-018).
 * - NON-TAMIL-NADU domestic events (D-018) and events with NO detectable place (owner decision): listed, but no player pages and
 *   no tournament pages.
 *
 * The parser (src/lib/parser, `parseTitle`) is the only title reader; this file builds its context and interprets the result.
 */
import { parseIsoDuration } from './client';
import type { ApiVideo } from './types';
import { DISTRICT_NAMES, INDIAN_STATES } from '../parser/vocab';
import type { ParseContext, ParseResult, VideoType, LiveStatus } from '../parser/types';

/** Playlist membership signals, all optional; injected because `playlistItems.list` on UUSH/UULF/UULV is undocumented (VF-C10). */
export interface PlaylistSignals {
  shortsIds?: ReadonlySet<string>;
  longFormIds?: ReadonlySet<string>;
  liveIds?: ReadonlySet<string>;
  /** Ids whose RSS entry link was `/shorts/{id}` (the 15 newest only). */
  rssShortsIds?: ReadonlySet<string>;
}

export type Visibility = 'public' | 'hidden' | 'listed_no_player_pages';
export type EventScope = 'tamil_nadu' | 'non_tamil_nadu' | 'unknown';

export function playlistOf(id: string, s: PlaylistSignals | undefined): ParseContext['playlist'] {
  if (!s) return null;
  if (s.shortsIds?.has(id)) return 'UUSH';
  if (s.liveIds?.has(id)) return 'UULV';
  if (s.longFormIds?.has(id)) return 'UULF';
  return null;
}

export function buildParseContext(video: ApiVideo, signals?: PlaylistSignals): ParseContext {
  const lbc = video.snippet?.liveBroadcastContent;
  const rss = signals?.rssShortsIds?.has(video.id) ? 'shorts' : null;
  return {
    durationSeconds: parseIsoDuration(video.contentDetails?.duration),
    liveBroadcastContent: lbc === 'live' || lbc === 'upcoming' || lbc === 'none' ? lbc : null,
    hasLiveStreamingDetails: video.liveStreamingDetails !== undefined,
    playlist: playlistOf(video.id, signals),
    rssLinkType: rss,
    publishedAt: video.snippet?.publishedAt ?? null,
  };
}

/** Where the event is held (D-018). Uses only the parser's canonical location and explicit state words. */
export function eventScope(parse: ParseResult): EventScope {
  const loc = parse.locationHint;
  if (loc) return DISTRICT_NAMES.has(loc) ? 'tamil_nadu' : 'non_tamil_nadu';
  const words = parse.normalizedTitle.toLowerCase();
  if (/\ball india\b|\bnational ranking\b|\bnationals?\b/u.test(words)) return 'non_tamil_nadu';
  for (const state of INDIAN_STATES) {
    if (state === 'tamil nadu' || state === 'tamilnadu' || state === 'services' || state === 'railways' || state === 'petroleum') continue;
    if (new RegExp(`\\b${state}\\b`, 'u').test(words)) return 'non_tamil_nadu';
  }
  if (/\btamil ?nadu\b/u.test(words)) return 'tamil_nadu';
  return 'unknown';
}

export interface Classification {
  videoType: VideoType;
  liveStatus: LiveStatus;
  wasLive: boolean;
  visibility: Visibility;
  hiddenReason: 'international' | 'not_public' | null;
  scope: EventScope;
  /** Short-length video with no playlist or hashtag signal: the 180 s rule alone is not trusted for landscape video. */
  shortUncertain: boolean;
}

/** Combine the API video, the parser output and the signals into the stored classification. */
export function classifyVideo(video: ApiVideo, parse: ParseResult, ctx: ParseContext): Classification {
  const lbc = ctx.liveBroadcastContent;
  const liveNow = lbc === 'live' || lbc === 'upcoming';
  const scope = eventScope(parse);
  const duration = ctx.durationSeconds;
  const hasShortsTag = parse.signals.includes('shorts');
  const noSignal = ctx.playlist === null && ctx.rssLinkType === null;
  const shortUncertain = !liveNow && typeof duration === 'number' && duration > 0 && duration <= 180 && noSignal && !hasShortsTag;

  const videoType: VideoType = liveNow ? 'live' : parse.videoType;
  let visibility: Visibility = 'public';
  let hiddenReason: Classification['hiddenReason'] = null;
  const privacy = video.status?.privacyStatus;
  if (parse.isInternational || parse.entityCreation === 'blocked' && parse.entityBlockReason === 'INTERNATIONAL') {
    visibility = 'hidden';
    hiddenReason = 'international';
  } else if (privacy === 'unlisted') {
    visibility = 'hidden';
    hiddenReason = 'not_public';
  } else if (scope !== 'tamil_nadu' && videoType === 'match') {
    // D-018 and the owner's answer: a match whose event is outside Tamil Nadu, or whose place cannot be detected, is LISTED but
    // gets no player or tournament pages. Only a detected Tamil Nadu event gets them.
    visibility = 'listed_no_player_pages';
  }
  return {
    videoType,
    liveStatus: parse.liveStatus,
    wasLive: ctx.hasLiveStreamingDetails === true,
    visibility,
    hiddenReason,
    scope,
    shortUncertain,
  };
}
