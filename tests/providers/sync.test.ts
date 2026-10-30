// The sync runner against the FICTIONAL FakeProvider and an in-memory store.
import { describe, expect, it } from 'vitest';
import { PermanentProviderError, ProviderAuthError, RateLimitedError, TransientProviderError } from '../../src/lib/providers/errors';
import { ProviderRegistry } from '../../src/lib/providers/registry';
import { runSync, runSyncFromRegistry, type SyncOptions } from '../../src/lib/providers/sync';
import { FAKE_PROVIDER_ID, FakeProvider, MemorySyncStore, fakeScheduler, fictionalDraw, fictionalMatch, fictionalRanking, fictionalTournament } from './fake-provider';

const fastRetry = { maxAttempts: 3, baseDelayMs: 10, maxDelayMs: 100, timeoutMs: 1_000, maxRetryAfterMs: 10_000 };

function setup(nTournaments = 3) {
  const provider = new FakeProvider();
  for (let i = 1; i <= nTournaments; i++) {
    const t = fictionalTournament(i);
    provider.tournaments.push(t);
    provider.draws.set(t.externalId, [fictionalDraw(t.externalId)]);
    provider.matches.set(t.externalId, [fictionalMatch(t.externalId, 1), fictionalMatch(t.externalId, 2, { round: 'SF' })]);
  }
  provider.rankings.set('MS', [fictionalRanking(1, 'MS')]);
  provider.rankings.set('all', [fictionalRanking(1, null)]);
  const store = new MemorySyncStore();
  const scheduler = fakeScheduler();
  return { provider, store, scheduler, deps: { store, scheduler } };
}

const opts = (over: Partial<SyncOptions> = {}): SyncOptions => ({ runId: 'run-1', pageLimit: 2, retry: fastRetry, ...over });

describe('runSync: happy path, idempotency, cursors', () => {
  it('imports every stream and records one succeeded history entry', async () => {
    const { provider, store, deps } = setup();
    const h = await runSync(provider, deps, opts({ rankingCategories: ['MS', null] }));
    expect(h.status).toBe('succeeded');
    expect(h.errors).toEqual([]);
    // 3 tournaments + 3 draws + 2 players + 6 matches + 2 rankings
    expect(h.counts.created).toBe(3 + 3 + 2 + 6 + 2);
    expect(h.counts.unchanged).toBe(4); // the two players are seen again in draws 2 and 3
    expect(store.history).toHaveLength(1);
    expect(store.record('tournament', 'T2')?.data['name']).toBe('Fictional Test Open 2');
    expect(store.record('match', 'T3-M2')?.data['round']).toBe('SF');
    expect(store.record('ranking', 'R-MS-1')).toBeDefined();
    expect(h.startedAt).toBe('2026-03-10T00:00:00.000Z');
  });

  it('pages with cursors: page size 2 over 3 tournaments = 2 list calls, cursors saved', async () => {
    const { provider, store, deps } = setup();
    await runSync(provider, deps, opts({ streams: ['tournaments'] }));
    expect(provider.calls.filter((c) => c.method === 'listTournaments').map((c) => c.arg)).toEqual([null, 'i:2']);
    expect(await store.getCursor(FAKE_PROVIDER_ID, 'tournaments')).toBe('i:3');
  });

  it('is idempotent: a second identical run writes nothing', async () => {
    const { provider, store, deps } = setup();
    await runSync(provider, deps, opts({ tournamentExternalIds: ['T1', 'T2', 'T3'] }));
    const puts = store.puts;
    const h2 = await runSync(provider, deps, opts({ runId: 'run-2', tournamentExternalIds: ['T1', 'T2', 'T3'] }));
    expect(store.puts).toBe(puts);
    expect(h2.counts.created).toBe(0);
    expect(h2.counts.updated).toBe(0);
    expect(h2.status).toBe('succeeded');
  });

  it('is incremental: the next run resumes from the saved cursor and sees only new items', async () => {
    const { provider, store, deps } = setup();
    await runSync(provider, deps, opts({ streams: ['tournaments'] }));
    provider.tournaments.push(fictionalTournament(4));
    provider.calls = [];
    const h = await runSync(provider, deps, opts({ runId: 'run-2', streams: ['tournaments'] }));
    expect(provider.calls.map((c) => c.arg)).toEqual(['i:3']);
    expect(h.counts.created).toBe(1);
    expect(store.record('tournament', 'T4')).toBeDefined();
  });

  it('updates a changed record and keeps first-synced time', async () => {
    const { provider, store, deps, scheduler } = setup(1);
    await runSync(provider, deps, opts({ streams: ['tournaments'] }));
    const first = store.record('tournament', 'T1')!;
    provider.tournaments[0] = fictionalTournament(1, { city: 'Newtown' });
    await scheduler.sleep(60_000);
    const h = await runSync(provider, deps, opts({ runId: 'run-2', streams: ['tournaments'], tournamentExternalIds: ['T1'] }));
    const after = store.record('tournament', 'T1')!;
    expect(h.counts.updated).toBe(1);
    expect(after.data['city']).toBe('Newtown');
    expect(after.firstSyncedAt).toBe(first.firstSyncedAt);
    expect(after.lastSyncedAt).not.toBe(first.lastSyncedAt);
    expect(after.lastRunId).toBe('run-2');
  });
});

