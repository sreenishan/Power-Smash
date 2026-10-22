import { describe, expect, it } from 'vitest';
import { runSync } from '../../src/lib/sync/pipeline';
import { MemorySyncStore } from '../../src/lib/sync/memory-store';
import { purgeExpiredApiData } from '../../src/lib/sync/purge';
import { EMPTY_COUNTS, isRetiredVideo, type VideoRecord } from '../../src/lib/sync/types';
import type { ParseResult } from '../../src/lib/parser/types';
import { Clock, FAKE_KEY, FakeYouTube, makeDeps, matchVideo } from './helpers';

const START = Date.parse('2026-10-22T06:00:00Z');
const DAY = 24 * 60 * 60 * 1000;

function setup(videos = Array.from({ length: 5 }, (_, i) => matchVideo(i + 1)), pageSize = 2) {
  const yt = new FakeYouTube(videos, pageSize);
  const store = new MemorySyncStore();
  const clock = new Clock(START);
  return { yt, store, clock, deps: makeDeps(yt, store, clock) };
}

describe('backfill', () => {
  it('pages through the uploads playlist, batches videos.list and records the run', async () => {
    const { yt, store, deps } = setup();
    const s = await runSync('backfill', deps);
    expect(s.status).toBe('ok');
    expect(store.videos.size).toBe(5);
    expect(yt.count('playlistItems')).toBe(3);
    expect(yt.count('videos')).toBe(3);
    expect(yt.count('channels')).toBe(1);
    expect(s.quotaUnits).toBe(7);
    expect(s.counts).toMatchObject({ pages: 3, inserted: 5, fetched: 5 });
    expect(s.markedDirty).toBe(true);
    expect(store.state.dirtySince).not.toBeNull();
    expect(store.state.checkpoint).toBeNull();
    expect(store.state.uploadsPlaylistId).toBe('fake-uploads');
    expect(store.state.lastSyncOkAt).not.toBeNull();
    expect(store.state.recentKnownIds).toEqual(['fake-v001', 'fake-v002']); // first page, for the RSS detector
    expect(store.runs.get(s.runId)?.summary?.status).toBe('ok');
    const row = store.videos.get('fake-v001') as VideoRecord;
    expect(row.type).toBe('match');
    expect((row.parse_result as unknown as ParseResult).tournamentName).toBeTruthy();
    expect(row.views).toBe(100);
    expect(row.stats_fetched_at).toBe(new Date(START).toISOString());
    expect(row.visibility).toBe('public'); // a new Tamil Nadu match row is sent with its visibility
    expect(row.description).toBeNull();
  });

  it('resumes from the checkpoint after a partial failure', async () => {
    const { yt, store, deps } = setup();
    yt.failures.push({ endpoint: 'videos', status: 500, times: 99, after: 1 });
    const first = await runSync('backfill', deps);
    expect(first.status).toBe('partial');
    expect(first.resumable).toBe(true);
    expect(first.errorCode).toBe('youtube_api_500_backendError');
    expect(store.videos.size).toBe(2);
    expect(store.state.checkpoint?.nextPageToken).toBe('p2');
    expect(deps.notifier.messages).toHaveLength(1);
    expect(deps.notifier.messages[0]).toContain('continues where this one stopped');

    yt.failures.length = 0;
    yt.calls.length = 0;
    const second = await runSync('backfill', deps);
    expect(second.status).toBe('ok');
    expect(store.videos.size).toBe(5);
    expect(yt.count('channels')).toBe(0); // uploads playlist id was saved
    expect(yt.calls.filter((c) => c.endpoint === 'playlistItems').map((c) => c.params.get('pageToken'))).toEqual(['p2', 'p4']);
    expect(store.state.checkpoint).toBeNull();
  });

  it('survives a store failure mid-way (the run is recorded failed and resumable)', async () => {
    const { store, deps } = setup();
    store.failUpsertOnCall = 2;
    const s = await runSync('backfill', deps);
    expect(s.status).toBe('failed');
    expect(s.errorCode).toBe('internal_Error');
    expect(s.resumable).toBe(true);
    expect(store.videos.size).toBe(2);
  });

  it('stops with quota_exhausted when the fail-closed ledger limit is reached and tells the owner', async () => {
    const { store, deps } = setup();
    deps.quotaLimit = 3;
    const s = await runSync('backfill', deps);
    expect(s.status).toBe('quota_exhausted');
    expect(s.errorCode).toBe('youtube_quota_ledger');
    expect(s.quotaUnits).toBe(3);
    expect(s.resumable).toBe(true);
    expect(store.videos.size).toBe(2);
    expect(deps.notifier.messages[0]).toContain('daily limit');
  });

  it('treats Google answering quotaExceeded as quota_exhausted without retrying', async () => {
    const { yt, deps } = setup();
    yt.failures.push({ endpoint: 'playlistItems', status: 403, reason: 'quotaExceeded', times: 99 });
    const s = await runSync('backfill', deps);
    expect(s.status).toBe('quota_exhausted');
    expect(s.errorCode).toBe('youtube_quota_api');
    expect(yt.count('playlistItems')).toBe(1);
    expect(deps.sleeps).toEqual([]);
  });

  it('makes no call at all when earlier runs today already used the budget', async () => {
    const { yt, store, deps } = setup();
    const earlier = await store.startRun('incremental', new Date(START).toISOString());
    await store.finishRun(earlier, {
      runId: earlier, mode: 'incremental', status: 'ok', startedAt: '', finishedAt: '', quotaDay: '2026-10-21', quotaUnits: 3000,
      counts: { ...EMPTY_COUNTS },
      errorCode: null, markedDirty: false, resumable: false,
    });
    const s = await runSync('incremental', deps);
    expect(s.status).toBe('quota_exhausted');
    expect(yt.calls).toHaveLength(0);
  });

  it('fails the run (and retires nothing) when videos.list answers empty for many ids', async () => {
    const { yt, store, deps } = setup(Array.from({ length: 12 }, (_, i) => matchVideo(i + 1)), 50);
    await runSync('backfill', deps);
    expect(store.videos.size).toBe(12);
    yt.emptyVideosResponse = true;
    const s = await runSync('stats_all', deps);
    expect(s.status).toBe('failed'); // nothing was stored this run, so it counts as failed rather than partial
    expect(s.errorCode).toBe('suspicious_empty_response');
    expect([...store.videos.values()].filter(isRetiredVideo)).toHaveLength(0);
  });
});

