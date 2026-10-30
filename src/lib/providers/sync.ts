// The sync runner: pulls normalised entities from ONE ready provider into an injected store.
//
// - Idempotent upserts keyed on (provider, externalType, externalId). A record whose merged data and provider data are unchanged is
//   not written at all, so running the same sync twice changes nothing the second time.
// - Malformed provider items are rejected and counted (validators are total, each item is processed inside a guard), never a crash.
// - Incremental cursors per stream (`tournaments`, `matches:<tournament>`, `rankings:<category|all>`), saved after every processed
//   page so a failed run resumes where it stopped; a page's `syncCursor` (high-water mark) is saved for the next run. A provider's
//   syncCursor must cover CHANGED items (see `Page` in ./types); as a guard, stored tournaments with an open match are re-read from the
//   start on every default run.
// - Retries with exponential backoff + jitter, per-call timeouts and Retry-After through ./retry (sleep, timer, clock, random injected).
// - Never deletes: the store has no delete; a tournament the provider no longer returns stays as it is (counted as `keptMissing`).
// - Conflict policy (./merge): manually verified fields are never overwritten; conflicts are reported in the history.
// - Every run, including one that cannot start, appends ONE sync history entry. A provider that is not ready is never reported as a
//   success (status = its registry status, for example 'awaiting_credentials').
// Nothing here is wired to a schedule, a route or a database yet (TODO(lead): a Supabase store and an owner-approved trigger, after a
// licensed source exists; docs/m5/international-data.md).
import type { Category, IsoInstant } from '../competition/types';
import { ProviderError, RateLimitedError, SyncCancelledError, asProviderError } from './errors';
import { LOCAL_ONLY_FIELDS, drawData, matchData, playerData, rankingData, tournamentData } from './map';
import { deepEqual, mergeRecord, type RecordData } from './merge';
import type { ProviderConfig, ProviderRegistry, ProviderStatus } from './registry';
import { DEFAULT_RETRY_POLICY, callWithRetry, type RetryPolicy, type Scheduler } from './retry';
import {
  validateDraw,
  validateMatch,
  validateRanking,
  validateTournament,
  type DataProvider,
  type ExternalKey,
  type ExternalType,
  type Page,
  type ProviderDraw,
  type ProviderId,
} from './types';

export interface StoredRecord extends ExternalKey {
  /** The local view: provider data merged under the conflict policy. */
  data: RecordData;
  /** The last data exactly as the provider sent it (for review of conflicts). */
  providerData: RecordData;
  /** Fields the owner verified by hand; a sync never overwrites them. The admin adds a field here on every manual edit. */
  verifiedFields: readonly string[];
  firstSyncedAt: IsoInstant;
  lastSyncedAt: IsoInstant;
  lastRunId: string;
}

export type SyncRunStatus = 'succeeded' | 'partial' | 'failed' | 'rate_limited' | 'credentials_rejected' | 'cancelled' | Exclude<ProviderStatus, 'ready'>;

export interface SyncError {
  stream: string;
  externalId?: string;
  code: string;
  message: string;
}

export interface SyncCounts {
  created: number;
  updated: number;
  unchanged: number;
  rejected: number;
  conflicts: number;
  keptOmitted: number;
  keptMissing: number;
  retries: number;
}

export interface SyncHistoryEntry {
  runId: string;
  provider: ProviderId;
  startedAt: IsoInstant;
  finishedAt: IsoInstant;
  status: SyncRunStatus;
  counts: SyncCounts;
  errors: SyncError[];
  conflicts: { key: ExternalKey; field: string }[];
  /** Cursors saved during this run (stream -> cursor). */
  cursors: Record<string, string | null>;
}

/** The persistence the runner needs. Deliberately has NO delete. */
export interface SyncStore {
  get(key: ExternalKey): Promise<StoredRecord | null>;
  /** Insert or replace the record with the same (provider, externalType, externalId). */
  put(record: StoredRecord): Promise<void>;
  getCursor(provider: ProviderId, stream: string): Promise<string | null>;
  setCursor(provider: ProviderId, stream: string, cursor: string | null): Promise<void>;
  appendHistory(entry: SyncHistoryEntry): Promise<void>;
  /**
   * The external ids of this provider's stored tournaments that are NOT finished: at least one stored match of the tournament has an
   * open status (`isOpenMatchStatus(record.data.status)`). A default run (no `tournamentExternalIds`) refreshes their draws and re-reads
   * their matches FROM THE START, so a match stored as `live` or `scheduled` is picked up when it completes even if the provider's
   * cursor only reports new items. Optional for backwards compatibility; a store without it relies on the provider's cursor contract
   * (see `Page` in ./types).
   */
  listOpenTournamentIds?(provider: ProviderId): Promise<readonly string[]>;
}

