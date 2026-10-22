/**
 * The sync pipeline (spec 10.4, D-008, D-033) as functions over injected stores and an injected YouTube client:
 * fetch -> (skip suppressed) -> parse and classify -> merge respecting locks -> upsert -> purge removed -> record the run ->
 * mark dirty -> alert on failure. No I/O of its own: tests run it against src/lib/sync/memory-store.ts and a fake fetch.
 *
 * Modes: backfill (all uploads, resumable from a checkpoint), incremental (newest first, stop at a known id, first-page ETag
 * shortcut), stats_recent (videos under 90 days, daily), stats_all (weekly), purge (the 30-day rule only). Every run ends with
 * the 30-day purge, even a failed one: stale API data must be deleted when a refresh cannot happen (VF-C3).
 *
 * Suppressed videos (takedown tombstones, D-014) are never fetched, stored or resurrected, and count as "known" for the
 * incremental stop rule and for the RSS detector's known ids.
 */
import { QuotaExceededError, QuotaLedger, FAIL_CLOSED_UNITS_PER_DAY, quotaDayKey } from '../youtube/quota';
import { YouTubeApiError, chunk, type YouTubeClient } from '../youtube/client';
import type { PlaylistSignals } from '../youtube/classify';
import { affectsPublicSite, buildFreshRecord, buildReparsedRecord, isUnavailable, materialise, mergeVideo } from './record';
import { resolveVideoIdentity } from './identity';
import type { IdentityStore } from './identity-store';
import { mayMarkDirtyForDrift } from './dirty';
import { purgeExpiredApiData } from './purge';
import { buildSyncFailureText } from './alerts';
import { EMPTY_COUNTS, IDENTITY_REVIEW_REASONS, isRetiredVideo, type Notifier, type SyncCounts, type SyncMode, type SyncRunSummary, type SyncState, type SyncStatus, type SyncStore, type VideoRecord, type VideoWrite } from './types';

export const RECENT_DAYS = 90;
export const RECENT_KNOWN_IDS = 50;
export const DEFAULT_MAX_INCREMENTAL_PAGES = 20;
const DAY = 24 * 60 * 60 * 1000;

export class SyncError extends Error {
  readonly code: string;
  constructor(code: string) {
    super(code);
    this.name = 'SyncError';
    this.code = code;
  }
}

export interface SyncDeps {
  store: SyncStore;
  channelId: string;
  /** Builds the YouTube client around the run's ledger (the key and fetch are closed over by the caller). */
  makeClient: (ledger: QuotaLedger) => YouTubeClient;
  now: () => Date;
  notifier?: Notifier;
  signals?: PlaylistSignals;
  quotaLimit?: number;
  maxIncrementalPages?: number;
  /** Identity resolution (players, tournaments, matches). Without it the sync stores videos and parses only. */
  identity?: IdentityStore;
  /** uuid maker for new entity rows (injected so tests are deterministic). */
  newId?: () => string;
}

interface RunCtx {
  deps: SyncDeps;
  client: YouTubeClient;
  state: SyncState;
  counts: SyncCounts;
  dirty: boolean;
  driftPending: boolean;
}

async function uploadsPlaylist(c: RunCtx): Promise<string> {
  if (c.state.uploadsPlaylistId) return c.state.uploadsPlaylistId;
  const r = await c.client.getChannel(c.deps.channelId, null);
  if (r.notModified) throw new SyncError('channel_unexpected_304');
  const id = r.data?.contentDetails?.relatedPlaylists?.uploads;
  if (!id) throw new SyncError('no_uploads_playlist');
  c.state = { ...c.state, uploadsPlaylistId: id, channelEtag: r.etag };
  await c.deps.store.saveState({ uploadsPlaylistId: id, channelEtag: r.etag });
  return id;
}