describe('runSync: local data is protected', () => {
  it('never overwrites a manually verified field; reports the conflict', async () => {
    const { provider, store, deps } = setup(1);
    await runSync(provider, deps, opts());
    const rec = store.record('match', 'T1-M1')!;
    rec.data = { ...rec.data, winner: 'B', games: [{ a: 15, b: 21 }] };
    rec.verifiedFields = ['winner', 'games'];
    await store.put(rec);
    await store.setCursor(FAKE_PROVIDER_ID, 'matches:T1', null); // re-read every match
    const h = await runSync(provider, deps, opts({ runId: 'run-2', tournamentExternalIds: ['T1'] }));
    const after = store.record('match', 'T1-M1')!;
    expect(after.data['winner']).toBe('B');
    expect(after.data['games']).toEqual([{ a: 15, b: 21 }]);
    expect(h.counts.conflicts).toBeGreaterThanOrEqual(2);
    expect(h.conflicts).toContainEqual({ key: { provider: FAKE_PROVIDER_ID, externalType: 'match', externalId: 'T1-M1' }, field: 'winner' });
  });

  it('never deletes: a tournament the provider no longer has stays, counted as keptMissing', async () => {
    const { provider, store, deps } = setup(2);
    await runSync(provider, deps, opts());
    provider.tournaments = [provider.tournaments[0]!];
    provider.matches.set('T2', []);
    provider.draws.set('T2', []);
    const h = await runSync(provider, deps, opts({ runId: 'run-2', tournamentExternalIds: ['T1', 'T2'] }));
    expect(store.record('tournament', 'T2')).toBeDefined();
    expect(store.record('match', 'T2-M1')).toBeDefined();
    expect(h.counts.keptMissing).toBe(1);
    expect(h.status).toBe('succeeded');
  });

  it('a provider null never erases a local value', async () => {
    const { provider, store, deps } = setup(1);
    await runSync(provider, deps, opts({ streams: ['tournaments'] }));
    provider.tournaments[0] = fictionalTournament(1, { city: null });
    const h = await runSync(provider, deps, opts({ runId: 'run-2', streams: ['tournaments'], tournamentExternalIds: ['T1'] }));
    expect(store.record('tournament', 'T1')!.data['city']).toBe('Testville');
    expect(h.counts.keptOmitted).toBe(1);
  });

  it('imported players are protected; an owner-confirmed age status survives later syncs (D-012)', async () => {
    const { provider, store, deps } = setup(1);
    await runSync(provider, deps, opts());
    expect(store.record('player', 'P1')!.data['ageStatus']).toBe('unknown');
    expect(store.record('player', 'P2')!.data['ageStatus']).toBe('unknown');
    const p1 = store.record('player', 'P1')!;
    p1.data = { ...p1.data, ageStatus: 'adult_confirmed' };
    await store.put(p1);
    await runSync(provider, deps, opts({ runId: 'run-2', tournamentExternalIds: ['T1'] }));
    expect(store.record('player', 'P1')!.data['ageStatus']).toBe('adult_confirmed');
  });

  it('the store interface has no delete', () => {
    const { store } = setup(0);
    expect('delete' in store).toBe(false);
  });
});

