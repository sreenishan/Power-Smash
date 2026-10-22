// Test helpers for the sync: a fake YouTube Data API server (mocked fetch) and a manual clock. FICTIONAL data only: ids start
// with `fake-`, names and tournaments are invented. The API key is a run-time-built fake so secret scanners stay quiet.
import { QuotaLedger } from '../../src/lib/youtube/quota';
import { createYouTubeClient } from '../../src/lib/youtube/client';
import type { SyncDeps } from '../../src/lib/sync/pipeline';
import { MemorySyncStore } from '../../src/lib/sync/memory-store';
import type { Notifier } from '../../src/lib/sync/types';

export const FAKE_KEY = ['AIza', 'FAKE', 'unit', 'test', 'key'].join('-');
export const CHANNEL_ID = 'fake-channel';
export const UPLOADS = 'fake-uploads';

export interface FakeVideo {
  id: string;
  title: string;
  publishedAt: string;
  duration?: string;
  live?: 'none' | 'upcoming' | 'live';
  liveDetails?: boolean;
  views?: number;
  privacy?: 'public' | 'unlisted' | 'private';
  /** Not in the uploads playlist any more (deleted). */
  deleted?: boolean;
}

export interface FailureRule {
  endpoint: 'channels' | 'playlistItems' | 'videos';
  status: number;
  reason?: string;
  times: number;
  /** Skip this many matching calls first. */
  after?: number;
}

export interface FakeCall {
  endpoint: string;
  params: URLSearchParams;
  headers: Record<string, string>;
}

export class FakeYouTube {
  videos: FakeVideo[];
  pageSize: number;
  failures: FailureRule[] = [];
  calls: FakeCall[] = [];
  networkErrors = 0;
  emptyVideosResponse = false;

  constructor(videos: FakeVideo[], pageSize = 50) {
    this.videos = videos;
    this.pageSize = pageSize;
  }

  count(endpoint: string): number {
    return this.calls.filter((c) => c.endpoint === endpoint).length;
  }

  readonly fetch: typeof fetch = async (input, init) => {
    const url = new URL(String(input));
    const endpoint = url.pathname.split('/').pop() ?? '';
    const headers = Object.fromEntries(Object.entries((init?.headers ?? {}) as Record<string, string>).map(([k, v]) => [k.toLowerCase(), v]));
    this.calls.push({ endpoint, params: url.searchParams, headers });
    if (this.networkErrors > 0) {
      this.networkErrors--;
      throw new TypeError('network down');
    }
    for (const f of this.failures) {
      if (f.endpoint !== endpoint || f.times <= 0) continue;
      if ((f.after ?? 0) > 0) {
        f.after = (f.after ?? 0) - 1;
        continue;
      }
      f.times--;
      return json({ error: { code: f.status, errors: [{ reason: f.reason ?? 'backendError' }] } }, f.status);
    }
    if (headers['x-goog-api-key'] !== FAKE_KEY) return json({ error: { code: 400, errors: [{ reason: 'keyInvalid' }] } }, 400);

    if (endpoint === 'channels') {
      return json({ kind: 'youtube#channelListResponse', items: [{ id: CHANNEL_ID, contentDetails: { relatedPlaylists: { uploads: UPLOADS } } }] }, 200, 'W/"ch-1"');
    }
    if (endpoint === 'playlistItems') {
      const listed = this.videos.filter((v) => !v.deleted);
      const offset = Number((url.searchParams.get('pageToken') ?? 'p0').slice(1));
      const slice = listed.slice(offset, offset + this.pageSize);
      const etag = `W/"pl-${offset}-${slice.map((v) => v.id).join('.')}"`;
      if (headers['if-none-match'] === etag) return new Response(null, { status: 304 });
      const next = offset + this.pageSize < listed.length ? `p${offset + this.pageSize}` : undefined;
      return json(
        {
          kind: 'youtube#playlistItemListResponse',
          nextPageToken: next,
          pageInfo: { totalResults: listed.length, resultsPerPage: this.pageSize },
          items: slice.map((v) => ({ kind: 'youtube#playlistItem', contentDetails: { videoId: v.id, videoPublishedAt: v.publishedAt } })),
        },
        200,
        etag,
      );
    }
    if (endpoint === 'videos') {
      const ids = (url.searchParams.get('id') ?? '').split(',');
      if (ids.length > 50) return json({ error: { code: 400, errors: [{ reason: 'tooManyIds' }] } }, 400);
      if (this.emptyVideosResponse) return json({ kind: 'youtube#videoListResponse', items: [] }, 200);
      const items = ids.flatMap((id) => {
        const v = this.videos.find((x) => x.id === id);
        if (!v || v.deleted || v.privacy === 'private') return [];
        return [
          {
            kind: 'youtube#video',
            id: v.id,
            snippet: { publishedAt: v.publishedAt, channelId: CHANNEL_ID, title: v.title, liveBroadcastContent: v.live ?? 'none' },
            contentDetails: { duration: v.duration ?? 'PT1H2M3S' },
            statistics: { viewCount: String(v.views ?? 100) },
            ...(v.liveDetails || v.live === 'live' || v.live === 'upcoming' ? { liveStreamingDetails: { actualStartTime: v.publishedAt } } : {}),
            status: { privacyStatus: v.privacy ?? 'public', embeddable: true, madeForKids: false },
          },
        ];
      });
      return json({ kind: 'youtube#videoListResponse', items }, 200);
    }
    return json({ error: { code: 404 } }, 404);
  };
}

