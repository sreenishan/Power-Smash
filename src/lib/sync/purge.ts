/**
 * The 30-day stored-API-data rule (VF-C3, D-016): data fetched with a plain API key may be stored "not longer than 30 calendar
 * days", then it must be refreshed or deleted (III.E.4.d); hiding it is not enough. The sync refreshes all videos weekly and
 * recent ones daily, so anything older than the thresholds below means a refresh failed, and it is deleted:
 *   - statistics older than 28 days are nulled (2 days of margin before day 30);
 *   - rows whose whole API data was not refreshed for 29 days are RETIRED (1 day of margin): service_role has no delete
 *     privilege on videos (D-014), so the row is hidden and the title, statistics, description, thumbnail and parse result are
 *     blanked. The insert-only `video_title_history` still holds old titles: see docs/m2/sync2-notes.md (request to SCHEMA).
 */
import type { SyncStore } from './types';

export const STATS_MAX_AGE_DAYS = 28;
export const ROW_MAX_AGE_DAYS = 29;
const DAY = 24 * 60 * 60 * 1000;

export interface PurgeResult {
  statsCleared: number;
  rowsRetired: string[];
}

export async function purgeExpiredApiData(store: SyncStore, now: Date): Promise<PurgeResult> {
  const rowCutoff = new Date(now.getTime() - ROW_MAX_AGE_DAYS * DAY).toISOString();
  const statsCutoff = new Date(now.getTime() - STATS_MAX_AGE_DAYS * DAY).toISOString();
  const stale = await store.listIdsNotRefreshedSince(rowCutoff);
  if (stale.length > 0) await store.retireVideos(stale, now.toISOString());
  const statsCleared = await store.clearStatisticsBefore(statsCutoff);
  return { statsCleared, rowsRetired: stale };
}
