import { describe, expect, it } from 'vitest';
import { createSupabaseRest } from '../../src/lib/supabase/rest';
import { createSupabaseIdentityStore } from '../../src/lib/sync/supabase-identity';

const KEY = ['sb', 'secret', 'FAKE', 'unit'].join('_');
const UUID = '00000000-0000-4000-8000-000000000001';

interface Call {
  method: string;
  path: string;
  query: string;
  prefer: string | undefined;
  body: unknown;
}

function mock(responder: (c: Call) => unknown = () => []) {
  const calls: Call[] = [];
  const fetchFn: typeof fetch = async (input, init) => {
    const u = new URL(String(input));
    const headers = (init?.headers ?? {}) as Record<string, string>;
    const call: Call = { method: String(init?.method), path: u.pathname.replace('/rest/v1/', ''), query: decodeURIComponent(u.search.slice(1)), prefer: headers.prefer, body: init?.body ? JSON.parse(String(init.body)) : undefined };
    calls.push(call);
    return new Response(JSON.stringify(responder(call)), { status: 200 });
  };
  return { calls, store: createSupabaseIdentityStore(createSupabaseRest({ url: 'https://fakeprojectref.supabase.co', secretKey: KEY, fetch: fetchFn })) };
}

describe('Supabase identity store (mocked fetch)', () => {
  it('fills the owner defaults for settings the table does not hold and ignores unknown keys', async () => {
    const { store } = mock(() => [{ key: 'unknown_match_mode', value: 'hidden' }, { key: 'rogue', value: 'x' }]);
    const s = await store.getSettings();
    expect(s).toEqual({ unknown_match_mode: 'hidden', minor_match_mode: 'hidden', non_tn_tournament_pages: 'off', auto_publish_clean_parses: 'true' });
  });

  it('reads only ACTIVE tombstones, by kind', async () => {
    const { calls, store } = mock((c) => (c.query.includes('kind=eq.name_normalized') ? [{ value: 'x y' }] : []));
    expect([...(await store.suppressedNames(['x y', 'z z']))]).toEqual(['x y']);
    await store.suppressedPlayerIds([UUID, 'not-a-uuid']);
    await store.isTournamentSuppressed(UUID);
    expect(calls.every((c) => c.path === 'suppression' && c.query.includes('released_at=is.null'))).toBe(true);
    expect(calls.map((c) => /kind=eq\.(\w+)/u.exec(c.query)![1])).toEqual(['name_normalized', 'player_id', 'tournament_id']);
    expect(calls[1]?.query).not.toContain('not-a-uuid');
  });

  it('finds a tournament edition by series_key and year, with null year as is.null', async () => {
    const { calls, store } = mock();
    await store.findTournament('fake cup open', 2026);
    await store.findTournament('fake cup open', null);
    expect(calls[0]?.query).toContain('series_key=eq.fake cup open&edition_year=eq.2026');
    expect(calls[1]?.query).toContain('edition_year=is.null');
  });

  it('resolves tournament aliases in two reads', async () => {
    const { calls, store } = mock((c) => (c.path === 'tournament_aliases' ? [{ tournament_id: UUID }] : []));
    await store.findTournamentsByAlias(['fake cup']);
    expect(calls.map((c) => c.path)).toEqual(['tournament_aliases', 'tournaments']);
    expect(calls[1]?.query).toContain(UUID);
    expect(await mock().store.findTournamentsByAlias([])).toEqual([]);
  });

  it('adds aliases with ignore-duplicates on the unique pair, so a re-run is a no-op', async () => {
    const { calls, store } = mock();
    await store.addTournamentAlias('t', UUID);
    await store.addPlayerAlias({ id: UUID, alias_normalized: 'x y', player_id: UUID, status: 'provisional', scope_tournament_id: UUID, scope_district: null, created_by: 'sync' });
    expect(calls.map((c) => [c.path, c.query, c.prefer])).toEqual([
      ['tournament_aliases', 'on_conflict=alias_normalized,tournament_id', 'return=minimal,resolution=ignore-duplicates'],
      ['player_aliases', 'on_conflict=alias_normalized,player_id', 'return=minimal,resolution=ignore-duplicates'],
    ]);
  });

  it('inserts a match once per video (conflict on video_id is ignored) and participants on (match, side, position)', async () => {
    const { calls, store } = mock();
    await store.insertMatch({ id: UUID, video_id: 'fake-x', tournament_id: null, category: null, age_group: null, round: null, format: 'unknown', played_on: null, match_key: null, duplicate_of: null, winner_side: null, score_text: null, publish_state: 'held', minor_hold: false, manual_override: {} });
    await store.insertParticipants([{ id: UUID, match_id: UUID, side: 'A', position: 1, raw_name: 'X Y', player_id: null, resolution: 'plain_text', identity_tier: 'multi_token', link_policy: 'plain_text_only', truncated: false, age_status: 'unknown', age_signal: [], seed: null, country: null, district_hint: null, affiliation_hint: null }]);
    expect(calls[0]?.query).toBe('on_conflict=video_id');
    expect(calls[0]?.prefer).toContain('ignore-duplicates');
    expect(calls[1]?.query).toBe('on_conflict=match_id,side,position');
  });

  it('deletes only participant rows (the one table here with a delete grant) and only by uuid', async () => {
    const { calls, store } = mock();
    await store.deleteParticipants([UUID, 'bad,id']);
    expect(calls).toHaveLength(1);
    expect(calls[0]).toMatchObject({ method: 'DELETE', path: 'match_participants' });
    expect(calls[0]?.query).not.toContain('bad');
  });

  it('raises a player age with PATCH on the id only (the database never lowers it)', async () => {
    const { calls, store } = mock();
    await store.updatePlayerAge(UUID, 'minor_suspected', ['junior_category:BS']);
    expect(calls[0]).toMatchObject({ method: 'PATCH', path: 'players', body: { age_status: 'minor_suspected', age_signal: ['junior_category:BS'] } });
    expect(calls[0]?.query).toContain(`id=eq.${UUID}`);
  });

  it('looks up near players by name key and a Latin prefix, rejects an odd prefix, and respects the limit', async () => {
    const { calls, store } = mock((c) => (c.query.includes('name_key') ? [{ id: 'a' }, { id: 'b' }] : [{ id: 'b' }, { id: 'c' }]));
    const rows = await store.findPlayersNear('x|y', 'abc', 2);
    expect(rows).toHaveLength(2);
    expect(calls).toHaveLength(2);
    expect(calls.every((c) => c.query.includes('merged_into=is.null'))).toBe(true);
    const odd = mock();
    await odd.store.findPlayersNear(null, '*) or (1=1', 10);
    expect(odd.calls).toHaveLength(0);
  });

  it('writes possible duplicates to the append-only audit_log in batches, no select back', async () => {
    const { calls, store } = mock();
    await store.recordAudit(Array.from({ length: 120 }, (_, i) => ({ actor: 'sync', action: 'possible_duplicate', entity: 'player', entity_id: String(i), diff: { reason: 'same_name_key' }, reason: null })));
    expect(calls.map((c) => (c.body as unknown[]).length)).toEqual([50, 50, 20]);
    expect(calls.every((c) => c.path === 'audit_log' && c.method === 'POST')).toBe(true);
  });
});
