/**
 * SyncStore over Supabase REST (src/lib/supabase/rest.ts conventions: secret key in the `apikey` header, errors carry no body).
 * Written against the REAL schema (migrations 0004 and 0005, row types in src/lib/archive/types.ts) but exercised only with a
 * mocked fetch: no Supabase project exists yet. tests/sync/schema-parity.test.ts proves that every table, column, filter, RPC and
 * conflict target this file uses exists in the migrations.
 *
 * Mapping decisions (docs/m2/sync2-notes.md):
 *  - videos: the sync writes only the columns of `VideoWrite`; `visibility` and `hidden_reason` go out ONLY for a new row, so an
 *    existing row's visibility, owner locks (`manual_override`) and hide reason are never touched (triggers restore locked fields anyway).
 *  - There is no delete privilege on videos (D-014): `retireVideos` hides the row and blanks every API-derived value.
 *  - sync_runs has no mode for stats refreshes or purge: the DB mode is mapped (`DB_MODE`) and the real mode is kept in `trigger`.
 *    The quota day, flags and the sync state (ETags, uploads playlist, checkpoint, drift stamp, recent ids) live in the `counts`
 *    jsonb of the run (`quota_day_key`, `sync_state`); the newest run that holds a `sync_state` is the current state.
 *  - site_state (one row) is owned by the database triggers and the deploy job: dirty_since and last_deploy_requested_at are
 *    READ here; the sync marks dirty through the `admin_mark_dirty` RPC (REST has no rpc method in the small client, so the call
 *    goes through `insert` to `rpc/<name>`, which POSTs the JSON body PostgREST expects).
 * Every list read is paginated at 1,000 rows (Supabase's cap, D-005) and uses explicit column lists (never `select=*`).
 */
import { VIDEO_COLUMNS, UPSERT_CONFLICT_TARGETS } from '../archive/types';
import type { Row, SupabaseRest } from '../supabase/rest';
import { quotaDayKey } from '../youtube/quota';
import { EMPTY_SYNC_STATE, type SyncMode, type SyncRunSummary, type SyncState, type SyncStore, type VideoRecord, type VideoWrite } from './types';

export const TABLES = { videos: 'videos', suppression: 'suppression', runs: 'sync_runs', siteState: 'site_state' } as const;
export const RPC_MARK_DIRTY = 'admin_mark_dirty';
export const PAGE_SIZE = 1000;
const ID_BATCH = 50;
const WRITE_BATCH = 100;
const SAFE_ID = /^[A-Za-z0-9_-]{1,64}$/u;

/** sync_runs.mode allows only these values (0004); the real sync mode is kept in `trigger` as `sync:<mode>`. */
export const DB_MODE: Record<SyncMode, 'backfill' | 'incremental' | 'full' | 'reparse' | 'weekly_check' | 'live_status'> = {
  backfill: 'backfill',
  incremental: 'incremental',
  stats_recent: 'live_status',
  stats_all: 'weekly_check',
  purge: 'weekly_check',
  reparse: 'reparse',
};

/** The parts of SyncState kept in the run's `counts.sync_state`. The rest comes from site_state or the run log. */
type StoredState = Pick<SyncState, 'uploadsPlaylistId' | 'channelEtag' | 'playlistFirstPageEtag' | 'checkpoint' | 'lastDriftDirtyAt' | 'recentKnownIds'>;
const STORED_KEYS = ['uploadsPlaylistId', 'channelEtag', 'playlistFirstPageEtag', 'checkpoint', 'lastDriftDirtyAt', 'recentKnownIds'] as const satisfies readonly (keyof StoredState)[];

function inList(ids: readonly string[]): string {
  const safe = ids.filter((id) => SAFE_ID.test(id));
  return `in.(${safe.map((id) => encodeURIComponent(`"${id}"`)).join(',')})`;
}

function batches<T>(items: readonly T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
  return out;
}

const VIDEO_SELECT = VIDEO_COLUMNS.join(',');

/** Request body for an upsert of one video. A row without `visibility` is an UPDATE: it can never carry visibility or a hide reason. */
export function toVideoBody(w: VideoWrite): Row {
  const body: Row = { ...w };
  if (w.visibility === undefined) {
    delete body.visibility;
    delete body.hidden_reason;
  } else if (w.hidden_reason === undefined) {
    delete body.hidden_reason;
  }
  return body;
}

