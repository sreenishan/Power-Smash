// The sync rehearsal (--dry-run): real pipeline, in-memory stores, counts only. Fictional data only.
import { describe, expect, it } from 'vitest';
import { parseSyncArgs, runDryRun } from '../../src/lib/sync/dry-run';
import { QuotaLedger } from '../../src/lib/youtube/quota';
import { createYouTubeClient } from '../../src/lib/youtube/client';
import { CHANNEL_ID, Clock, FAKE_KEY, FakeYouTube, fictionalTitle, fictionalVideo } from './helpers';

const START = Date.parse('2026-10-22T06:00:00Z');

function rehearse(yt: FakeYouTube) {
  return runDryRun({
    channelId: CHANNEL_ID,
    now: new Clock(START).now,
    makeClient: (ledger: QuotaLedger) => createYouTubeClient({ apiKey: FAKE_KEY, fetch: yt.fetch, ledger, sleep: async () => undefined }),
  });
}

const catalogue = () => [
  fictionalVideo(1, fictionalTitle(['ARJUN VELMURUGAN'], ['DEVAN RAJAN'], { category: 'MS', round: 'QF' })),
  fictionalVideo(2, fictionalTitle(['ARJUN VELMURUGAN'], ['DEVAN RAJAN'], { category: 'MS', round: 'SF' })),
  fictionalVideo(3, fictionalTitle(['BALA MURUGAN', 'KIRAN MOHAN'], ['SURESH KANNAN', 'MANI SELVAN'], { category: 'MD', round: 'F' })),
  fictionalVideo(4, 'Fake smash drill compilation', { duration: 'PT2M30S' }),
  fictionalVideo(5, fictionalTitle(['SURESH KANNAN'], ['MANI SELVAN'], { tournament: 'Fake Cup U13 Badminton Tournament' })),
];

describe('runDryRun', () => {
  it('reports counts and the parse rate from the real pipeline, and only counts', async () => {
    const yt = new FakeYouTube(catalogue(), 50);
    const r = await rehearse(yt);
    expect(r.dryRun).toBe(true);
    expect(r.status).toBe('ok');
    expect(r.videos.total).toBe(5);
    expect(r.counts.inserted).toBe(5);
    expect(Object.values(r.videos.byType).reduce((a, b) => a + b, 0)).toBe(5);
    expect(Object.values(r.videos.byParseStatus).reduce((a, b) => a + b, 0)).toBe(5);
    expect(r.matchParseRatePercent).not.toBeNull();
    expect(r.quotaUnits).toBeGreaterThan(0);
    expect(r.entities.players).toBeGreaterThan(0);
    // the minor-signal title makes at least one player protected (D-012), and the count shows it
    expect(r.entities.protectedPlayers).toBeGreaterThan(0);
  });

  it('never carries a title, a name, a video id or a URL', async () => {
    const yt = new FakeYouTube(catalogue(), 50);
    const text = JSON.stringify(await rehearse(yt));
    for (const needle of ['ARJUN', 'VELMURUGAN', 'DEVAN', 'Fake Cup', 'smash drill', 'fake-f001', 'http']) expect(text, needle).not.toContain(needle);
  });

  it('only reads from YouTube (GET calls to the three read endpoints) and touches nothing else', async () => {
    const yt = new FakeYouTube(catalogue(), 2);
    await rehearse(yt);
    expect(yt.calls.length).toBeGreaterThan(0);
    for (const c of yt.calls) expect(['channels', 'playlistItems', 'videos']).toContain(c.endpoint);
  });

  it('reports a failed run honestly instead of throwing', async () => {
    const yt = new FakeYouTube(catalogue(), 50);
    yt.failures.push({ endpoint: 'videos', status: 403, reason: 'quotaExceeded', times: 99 });
    const r = await rehearse(yt);
    expect(r.status).not.toBe('ok');
    expect(r.videos.total).toBe(0);
    expect(r.matchParseRatePercent).toBeNull();
  });
});

describe('parseSyncArgs', () => {
  it('accepts a mode, with or without --dry-run for backfill', () => {
    expect(parseSyncArgs(['incremental'])).toEqual({ ok: true, mode: 'incremental', dryRun: false });
    expect(parseSyncArgs(['backfill', '--dry-run'])).toEqual({ ok: true, mode: 'backfill', dryRun: true });
    expect(parseSyncArgs(['--dry-run', 'backfill'])).toEqual({ ok: true, mode: 'backfill', dryRun: true });
  });
  it('refuses a dry run for any other mode, an unknown option, an unknown mode and a missing mode', () => {
    expect(parseSyncArgs(['purge', '--dry-run'])).toMatchObject({ ok: false });
    expect(parseSyncArgs(['backfill', '--wet'])).toMatchObject({ ok: false });
    expect(parseSyncArgs(['bogus'])).toMatchObject({ ok: false });
    expect(parseSyncArgs([])).toMatchObject({ ok: false });
    expect(parseSyncArgs(['backfill', 'incremental'])).toMatchObject({ ok: false });
  });
});
