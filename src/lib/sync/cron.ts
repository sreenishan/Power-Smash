/**
 * Cron handler shape (D-008, VF-A29) as PURE functions over injected dependencies.
 *
 * NOT WIRED (Vercel port, 2026-10-22): the parked Vercel Cron route is scripts/sync-worker/vercel-cron.ts (copy it to
 * src/pages/api/cron/sync.ts only when features.youtubeApiData is true, and add the `crons` entry to vercel.json). Every-5-minutes
 * needs the Vercel Pro plan (Hobby cron: once a day). Untested against the real runtime.
 *
 * One cron expression (`*\/5 * * * *`) serves three jobs by the minute of the hour:
 *   dispatch  every 5 minutes: dirty and last build started 10+ minutes ago -> GitHub workflow_dispatch
 *   rss       minute % 15 == 0: channel RSS ids compared with known ids; a new id -> dispatch a sync-and-deploy
 *   deadman   minute < 5 (once an hour): no successful sync for 8 hours -> owner alert
 * Keep the RSS parse a single regex pass (parseRssEntries); the route is called with GET and must finish well inside the function limit.
 */
import { buildDeadManText } from './alerts';
import { deadManTriggered, shouldDispatchRebuild } from './dirty';
import type { Notifier, SyncState } from './types';

export const CRON_EXPRESSION = '*/5 * * * *';
export type CronJob = 'dispatch' | 'rss' | 'deadman';

export function jobsForTime(at: Date): CronJob[] {
  const minute = at.getUTCMinutes();
  const jobs: CronJob[] = ['dispatch'];
  if (minute % 15 === 0) jobs.push('rss');
  if (minute < 5) jobs.push('deadman');
  return jobs;
}

export interface RssEntry {
  videoId: string;
  /** From the entry link: `/shorts/{id}` for a Short (VF-C10), else `/watch?v={id}`. */
  linkType: 'shorts' | 'watch';
}

/** Minimal Atom reader for the channel feed (15 newest entries). Never throws. */
export function parseRssEntries(xml: string): RssEntry[] {
  const out: RssEntry[] = [];
  const entryRe = /<entry>([\s\S]*?)<\/entry>/gu;
  for (let m = entryRe.exec(xml); m !== null; m = entryRe.exec(xml)) {
    const body = m[1] ?? '';
    const id = /<yt:videoId>([A-Za-z0-9_-]{1,64})<\/yt:videoId>/u.exec(body)?.[1];
    if (!id) continue;
    const href = /<link[^>]*\bhref="([^"]*)"/u.exec(body)?.[1] ?? '';
    out.push({ videoId: id, linkType: href.includes('/shorts/') ? 'shorts' : 'watch' });
  }
  return out;
}

export interface WorkflowDispatchTarget {
  owner: string;
  repo: string;
  workflowFile: string;
  ref: string;
  /** The Vercel project secret REBUILD_DISPATCH_TOKEN (Actions: write on this one repo, D-008, OT-42). Never logged. */
  token: string;
  inputs?: Record<string, string>;
}

/** GitHub "Create a workflow dispatch event" (needs only Actions: write; D-008, VF-A32). */
export function buildWorkflowDispatchRequest(t: WorkflowDispatchTarget): { url: string; init: RequestInit } {
  return {
    url: `https://api.github.com/repos/${encodeURIComponent(t.owner)}/${encodeURIComponent(t.repo)}/actions/workflows/${encodeURIComponent(t.workflowFile)}/dispatches`,
    init: {
      method: 'POST',
      headers: {
        accept: 'application/vnd.github+json',
        authorization: `Bearer ${t.token}`,
        'x-github-api-version': '2022-11-28',
        'user-agent': 'power-smash-cron',
        'content-type': 'application/json',
      },
      body: JSON.stringify({ ref: t.ref, inputs: t.inputs ?? {} }),
    },
  };
}

export interface CronDeps {
  now: Date;
  loadState: () => Promise<SyncState>;
  /** Calls workflow_dispatch; resolves true when GitHub accepted (204). Must not throw. */
  dispatch: (reason: 'dirty' | 'new_video') => Promise<boolean>;
  /** Returns the RSS XML, or null on any failure (RSS is best-effort and never fails anything, D-008). */
  fetchRss: () => Promise<string | null>;
  notifier: Notifier;
}

export interface CronOutcome {
  jobs: CronJob[];
  dispatched: ('dirty' | 'new_video')[];
  deadManAlerted: boolean;
}

export async function handleScheduled(d: CronDeps): Promise<CronOutcome> {
  const jobs = jobsForTime(d.now);
  const out: CronOutcome = { jobs, dispatched: [], deadManAlerted: false };
  const state = await d.loadState();

  if (jobs.includes('rss')) {
    const xml = await d.fetchRss();
    if (xml !== null) {
      const known = new Set(state.recentKnownIds);
      const fresh = parseRssEntries(xml).some((e) => !known.has(e.videoId));
      if (fresh && (await d.dispatch('new_video'))) out.dispatched.push('new_video');
    }
  }
  if (jobs.includes('dispatch') && !out.dispatched.includes('new_video')) {
    const decision = shouldDispatchRebuild({ dirtySince: state.dirtySince, lastBuildStarted: state.lastBuildStarted, now: d.now });
    if (decision.dispatch && (await d.dispatch('dirty'))) out.dispatched.push('dirty');
  }
  if (jobs.includes('deadman') && deadManTriggered(state.lastSyncOkAt, d.now)) {
    await d.notifier.send(buildDeadManText(state.lastSyncOkAt));
    out.deadManAlerted = true;
  }
  return out;
}
