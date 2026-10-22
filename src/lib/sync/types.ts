/**
 * Sync contracts (spec 10, D-008, D-016, D-033): row types and the store interface the pipeline runs against.
 *
 * The stored video is the SCHEMA worker's `VideoRow` (src/lib/archive/types.ts, migration 0004): the sync no longer has a
 * private row type. What the sync WRITES is `VideoWrite` (VideoUpsert plus an optional first-insert hidden reason).
 */
import type { VideoRow, VideoUpsert } from '../archive/types';
import type { ReviewReason } from '../parser/types';

/** A stored video (the real table row). */
export type VideoRecord = VideoRow;

/**
 * What the sync sends. `visibility` and `hidden_reason` are present ONLY for a brand-new row (the database default is
 * `hidden`, SA-M31); the store never sends them for an existing row (the sync never changes visibility, the owner's admin does).
 */
export type VideoWrite = VideoUpsert & { hidden_reason?: string | null };

/** Review reasons added by the sync, not by the parser (the DB column is plain text[]). */
export type SyncReviewReason = ReviewReason | 'SHORT_UNCERTAIN';

/** Reasons the identity step adds after the parse; carried across re-syncs so a re-sync does not flap them. */
export const IDENTITY_REVIEW_REASONS = ['AMBIGUOUS_ALIAS'] as const satisfies readonly ReviewReason[];

/** Owner locks (`videos.manual_override`, PC-20) that the sync honours. */
export const VIDEO_LOCKS = ['type', 'parse_status', 'is_international', 'visibility'] as const;

/** A retired video (deleted or private upstream, or API data older than the 30-day limit): the title text is gone. */
export const isRetiredVideo = (v: Pick<VideoRow, 'title_raw'>): boolean => v.title_raw === '';

export interface SyncCheckpoint {
  mode: 'backfill';
  /** Page token of the NEXT page to fetch. */
  nextPageToken: string | null;
  pagesDone: number;
  startedAt: string;
}

/** Singleton state (the sync part of D-008's `site_state`). */
export interface SyncState {
  uploadsPlaylistId: string | null;
  channelEtag: string | null;
  /** Etag of the first uploads page, for the "anything new?" 304 shortcut. */
  playlistFirstPageEtag: string | null;
  checkpoint: SyncCheckpoint | null;
  dirtySince: string | null;
  lastBuildStarted: string | null;
  lastSyncOkAt: string | null;
  /** Last time view-count drift alone marked the site dirty (at most once per 24 h, D-008). */
  lastDriftDirtyAt: string | null;
  /** Newest known video ids, for the RSS detector (D-008 `known_video_ids`). */
  recentKnownIds: string[];
}

export const EMPTY_SYNC_STATE: SyncState = {
  uploadsPlaylistId: null,
  channelEtag: null,
  playlistFirstPageEtag: null,
  checkpoint: null,
  dirtySince: null,
  lastBuildStarted: null,
  lastSyncOkAt: null,
  lastDriftDirtyAt: null,
  recentKnownIds: [],
};

export type SyncMode = 'backfill' | 'incremental' | 'stats_recent' | 'stats_all' | 'purge' | 'reparse';
export type SyncStatus = 'ok' | 'partial' | 'failed' | 'quota_exhausted';

export interface SyncCounts {
  pages: number;
  fetched: number;
  inserted: number;
  updated: number;
  unchanged: number;
  suppressedSkipped: number;
  duplicates: number;
  purged: number;
  statsCleared: number;
  needsReview: number;
  playersCreated: number;
  tournamentsCreated: number;
  matchesWritten: number;
  duplicateCandidates: number;
}

export const EMPTY_COUNTS: SyncCounts = {
  pages: 0,
  fetched: 0,
  inserted: 0,
  updated: 0,
  unchanged: 0,
  suppressedSkipped: 0,
  duplicates: 0,
  purged: 0,
  statsCleared: 0,
  needsReview: 0,
  playersCreated: 0,
  tournamentsCreated: 0,
  matchesWritten: 0,
  duplicateCandidates: 0,
};

export interface SyncRunSummary {
  runId: string;
  mode: SyncMode;
  status: SyncStatus;
  startedAt: string;
  finishedAt: string;
  quotaDay: string;
  quotaUnits: number;
  counts: SyncCounts;
  /** Small code only (never a URL, header or body). */
  errorCode: string | null;
  markedDirty: boolean;
  /** True when a later backfill will continue from a saved checkpoint. */
  resumable: boolean;
}

export interface SyncStore {
  loadState(): Promise<SyncState>;
  saveState(patch: Partial<SyncState>): Promise<void>;
  /** Existing rows for these ids (any order). */
  getVideos(ids: readonly string[]): Promise<VideoRow[]>;
  /** Insert or update by `youtube_id`. Rows with `visibility` are inserts; rows without it are updates (never changes visibility). */
  upsertVideos(rows: readonly VideoWrite[]): Promise<void>;
  /** All known ids (retired rows excluded), optionally only those published at or after the instant (adapters paginate, 1,000-row cap). */
  listVideoIds(filter?: { publishedAfter?: string }): Promise<string[]>;
  /** Ids on the ACTIVE suppression list (takedown tombstones, D-014): never re-created. */
  getSuppressedIds(ids: readonly string[]): Promise<Set<string>>;
  /**
   * Retire rows (deleted or private upstream, or older than the 30-day limit). service_role has NO delete privilege on videos (D-014),
   * so the row is hidden and every API-derived value is blanked instead (VF-C3): title, statistics, description, thumbnail, parse result.
   */
  retireVideos(ids: readonly string[], at: string): Promise<void>;
  /** Null the statistics of rows fetched before the cutoff; returns how many. */
  clearStatisticsBefore(cutoff: string): Promise<number>;
  /** Ids (not retired) whose last API refresh is before the cutoff. */
  listIdsNotRefreshedSince(cutoff: string): Promise<string[]>;
  /** Marks the site dirty (SQL `admin_mark_dirty`; the table triggers also do it for content changes). */
  markDirty(at: string): Promise<void>;
  quotaUnitsForDay(quotaDay: string): Promise<number>;
  startRun(mode: SyncMode, startedAt: string): Promise<string>;
  finishRun(runId: string, summary: SyncRunSummary): Promise<void>;
}

/** Owner alert sink (Telegram in production). Must never throw into the pipeline. */
export interface Notifier {
  send(text: string): Promise<void>;
}
