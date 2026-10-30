// TEST-ONLY helpers for the international data adapter layer. FICTIONAL DATA: every tournament, player and score below is invented.
// Not exported from src/lib/providers (a test checks that); never registered in the production registry.
import type { Category } from '../../src/lib/competition/types';
import { seededRandom } from '../../src/lib/competition/types';
import type { Scheduler } from '../../src/lib/providers/retry';
import type { StoredRecord, SyncHistoryEntry, SyncStore } from '../../src/lib/providers/sync';
import type {
  CallContext,
  DataProvider,
  ExternalKey,
  Page,
  PagedCallContext,
  ProviderDraw,
  ProviderMatch,
  ProviderRanking,
  ProviderTournament,
} from '../../src/lib/providers/types';
import { isOpenMatchStatus } from '../../src/lib/providers/types';

export const FAKE_PROVIDER_ID = 'fake-fictional';

type Method = 'listTournaments' | 'getTournament' | 'getDraws' | 'getMatches' | 'getRankings';

export function fictionalTournament(n: number, over: Partial<ProviderTournament> = {}): ProviderTournament {
  return {
    externalId: `T${n}`,
    name: `Fictional Test Open ${n}`,
    startDate: '2026-03-01',
    endDate: '2026-03-05',
    countryCode: 'ZZ',
    city: 'Testville',
    level: 'Test Grade',
    events: [{ externalId: `T${n}-MS`, name: 'Fictional Men Singles', category: 'MS' }],
    updatedAt: '2026-03-06T00:00:00Z',
    ...over,
  };
}

export function fictionalDraw(tid: string, over: Partial<ProviderDraw> = {}): ProviderDraw {
  return {
    externalId: `${tid}-D1`,
    tournamentExternalId: tid,
    eventExternalId: `${tid}-MS`,
    kind: 'knockout',
    size: 2,
    entries: [
      { externalId: `${tid}-E1`, playerExternalIds: ['P1'], seed: 1 },
      { externalId: `${tid}-E2`, playerExternalIds: ['P2'], seed: null },
    ],
    players: [
      { externalId: 'P1', name: 'Test Player Alpha', countryCode: 'ZZ', ageHint: 'adult' },
      { externalId: 'P2', name: 'Test Player Beta', countryCode: 'ZZ', ageHint: 'junior' },
    ],
    updatedAt: '2026-03-06T00:00:00Z',
    ...over,
  };
}

export function fictionalMatch(tid: string, n: number, over: Partial<ProviderMatch> = {}): ProviderMatch {
  return {
    externalId: `${tid}-M${n}`,
    tournamentExternalId: tid,
    drawExternalId: `${tid}-D1`,
    round: 'F',
    status: 'completed',
    sideAEntryExternalId: `${tid}-E1`,
    sideBEntryExternalId: `${tid}-E2`,
    games: [
      { a: 21, b: 15 },
      { a: 21, b: 18 },
    ],
    winner: 'A',
    final: true,
    scheduledAt: '2026-03-05T04:30:00Z',
    updatedAt: '2026-03-05T06:00:00Z',
    ...over,
  };
}

export function fictionalRanking(n: number, category: Category | null = 'MS'): ProviderRanking {
  return {
    externalId: `R-${category ?? 'all'}-${n}`,
    category,
    asOf: '2026-03-10',
    rows: [
      { rank: 1, playerExternalIds: ['P1'], points: 1000 },
      { rank: 2, playerExternalIds: ['P2'], points: 900 },
    ],
  };
}

/** Pages through an array with cursors `i:<offset>`; the last page carries syncCursor `i:<length>` so a next run sees only new items. */
function pageOf<T>(items: readonly T[], ctx: PagedCallContext): Page<T> {
  const start = ctx.cursor === null ? 0 : Number(ctx.cursor.slice(2));
  const slice = items.slice(start, start + ctx.limit);
  const end = start + slice.length;
  return end < items.length ? { items: slice, nextCursor: `i:${end}` } : { items: slice, nextCursor: null, syncCursor: `i:${end}` };
}

/** A programmable FICTIONAL provider for tests only. */
export class FakeProvider implements DataProvider {
  readonly id: string;
  tournaments: ProviderTournament[] = [];
  draws = new Map<string, ProviderDraw[]>();
  matches = new Map<string, ProviderMatch[]>();
  rankings = new Map<string, ProviderRanking[]>();
  /** Every call, in order. */
  calls: { method: Method; arg: string | null; signal: AbortSignal }[] = [];
  readonly #failures = new Map<Method, unknown[]>();
  readonly #hang = new Set<Method>();
  /** Force a fixed nextCursor (to simulate a stuck provider). */
  stuckCursor: string | null = null;

  constructor(id = FAKE_PROVIDER_ID) {
    this.id = id;
  }

