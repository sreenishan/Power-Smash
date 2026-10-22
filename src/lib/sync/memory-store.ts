/**
 * In-memory SyncStore for tests and local dry runs (fictional data only). It mimics what the database does around the sync
 * (migrations 0004 and 0005): a NEW row starts `hidden` unless the write says otherwise, an existing row's visibility and locks
 * are never changed by a sync write, locked fields are put back, a suppressed video stays hidden, a retitle adds a history entry.
 */
import {
  EMPTY_SYNC_STATE,
  isRetiredVideo,
  type SyncMode,
  type SyncRunSummary,
  type SyncState,
  type SyncStore,
  type VideoRecord,
  type VideoWrite,
} from './types';

export class MemorySyncStore implements SyncStore {
  readonly videos = new Map<string, VideoRecord>();
  /** Active youtube_id tombstones (D-014). */
  readonly suppressed = new Set<string>();
  readonly titleHistory: { youtube_id: string; title_raw: string }[] = [];
  readonly runs = new Map<string, { mode: SyncMode; startedAt: string; summary: SyncRunSummary | null }>();
  state: SyncState = { ...EMPTY_SYNC_STATE };
  /** Test hook: throw on the Nth upsertVideos call (1-based). */
  failUpsertOnCall: number | null = null;
  private upsertCalls = 0;
  private runSeq = 0;

  async loadState(): Promise<SyncState> {
    return structuredClone(this.state);
  }
  async saveState(patch: Partial<SyncState>): Promise<void> {
    this.state = { ...this.state, ...structuredClone(patch) };
  }
  async getVideos(ids: readonly string[]): Promise<VideoRecord[]> {
    return ids.flatMap((id) => {
      const r = this.videos.get(id);
      return r ? [structuredClone(r)] : [];
    });
  }

  async upsertVideos(rows: readonly VideoWrite[]): Promise<void> {
    this.upsertCalls++;
    if (this.failUpsertOnCall === this.upsertCalls) throw new Error('memory_store_forced_failure');
    for (const w of rows) {
      const old = this.videos.get(w.youtube_id);
      const at = w.last_synced_at ?? '1970-01-01T00:00:00.000Z';
      const { visibility, hidden_reason, ...cols } = w;
      const next: VideoRecord = old
        ? ({ ...old, ...structuredClone(cols), updated_at: at } as VideoRecord)
        : ({
            ...structuredClone(cols),
            visibility: visibility ?? 'hidden',
            hidden_reason: hidden_reason ?? null,
            hidden_at: null,
            manual_override: {},
            override_stale: false,
            created_at: at,
            updated_at: at,
          } as VideoRecord);
      if (old) {
        // field locks (PC-20, trigger videos_guard): a locked field is put back; the sync never changes the locks or visibility
        const lock = old.manual_override;
        if (lock.type) next.type = old.type;
        if (lock.parse_status) next.parse_status = old.parse_status;
        if (lock.is_international) next.is_international = old.is_international;
        next.manual_override = old.manual_override;
        next.visibility = old.visibility;
        next.hidden_reason = old.hidden_reason;
        next.hidden_at = old.hidden_at;
        if (cols.title_raw !== old.title_raw && Object.keys(lock).length > 0) next.override_stale = true;
      }
      if (this.suppressed.has(next.youtube_id)) {
        next.visibility = 'hidden';
        next.hidden_reason ??= 'suppressed';
      }
      if (!old && next.is_international && next.visibility !== 'hidden') {
        next.visibility = 'hidden';
        next.hidden_reason ??= 'international';
      }
      if (next.visibility === 'hidden') {
        if (next.hidden_reason !== null && next.hidden_at === null) next.hidden_at = at;
      } else {
        next.hidden_reason = null;
        next.hidden_at = null;
      }
      if (!old || old.title_raw !== next.title_raw) this.titleHistory.push({ youtube_id: next.youtube_id, title_raw: next.title_raw });
      this.videos.set(next.youtube_id, next);
    }
  }

  async listVideoIds(filter?: { publishedAfter?: string }): Promise<string[]> {
    const after = filter?.publishedAfter ? Date.parse(filter.publishedAfter) : null;
    return [...this.videos.values()]
      .filter((v) => !isRetiredVideo(v))
      .filter((v) => after === null || (v.published_at !== null && Date.parse(v.published_at) >= after))
      .map((v) => v.youtube_id);
  }
  async getSuppressedIds(ids: readonly string[]): Promise<Set<string>> {
    return new Set(ids.filter((id) => this.suppressed.has(id)));
  }
  async retireVideos(ids: readonly string[], at: string): Promise<void> {
    for (const id of ids) {
      const v = this.videos.get(id);
      if (!v) continue;
      v.title_raw = '';
      v.title_normalized = '';
      v.description = null;
      v.views = null;
      v.likes = null;
      v.stats_fetched_at = null;
      v.thumbnail_url = null;
      v.parse_result = null;
      v.visibility = 'hidden';
      v.hidden_reason = 'removed_from_youtube';
      v.hidden_at = at;
    }
  }
  async clearStatisticsBefore(cutoff: string): Promise<number> {
    let n = 0;
    for (const v of this.videos.values()) {
      if (v.stats_fetched_at !== null && v.stats_fetched_at < cutoff) {
        v.views = null;
        v.likes = null;
        v.stats_fetched_at = null;
        n++;
      }
    }
    return n;
  }
  async listIdsNotRefreshedSince(cutoff: string): Promise<string[]> {
    return [...this.videos.values()].filter((v) => !isRetiredVideo(v) && v.last_synced_at !== null && v.last_synced_at < cutoff).map((v) => v.youtube_id);
  }
  async markDirty(at: string): Promise<void> {
    if (this.state.dirtySince === null) this.state = { ...this.state, dirtySince: at };
  }
  async quotaUnitsForDay(quotaDay: string): Promise<number> {
    let n = 0;
    for (const r of this.runs.values()) if (r.summary?.quotaDay === quotaDay) n += r.summary.quotaUnits;
    return n;
  }
  async startRun(mode: SyncMode, startedAt: string): Promise<string> {
    const id = `run-${++this.runSeq}`;
    this.runs.set(id, { mode, startedAt, summary: null });
    return id;
  }
  async finishRun(runId: string, summary: SyncRunSummary): Promise<void> {
    const r = this.runs.get(runId);
    if (r) r.summary = structuredClone(summary);
  }
}
