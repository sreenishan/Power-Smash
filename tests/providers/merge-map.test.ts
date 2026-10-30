// Conflict policy, validation and mapping onto the competition vocabulary. Fictional data only.
import { describe, expect, it } from 'vitest';
import { LOCAL_ONLY_FIELDS, drawData, entryLocalId, playerData, rankingData, toCompetitionEntry, toMatchResult, tournamentData } from '../../src/lib/providers/map';
import { deepEqual, mergeRecord, stableStringify } from '../../src/lib/providers/merge';
import { isIsoDate, isIsoInstant, localIdOf, validateDraw, validateMatch, validateRanking, validateTournament } from '../../src/lib/providers/types';
import { FAKE_PROVIDER_ID, fictionalDraw, fictionalMatch, fictionalRanking, fictionalTournament } from './fake-provider';

describe('mergeRecord (conflict policy)', () => {
  it('takes provider values for unverified fields', () => {
    const m = mergeRecord({ name: 'Old', city: 'A' }, [], { name: 'New', city: 'A' });
    expect(m.data).toEqual({ name: 'New', city: 'A' });
    expect(m.changed).toBe(true);
    expect(m.conflicts).toEqual([]);
  });

  it('NEVER overwrites a manually verified field, and reports the conflict', () => {
    const m = mergeRecord({ name: 'Owner Fixed Name', city: 'A' }, ['name'], { name: 'Provider Name', city: 'B' });
    expect(m.data['name']).toBe('Owner Fixed Name');
    expect(m.data['city']).toBe('B');
    expect(m.conflicts).toEqual([{ field: 'name', localValue: 'Owner Fixed Name', providerValue: 'Provider Name' }]);
  });

  it('a verified field equal to the provider value is not a conflict', () => {
    expect(mergeRecord({ games: [{ a: 21, b: 1 }] }, ['games'], { games: [{ b: 1, a: 21 }] }).conflicts).toEqual([]);
  });

  it('never erases a local value because the provider omitted it (null or undefined or absent)', () => {
    const m = mergeRecord({ city: 'Testville', level: 'X', extra: 'local note' }, [], { city: null, level: undefined });
    expect(m.data).toEqual({ city: 'Testville', level: 'X', extra: 'local note' });
    expect(m.changed).toBe(false);
    expect(m.keptOmitted.sort()).toEqual(['city', 'level']);
  });

  it('a provider null over nothing is stored as null', () => {
    expect(mergeRecord({}, [], { city: null }).data).toEqual({ city: null });
  });

  it('local-only fields are never touched once present', () => {
    const m = mergeRecord({ ageStatus: 'adult_confirmed' }, [], { ageStatus: 'unknown' }, ['ageStatus']);
    expect(m.data['ageStatus']).toBe('adult_confirmed');
    expect(m.changed).toBe(false);
  });

  it('stableStringify ignores key order and undefined', () => {
    expect(stableStringify({ b: 1, a: [1, { d: 2, c: undefined }] })).toBe('{"a":[1,{"d":2}],"b":1}');
    expect(deepEqual({ a: 1, b: 2 }, { b: 2, a: 1 })).toBe(true);
    expect(deepEqual([1, 2], [2, 1])).toBe(false);
  });
});

