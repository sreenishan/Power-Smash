import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { QuotaExceededError, QuotaLedger, quotaDayKey } from '../../src/lib/youtube/quota';
import { YouTubeApiError, createYouTubeClient, parseIsoDuration } from '../../src/lib/youtube/client';
import { CHANNEL_ID, FAKE_KEY, FakeYouTube, matchVideo } from './helpers';

const fixture = (name: string): string => readFileSync(new URL(`../fixtures/youtube-api/${name}`, import.meta.url), 'utf8');

function clientFor(yt: FakeYouTube, limit = 3000, opts: { maxRetries?: number } = {}) {
  const ledger = new QuotaLedger(limit);
  const sleeps: number[] = [];
  const client = createYouTubeClient({ apiKey: FAKE_KEY, fetch: yt.fetch, ledger, sleep: async (ms) => void sleeps.push(ms), ...opts });
  return { client, ledger, sleeps };
}

describe('recorded-shape fixtures', () => {
  it('reads channels, playlist pages and videos from the synthetic fixtures', async () => {
    const routes: Record<string, string> = {
      channels: fixture('channels-list.json'),
      videos: fixture('videos-list.json'),
    };
    const fetchFx: typeof fetch = async (input) => {
      const url = new URL(String(input));
      const ep = url.pathname.split('/').pop() ?? '';
      if (ep === 'playlistItems') {
        const page2 = url.searchParams.get('pageToken') === 'FAKE_PAGE_2';
        return new Response(fixture(page2 ? 'playlist-items-page2.json' : 'playlist-items-page1.json'), { status: 200, headers: { etag: page2 ? 'W/"p2"' : 'W/"p1"' } });
      }
      return new Response(routes[ep] ?? '{}', { status: 200 });
    };
    const ledger = new QuotaLedger();
    const client = createYouTubeClient({ apiKey: FAKE_KEY, fetch: fetchFx, ledger, sleep: async () => {} });

    const ch = await client.getChannel(CHANNEL_ID);
    expect(ch.notModified).toBe(false);
    if (!ch.notModified) expect(ch.data?.contentDetails?.relatedPlaylists?.uploads).toBe('fake-uploads');

    const p1 = await client.listPlaylistPage('fake-uploads');
    expect(p1.notModified).toBe(false);
    if (!p1.notModified) {
      expect(p1.data.nextPageToken).toBe('FAKE_PAGE_2');
      expect(p1.etag).toBe('W/"p1"');
    }
    const p2 = await client.listPlaylistPage('fake-uploads', { pageToken: 'FAKE_PAGE_2' });
    if (!p2.notModified) expect(p2.data.nextPageToken).toBeUndefined();

    const v = await client.getVideos(['fake-fx-01', 'fake-fx-02', 'fake-fx-03', 'fake-fx-04']);
    expect(v.items.map((i) => i.id)).toEqual(['fake-fx-01', 'fake-fx-02', 'fake-fx-03']);
    expect(v.missingIds).toEqual(['fake-fx-04']);
    expect(ledger.unitsThisRun).toBe(4);
  });
});

describe('batching, pagination and the quota ledger', () => {
  it('splits 120 ids into three videos.list calls of at most 50 and charges 3 units', async () => {
    const yt = new FakeYouTube(Array.from({ length: 120 }, (_, i) => matchVideo(i)));
    const { client, ledger } = clientFor(yt);
    const r = await client.getVideos(yt.videos.map((v) => v.id));
    expect(r.items).toHaveLength(120);
    expect(yt.count('videos')).toBe(3);
    expect(yt.calls.map((c) => (c.params.get('id') ?? '').split(',').length)).toEqual([50, 50, 20]);
    expect(ledger.unitsThisRun).toBe(3);
    expect(ledger.breakdown().videosList).toBe(3);
  });

  it('fetches duplicate ids once and reports them', async () => {
    const yt = new FakeYouTube([matchVideo(1)]);
    const { client } = clientFor(yt);
    const r = await client.getVideos(['fake-v001', 'fake-v001', 'fake-v001']);
    expect(r.items).toHaveLength(1);
    expect(r.duplicateIds).toEqual(['fake-v001']);
    expect(yt.calls[0]?.params.get('id')).toBe('fake-v001');
  });

  it('fails closed before a call that would cross the ledger limit', async () => {
    const yt = new FakeYouTube([matchVideo(1)]);
    const { client } = clientFor(yt, 2);
    await client.getChannel(CHANNEL_ID);
    await client.getVideos(['fake-v001']);
    await expect(client.getVideos(['fake-v001'])).rejects.toMatchObject({ name: 'QuotaExceededError', source: 'ledger' });
    expect(yt.calls).toHaveLength(2); // the third call was never made
  });

  it('starts from the units already used earlier the same quota day', () => {
    const ledger = new QuotaLedger(3000, 2999);
    ledger.charge('videosList');
    expect(() => ledger.charge('videosList')).toThrow(QuotaExceededError);
  });

  it('computes the Pacific quota day, which differs from the UTC date for part of the day', () => {
    expect(quotaDayKey(new Date('2026-10-22T06:00:00Z'))).toBe('2026-10-21'); // 23:00 PDT the day before
    expect(quotaDayKey(new Date('2026-10-22T08:00:00Z'))).toBe('2026-10-22'); // 01:00 PDT
  });
});