export type SyncStream = 'tournaments' | 'draws' | 'matches' | 'rankings';

export interface SyncOptions {
  /** Injected run id (no randomness here). */
  runId: string;
  streams?: readonly SyncStream[];
  /**
   * Tournaments to refresh (getTournament) and pull draws/matches for. Default: the tournaments listed in this run plus the stored
   * tournaments that are not finished (`SyncStore.listOpenTournamentIds`), whose matches are re-read from the start.
   */
  tournamentExternalIds?: readonly string[];
  /** Ranking lists to pull; null = the provider's default list. Default [null]. */
  rankingCategories?: readonly (Category | null)[];
  pageLimit?: number;
  /** Guard against a provider that pages forever. */
  maxPagesPerStream?: number;
  retry?: Partial<RetryPolicy>;
  signal?: AbortSignal;
  /** Max conflicts listed in the history entry (all are counted). */
  maxConflictsListed?: number;
}

export interface SyncDeps {
  store: SyncStore;
  scheduler: Scheduler;
}

const ALL_STREAMS: readonly SyncStream[] = ['tournaments', 'draws', 'matches', 'rankings'];

class FatalSync extends Error {
  constructor(readonly status: SyncRunStatus, readonly reason: ProviderError | Error) {
    super(reason.message);
  }
}

const iso = (ms: number): IsoInstant => new Date(ms).toISOString();

