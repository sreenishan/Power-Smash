import { describe, expect, it } from 'vitest';
import { deadManTriggered, mayMarkDirtyForDrift, nextDirtySince, shouldDispatchRebuild, REBUILD_DEBOUNCE_MS } from '../../src/lib/sync/dirty';
import { buildWorkflowDispatchRequest, handleScheduled, jobsForTime, parseRssEntries, type CronDeps } from '../../src/lib/sync/cron';
import { buildDeadManText, buildSyncFailureText, telegramNotifier } from '../../src/lib/sync/alerts';
import { EMPTY_COUNTS, EMPTY_SYNC_STATE, type SyncRunSummary, type SyncState } from '../../src/lib/sync/types';
import { CaptureNotifier } from './helpers';

const NOW = new Date('2026-10-22T06:00:00Z');
const ago = (ms: number) => new Date(NOW.getTime() - ms).toISOString();
const MIN = 60 * 1000;

describe('shouldDispatchRebuild (D-008, 10-minute debounce)', () => {
  it('does nothing when clean', () => {
    expect(shouldDispatchRebuild({ dirtySince: null, lastBuildStarted: null, now: NOW })).toEqual({ dispatch: false, reason: 'clean' });
  });
  it('dispatches when dirty and no build has ever started', () => {
    expect(shouldDispatchRebuild({ dirtySince: ago(MIN), lastBuildStarted: null, now: NOW })).toEqual({ dispatch: true });
  });
  it('waits while the last build started less than 10 minutes ago', () => {
    expect(shouldDispatchRebuild({ dirtySince: ago(MIN), lastBuildStarted: ago(REBUILD_DEBOUNCE_MS - 1), now: NOW })).toEqual({ dispatch: false, reason: 'debounce' });
  });
  it('dispatches at exactly 10 minutes', () => {
    expect(shouldDispatchRebuild({ dirtySince: ago(MIN), lastBuildStarted: ago(REBUILD_DEBOUNCE_MS), now: NOW })).toEqual({ dispatch: true });
  });
  it('does not dispatch while a build is running', () => {
    expect(shouldDispatchRebuild({ dirtySince: ago(MIN), lastBuildStarted: null, now: NOW, buildRunning: true })).toEqual({ dispatch: false, reason: 'build_running' });
  });
  it('treats a corrupt dirty timestamp as clean', () => {
    expect(shouldDispatchRebuild({ dirtySince: 'garbage', lastBuildStarted: null, now: NOW }).dispatch).toBe(false);
  });
});

describe('dirty helpers', () => {
  it('the first dirtying wins', () => {
    expect(nextDirtySince(null, NOW)).toBe(NOW.toISOString());
    expect(nextDirtySince(ago(5 * MIN), NOW)).toBe(ago(5 * MIN));
  });
  it('drift may dirty once per 24 hours', () => {
    expect(mayMarkDirtyForDrift(null, NOW)).toBe(true);
    expect(mayMarkDirtyForDrift(ago(23 * 60 * MIN), NOW)).toBe(false);
    expect(mayMarkDirtyForDrift(ago(24 * 60 * MIN), NOW)).toBe(true);
  });
  it('dead-man switch fires at 8 hours or never synced', () => {
    expect(deadManTriggered(ago(7 * 60 * MIN), NOW)).toBe(false);
    expect(deadManTriggered(ago(8 * 60 * MIN), NOW)).toBe(true);
    expect(deadManTriggered(null, NOW)).toBe(true);
  });
});

describe('cron job selection (one cron expression, three jobs)', () => {
  it.each([
    ['2026-10-22T06:00:00Z', ['dispatch', 'rss', 'deadman']],
    ['2026-10-22T06:05:00Z', ['dispatch']],
    ['2026-10-22T06:15:00Z', ['dispatch', 'rss']],
    ['2026-10-22T06:03:00Z', ['dispatch', 'deadman']],
  ])('%s', (iso, jobs) => expect(jobsForTime(new Date(iso))).toEqual(jobs));
});

const RSS = `<?xml version="1.0"?><feed xmlns:yt="http://www.youtube.com/xml/schemas/2015"><entry><yt:videoId>fake-r1</yt:videoId><link rel="alternate" href="https://www.youtube.com/watch?v=fake-r1"/></entry><entry><yt:videoId>fake-r2</yt:videoId><link rel="alternate" href="https://www.youtube.com/shorts/fake-r2"/></entry></feed>`;

describe('parseRssEntries', () => {
  it('reads ids and the shorts-or-watch link type', () => {
    expect(parseRssEntries(RSS)).toEqual([
      { videoId: 'fake-r1', linkType: 'watch' },
      { videoId: 'fake-r2', linkType: 'shorts' },
    ]);
  });
  it('never throws on junk', () => {
    expect(parseRssEntries('')).toEqual([]);
    expect(parseRssEntries('<entry><yt:videoId>bad id!</yt:videoId></entry>')).toEqual([]);
  });
});