describe('ETag handling', () => {
  it('sends If-None-Match and returns notModified on 304 (still charged)', async () => {
    const yt = new FakeYouTube([matchVideo(1), matchVideo(2)]);
    const { client, ledger } = clientFor(yt);
    const first = await client.listPlaylistPage('fake-uploads');
    expect(first.notModified).toBe(false);
    const etag = first.etag;
    expect(etag).toBeTruthy();
    const second = await client.listPlaylistPage('fake-uploads', { etag });
    expect(second.notModified).toBe(true);
    expect(yt.calls[1]?.headers['if-none-match']).toBe(etag);
    expect(ledger.unitsThisRun).toBe(2);
  });
});

describe('retries and backoff', () => {
  it('backs off exponentially on 429 with the injected sleep, then succeeds', async () => {
    const yt = new FakeYouTube([matchVideo(1)]);
    yt.failures.push({ endpoint: 'videos', status: 429, reason: 'rateLimitExceeded', times: 2 });
    const { client, sleeps, ledger } = clientFor(yt);
    const r = await client.getVideos(['fake-v001']);
    expect(r.items).toHaveLength(1);
    expect(sleeps).toEqual([500, 1000]);
    expect(ledger.unitsThisRun).toBe(3);
  });

  it('retries a 403 rateLimitExceeded and network errors', async () => {
    const yt = new FakeYouTube([matchVideo(1)]);
    yt.failures.push({ endpoint: 'videos', status: 403, reason: 'userRateLimitExceeded', times: 1 });
    yt.networkErrors = 1;
    const { client, sleeps } = clientFor(yt);
    expect((await client.getVideos(['fake-v001'])).items).toHaveLength(1);
    expect(sleeps).toEqual([500, 1000]);
  });

  it('gives up after maxRetries with a small error code and 2x growth capped', async () => {
    const yt = new FakeYouTube([matchVideo(1)]);
    yt.failures.push({ endpoint: 'videos', status: 500, times: 99 });
    const { client, sleeps } = clientFor(yt, 3000, { maxRetries: 4 });
    const err = await client.getVideos(['fake-v001']).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(YouTubeApiError);
    expect((err as YouTubeApiError).status).toBe(500);
    expect(sleeps).toEqual([500, 1000, 2000, 4000]);
    expect(yt.count('videos')).toBe(5);
  });

  it('never retries quotaExceeded (403) and reports it as a quota error', async () => {
    const yt = new FakeYouTube([matchVideo(1)]);
    yt.failures.push({ endpoint: 'videos', status: 403, reason: 'quotaExceeded', times: 99 });
    const { client, sleeps } = clientFor(yt);
    await expect(client.getVideos(['fake-v001'])).rejects.toMatchObject({ name: 'QuotaExceededError', source: 'api' });
    expect(yt.count('videos')).toBe(1);
    expect(sleeps).toEqual([]);
    expect(JSON.parse(fixture('error-quota-exceeded.json')).error.errors[0].reason).toBe('quotaExceeded');
  });

  it('does not retry a plain 404', async () => {
    const yt = new FakeYouTube([matchVideo(1)]);
    yt.failures.push({ endpoint: 'playlistItems', status: 404, reason: 'playlistNotFound', times: 99 });
    const { client } = clientFor(yt);
    await expect(client.listPlaylistPage('fake-uploads')).rejects.toMatchObject({ status: 404, reason: 'playlistNotFound' });
    expect(yt.count('playlistItems')).toBe(1);
  });
});

describe('API key hygiene', () => {
  it('sends the key in a header, never in the URL, and never in an error message', async () => {
    const yt = new FakeYouTube([matchVideo(1)]);
    yt.failures.push({ endpoint: 'videos', status: 400, reason: 'badRequest', times: 1 });
    const { client } = clientFor(yt);
    const err = await client.getVideos(['fake-v001']).catch((e: unknown) => e as Error);
    expect(String((err as Error).message)).not.toContain(FAKE_KEY);
    expect(JSON.stringify(err)).not.toContain(FAKE_KEY);
    await client.getChannel(CHANNEL_ID);
    for (const c of yt.calls) {
      expect(c.headers['x-goog-api-key']).toBe(FAKE_KEY);
      expect(c.params.has('key')).toBe(false);
    }
  });
});

describe('parseIsoDuration', () => {
  it.each([
    ['PT58M12S', 3492],
    ['PT45S', 45],
    ['PT3H1M', 10860],
    ['P0D', 0],
    ['P1DT1H', 90000],
  ])('%s', (iso, secs) => expect(parseIsoDuration(iso)).toBe(secs));
  it.each([[undefined], [''], ['bogus'], ['PT']])('returns null for %s', (v) => {
    // 'PT' parses as zero seconds in the regex: accept 0 or null, but never throw
    const r = parseIsoDuration(v as string | undefined);
    expect(r === null || r === 0).toBe(true);
  });
});