describe('runSync: failures', () => {
  it('rejects invalid items, keeps the valid ones, status partial', async () => {
    const { provider, store, deps } = setup(2);
    provider.tournaments.push(fictionalTournament(3, { startDate: 'not-a-date' }));
    const h = await runSync(provider, deps, opts({ streams: ['tournaments'] }));
    expect(h.counts.rejected).toBe(1);
    expect(h.status).toBe('partial');
    expect(store.record('tournament', 'T3')).toBeUndefined();
    expect(h.errors[0]).toMatchObject({ stream: 'tournaments', externalId: 'T3', code: 'invalid' });
  });

  it('retries transient errors (with backoff sleeps) and still succeeds', async () => {
    const { provider, deps, scheduler } = setup(1);
    provider.failNext('listTournaments', new TransientProviderError('blip'), new Error('socket reset'));
    const h = await runSync(provider, deps, opts({ streams: ['tournaments'] }));
    expect(h.status).toBe('succeeded');
    expect(h.counts.retries).toBe(2);
    expect(scheduler.sleeps).toHaveLength(2);
  });

  it('honours Retry-After from a rate limit', async () => {
    const { provider, deps, scheduler } = setup(1);
    provider.failNext('listTournaments', new RateLimitedError('429', 4_000));
    const h = await runSync(provider, deps, opts({ streams: ['tournaments'] }));
    expect(h.status).toBe('succeeded');
    expect(scheduler.sleeps).toEqual([4_000]);
  });

  it('a long Retry-After stops the whole run as rate_limited, keeping what was saved', async () => {
    const { provider, store, deps } = setup(1);
    provider.failNext('getDraws', new RateLimitedError('429', 3_600_000));
    const h = await runSync(provider, deps, opts());
    expect(h.status).toBe('rate_limited');
    expect(store.record('tournament', 'T1')).toBeDefined();
    expect(provider.calls.some((c) => c.method === 'getMatches')).toBe(false);
    expect(store.history.at(-1)?.status).toBe('rate_limited');
  });

  it('an auth error stops the run as credentials_rejected with no retry', async () => {
    const { provider, deps, scheduler } = setup(1);
    provider.failNext('listTournaments', new ProviderAuthError('401'));
    const h = await runSync(provider, deps, opts());
    expect(h.status).toBe('credentials_rejected');
    expect(scheduler.sleeps).toEqual([]);
    expect(provider.calls).toHaveLength(1);
  });

  it('a permanent error on one tournament is recorded; the others continue (partial)', async () => {
    const { provider, store, deps } = setup(2);
    provider.failNext('getDraws', new PermanentProviderError('404'));
    const h = await runSync(provider, deps, opts());
    expect(h.status).toBe('partial');
    expect(h.errors).toContainEqual(expect.objectContaining({ stream: 'draws', externalId: 'T1', code: 'permanent' }));
    expect(store.record('draw', 'T2-D1')).toBeDefined();
  });

  it('nothing imported and errors => failed', async () => {
    const { provider, deps } = setup(1);
    provider.failNext('listTournaments', new PermanentProviderError('400'));
    const h = await runSync(provider, deps, opts({ streams: ['tournaments'] }));
    expect(h.status).toBe('failed');
  });

  it('times out a hanging provider and records the timeout', async () => {
    const { provider, store } = setup(1);
    provider.hang('getRankings');
    const scheduler = fakeScheduler({ timeoutsFire: true });
    const h = await runSync(provider, { store, scheduler }, opts({ streams: ['rankings'] }));
    expect(h.errors).toContainEqual(expect.objectContaining({ stream: 'rankings:all', code: 'timeout' }));
    expect(provider.calls.filter((c) => c.method === 'getRankings')).toHaveLength(fastRetry.maxAttempts);
    expect(provider.calls.every((c) => c.signal.aborted)).toBe(true);
  });

  it('stops a stream whose cursor does not advance', async () => {
    const { provider, store, deps } = setup(1);
    provider.stuckCursor = 'same';
    await store.setCursor(FAKE_PROVIDER_ID, 'tournaments', 'same');
    const h = await runSync(provider, deps, opts({ streams: ['tournaments'] }));
    expect(h.errors).toContainEqual(expect.objectContaining({ code: 'cursor_stuck' }));
  });

  it('a page limit stops a stream; the next run resumes', async () => {
    const { provider, store, deps } = setup(5);
    const h = await runSync(provider, deps, opts({ streams: ['tournaments'], pageLimit: 1, maxPagesPerStream: 2 }));
    expect(h.errors).toContainEqual(expect.objectContaining({ code: 'page_limit' }));
    expect(await store.getCursor(FAKE_PROVIDER_ID, 'tournaments')).toBe('i:2');
  });

  it('a store failure stops the run as failed and is still recorded in history', async () => {
    const { provider, store, deps } = setup(1);
    store.failPut = true;
    const h = await runSync(provider, deps, opts());
    expect(h.status).toBe('failed');
    expect(store.history).toHaveLength(1);
  });

  it('cancellation stops the run as cancelled', async () => {
    const { provider, deps } = setup(1);
    const ctl = new AbortController();
    ctl.abort();
    const h = await runSync(provider, deps, opts({ signal: ctl.signal }));
    expect(h.status).toBe('cancelled');
    expect(provider.calls).toEqual([]);
  });
});