  /** The next calls to `method` throw these errors, one per call. */
  failNext(method: Method, ...errs: unknown[]): this {
    this.#failures.set(method, [...(this.#failures.get(method) ?? []), ...errs]);
    return this;
  }

  /** Calls to `method` never answer until their signal aborts (then they reject with an AbortError). */
  hang(method: Method): this {
    this.#hang.add(method);
    return this;
  }

  async #enter(method: Method, arg: string | null, signal: AbortSignal): Promise<void> {
    this.calls.push({ method, arg, signal });
    const queue = this.#failures.get(method);
    if (queue && queue.length > 0) throw queue.shift();
    if (this.#hang.has(method)) {
      await new Promise<never>((_, reject) => signal.addEventListener('abort', () => reject(new Error('aborted')), { once: true }));
    }
  }

  async listTournaments(ctx: PagedCallContext): Promise<Page<ProviderTournament>> {
    await this.#enter('listTournaments', ctx.cursor, ctx.signal);
    if (this.stuckCursor !== null) return { items: this.tournaments.slice(0, ctx.limit), nextCursor: this.stuckCursor };
    return pageOf(this.tournaments, ctx);
  }
  async getTournament(externalId: string, ctx: CallContext): Promise<ProviderTournament | null> {
    await this.#enter('getTournament', externalId, ctx.signal);
    return this.tournaments.find((t) => t.externalId === externalId) ?? null;
  }
  async getDraws(tid: string, ctx: CallContext): Promise<readonly ProviderDraw[]> {
    await this.#enter('getDraws', tid, ctx.signal);
    return this.draws.get(tid) ?? [];
  }
  async getMatches(tid: string, ctx: PagedCallContext): Promise<Page<ProviderMatch>> {
    await this.#enter('getMatches', tid, ctx.signal);
    return pageOf(this.matches.get(tid) ?? [], ctx);
  }
  async getRankings(category: Category | null, ctx: PagedCallContext): Promise<Page<ProviderRanking>> {
    await this.#enter('getRankings', category, ctx.signal);
    return pageOf(this.rankings.get(category ?? 'all') ?? [], ctx);
  }
}

const keyOf = (k: ExternalKey) => `${k.provider}|${k.externalType}|${k.externalId}`;

/** In-memory SyncStore for tests. Counts writes so idempotency can be checked. */
export class MemorySyncStore implements SyncStore {
  records = new Map<string, StoredRecord>();
  cursors = new Map<string, string | null>();
  history: SyncHistoryEntry[] = [];
  puts = 0;
  failPut = false;

  async get(key: ExternalKey) {
    const r = this.records.get(keyOf(key));
    return r ? structuredClone(r) : null;
  }
  async put(record: StoredRecord) {
    if (this.failPut) throw new Error('fictional store outage');
    this.puts++;
    this.records.set(keyOf(record), structuredClone(record));
  }
  async getCursor(provider: string, stream: string) {
    return this.cursors.get(`${provider}|${stream}`) ?? null;
  }
  async setCursor(provider: string, stream: string, cursor: string | null) {
    this.cursors.set(`${provider}|${stream}`, cursor);
  }
  async appendHistory(entry: SyncHistoryEntry) {
    this.history.push(structuredClone(entry));
  }
  /** Stored tournaments of `provider` with at least one stored match in an open status (the contract in SyncStore). */
  async listOpenTournamentIds(provider: string) {
    const ids = new Set<string>();
    for (const r of this.records.values()) {
      if (r.provider !== provider || r.externalType !== 'match' || !isOpenMatchStatus(r.data['status'])) continue;
      const tid = r.data['tournamentExternalId'];
      if (typeof tid === 'string') ids.add(tid);
    }
    return [...ids].sort();
  }
  record(externalType: ExternalKey['externalType'], externalId: string, provider = FAKE_PROVIDER_ID) {
    return this.records.get(keyOf({ provider, externalType, externalId }));
  }
}

/** A deterministic scheduler: sleeps are recorded and resolve at once; the clock advances by the slept time. */
export function fakeScheduler(opts: { timeoutsFire?: boolean; seed?: number; startMs?: number } = {}) {
  let now = opts.startMs ?? Date.UTC(2026, 2, 10, 0, 0, 0);
  const sleeps: number[] = [];
  const scheduler: Scheduler & { sleeps: number[] } = {
    sleeps,
    now: () => now,
    random: seededRandom(opts.seed ?? 7),
    sleep: async (ms) => {
      sleeps.push(ms);
      now += ms;
    },
    timer: (_ms, signal) =>
      opts.timeoutsFire
        ? Promise.resolve()
        : new Promise<void>((resolve) => signal.addEventListener('abort', () => resolve(), { once: true })),
  };
  return scheduler;
}