function cronDeps(at: string, state: Partial<SyncState>, over: Partial<CronDeps> = {}) {
  const notifier = new CaptureNotifier();
  const dispatched: string[] = [];
  const deps: CronDeps = {
    now: new Date(at),
    loadState: async () => ({ ...EMPTY_SYNC_STATE, lastSyncOkAt: new Date(at).toISOString(), ...state }),
    dispatch: async (reason) => {
      dispatched.push(reason);
      return true;
    },
    fetchRss: async () => RSS,
    notifier,
    ...over,
  };
  return { deps, dispatched, notifier };
}

describe('handleScheduled', () => {
  it('dispatches a rebuild when dirty and the debounce has passed', async () => {
    const { deps, dispatched } = cronDeps('2026-10-22T06:05:00Z', { dirtySince: '2026-10-22T05:50:00Z', lastBuildStarted: '2026-10-22T05:40:00Z' });
    const out = await handleScheduled(deps);
    expect(out.dispatched).toEqual(['dirty']);
    expect(dispatched).toEqual(['dirty']);
  });

  it('respects the debounce', async () => {
    const { deps, dispatched } = cronDeps('2026-10-22T06:05:00Z', { dirtySince: '2026-10-22T05:50:00Z', lastBuildStarted: '2026-10-22T06:00:00Z' });
    await handleScheduled(deps);
    expect(dispatched).toEqual([]);
  });

  it('RSS with an unknown id dispatches a new_video sync once per tick', async () => {
    const { deps, dispatched } = cronDeps('2026-10-22T06:15:00Z', { recentKnownIds: ['fake-r1'], dirtySince: '2026-10-22T05:00:00Z' });
    const out = await handleScheduled(deps);
    expect(dispatched).toEqual(['new_video']);
    expect(out.dispatched).toEqual(['new_video']);
  });

  it('RSS with only known ids (including suppressed ones kept in known ids) dispatches nothing', async () => {
    const { deps, dispatched } = cronDeps('2026-10-22T06:15:00Z', { recentKnownIds: ['fake-r1', 'fake-r2'] });
    await handleScheduled(deps);
    expect(dispatched).toEqual([]);
  });

  it('an RSS failure is ignored (best-effort)', async () => {
    const { deps, dispatched } = cronDeps('2026-10-22T06:15:00Z', {}, { fetchRss: async () => null });
    await expect(handleScheduled(deps)).resolves.toBeTruthy();
    expect(dispatched).toEqual([]);
  });

  it('alerts the owner when there has been no good sync for 8 hours (top of the hour only)', async () => {
    const { deps, notifier } = cronDeps('2026-10-22T06:00:00Z', { lastSyncOkAt: '2026-10-21T21:00:00Z' });
    const out = await handleScheduled(deps);
    expect(out.deadManAlerted).toBe(true);
    expect(notifier.messages[0]).toContain('no successful YouTube sync');
    const later = cronDeps('2026-10-22T06:10:00Z', { lastSyncOkAt: '2026-10-21T21:00:00Z' });
    expect((await handleScheduled(later.deps)).deadManAlerted).toBe(false);
  });

  it('does not alert when the last sync is recent', async () => {
    const { deps, notifier } = cronDeps('2026-10-22T06:00:00Z', { lastSyncOkAt: '2026-10-22T04:00:00Z' });
    await handleScheduled(deps);
    expect(notifier.messages).toEqual([]);
  });
});

describe('workflow_dispatch request', () => {
  it('builds the GitHub request with the token only in the Authorization header', () => {
    const token = ['ghp', 'FAKE', 'token'].join('_');
    const { url, init } = buildWorkflowDispatchRequest({ owner: 'fake-owner', repo: 'fake-repo', workflowFile: 'deploy.yml', ref: 'main', token, inputs: { reason: 'dirty' } });
    expect(url).toBe('https://api.github.com/repos/fake-owner/fake-repo/actions/workflows/deploy.yml/dispatches');
    expect(url).not.toContain(token);
    expect((init.headers as Record<string, string>).authorization).toBe(`Bearer ${token}`);
    expect(JSON.parse(String(init.body))).toEqual({ ref: 'main', inputs: { reason: 'dirty' } });
  });
});

describe('alert text and notifier', () => {
  const summary: SyncRunSummary = {
    runId: 'run-9', mode: 'incremental', status: 'failed', startedAt: '', finishedAt: '', quotaDay: '2026-10-21', quotaUnits: 4,
    counts: { ...EMPTY_COUNTS, pages: 1 },
    errorCode: 'youtube_api_500', markedDirty: false, resumable: false,
  };
  it('plain text with the code and run id', () => {
    const t = buildSyncFailureText(summary);
    expect(t).toContain('run-9');
    expect(t).toContain('youtube_api_500');
    expect(buildDeadManText(null)).toContain('never');
  });
  it('the Telegram notifier swallows a failing sender and never throws', async () => {
    const n = telegramNotifier({ fetch: async () => { throw new Error('down'); }, token: 'fake', chatId: '1' });
    await expect(n.send('x')).resolves.toBeUndefined();
  });
  it('the Telegram notifier with no token sends nothing', async () => {
    let calls = 0;
    const n = telegramNotifier({ fetch: async () => { calls++; return new Response('{}'); }, token: null, chatId: null });
    await n.send('x');
    expect(calls).toBe(0);
  });
});