describe('runSync: malformed provider items never crash or block a run (review finding, wave 2)', () => {
  it('null and {} tournaments are rejected and counted; the valid ones are stored and the cursor still advances', async () => {
    const { provider, store, deps } = setup(2);
    provider.tournaments.splice(1, 0, null as never, {} as never);
    const h = await runSync(provider, deps, opts({ streams: ['tournaments'] }));
    expect(h.status).toBe('partial');
    expect(h.counts.rejected).toBe(2);
    expect(h.counts.created).toBe(2);
    expect(h.errors.every((e) => e.code === 'invalid')).toBe(true);
    expect(h.errors.some((e) => e.code === 'unexpected')).toBe(false);
    expect(await store.getCursor(FAKE_PROVIDER_ID, 'tournaments')).toBe('i:4');
    // The next run is not blocked: it resumes after the bad items and imports a new one.
    provider.tournaments.push(fictionalTournament(3));
    const h2 = await runSync(provider, deps, opts({ runId: 'run-2', streams: ['tournaments'] }));
    expect(h2.status).toBe('succeeded');
    expect(h2.counts.created).toBe(1);
    expect(store.record('tournament', 'T3')).toBeDefined();
  });

  it('a draw with entries: undefined (or players: undefined, or a null draw) is rejected; the other draws are stored', async () => {
    const { provider, store, deps } = setup(1);
    provider.draws.set('T1', [
      fictionalDraw('T1', { externalId: 'T1-BAD1', entries: undefined as never }),
      fictionalDraw('T1', { externalId: 'T1-BAD2', players: undefined as never }),
      fictionalDraw('T1', { externalId: 'T1-BAD3', entries: [{ externalId: 'e', playerExternalIds: undefined as never, seed: null }] }),
      null as never,
      fictionalDraw('T1'),
    ]);
    const h = await runSync(provider, deps, opts({ streams: ['tournaments', 'draws'] }));
    expect(h.status).toBe('partial');
    expect(h.counts.rejected).toBe(4);
    expect(h.errors.filter((e) => e.stream === 'draws').map((e) => e.externalId)).toEqual(['T1-BAD1', 'T1-BAD2', 'T1-BAD3', '']);
    expect(store.record('draw', 'T1-D1')).toBeDefined();
    expect(store.record('draw', 'T1-BAD1')).toBeUndefined();
  });

  it('a null match, a match with games: undefined and a ranking with rows: undefined are rejected; the run goes on', async () => {
    const { provider, store, deps } = setup(1);
    provider.matches.set('T1', [null as never, fictionalMatch('T1', 9, { games: undefined as never }), fictionalMatch('T1', 1)]);
    provider.rankings.set('all', [{ ...fictionalRanking(2, null), rows: undefined as never }, fictionalRanking(1, null)]);
    const h = await runSync(provider, deps, opts({ streams: ['tournaments', 'matches', 'rankings'], pageLimit: 10 }));
    expect(h.status).toBe('partial');
    expect(h.counts.rejected).toBe(3);
    expect(store.record('match', 'T1-M1')).toBeDefined();
    expect(store.record('match', 'T1-M9')).toBeUndefined();
    expect(store.record('ranking', 'R-all-1')).toBeDefined();
    expect(await store.getCursor(FAKE_PROVIDER_ID, 'matches:T1')).toBe('i:3');
  });

  it('a page without an item list is an error for that stream only', async () => {
    const { provider, store, deps } = setup(1);
    provider.getRankings = async () => ({ items: undefined as never, nextCursor: null });
    const h = await runSync(provider, deps, opts());
    expect(h.status).toBe('partial');
    expect(h.errors).toContainEqual(expect.objectContaining({ stream: 'rankings:all', code: 'invalid' }));
    expect(store.record('match', 'T1-M1')).toBeDefined();
  });

  it('a store failure inside an item is still fatal (never counted as one bad item)', async () => {
    const { provider, store, deps } = setup(1);
    store.failPut = true;
    const h = await runSync(provider, deps, opts({ streams: ['tournaments'] }));
    expect(h.status).toBe('failed');
    expect(h.counts.rejected).toBe(0);
  });
});