describe('incremental', () => {
  it('stops at the first page containing a known id', async () => {
    const { yt, store, deps } = setup(Array.from({ length: 10 }, (_, i) => matchVideo(i + 10)), 2);
    await runSync('backfill', deps);
    store.state.dirtySince = null;
    yt.calls.length = 0;
    yt.videos = [matchVideo(1), matchVideo(2), matchVideo(3), ...yt.videos];
    const s = await runSync('incremental', deps);
    expect(s.status).toBe('ok');
    expect(s.counts.inserted).toBe(3);
    expect(yt.count('playlistItems')).toBe(2); // page 1 all new, page 2 has one new + one known -> stop
    expect(store.videos.size).toBe(13);
    expect(s.markedDirty).toBe(true);
    expect(store.state.recentKnownIds.slice(0, 2)).toEqual(['fake-v001', 'fake-v002']);
  });

  it('uses the first-page ETag: a 304 means nothing new, no videos.list call, no dirty flag', async () => {
    const { yt, store, deps } = setup();
    await runSync('backfill', deps);
    store.state.dirtySince = null;
    yt.calls.length = 0;
    const s = await runSync('incremental', deps);
    expect(s.status).toBe('ok');
    expect(yt.count('playlistItems')).toBe(1);
    expect(yt.calls[0]?.headers['if-none-match']).toBeTruthy();
    expect(yt.count('videos')).toBe(0);
    expect(s.markedDirty).toBe(false);
    expect(s.quotaUnits).toBe(1);
  });
});