export async function runSync(provider: DataProvider, deps: SyncDeps, options: SyncOptions): Promise<SyncHistoryEntry> {
  const { store, scheduler } = deps;
  const policy: RetryPolicy = { ...DEFAULT_RETRY_POLICY, ...(options.retry ?? {}) };
  const streams = new Set(options.streams ?? ALL_STREAMS);
  const pageLimit = Math.max(1, Math.floor(options.pageLimit ?? 100));
  const maxPages = Math.max(1, Math.floor(options.maxPagesPerStream ?? 1000));
  const maxConflictsListed = options.maxConflictsListed ?? 200;
  const pid = provider.id;
  const startedAt = iso(scheduler.now());

  const counts: SyncCounts = { created: 0, updated: 0, unchanged: 0, rejected: 0, conflicts: 0, keptOmitted: 0, keptMissing: 0, retries: 0 };
  const errors: SyncError[] = [];
  const conflicts: { key: ExternalKey; field: string }[] = [];
  const cursors: Record<string, string | null> = {};

  const call = <T>(fn: (signal: AbortSignal) => Promise<T>) =>
    callWithRetry(fn, policy, scheduler, options.signal, () => {
      counts.retries++;
    });

  /** Classifies a provider failure: fatal ones stop the run, others are recorded and the run goes on. */
  const fail = (stream: string, err: unknown, externalId?: string): void => {
    const pe = err instanceof FatalSync ? null : asProviderError(err);
    if (err instanceof FatalSync) throw err;
    if (pe instanceof SyncCancelledError) throw new FatalSync('cancelled', pe);
    if (pe instanceof RateLimitedError) throw new FatalSync('rate_limited', pe);
    if (pe && pe.code === 'auth') throw new FatalSync('credentials_rejected', pe);
    errors.push({ stream, ...(externalId !== undefined ? { externalId } : {}), code: pe?.code ?? 'unknown', message: pe?.message ?? String(err) });
  };

  const upsert = async (externalType: ExternalType, externalId: string, incoming: RecordData, localOnly: readonly string[]) => {
    const key: ExternalKey = { provider: pid, externalType, externalId };
    let existing: StoredRecord | null;
    try {
      existing = await store.get(key);
    } catch (e) {
      throw new FatalSync('failed', e instanceof Error ? e : new Error('Store read failed'));
    }
    const now = iso(scheduler.now());
    let next: StoredRecord | null = null;
    if (!existing) {
      next = { ...key, data: { ...incoming }, providerData: incoming, verifiedFields: [], firstSyncedAt: now, lastSyncedAt: now, lastRunId: options.runId };
      counts.created++;
    } else {
      const m = mergeRecord(existing.data, existing.verifiedFields, incoming, localOnly);
      counts.conflicts += m.conflicts.length;
      counts.keptOmitted += m.keptOmitted.length;
      for (const c of m.conflicts) if (conflicts.length < maxConflictsListed) conflicts.push({ key, field: c.field });
      if (!m.changed && deepEqual(existing.providerData, incoming)) {
        counts.unchanged++;
        return;
      }
      next = { ...existing, data: m.data, providerData: incoming, lastSyncedAt: now, lastRunId: options.runId };
      counts.updated++;
    }
    try {
      await store.put(next);
    } catch (e) {
      throw new FatalSync('failed', e instanceof Error ? e : new Error('Store write failed'));
    }
  };

  const saveCursor = async (stream: string, cursor: string | null) => {
    cursors[stream] = cursor;
    try {
      await store.setCursor(pid, stream, cursor);
    } catch (e) {
      throw new FatalSync('failed', e instanceof Error ? e : new Error('Cursor write failed'));
    }
  };

  const reject = (stream: string, externalId: unknown, problems: string[], code = 'invalid') => {
    counts.rejected++;
    errors.push({ stream, externalId: typeof externalId === 'string' ? externalId : '', code, message: problems.join('; ') });
  };

  /** The external id of an untrusted item, if it has one (never throws). */
  const idOf = (item: unknown): unknown => (typeof item === 'object' && item !== null ? (item as { externalId?: unknown }).externalId : undefined);

  /**
   * Processes ONE untrusted item. A store failure or cancellation (FatalSync) still stops the run; any other throw (a malformed item
   * the validator did not foresee, a mapping bug) rejects and counts that item only, so one bad record never blocks the stream.
   */
  const guarded = async (stream: string, item: unknown, fn: () => Promise<void>) => {
    try {
      await fn();
    } catch (e) {
      if (e instanceof FatalSync) throw e;
      reject(stream, idOf(item), [e instanceof Error ? e.message : 'The item could not be processed'], 'item_failed');
    }
  };

  /** Pages through one stream from its saved cursor (or from the start when `fromStart`). */
  const pageThrough = async <T>(
    stream: string,
    fetchPage: (cursor: string | null, signal: AbortSignal) => Promise<Page<T>>,
    onItem: (item: T) => Promise<void>,
    fromStart = false,
  ) => {
    let cursor: string | null;
    try {
      cursor = fromStart ? null : await store.getCursor(pid, stream);
    } catch (e) {
      throw new FatalSync('failed', e instanceof Error ? e : new Error('Cursor read failed'));
    }
    for (let n = 0; n < maxPages; n++) {
      if (options.signal?.aborted) throw new FatalSync('cancelled', new SyncCancelledError());
      let page: Page<T>;
      try {
        page = await call((signal) => fetchPage(cursor, signal));
      } catch (e) {
        fail(stream, e);
        return;
      }
      if (typeof page !== 'object' || page === null || !Array.isArray(page.items)) {
        errors.push({ stream, code: 'invalid', message: 'The provider page has no item list; stopped this stream' });
        return;
      }
      for (const item of page.items as readonly unknown[]) await guarded(stream, item, () => onItem(item as T));
      if (page.nextCursor !== null && page.nextCursor !== undefined) {
        if (page.nextCursor === cursor) {
          errors.push({ stream, code: 'cursor_stuck', message: 'The provider returned the same cursor again; stopped this stream' });
          return;
        }
        cursor = page.nextCursor;
        await saveCursor(stream, cursor);
        continue;
      }
      if (page.syncCursor !== undefined && page.syncCursor !== null) await saveCursor(stream, page.syncCursor);
      return;
    }
    errors.push({ stream, code: 'page_limit', message: `Stopped after ${maxPages} pages; the next run resumes from the saved cursor` });
  };

  let status: SyncRunStatus = 'succeeded';
  try {
    const listed: string[] = [];

    if (streams.has('tournaments')) {
      await pageThrough(
        'tournaments',
        (cursor, signal) => provider.listTournaments({ cursor, limit: pageLimit, signal }),
        async (t) => {
          const problems = validateTournament(t);
          if (problems.length) return reject('tournaments', idOf(t), problems);
          listed.push(t.externalId);
          await upsert('tournament', t.externalId, tournamentData(t), LOCAL_ONLY_FIELDS.tournament);
        },
      );
    }

    // Default targets: the tournaments listed in this run PLUS the stored ones that are not finished (an open match), so a match stored
    // as live or scheduled is re-read when it completes even if the provider's cursor reports only new items (review finding, wave 2).
    let open: readonly string[] = [];
    if (!options.tournamentExternalIds && store.listOpenTournamentIds) {
      try {
        open = await store.listOpenTournamentIds(pid);
      } catch (e) {
        throw new FatalSync('failed', e instanceof Error ? e : new Error('Store read failed'));
      }
    }
    const reread = new Set(open);
    const targets = options.tournamentExternalIds ? [...new Set(options.tournamentExternalIds)] : [...new Set([...listed, ...open])];

    // Explicitly requested tournaments are refreshed one by one; one the provider no longer has is KEPT locally.
    if (options.tournamentExternalIds) {
      for (const tid of targets) {
        if (options.signal?.aborted) throw new FatalSync('cancelled', new SyncCancelledError());
        try {
          const t = await call((signal) => provider.getTournament(tid, { signal }));
          if (t === null) {
            counts.keptMissing++;
            continue;
          }
          const problems = validateTournament(t);
          if (problems.length) reject('tournament', tid, problems);
          else await upsert('tournament', t.externalId, tournamentData(t), LOCAL_ONLY_FIELDS.tournament);
        } catch (e) {
          fail('tournament', e, tid);
        }
      }
    }

    if (streams.has('draws')) {
      for (const tid of targets) {
        if (options.signal?.aborted) throw new FatalSync('cancelled', new SyncCancelledError());
        let draws: readonly ProviderDraw[];
        try {
          draws = await call((signal) => provider.getDraws(tid, { signal }));
        } catch (e) {
          fail('draws', e, tid);
          continue;
        }
        if (!Array.isArray(draws)) {
          errors.push({ stream: 'draws', externalId: tid, code: 'invalid', message: 'The provider returned no draw list' });
          continue;
        }
        for (const d of draws as readonly unknown[]) {
          await guarded('draws', d, async () => {
            const problems = validateDraw(d);
            if (problems.length) return reject('draws', idOf(d), problems);
            const draw = d as ProviderDraw;
            for (const p of draw.players) await upsert('player', p.externalId, playerData(p), LOCAL_ONLY_FIELDS.player);
            await upsert('draw', draw.externalId, drawData(pid, draw), LOCAL_ONLY_FIELDS.draw);
          });
        }
      }
    }

    if (streams.has('matches')) {
      for (const tid of targets) {
        await pageThrough(
          `matches:${tid}`,
          (cursor, signal) => provider.getMatches(tid, { cursor, limit: pageLimit, signal }),
          async (m) => {
            const problems = validateMatch(m);
            if (problems.length) return reject(`matches:${tid}`, idOf(m), problems);
            await upsert('match', m.externalId, matchData(m), LOCAL_ONLY_FIELDS.match);
          },
          reread.has(tid),
        );
      }
    }

    if (streams.has('rankings')) {
      for (const category of options.rankingCategories ?? [null]) {
        const stream = `rankings:${category ?? 'all'}`;
        await pageThrough(
          stream,
          (cursor, signal) => provider.getRankings(category, { cursor, limit: pageLimit, signal }),
          async (r) => {
            const problems = validateRanking(r);
            if (problems.length) return reject(stream, idOf(r), problems);
            await upsert('ranking', r.externalId, rankingData(pid, r), LOCAL_ONLY_FIELDS.ranking);
          },
        );
      }
    }

    if (errors.length > 0) {
      const touched = counts.created + counts.updated + counts.unchanged;
      status = touched > 0 ? 'partial' : 'failed';
    }
  } catch (e) {
    if (e instanceof FatalSync) {
      status = e.status;
      const pe = e.reason instanceof ProviderError ? e.reason : null;
      errors.push({ stream: 'run', code: pe?.code ?? 'store', message: e.message });
    } else {
      status = 'failed';
      errors.push({ stream: 'run', code: 'unexpected', message: e instanceof Error ? e.message : 'Unexpected failure' });
    }
  }

  const entry: SyncHistoryEntry = { runId: options.runId, provider: pid, startedAt, finishedAt: iso(scheduler.now()), status, counts, errors, conflicts, cursors };
  await store.appendHistory(entry);
  return entry;
}

/**
 * Looks the provider up in the registry and runs it only when it is ready. Otherwise records a history entry with the registry status
 * (for example 'awaiting_credentials') and touches nothing else: never a fake success.
 */
export async function runSyncFromRegistry(
  registry: ProviderRegistry,
  id: ProviderId,
  config: ProviderConfig | undefined,
  deps: SyncDeps,
  options: SyncOptions,
): Promise<SyncHistoryEntry> {
  const lookup = registry.get(id, config);
  if (!lookup.ok) {
    const at = iso(deps.scheduler.now());
    const entry: SyncHistoryEntry = {
      runId: options.runId,
      provider: id,
      startedAt: at,
      finishedAt: at,
      status: lookup.report.status as Exclude<ProviderStatus, 'ready'>,
      counts: { created: 0, updated: 0, unchanged: 0, rejected: 0, conflicts: 0, keptOmitted: 0, keptMissing: 0, retries: 0 },
      errors: lookup.report.messages.map((message) => ({ stream: 'run', code: lookup.report.status, message })),
      conflicts: [],
      cursors: {},
    };
    await deps.store.appendHistory(entry);
    return entry;
  }
  return runSync(lookup.provider, deps, options);
}
