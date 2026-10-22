/**
 * Dirty-flag and rebuild-trigger logic (D-008) as pure functions.
 *
 * - "Public content changed" marks the site dirty (see record.ts `affectsPublicSite`); view-count drift alone marks it at
 *   most once per 24 hours.
 * - The dispatcher (a Worker cron, every 5 minutes) calls GitHub workflow_dispatch when the site is dirty AND the last build
 *   started at least 10 minutes ago.
 * - Dead-man switch: alert when there has been no successful sync for 8 hours.
 */
export const REBUILD_DEBOUNCE_MS = 10 * 60 * 1000;
export const DRIFT_DIRTY_INTERVAL_MS = 24 * 60 * 60 * 1000;
export const DEAD_MAN_AFTER_MS = 8 * 60 * 60 * 1000;

const ms = (iso: string | null): number | null => {
  if (iso === null) return null;
  const t = Date.parse(iso);
  return Number.isNaN(t) ? null : t;
};

export interface DirtyInputs {
  dirtySince: string | null;
  lastBuildStarted: string | null;
  now: Date;
  /** True while a build is known to be running (the concurrency group serialises anyway). */
  buildRunning?: boolean;
}

export type DispatchDecision = { dispatch: true } | { dispatch: false; reason: 'clean' | 'debounce' | 'build_running' };

export function shouldDispatchRebuild(i: DirtyInputs): DispatchDecision {
  if (ms(i.dirtySince) === null) return { dispatch: false, reason: 'clean' };
  if (i.buildRunning === true) return { dispatch: false, reason: 'build_running' };
  const last = ms(i.lastBuildStarted);
  if (last !== null && i.now.getTime() - last < REBUILD_DEBOUNCE_MS) return { dispatch: false, reason: 'debounce' };
  return { dispatch: true };
}

/** First dirtying wins: a later change never moves dirty_since forward (the workflow clears it only if it was not set again). */
export function nextDirtySince(current: string | null, now: Date): string {
  return ms(current) !== null ? (current as string) : now.toISOString();
}

export function mayMarkDirtyForDrift(lastDriftDirtyAt: string | null, now: Date): boolean {
  const last = ms(lastDriftDirtyAt);
  return last === null || now.getTime() - last >= DRIFT_DIRTY_INTERVAL_MS;
}

export function deadManTriggered(lastSyncOkAt: string | null, now: Date): boolean {
  const last = ms(lastSyncOkAt);
  return last === null || now.getTime() - last >= DEAD_MAN_AFTER_MS;
}