describe('deleted, private, duplicate and suppressed videos', () => {
  it('retires videos that were deleted or made private upstream (stats_all): no delete privilege, title and statistics blanked', async () => {
    const { yt, store, deps } = setup();
    await runSync('backfill', deps);
    store.state.dirtySince = null;
    yt.videos[0]!.deleted = true;
    yt.videos[1]!.privacy = 'private';
    const s = await runSync('stats_all', deps);
    expect(s.counts.purged).toBe(2);
    expect([...store.videos.values()].filter(isRetiredVideo).map((v) => v.youtube_id).sort()).toEqual(['fake-v001', 'fake-v002']);
    const gone = store.videos.get('fake-v001') as VideoRecord;
    expect([gone.title_raw, gone.views, gone.stats_fetched_at, gone.parse_result, gone.visibility, gone.hidden_reason]).toEqual(['', null, null, null, 'hidden', 'removed_from_youtube']);
    expect(await store.listVideoIds()).toHaveLength(3); // retired rows are not refreshed again
    expect(s.markedDirty).toBe(true);
  });

  it('handles duplicate ids in the playlist: one row, duplicates counted', async () => {
    const dup = matchVideo(1);
    const { store, deps } = setup([dup, dup, matchVideo(2)], 50);
    const s = await runSync('backfill', deps);
    expect(store.videos.size).toBe(2);
    expect(s.counts.duplicates).toBeGreaterThanOrEqual(1);
  });

  it('never fetches or stores a suppressed video (tombstone), and never resurrects a retired one', async () => {
    const { yt, store, deps } = setup();
    store.suppressed.add('fake-v003');
    const s = await runSync('backfill', deps);
    expect(store.videos.has('fake-v003')).toBe(false);
    expect(s.counts.suppressedSkipped).toBe(1);
    const requested = yt.calls.filter((c) => c.endpoint === 'videos').flatMap((c) => (c.params.get('id') ?? '').split(','));
    expect(requested).not.toContain('fake-v003');
    // a second pass and a stats refresh still do not bring it back
    await runSync('incremental', deps);
    await runSync('stats_all', deps);
    expect(store.videos.has('fake-v003')).toBe(false);
  });

  it('counts a suppressed id as known for the incremental stop rule and the RSS known ids', async () => {
    const { yt, store, deps } = setup([matchVideo(1), matchVideo(2), matchVideo(3), matchVideo(4)], 2);
    store.suppressed.add('fake-v001');
    store.suppressed.add('fake-v002');
    const s = await runSync('incremental', deps);
    expect(yt.count('playlistItems')).toBe(1); // first page: both suppressed = known -> stop
    expect(s.counts.inserted).toBe(0);
    expect(store.state.recentKnownIds).toEqual(['fake-v001', 'fake-v002']);
  });
});

describe('upstream edits', () => {
  it('title edited upstream: raw title updated byte-exact, re-parsed, history kept, site marked dirty', async () => {
    const { yt, store, clock, deps } = setup();
    await runSync('backfill', deps);
    store.state.dirtySince = null;
    clock.advance(DAY);
    const edited = `${matchVideo(1).title.replace('Madurai', 'Salem')}  `;
    yt.videos[0]!.title = edited;
    const s = await runSync('stats_recent', deps);
    const row = store.videos.get('fake-v001') as VideoRecord;
    expect(row.title_raw).toBe(edited);
    expect((row.parse_result as unknown as ParseResult).locationHint).toBe('Salem');
    expect(store.titleHistory.filter((h) => h.youtube_id === 'fake-v001').map((h) => h.title_raw)).toEqual([matchVideo(1).title, edited]);
    expect(s.markedDirty).toBe(true);
  });

  it('a live stream that completed becomes a match with was_live, and the change marks the site dirty', async () => {
    const live = matchVideo(1, { live: 'live', duration: 'P0D' });
    const { store, clock, deps } = setup([live], 50);
    await runSync('backfill', deps);
    expect((store.videos.get('fake-v001') as VideoRecord).type).toBe('live');
    store.state.dirtySince = null;
    clock.advance(DAY);
    live.live = 'none';
    live.liveDetails = true;
    live.duration = 'PT3H';
    const s = await runSync('stats_recent', deps);
    const row = store.videos.get('fake-v001') as VideoRecord;
    expect(row.type).toBe('match');
    expect(row.live_status).toBe('completed');
    expect(row.was_live).toBe(true);
    expect(s.markedDirty).toBe(true);
  });

  it('a landscape clip under 180 s with no signal is flagged for review through the pipeline', async () => {
    const clip = { id: 'fake-clip1', title: 'Fake smash drill compilation', publishedAt: '2026-09-20T10:00:00Z', duration: 'PT2M30S' };
    const { store, deps } = setup([clip], 50);
    const s = await runSync('backfill', deps);
    const row = store.videos.get('fake-clip1') as VideoRecord;
    expect(row.type).toBe('short');
    expect(row.parse_status).toBe('needs_review');
    expect(row.review_reasons).toContain('SHORT_UNCERTAIN');
    expect(s.counts.needsReview).toBe(1);
  });
});

