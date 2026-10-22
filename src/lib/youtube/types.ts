/**
 * YouTube Data API v3 response shapes (only the fields the sync reads). Written from the official reference
 * (https://developers.google.com/youtube/v3/docs/videos, /playlistItems, /channels); every field is optional because the API
 * omits fields freely (a private video returns no snippet to an API key, statistics can be hidden, ...).
 * Numbers such as viewCount arrive as STRINGS.
 */
export interface ApiChannel {
  id: string;
  etag?: string;
  contentDetails?: { relatedPlaylists?: { uploads?: string } };
  statistics?: { subscriberCount?: string; hiddenSubscriberCount?: boolean; videoCount?: string; viewCount?: string };
}

export interface ApiPlaylistItem {
  id?: string;
  contentDetails?: { videoId?: string; videoPublishedAt?: string };
  snippet?: { resourceId?: { videoId?: string }; title?: string };
}

export interface ApiPlaylistPage {
  etag?: string;
  nextPageToken?: string;
  pageInfo?: { totalResults?: number; resultsPerPage?: number };
  items?: ApiPlaylistItem[];
}

export interface ApiVideo {
  id: string;
  etag?: string;
  snippet?: {
    publishedAt?: string;
    channelId?: string;
    title?: string;
    description?: string;
    liveBroadcastContent?: 'none' | 'upcoming' | 'live';
  };
  contentDetails?: {
    duration?: string; // ISO 8601, PT1H2M3S
    regionRestriction?: { allowed?: string[]; blocked?: string[] };
    contentRating?: { ytRating?: string };
  };
  statistics?: { viewCount?: string; likeCount?: string; commentCount?: string };
  liveStreamingDetails?: { actualStartTime?: string; actualEndTime?: string; scheduledStartTime?: string };
  status?: { privacyStatus?: 'public' | 'unlisted' | 'private'; embeddable?: boolean; madeForKids?: boolean; uploadStatus?: string };
}

export interface ApiVideoList {
  etag?: string;
  items?: ApiVideo[];
}

export type ApiResult<T> = { notModified: true; etag: string | null } | { notModified: false; etag: string | null; data: T };