describe('runSync: open matches are refreshed on a default run (review finding, wave 2)', () => {
  it('a match stored as live is picked up as completed even though the offset cursor has moved past it', async () => {
    const { provider, store, deps } = setup(1);
    provider.matches.set('T1', [fictionalMatch('T1', 1), fictionalMatch('T1', 2, { status: 'live', winner: null, final: false, games: [{ a: 11, b: 9 }] })]);
    await runSync(provider, deps, opts());
    expect(store.record('match', 'T1-M2')!.data['status']).toBe('live');
    expect(await store.getCursor(FAKE_PROVIDER_ID, 'matches:T1')).toBe('i:2');
    // The tournament list has nothing new (the offset cursor returns no T1), but the stored live match keeps T1 on the refresh list.
    provider.matches.set('T1', [fictionalMatch('T1', 1), fictionalMatch('T1', 2)]);
    provider.calls = [];
    const h = await runSync(provider, deps, opts({ runId: 'run-2' }));
    expect(h.status).toBe('succeeded');
    expect(provider.calls.filter((c) => c.method === 'getMatches').map((c) => c.arg)).toContain('T1');
    const m2 = store.record('match', 'T1-M2')!;
    expect(m2.data['status']).toBe('completed');
    expect(m2.data['winner']).toBe('A');
    expect(h.counts.updated).toBe(1);
    // Once nothing is open, a default run no longer re-reads T1.
    provider.calls = [];
    await runSync(provider, deps, opts({ runId: 'run-3' }));
    expect(provider.calls.some((c) => c.method === 'getMatches' && c.arg === 'T1')).toBe(false);
  });

  it('explicit tournamentExternalIds win over the open list', async () => {
    const { provider, store, deps } = setup(2);
    provider.matches.set('T2', [fictionalMatch('T2', 1, { status: 'scheduled', winner: null, final: false, games: [] })]);
    await runSync(provider, deps, opts());
    expect(await store.listOpenTournamentIds(FAKE_PROVIDER_ID)).toEqual(['T2']);
    provider.calls = [];
    await runSync(provider, deps, opts({ runId: 'run-2', tournamentExternalIds: ['T1'] }));
    expect(provider.calls.some((c) => c.arg === 'T2')).toBe(false);
  });

  it('a store without listOpenTournamentIds still runs (it relies on the provider cursor contract)', async () => {
    const { provider, store, scheduler } = setup(1);
    const plain = {
      get: store.get.bind(store),
      put: store.put.bind(store),
      getCursor: store.getCursor.bind(store),
      setCursor: store.setCursor.bind(store),
      appendHistory: store.appendHistory.bind(store),
    };
    const h = await runSync(provider, { store: plain, scheduler }, opts());
    expect(h.status).toBe('succeeded');
  });
});

describe('runSyncFromRegistry: never a fake success', () => {
  it('missing credentials => history status awaiting_credentials, provider never called, nothing stored', async () => {
    const { provider, store, deps } = setup(1);
    const registry = new ProviderRegistry();
    registry.register({
      id: FAKE_PROVIDER_ID,
      displayName: 'Fictional test source',
      requiredCredentials: ['apiKey'],
      licence: { status: 'signed', reference: 'fictional' },
      create: () => provider,
    });
    const h = await runSyncFromRegistry(registry, FAKE_PROVIDER_ID, { enabled: true }, deps, opts());
    expect(h.status).toBe('awaiting_credentials');
    expect(provider.calls).toEqual([]);
    expect(store.records.size).toBe(0);
    expect(store.history.map((x) => x.status)).toEqual(['awaiting_credentials']);
  });

  it('an unknown provider (the production default) => not_registered', async () => {
    const { deps, store } = setup(0);
    const h = await runSyncFromRegistry(new ProviderRegistry(), 'any-source', { enabled: true }, deps, opts());
    expect(h.status).toBe('not_registered');
    expect(store.history).toHaveLength(1);
  });

  it('a ready provider runs', async () => {
    const { provider, deps } = setup(1);
    const registry = new ProviderRegistry();
    registry.register({ id: FAKE_PROVIDER_ID, displayName: 'Fictional', requiredCredentials: [], licence: { status: 'signed', reference: 'fictional' }, create: () => provider });
    const h = await runSyncFromRegistry(registry, FAKE_PROVIDER_ID, { enabled: true }, deps, opts());
    expect(h.status).toBe('succeeded');
  });
});