describe('manual overrides are sacred (spec 10.4, PC-20)', () => {
  it('never overwrites locked fields or visibility but still follows the raw title and statistics', async () => {
    const { yt, store, clock, deps } = setup([matchVideo(1)], 50);
    await runSync('backfill', deps);
    const row = store.videos.get('fake-v001') as VideoRecord;
    const parsedBefore = row.parse_result;
    row.type = 'other';
    row.visibility = 'hidden';
    row.hidden_reason = 'owner';
    row.manual_override = { type: true, visibility: true };
    store.state.dirtySince = null;
    clock.advance(DAY);
    yt.videos[0]!.title = matchVideo(1).title.replace('Madurai', 'Salem');
    yt.videos[0]!.views = 777;
    const s = await runSync('stats_recent', deps);
    const after = store.videos.get('fake-v001') as VideoRecord;
    expect(after.type).toBe('other');
    expect(after.visibility).toBe('hidden');
    expect(after.hidden_reason).toBe('owner');
    expect(after.manual_override).toEqual({ type: true, visibility: true });
    expect(after.parse_result).not.toEqual(parsedBefore); // parse data is not lockable: it follows the title
    expect(after.title_raw).toContain('Salem');
    expect(after.views).toBe(777);
    expect(after.override_stale).toBe(true); // a retitle under a lock asks the owner to re-confirm
    expect(s.markedDirty).toBe(false); // an owner-hidden video changing upstream does not rebuild the site
  });

  it('keeps a locked parse_status decision (owner cleared the review)', async () => {
    const { store, deps } = setup([{ id: 'fake-clip2', title: 'Fake smash drill compilation', publishedAt: '2026-09-20T10:00:00Z', duration: 'PT2M30S' }], 50);
    await runSync('backfill', deps);
    const row = store.videos.get('fake-clip2') as VideoRecord;
    row.parse_status = 'parsed';
    row.manual_override = { parse_status: true };
    await runSync('stats_all', deps);
    expect((store.videos.get('fake-clip2') as VideoRecord).parse_status).toBe('parsed');
  });

  it('sends visibility only for new rows, never for an existing one', async () => {
    const { store, clock, deps } = setup([matchVideo(1)], 50);
    const seen: { id: string; hasVisibility: boolean }[] = [];
    const original = store.upsertVideos.bind(store);
    store.upsertVideos = async (rows) => {
      for (const r of rows) seen.push({ id: r.youtube_id, hasVisibility: r.visibility !== undefined });
      return original(rows);
    };
    await runSync('backfill', deps);
    clock.advance(DAY);
    await runSync('stats_all', deps);
    expect(seen).toEqual([
      { id: 'fake-v001', hasVisibility: true },
      { id: 'fake-v001', hasVisibility: false },
    ]);
  });
});

describe('dirty flag', () => {
  it('view-count drift alone marks dirty at most once per 24 hours', async () => {
    const { yt, store, clock, deps } = setup([matchVideo(1)], 50);
    await runSync('backfill', deps);
    store.state.dirtySince = null;
    clock.advance(60 * 60 * 1000);
    yt.videos[0]!.views = 200;
    const first = await runSync('stats_recent', deps);
    expect(first.markedDirty).toBe(true);
    store.state.dirtySince = null;
    clock.advance(60 * 60 * 1000);
    yt.videos[0]!.views = 300;
    const second = await runSync('stats_recent', deps);
    expect(second.markedDirty).toBe(false);
    clock.advance(DAY);
    yt.videos[0]!.views = 400;
    expect((await runSync('stats_recent', deps)).markedDirty).toBe(true);
  });

  it('an unchanged refresh does not mark dirty', async () => {
    const { store, clock, deps } = setup([matchVideo(1)], 50);
    await runSync('backfill', deps);
    store.state.dirtySince = null;
    clock.advance(DAY);
    const s = await runSync('stats_recent', deps);
    expect(s.markedDirty).toBe(false);
    expect(s.counts.unchanged).toBe(1);
  });

  it('a new hidden (international) video does not mark dirty', async () => {
    const intl = { id: 'fake-intl1', title: 'ANTHONY SINISUKA GINTING (INA) vs KENTO MOMOTA (JPN) || BWF World Tour Finals 2026', publishedAt: '2026-09-20T10:00:00Z' };
    const { store, deps } = setup([intl], 50);
    const s = await runSync('backfill', deps);
    expect((store.videos.get('fake-intl1') as VideoRecord).visibility).toBe('hidden');
    expect((store.videos.get('fake-intl1') as VideoRecord).is_international).toBe(true);
    expect(s.markedDirty).toBe(false);
  });
});