describe('validators (fail closed)', () => {
  it('accepts the fictional fixtures', () => {
    expect(validateTournament(fictionalTournament(1))).toEqual([]);
    expect(validateDraw(fictionalDraw('T1'))).toEqual([]);
    expect(validateMatch(fictionalMatch('T1', 1))).toEqual([]);
    expect(validateRanking(fictionalRanking(1))).toEqual([]);
  });
  it('rejects malformed items', () => {
    expect(validateTournament(fictionalTournament(1, { externalId: ' ' }))).not.toEqual([]);
    expect(validateTournament(fictionalTournament(1, { startDate: '2026-02-30' }))).not.toEqual([]);
    expect(validateTournament(fictionalTournament(1, { startDate: '2026-03-05', endDate: '2026-03-01' }))).not.toEqual([]);
    expect(validateTournament(fictionalTournament(1, { events: [{ externalId: 'e', name: 'x', category: 'ZZ' as never }] }))).not.toEqual([]);
    expect(validateDraw(fictionalDraw('T1', { entries: [{ externalId: 'e', playerExternalIds: ['a', 'b', 'c'], seed: null }] }))).not.toEqual([]);
    expect(validateDraw(fictionalDraw('T1', { entries: [{ externalId: 'e', playerExternalIds: ['a'], seed: 0 }] }))).not.toEqual([]);
    expect(validateDraw(fictionalDraw('T1', { kind: 'swiss' as never }))).not.toEqual([]);
    expect(validateMatch(fictionalMatch('T1', 1, { status: 'won' as never }))).not.toEqual([]);
    expect(validateMatch(fictionalMatch('T1', 1, { round: 'R3' as never }))).not.toEqual([]);
    expect(validateMatch(fictionalMatch('T1', 1, { games: [{ a: 21.5, b: 3 }] }))).not.toEqual([]);
    expect(validateMatch(fictionalMatch('T1', 1, { updatedAt: 'yesterday' }))).not.toEqual([]);
    expect(validateRanking({ ...fictionalRanking(1), asOf: '10/03/2026' })).not.toEqual([]);
    expect(validateRanking({ ...fictionalRanking(1), rows: [{ rank: 0, playerExternalIds: ['P1'], points: 1 }] })).not.toEqual([]);
  });

  it('validators are total: malformed shapes return problems and never throw', () => {
    for (const v of [validateTournament, validateDraw, validateMatch, validateRanking]) {
      for (const bad of [null, undefined, {}, [], 'x', 42]) {
        expect(() => v(bad)).not.toThrow();
        expect(v(bad)).not.toEqual([]);
      }
    }
    expect(validateTournament({ ...fictionalTournament(1), events: undefined })).toContain('events is not a list');
    expect(validateTournament({ ...fictionalTournament(1), events: [null] })).toContain('an event is not an object');
    expect(validateDraw({ ...fictionalDraw('T1'), entries: undefined })).toContain('entries is not a list');
    expect(validateDraw({ ...fictionalDraw('T1'), players: undefined })).toContain('players is not a list');
    expect(validateDraw({ ...fictionalDraw('T1'), entries: [{ externalId: 'e', playerExternalIds: undefined, seed: null }] })).toContain('entry e players is not a list of ids');
    expect(validateDraw({ ...fictionalDraw('T1'), entries: [null], players: [7] })).toEqual(['an entry is not an object', 'a player is not an object']);
    expect(validateMatch({ ...fictionalMatch('T1', 1), games: undefined })).toContain('games is not a list');
    expect(validateMatch({ ...fictionalMatch('T1', 1), games: [null] })).toContain('a game score is not a whole number');
    expect(validateRanking({ ...fictionalRanking(1), rows: undefined })).toContain('rows is not a list');
    expect(validateRanking({ ...fictionalRanking(1), rows: [{ rank: 1, playerExternalIds: 'P1', points: 1 }] })).toContain('a ranking row players is not a list of ids');
  });
  it('date helpers', () => {
    expect(isIsoDate('2024-02-29')).toBe(true);
    expect(isIsoDate('2026-02-29')).toBe(false);
    expect(isIsoInstant('2026-03-05T04:30:00Z')).toBe(true);
    expect(isIsoInstant('2026-03-05T04:30:00+05:30')).toBe(true);
    expect(isIsoInstant('2026-03-05')).toBe(false);
  });
});

describe('mapping', () => {
  it('imported players are ALWAYS protected (ageStatus unknown), whatever the hint says (D-012)', () => {
    for (const ageHint of ['adult', 'junior', 'unknown'] as const) {
      expect(playerData({ externalId: 'P9', name: 'Test Player', countryCode: null, ageHint }).ageStatus).toBe('unknown');
    }
    expect(LOCAL_ONLY_FIELDS.player).toContain('ageStatus');
  });

  it('maps ids to opaque local ids', () => {
    expect(localIdOf({ provider: FAKE_PROVIDER_ID, externalType: 'player', externalId: 'P1' })).toBe(`${FAKE_PROVIDER_ID}:player:P1`);
    const d = drawData(FAKE_PROVIDER_ID, fictionalDraw('T1'));
    expect((d['entries'] as { players: string[] }[])[0]!.players).toEqual([`${FAKE_PROVIDER_ID}:player:P1`]);
    const r = rankingData(FAKE_PROVIDER_ID, fictionalRanking(1));
    expect((r['rows'] as { players: string[] }[])[1]!.players).toEqual([`${FAKE_PROVIDER_ID}:player:P2`]);
    expect(tournamentData(fictionalTournament(1))['name']).toBe('Fictional Test Open 1');
  });

  it('toCompetitionEntry gives a competition Entry', () => {
    const e = toCompetitionEntry(FAKE_PROVIDER_ID, { externalId: 'E1', playerExternalIds: ['P1', 'P2'], seed: 2 });
    expect(e).toEqual({ id: entryLocalId(FAKE_PROVIDER_ID, 'E1'), players: [`${FAKE_PROVIDER_ID}:player:P1`, `${FAKE_PROVIDER_ID}:player:P2`], seed: 2 });
    expect('seed' in toCompetitionEntry(FAKE_PROVIDER_ID, { externalId: 'E2', playerExternalIds: ['P1'], seed: null })).toBe(false);
  });

  it('toMatchResult is NOT confirmed by default; only when the caller trusts a final result', () => {
    const m = fictionalMatch('T1', 1);
    expect(toMatchResult(m)).toMatchObject({ status: 'completed', winner: 'A', confirmed: false });
    expect(toMatchResult(m, { trustProviderFinal: true })?.confirmed).toBe(true);
    expect(toMatchResult({ ...m, final: false }, { trustProviderFinal: true })?.confirmed).toBe(false);
  });

  it('toMatchResult: undecided => null, abandoned => no winner, decided without a winner => null', () => {
    expect(toMatchResult(fictionalMatch('T1', 1, { status: 'scheduled', winner: null, games: [] }))).toBeNull();
    expect(toMatchResult(fictionalMatch('T1', 1, { status: 'abandoned', winner: 'A' }))).toMatchObject({ status: 'abandoned', winner: null, confirmed: false });
    expect(toMatchResult(fictionalMatch('T1', 1, { status: 'walkover', winner: null }))).toBeNull();
    expect(toMatchResult(fictionalMatch('T1', 1, { status: 'retired', winner: 'B' }))?.winner).toBe('B');
  });
});