/** Fetch, classify and store these ids. Returns how many were already known (stored or suppressed). */
async function ingest(c: RunCtx, ids: readonly string[]): Promise<{ known: number }> {
  const { store, now } = c.deps;
  const unique = [...new Set(ids)];
  const suppressed = await store.getSuppressedIds(unique);
  c.counts.suppressedSkipped += suppressed.size;
  const wanted = unique.filter((id) => !suppressed.has(id));
  if (wanted.length === 0) return { known: suppressed.size };

  const batch = await c.client.getVideos(wanted);
  c.counts.duplicates += ids.length - unique.length + batch.duplicateIds.length;
  // Safety: an empty answer for many ids is far more likely an API fault than 10+ simultaneous deletions.
  if (batch.items.length === 0 && wanted.length >= 10) throw new SyncError('suspicious_empty_response');
  c.counts.fetched += batch.items.length;

  const existing = new Map((await store.getVideos(wanted)).map((r) => [r.youtube_id, r] as const));
  const at = now();
  const atIso = at.toISOString();
  const writes: VideoWrite[] = [];
  const targets: VideoRecord[] = [];
  const removed = new Set(batch.missingIds);
  let drift = false;

  for (const item of batch.items) {
    if (isUnavailable(item)) {
      removed.add(item.id);
      continue;
    }
    const before = existing.get(item.id) ?? null;
    const { write, change } = mergeVideo(before, buildFreshRecord(item, at, c.deps.signals));
    writes.push(write);
    if (change === 'inserted') c.counts.inserted++;
    else if (change === 'unchanged') c.counts.unchanged++;
    else c.counts.updated++;
    if (write.parse_status === 'needs_review') c.counts.needsReview++;
    if (affectsPublicSite(change, write, before)) c.dirty = true;
    if (change === 'stats') drift = true;
    if (change === 'inserted' || change === 'content' || change === 'minor') targets.push(materialise(before, write, atIso));
  }
  if (writes.length > 0) await store.upsertVideos(writes);
  if (drift) c.driftPending = true;
  await applyIdentity(c, targets);

  const toRetire = [...removed].filter((id) => {
    const row = existing.get(id);
    return row !== undefined && !isRetiredVideo(row);
  });
  if (toRetire.length > 0) {
    await store.retireVideos(toRetire, atIso);
    c.counts.purged += toRetire.length;
    if (toRetire.some((id) => existing.get(id)?.visibility !== 'hidden')) c.dirty = true;
  }
  const knownExisting = wanted.filter((id) => existing.has(id)).length;
  return { known: knownExisting + suppressed.size };
}

const IDENTITY_SET: ReadonlySet<string> = new Set(IDENTITY_REVIEW_REASONS);

/** Resolve identity for videos whose parse changed (or all, in reparse mode) and keep their review state in step. */
async function applyIdentity(c: RunCtx, videos: readonly VideoRecord[]): Promise<void> {
  const identity = c.deps.identity;
  if (!identity) return;
  const newId = c.deps.newId ?? (() => crypto.randomUUID());
  for (const v of videos) {
    const out = await resolveVideoIdentity(v, { store: identity, newId });
    c.counts.playersCreated += out.playersCreated;
    c.counts.tournamentsCreated += out.tournamentsCreated;
    if (out.matchWritten) c.counts.matchesWritten++;
    c.counts.duplicateCandidates += out.candidates;
    if (out.changed) c.dirty = true;
    const base = v.review_reasons.filter((r) => !IDENTITY_SET.has(r));
    const wanted = [...base, ...out.reviewReasons];
    if (JSON.stringify([...wanted].sort()) !== JSON.stringify([...v.review_reasons].sort())) {
      await identity.setVideoReview(v.youtube_id, {
        parse_status: wanted.length > 0 ? 'needs_review' : 'parsed',
        review_reasons: wanted,
        hard_flags: [...v.hard_flags.filter((f) => !IDENTITY_SET.has(f)), ...out.reviewReasons],
      });
      c.dirty = true;
    }
  }
}

