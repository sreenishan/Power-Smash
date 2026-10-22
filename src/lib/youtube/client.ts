/**
 * YouTube Data API v3 client over an injected `fetch` (D-033). Three endpoints only: channels.list, playlistItems.list
 * (uploads playlist) and videos.list (50 ids per call). No search.list.
 *
 * Secret hygiene (D-027): the API key is sent in the `x-goog-api-key` header (Google documents this alongside `?key=`), so it
 * is never part of a URL that could end up in a log or an error. Errors carry only a status and a reason code, never a URL,
 * a header or a body.
 *
 * ETags: pass the stored etag as `If-None-Match`; a 304 comes back as `{ notModified: true }` (and still costs a quota unit).
 * Retries: network errors, 429, 5xx and 403 rateLimitExceeded/userRateLimitExceeded back off exponentially with an injected
 * `sleep` (500 ms, 1 s, 2 s, ... capped); 403 quotaExceeded is never retried.
 */
import { QuotaExceededError, type QuotaLedger, type QuotaMethod } from './quota';
import type { ApiChannel, ApiPlaylistPage, ApiResult, ApiVideo, ApiVideoList } from './types';

export const YOUTUBE_API_BASE = 'https://www.googleapis.com/youtube/v3';
export const VIDEOS_PER_BATCH = 50;
export const PLAYLIST_PAGE_SIZE = 50;
export const VIDEO_PARTS = 'snippet,contentDetails,statistics,liveStreamingDetails,status';

export class YouTubeApiError extends Error {
  readonly status: number;
  readonly reason: string | null;
  constructor(status: number, reason: string | null) {
    super(`youtube_api_${status}${reason ? `_${reason}` : ''}`);
    this.name = 'YouTubeApiError';
    this.status = status;
    this.reason = reason;
  }
}

export interface YouTubeClientOptions {
  apiKey: string;
  fetch: typeof fetch;
  ledger: QuotaLedger;
  sleep: (ms: number) => Promise<void>;
  /** 0..1, for jitter; default no jitter (deterministic). */
  random?: () => number;
  maxRetries?: number;
  baseDelayMs?: number;
  maxDelayMs?: number;
}

const RETRYABLE_REASONS = new Set(['rateLimitExceeded', 'userRateLimitExceeded', 'backendError', 'internalError']);

export interface VideoBatchResult {
  items: ApiVideo[];
  /** Requested ids the API did not return: deleted, private or never existed. */
  missingIds: string[];
  /** Ids requested twice or more (each is fetched once). */
  duplicateIds: string[];
}

export interface YouTubeClient {
  getChannel(channelId: string, etag?: string | null): Promise<ApiResult<ApiChannel | null>>;
  listPlaylistPage(playlistId: string, opts?: { pageToken?: string | null; etag?: string | null }): Promise<ApiResult<ApiPlaylistPage>>;
  getVideos(ids: readonly string[]): Promise<VideoBatchResult>;
}

/** PT1H2M3S -> seconds; null when absent or malformed (P0D is what live streams in progress report). */
export function parseIsoDuration(value: string | undefined | null): number | null {
  if (!value) return null;
  const m = /^P(?:(\d+)D)?(?:T(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?)?$/u.exec(value);
  if (!m) return null;
  const [, d, h, mi, s] = m;
  return Number(d ?? 0) * 86400 + Number(h ?? 0) * 3600 + Number(mi ?? 0) * 60 + Number(s ?? 0);
}

export function chunk<T>(items: readonly T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
  return out;
}

export function createYouTubeClient(opts: YouTubeClientOptions): YouTubeClient {
  const maxRetries = opts.maxRetries ?? 4;
  const base = opts.baseDelayMs ?? 500;
  const maxDelay = opts.maxDelayMs ?? 30_000;
  const random = opts.random ?? (() => 0);

  async function request<T>(method: QuotaMethod, endpoint: string, params: Record<string, string>, etag?: string | null): Promise<ApiResult<T>> {
    const qs = new URLSearchParams(params).toString();
    const url = `${YOUTUBE_API_BASE}/${endpoint}?${qs}`;
    let failure: YouTubeApiError | null = null;
    for (let attempt = 0; attempt <= maxRetries; attempt++) {
      if (attempt > 0) await opts.sleep(Math.min(base * 2 ** (attempt - 1), maxDelay) + Math.floor(random() * 250));
      opts.ledger.charge(method); // throws QuotaExceededError('ledger') before the call
      const headers: Record<string, string> = { accept: 'application/json', 'x-goog-api-key': opts.apiKey };
      if (etag) headers['if-none-match'] = etag;
      let res: Response;
      try {
        res = await opts.fetch(url, { method: 'GET', headers });
      } catch {
        failure = new YouTubeApiError(0, 'network');
        continue;
      }
      if (res.status === 304) return { notModified: true, etag: etag ?? null };
      if (res.ok) {
        const data = (await res.json()) as T & { etag?: string };
        return { notModified: false, etag: res.headers.get('etag') ?? data.etag ?? null, data };
      }
      let reason: string | null = null;
      try {
        const body = (await res.json()) as { error?: { errors?: { reason?: unknown }[] } };
        const r = body.error?.errors?.[0]?.reason;
        reason = typeof r === 'string' ? r.slice(0, 60) : null;
      } catch {
        // not JSON
      }
      if (res.status === 403 && (reason === 'quotaExceeded' || reason === 'dailyLimitExceeded')) throw new QuotaExceededError('api');
      const retryable = res.status === 429 || res.status >= 500 || (res.status === 403 && reason !== null && RETRYABLE_REASONS.has(reason));
      failure = new YouTubeApiError(res.status, reason);
      if (!retryable) throw failure;
    }
    throw failure ?? new YouTubeApiError(0, 'unknown');
  }

  return {
    async getChannel(channelId, etag) {
      const r = await request<{ items?: ApiChannel[] }>('channelsList', 'channels', { part: 'contentDetails,statistics', id: channelId }, etag);
      if (r.notModified) return r;
      return { notModified: false, etag: r.etag, data: r.data.items?.[0] ?? null };
    },

    listPlaylistPage(playlistId, o = {}) {
      const params: Record<string, string> = { part: 'contentDetails', playlistId, maxResults: String(PLAYLIST_PAGE_SIZE) };
      if (o.pageToken) params.pageToken = o.pageToken;
      return request<ApiPlaylistPage>('playlistItemsList', 'playlistItems', params, o.etag);
    },

    async getVideos(ids) {
      const seen = new Set<string>();
      const duplicateIds: string[] = [];
      for (const id of ids) {
        if (seen.has(id)) {
          if (!duplicateIds.includes(id)) duplicateIds.push(id);
        } else seen.add(id);
      }
      const unique = [...seen];
      const items: ApiVideo[] = [];
      const returned = new Set<string>();
      for (const batch of chunk(unique, VIDEOS_PER_BATCH)) {
        const r = await request<ApiVideoList>('videosList', 'videos', { part: VIDEO_PARTS, id: batch.join(','), maxResults: String(VIDEOS_PER_BATCH) });
        if (r.notModified) continue; // cannot happen: no etag is sent for batches
        for (const v of r.data.items ?? []) {
          if (!v.id || returned.has(v.id)) continue;
          returned.add(v.id);
          items.push(v);
        }
      }
      return { items, missingIds: unique.filter((id) => !returned.has(id)), duplicateIds };
    },
  };
}
