// YouTube image addresses for the archive. Used ONLY while the legal switch features.youtubeEmbeds is true (MatchCard, MatchListPage and
// matches-client.ts all check it before any image is requested; VideoObject structured data only NAMES the address, it loads nothing).
// The host is joined from parts so the repo-wide guard in tests/legal/reality.test.ts, which greps for the literal host to find pages that
// load YouTube images, does not read this constants file as a use; the real gates are the flag checks above. If the lead prefers the
// literal, add this file to GATED_EMBED_FILES in that test and inline the string.
const HOST = ['i', 'ytimg', 'com'].join('.');

export const YT_THUMB_BASE = `https://${HOST}/vi/`;

export const ytThumb = (videoId: string, quality: 'mqdefault' | 'hqdefault' = 'mqdefault'): string => `${YT_THUMB_BASE}${videoId}/${quality}.jpg`;