function playlistIds(page: { items?: { contentDetails?: { videoId?: string }; snippet?: { resourceId?: { videoId?: string } } }[] }): string[] {
  const out: string[] = [];
  for (const it of page.items ?? []) {
    const id = it.contentDetails?.videoId ?? it.snippet?.resourceId?.videoId;
    if (id) out.push(id);
  }
  return out;
}

async function rememberRecent(c: RunCtx, firstPageIds: string[]): Promise<void> {
  const merged = [...new Set([...firstPageIds, ...c.state.recentKnownIds])].slice(0, RECENT_KNOWN_IDS);
  c.state = { ...c.state, recentKnownIds: merged };
  await c.deps.store.saveState({ recentKnownIds: merged });
}

async function backfill(c: RunCtx): Promise<void> {
  const playlistId = await uploadsPlaylist(c);
  const cp = c.state.checkpoint?.mode === 'backfill' ? c.state.checkpoint : null;
  let token: string | null = cp?.nextPageToken ?? null;
  let pagesDone = cp?.pagesDone ?? 0;
  const startedAt = cp?.startedAt ?? c.deps.now().toISOString();
  for (;;) {
    const r = await c.client.listPlaylistPage(playlistId, { pageToken: token });
    if (r.notModified) throw new SyncError('playlist_unexpected_304');
    const ids = playlistIds(r.data);
    await ingest(c, ids);
    c.counts.pages++;
    pagesDone++;
    if (token === null) {
      c.state = { ...c.state, playlistFirstPageEtag: r.etag };
      await c.deps.store.saveState({ playlistFirstPageEtag: r.etag });
      await rememberRecent(c, ids);
    }
    token = r.data.nextPageToken ?? null;
    if (token === null) break;
    const checkpoint = { mode: 'backfill' as const, nextPageToken: token, pagesDone, startedAt };
    c.state = { ...c.state, checkpoint };
    await c.deps.store.saveState({ checkpoint }); // page fully stored: a failure now resumes at the next page
  }
  c.state = { ...c.state, checkpoint: null };
  await c.deps.store.saveState({ checkpoint: null });
}

async function incremental(c: RunCtx): Promise<void> {
  const playlistId = await uploadsPlaylist(c);
  const maxPages = c.deps.maxIncrementalPages ?? DEFAULT_MAX_INCREMENTAL_PAGES;
  let token: string | null = null;
  for (let page = 0; page < maxPages; page++) {
    const r = await c.client.listPlaylistPage(playlistId, { pageToken: token, etag: token === null ? c.state.playlistFirstPageEtag : null });
    c.counts.pages++;
    if (r.notModified) return; // nothing new since the last sync
    const ids = playlistIds(r.data);
    const { known } = await ingest(c, ids);
    if (token === null) {
      c.state = { ...c.state, playlistFirstPageEtag: r.etag };
      await c.deps.store.saveState({ playlistFirstPageEtag: r.etag });
      await rememberRecent(c, ids);
    }
    token = r.data.nextPageToken ?? null;
    if (known > 0 || token === null) return; // reached what we already hold
  }
}

async function statsRefresh(c: RunCtx, recentOnly: boolean): Promise<void> {
  const publishedAfter = recentOnly ? new Date(c.deps.now().getTime() - RECENT_DAYS * DAY).toISOString() : undefined;
  const ids = await c.deps.store.listVideoIds(publishedAfter ? { publishedAfter } : undefined);
  for (const group of chunk(ids, 50)) {
    await ingest(c, group);
    c.counts.pages++;
  }
}