function json(body: unknown, status: number, etag?: string): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json', ...(etag ? { etag } : {}) } });
}

export function matchVideo(n: number, over: Partial<FakeVideo> = {}): FakeVideo {
  const day = String(28 - (n % 28)).padStart(2, '0');
  return {
    id: `fake-v${String(n).padStart(3, '0')}`,
    title: `ARJUN VEL${n}/BALA MURUGAN vs DEVAN RAJ/KIRAN MOHAN || Fake Cup Open Badminton Tournament 2026 - Madurai`,
    publishedAt: `2026-09-${day}T10:00:00Z`,
    ...over,
  };
}

export class Clock {
  constructor(private t: number) {}
  now = (): Date => new Date(this.t);
  advance(ms: number): void {
    this.t += ms;
  }
}

export class CaptureNotifier implements Notifier {
  messages: string[] = [];
  async send(text: string): Promise<void> {
    this.messages.push(text);
  }
}

export function makeDeps(yt: FakeYouTube, store: MemorySyncStore, clock: Clock, extra: Partial<SyncDeps> = {}): Omit<SyncDeps, 'notifier'> & { sleeps: number[]; notifier: CaptureNotifier } {
  const sleeps: number[] = [];
  const notifier = new CaptureNotifier();
  return {
    ...extra,
    store,
    channelId: CHANNEL_ID,
    now: clock.now,
    notifier,
    sleeps,
    makeClient: (ledger: QuotaLedger) =>
      createYouTubeClient({ apiKey: FAKE_KEY, fetch: yt.fetch, ledger, sleep: async (ms) => void sleeps.push(ms) }),
  };
}

// ---------------------------------------------------------------------------
// Fictional catalogue helpers for the identity and end-to-end tests (invented names and events, ids start `fake-`)
// ---------------------------------------------------------------------------
import { buildFreshRecord, materialise } from '../../src/lib/sync/record';
import type { VideoRecord } from '../../src/lib/sync/types';

export interface TitleOptions {
  category?: string;
  round?: string;
  tournament?: string;
  year?: number | null;
  /** Place after the dash; null = no place in the title. */
  place?: string | null;
}

/** "ARJUN VELMURUGAN vs DEVAN RAJAN | MS | Final || Fake Cup Open Badminton Tournament 2026 - Madurai" */
export function fictionalTitle(sideA: string[], sideB: string[], o: TitleOptions = {}): string {
  const mid = [o.category, o.round].filter(Boolean);
  const year = o.year === null ? '' : ` ${o.year ?? 2026}`;
  const place = o.place === null ? '' : ` - ${o.place ?? 'Madurai'}`;
  return `${sideA.join('/')} vs ${sideB.join('/')}${mid.length > 0 ? ` | ${mid.join(' | ')}` : ''} || ${o.tournament ?? 'Fake Cup Open Badminton Tournament'}${year}${place}`;
}

export const NOW = new Date('2026-10-22T06:00:00Z');

/** A stored video row built exactly as the sync would store it (fresh API record, materialised). */
export function storedVideo(id: string, title: string, over: Partial<VideoRecord> = {}): VideoRecord {
  const w = buildFreshRecord(
    {
      id,
      snippet: { publishedAt: '2026-09-10T10:00:00Z', channelId: CHANNEL_ID, title, liveBroadcastContent: 'none' },
      contentDetails: { duration: 'PT1H2M3S' },
      statistics: { viewCount: '10' },
      status: { privacyStatus: 'public', embeddable: true },
    },
    NOW,
  );
  return { ...materialise(null, w, NOW.toISOString()), ...over };
}

export function fictionalVideo(n: number, title: string, over: Partial<FakeVideo> = {}): FakeVideo {
  const day = String(1 + (n % 27)).padStart(2, '0');
  return { id: `fake-f${String(n).padStart(3, '0')}`, title, publishedAt: `2026-09-${day}T10:00:00Z`, ...over };
}