describe('30-day stored-statistics rule (VF-C3, D-016)', () => {
  async function seeded() {
    const { yt, store, clock, deps } = setup([matchVideo(1), matchVideo(2), matchVideo(3)], 50);
    await runSync('backfill', deps);
    const iso = (days: number) => new Date(START - days * DAY).toISOString();
    const b = store.videos.get('fake-v002') as VideoRecord; // statistics 29 days old, row refreshed recently
    const c = store.videos.get('fake-v003') as VideoRecord; // whole row 30 days old
    b.stats_fetched_at = iso(29);
    c.stats_fetched_at = iso(30);
    c.last_synced_at = iso(30);
    return { yt, store, clock, deps };
  }

  it('purgeExpiredApiData nulls old statistics and retires rows not refreshed for 29+ days', async () => {
    const { store, clock } = await seeded();
    const r = await purgeExpiredApiData(store, clock.now());
    expect(r.rowsRetired).toEqual(['fake-v003']);
    expect(r.statsCleared).toBe(1);
    const gone = store.videos.get('fake-v003') as VideoRecord;
    expect(isRetiredVideo(gone)).toBe(true);
    expect(gone.visibility).toBe('hidden');
    expect((store.videos.get('fake-v002') as VideoRecord).views).toBeNull();
    expect((store.videos.get('fake-v001') as VideoRecord).views).not.toBeNull();
  });

  it('keeps data refreshed 27 days ago', async () => {
    const { store, clock } = await seeded();
    (store.videos.get('fake-v002') as VideoRecord).stats_fetched_at = new Date(START - 27 * DAY).toISOString();
    const r = await purgeExpiredApiData(store, clock.now());
    expect(r.statsCleared).toBe(0);
    expect((store.videos.get('fake-v002') as VideoRecord).views).not.toBeNull();
  });

  it('runs at the end of every run, even when the API is down, so stale data is retired', async () => {
    const { yt, store, deps } = await seeded();
    yt.failures.push({ endpoint: 'playlistItems', status: 500, times: 999 });
    const s = await runSync('incremental', deps);
    expect(s.status).toBe('failed');
    expect(isRetiredVideo(store.videos.get('fake-v003') as VideoRecord)).toBe(true);
    expect(s.counts.purged).toBe(1);
    expect(s.markedDirty).toBe(true);
  });

  it('a successful refresh re-stamps statistics, so nothing is purged', async () => {
    const { store, deps } = await seeded();
    await runSync('stats_all', deps);
    expect((store.videos.get('fake-v002') as VideoRecord).views).not.toBeNull();
    expect([...store.videos.values()].filter(isRetiredVideo)).toHaveLength(0);
  });
});

describe('alerts and logs', () => {
  it('failure alerts hold small codes only: no key, URL, title or body', async () => {
    const { yt, deps } = setup();
    yt.failures.push({ endpoint: 'videos', status: 500, times: 99 });
    const s = await runSync('backfill', deps);
    const text = deps.notifier.messages.join('\n');
    expect(s.status).not.toBe('ok');
    expect(text).not.toContain(FAKE_KEY);
    expect(text).not.toMatch(/https?:/);
    expect(text).not.toContain('Fake Cup');
    expect(text).toContain('youtube_api_500');
  });

  it('a successful run sends no alert', async () => {
    const { deps } = setup();
    await runSync('backfill', deps);
    expect(deps.notifier.messages).toHaveLength(0);
  });

  it('sums the quota units per Pacific quota day from sync_runs', async () => {
    const { store, deps } = setup();
    await runSync('backfill', deps);
    await runSync('incremental', deps);
    const total = [...store.runs.values()].reduce((n, r) => n + (r.summary?.quotaUnits ?? 0), 0);
    expect(await store.quotaUnitsForDay('2026-10-21')).toBe(total);
    expect(total).toBeGreaterThan(7);
  });
});