export function fromVideoRow(r: Row): VideoRecord {
  const arr = (v: unknown): string[] => (Array.isArray(v) ? (v as string[]) : []);
  return { ...(r as unknown as VideoRecord), hard_flags: arr(r.hard_flags) as VideoRecord['hard_flags'], review_reasons: arr(r.review_reasons) as VideoRecord['review_reasons'], manual_override: (r.manual_override ?? {}) as VideoRecord['manual_override'] };
}

const quotaKey = (day: string): number => Number(day.replaceAll('-', ''));

export function createSupabaseSyncStore(rest: SupabaseRest, newId: () => string = () => crypto.randomUUID()): SyncStore {
  let currentRunId: string | null = null;
  let runCounts: Record<string, unknown> = {};
  let storedState: StoredState | null = null;

  async function selectAll<T = Row>(table: string, filter: string, columns: string, orderBy: string): Promise<T[]> {
    const out: T[] = [];
    for (let offset = 0; ; offset += PAGE_SIZE) {
      const q = `select=${columns}${filter ? `&${filter}` : ''}&order=${orderBy}.asc&limit=${PAGE_SIZE}&offset=${offset}`;
      const page = await rest.select<T>(table, q);
      out.push(...page);
      if (page.length < PAGE_SIZE) return out;
    }
  }

  async function readStored(): Promise<StoredState> {
    const rows = await rest.select<{ counts: { sync_state?: Partial<StoredState> } }>(TABLES.runs, 'select=counts&counts->sync_state=not.is.null&order=started_at.desc&limit=1');
    const s = rows[0]?.counts?.sync_state ?? {};
    return {
      uploadsPlaylistId: s.uploadsPlaylistId ?? null,
      channelEtag: s.channelEtag ?? null,
      playlistFirstPageEtag: s.playlistFirstPageEtag ?? null,
      checkpoint: s.checkpoint ?? null,
      lastDriftDirtyAt: s.lastDriftDirtyAt ?? null,
      recentKnownIds: Array.isArray(s.recentKnownIds) ? s.recentKnownIds : [],
    };
  }

  async function persistRunCounts(): Promise<void> {
    if (currentRunId !== null) await rest.update(TABLES.runs, `id=eq.${encodeURIComponent(currentRunId)}`, { counts: runCounts });
  }

  return {
    async loadState() {
      storedState = await readStored();
      const site = await rest.select<{ dirty: boolean; dirty_since: string | null; last_deploy_requested_at: string | null }>(TABLES.siteState, 'select=dirty,dirty_since,last_deploy_requested_at&id=eq.1&limit=1');
      const ok = await rest.select<{ finished_at: string | null }>(TABLES.runs, 'select=finished_at&status=eq.ok&trigger=neq.sync%3Apurge&order=finished_at.desc&limit=1');
      const s = site[0];
      return {
        ...EMPTY_SYNC_STATE,
        ...storedState,
        dirtySince: s && s.dirty ? s.dirty_since : null,
        lastBuildStarted: s?.last_deploy_requested_at ?? null,
        lastSyncOkAt: ok[0]?.finished_at ?? null,
      };
    },
    async saveState(patch) {
      // dirtySince, lastBuildStarted and lastSyncOkAt are derived (site_state and the run log): only the stored parts persist here.
      const stored: Partial<StoredState> = {};
      for (const key of STORED_KEYS) if (key in patch) (stored as Record<string, unknown>)[key] = patch[key] ?? null;
      if (Object.keys(stored).length === 0) return;
      storedState = { ...(storedState ?? (await readStored())), ...stored } as StoredState;
      runCounts = { ...runCounts, sync_state: storedState };
      await persistRunCounts();
    },
    async getVideos(ids) {
      const out: VideoRecord[] = [];
      for (const group of batches(ids.filter((i) => SAFE_ID.test(i)), ID_BATCH)) {
        const rows = await rest.select(TABLES.videos, `select=${VIDEO_SELECT}&youtube_id=${inList(group)}&limit=${PAGE_SIZE}`);
        out.push(...rows.map(fromVideoRow));
      }
      return out;
    },
    async upsertVideos(rows) {
      // PostgREST fills a missing key with NULL for the whole batch: inserts (with visibility) and updates (without) go separately.
      const inserts = rows.filter((r) => r.visibility !== undefined).map(toVideoBody);
      const updates = rows.filter((r) => r.visibility === undefined).map(toVideoBody);
      for (const group of batches(inserts, WRITE_BATCH)) await rest.insert(TABLES.videos, group, { onConflict: UPSERT_CONFLICT_TARGETS.videos });
      for (const group of batches(updates, WRITE_BATCH)) await rest.insert(TABLES.videos, group, { onConflict: UPSERT_CONFLICT_TARGETS.videos });
    },
    async listVideoIds(filter) {
      const f = ['title_raw=neq.', filter?.publishedAfter ? `published_at=gte.${encodeURIComponent(filter.publishedAfter)}` : ''].filter(Boolean).join('&');
      const rows = await selectAll<{ youtube_id: string }>(TABLES.videos, f, 'youtube_id', 'youtube_id');
      return rows.map((r) => r.youtube_id);
    },
    async getSuppressedIds(ids) {
      const found = new Set<string>();
      for (const group of batches(ids.filter((i) => SAFE_ID.test(i)), ID_BATCH)) {
        const rows = await rest.select<{ value: string }>(TABLES.suppression, `select=value&kind=eq.youtube_id&released_at=is.null&value=${inList(group)}&limit=${PAGE_SIZE}`);
        for (const r of rows) found.add(r.value);
      }
      return found;
    },
    async retireVideos(ids, at) {
      const patch: Row = {
        title_raw: '',
        title_normalized: '',
        description: null,
        views: null,
        likes: null,
        stats_fetched_at: null,
        thumbnail_url: null,
        parse_result: null,
        etag: null,
        visibility: 'hidden',
        hidden_reason: 'removed_from_youtube',
        hidden_at: at,
      };
      for (const group of batches(ids.filter((i) => SAFE_ID.test(i)), ID_BATCH)) await rest.update(TABLES.videos, `youtube_id=${inList(group)}`, patch);
    },
    async clearStatisticsBefore(cutoff) {
      const q = `stats_fetched_at=lt.${encodeURIComponent(cutoff)}`;
      const n = await rest.count(TABLES.videos, q);
      if (n > 0) await rest.update(TABLES.videos, q, { views: null, likes: null, stats_fetched_at: null });
      return n;
    },
    async listIdsNotRefreshedSince(cutoff) {
      const rows = await selectAll<{ youtube_id: string }>(TABLES.videos, `title_raw=neq.&last_synced_at=lt.${encodeURIComponent(cutoff)}`, 'youtube_id', 'youtube_id');
      return rows.map((r) => r.youtube_id);
    },
    async markDirty(at) {
      await rest.insert(`rpc/${RPC_MARK_DIRTY}`, { p_actor: 'sync', p_reason: `sync ${at}`.slice(0, 200), p_urgent: false });
    },
    async quotaUnitsForDay(quotaDay) {
      const rows = await selectAll<{ id: string; quota_units: number | null }>(TABLES.runs, `counts->>quota_day_key=eq.${quotaKey(quotaDay)}`, 'id,quota_units', 'id');
      return rows.reduce((sum, r) => sum + (r.quota_units ?? 0), 0);
    },
    async startRun(mode: SyncMode, startedAt) {
      const id = newId();
      currentRunId = id;
      runCounts = { quota_day_key: quotaKey(quotaDayKey(new Date(startedAt))) };
      if (storedState !== null) runCounts.sync_state = storedState; // keep the current state on this run's row too
      await rest.insert(TABLES.runs, { id, mode: DB_MODE[mode], status: 'running', started_at: startedAt, counts: runCounts, trigger: `sync:${mode}` });
      return id;
    },
    async finishRun(runId, s: SyncRunSummary) {
      runCounts = { ...runCounts, ...s.counts, quota_day_key: quotaKey(s.quotaDay), marked_dirty: s.markedDirty ? 1 : 0, resumable: s.resumable ? 1 : 0 };
      await rest.update(TABLES.runs, `id=eq.${encodeURIComponent(runId)}`, {
        // the table's status check has no quota_exhausted: it is a partial run with the code in `error`
        status: s.status === 'quota_exhausted' ? 'partial' : s.status,
        finished_at: s.finishedAt,
        quota_units: s.quotaUnits,
        counts: runCounts,
        error: s.errorCode,
      });
      currentRunId = null;
    },
  };
}