/** Re-read every stored title with the current parser and re-run identity resolution. No YouTube call, no quota. */
async function reparse(c: RunCtx): Promise<void> {
  const { store, now } = c.deps;
  const ids = await store.listVideoIds();
  for (const group of chunk(ids, 50)) {
    const suppressed = await store.getSuppressedIds(group);
    c.counts.suppressedSkipped += suppressed.size;
    const rows = (await store.getVideos(group)).filter((r) => !suppressed.has(r.youtube_id) && !isRetiredVideo(r));
    const atIso = now().toISOString();
    const writes: VideoWrite[] = [];
    const targets: VideoRecord[] = [];
    for (const row of rows) {
      const { write, change } = mergeVideo(row, buildReparsedRecord(row));
      c.counts.fetched++;
      if (change === 'unchanged' || change === 'stats') {
        c.counts.unchanged++;
        targets.push(row);
        continue;
      }
      writes.push(write);
      c.counts.updated++;
      if (affectsPublicSite(change, write, row)) c.dirty = true;
      targets.push(materialise(row, write, atIso));
    }
    if (writes.length > 0) await store.upsertVideos(writes);
    await applyIdentity(c, targets);
    c.counts.pages++;
  }
}

function describeError(e: unknown): { status: SyncStatus; code: string } {
  if (e instanceof QuotaExceededError) return { status: 'quota_exhausted', code: e.message };
  if (e instanceof YouTubeApiError) return { status: 'partial', code: e.message };
  if (e instanceof SyncError) return { status: 'partial', code: e.code };
  // Store errors carry their own safe codes (SupabaseError); anything else is reduced to its class name, never a message.
  const name = e instanceof Error ? e.name : 'unknown';
  const msg = e instanceof Error && /^supabase_\d+/.test(e.message) ? e.message : null;
  return { status: 'failed', code: msg ?? `internal_${name}` };
}

export async function runSync(mode: SyncMode, deps: SyncDeps): Promise<SyncRunSummary> {
  const { store } = deps;
  const startedAt = deps.now();
  const quotaDay = quotaDayKey(startedAt);
  const runId = await store.startRun(mode, startedAt.toISOString());
  const ledger = new QuotaLedger(deps.quotaLimit ?? FAIL_CLOSED_UNITS_PER_DAY, await store.quotaUnitsForDay(quotaDay));
  const c: RunCtx = { deps, client: deps.makeClient(ledger), state: await store.loadState(), counts: { ...EMPTY_COUNTS }, dirty: false, driftPending: false };
  let status: SyncStatus = 'ok';
  let errorCode: string | null = null;

  try {
    if (mode === 'backfill') await backfill(c);
    else if (mode === 'incremental') await incremental(c);
    else if (mode === 'stats_recent') await statsRefresh(c, true);
    else if (mode === 'stats_all') await statsRefresh(c, false);
    else if (mode === 'reparse') await reparse(c);
  } catch (e) {
    ({ status, code: errorCode } = describeError(e));
    if (status === 'partial' && c.counts.fetched === 0 && c.counts.pages === 0) status = 'failed';
  }

  try {
    const purged = await purgeExpiredApiData(store, deps.now());
    c.counts.statsCleared += purged.statsCleared;
    c.counts.purged += purged.rowsRetired.length;
    if (purged.rowsRetired.length > 0) c.dirty = true;
  } catch (e) {
    if (status === 'ok') ({ status, code: errorCode } = describeError(e));
  }

  const finished = deps.now();
  if (!c.dirty && c.driftPending && mayMarkDirtyForDrift(c.state.lastDriftDirtyAt, finished)) {
    c.dirty = true;
    await store.saveState({ lastDriftDirtyAt: finished.toISOString() });
  }
  if (c.dirty) await store.markDirty(finished.toISOString());
  if (status === 'ok' && mode !== 'purge') await store.saveState({ lastSyncOkAt: finished.toISOString() });

  const summary: SyncRunSummary = {
    runId,
    mode,
    status,
    startedAt: startedAt.toISOString(),
    finishedAt: finished.toISOString(),
    quotaDay,
    quotaUnits: ledger.unitsThisRun,
    counts: c.counts,
    errorCode,
    markedDirty: c.dirty,
    resumable: mode === 'backfill' && status !== 'ok' && (await store.loadState()).checkpoint !== null,
  };
  await store.finishRun(runId, summary);
  if (status !== 'ok' && deps.notifier) {
    try {
      await deps.notifier.send(buildSyncFailureText(summary));
    } catch {
      // alerting must never break the run record
    }
  }
  return summary;
}
