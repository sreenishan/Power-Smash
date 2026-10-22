import { describe, expect, it } from 'vitest';
import {
  addRedirect,
  applyMergeUndo,
  canConfirmAdult,
  decideMergeStatus,
  editDistance,
  findPossibleDuplicates,
  inheritForSplit,
  isSuppressed,
  matchAlias,
  mergeAgeStatus,
  moveAliases,
  planMerge,
  planRename,
  planSplit,
  removeRedirectsFor,
  suppressionsForPlayer,
  type IdAlias,
  type IdentityState,
  type IdPlayer,
} from '../../src/lib/identity';

let n = 0;
const newId = () => `00000000-0000-4000-8000-${String(++n).padStart(12, '0')}`;

function player(over: Partial<IdPlayer> & { id: string; displayName: string }): IdPlayer {
  return {
    slug: over.displayName.toLowerCase().replace(/ /g, '-'),
    ageStatus: 'adult_confirmed',
    ageSignals: [],
    nameKey: null,
    latinKey: null,
    provisional: false,
    consentStatus: 'unknown',
    visibility: 'public',
    mergedInto: null,
    ...over,
  };
}
const alias = (id: string, a: string, playerId: string, over: Partial<IdAlias> = {}): IdAlias => ({
  id,
  aliasNormalized: a,
  playerId,
  status: 'confirmed',
  scopeTournamentId: null,
  scopeDistrict: null,
  ...over,
});

const A = '11111111-1111-4111-8111-111111111111';
const B = '22222222-2222-4222-8222-222222222222';
const C = '33333333-3333-4333-8333-333333333333';

describe('status rules (D-012)', () => {
  it('merge takes the more restrictive status', () => {
    expect(mergeAgeStatus('adult_confirmed', 'unknown')).toBe('unknown');
    expect(mergeAgeStatus('minor_suspected', 'unknown')).toBe('minor_suspected');
    expect(mergeAgeStatus('minor_confirmed', 'minor_suspected')).toBe('minor_confirmed');
  });
  it('blocks minor + adult_confirmed without override, and demands a reason', () => {
    const a = player({ id: A, displayName: 'Test Alpha' });
    const b = player({ id: B, displayName: 'Test Beta', ageStatus: 'minor_suspected' });
    expect(decideMergeStatus(a, b)).toEqual({ allowed: false, code: 'MINOR_ADULT_MERGE_BLOCKED' });
    expect(decideMergeStatus(b, a)).toEqual({ allowed: false, code: 'MINOR_ADULT_MERGE_BLOCKED' });
    expect(decideMergeStatus(a, b, { reason: '  ' })).toEqual({ allowed: false, code: 'OVERRIDE_REASON_REQUIRED' });
    const ok = decideMergeStatus(a, b, { reason: 'same person, parent confirmed' });
    expect(ok).toMatchObject({ allowed: true, ageStatus: 'minor_suspected', overrideLogged: { reason: 'same person, parent confirmed' } });
  });
  it('unknown + adult merges without override but result is unknown', () => {
    const a = player({ id: A, displayName: 'Test Alpha' });
    const b = player({ id: B, displayName: 'Test Beta', ageStatus: 'unknown' });
    expect(decideMergeStatus(a, b)).toMatchObject({ allowed: true, ageStatus: 'unknown', overrideLogged: null });
  });
  it('split inherits status and signals and is provisional', () => {
    const p = player({ id: A, displayName: 'Test Alpha', ageStatus: 'minor_confirmed', ageSignals: ['age_token:U13'], consentStatus: 'withdrawn' });
    expect(inheritForSplit(p)).toEqual({ ageStatus: 'minor_confirmed', ageSignals: ['age_token:U13'], consentStatus: 'withdrawn', provisional: true });
  });
  it('confirm adult: never from minor_confirmed, withdrawn consent or merged rows', () => {
    expect(canConfirmAdult(player({ id: A, displayName: 'x y', ageStatus: 'unknown' }))).toEqual({ ok: true });
    expect(canConfirmAdult(player({ id: A, displayName: 'x y', ageStatus: 'minor_suspected' }))).toEqual({ ok: true });
    expect(canConfirmAdult(player({ id: A, displayName: 'x y', ageStatus: 'minor_confirmed' }))).toMatchObject({ ok: false });
    expect(canConfirmAdult(player({ id: A, displayName: 'x y', ageStatus: 'unknown', consentStatus: 'withdrawn' }))).toMatchObject({ ok: false });
    expect(canConfirmAdult(player({ id: A, displayName: 'x y', ageStatus: 'unknown', mergedInto: B }))).toMatchObject({ ok: false });
    expect(canConfirmAdult(player({ id: A, displayName: 'x y' }))).toMatchObject({ ok: false });
  });
});

describe('redirects', () => {
  it('flattens chains and rejects loops', () => {
    let r = addRedirect([], 'a', 'b', 301);
    expect(r.ok && r.redirects).toEqual([{ fromSlug: 'a', toSlug: 'b', type: 301 }]);
    r = addRedirect(r.ok ? r.redirects : [], 'b', 'c', 301);
    expect(r.ok && r.redirects).toEqual([
      { fromSlug: 'a', toSlug: 'c', type: 301 },
      { fromSlug: 'b', toSlug: 'c', type: 301 },
    ]);
    expect(addRedirect(r.ok ? r.redirects : [], 'c', 'a', 301)).toEqual({ ok: false, code: 'REDIRECT_LOOP' });
    expect(addRedirect([], 'a', 'a', 301)).toEqual({ ok: false, code: 'SAME_SLUG' });
  });
  it('410 turns inbound redirects into 410', () => {
    const r = addRedirect([{ fromSlug: 'old', toSlug: 'a', type: 301 }], 'a', null, 410);
    expect(r.ok && r.redirects).toEqual([
      { fromSlug: 'old', toSlug: null, type: 410 },
      { fromSlug: 'a', toSlug: null, type: 410 },
    ]);
  });
  it('emergency hide removes redirects and serves 410', () => {
    expect(removeRedirectsFor([{ fromSlug: 'o', toSlug: 'a', type: 301 }], 'a')).toEqual([{ fromSlug: 'a', toSlug: null, type: 410 }]);
  });
});

describe('alias matching tiers (PC-01)', () => {
  const players = [player({ id: A, displayName: 'Test Alpha Kumar' }), player({ id: B, displayName: 'Test Alpha Kumar' })];
  it('single token or initials-only is never linked unscoped', () => {
    const aliases = [alias('1', 'ganesh', A)];
    expect(matchAlias('GANESH', aliases, players)).toEqual({ tier: 'text_only' });
    expect(matchAlias('S K', aliases, players)).toEqual({ tier: 'text_only' });
  });
  it('single token links only inside its tournament scope', () => {
    const aliases = [alias('1', 'ganesh', A, { scopeTournamentId: 't1' })];
    expect(matchAlias('GANESH', aliases, players, { tournamentId: 't1' })).toEqual({ tier: 'confirmed', playerId: A });
    expect(matchAlias('GANESH', aliases, players, { tournamentId: 't2' })).toEqual({ tier: 'text_only' });
  });
  it('multi-token: one confirmed = link, two = ambiguous, none = provisional', () => {
    expect(matchAlias('Test Alpha', [alias('1', 'test alpha', A)], players)).toEqual({ tier: 'confirmed', playerId: A });
    expect(matchAlias('Test Alpha', [alias('1', 'test alpha', A), alias('2', 'test alpha', B)], players)).toEqual({ tier: 'ambiguous', candidates: [A, B] });
    expect(matchAlias('Test Alpha', [], players)).toEqual({ tier: 'provisional' });
  });
  it('a rejected row makes a split stick; merged players are ignored; candidate rows never link', () => {
    expect(matchAlias('Test Alpha', [alias('1', 'test alpha', A), alias('2', 'test alpha', A, { status: 'rejected' })], players)).toEqual({ tier: 'provisional' });
    expect(matchAlias('Test Alpha', [alias('1', 'test alpha', C)], players)).toEqual({ tier: 'provisional' });
    expect(matchAlias('Test Alpha', [alias('1', 'test alpha', A, { status: 'provisional' })], players)).toEqual({ tier: 'provisional' });
    const merged = [player({ id: A, displayName: 'T A', mergedInto: B }), players[1]!];
    expect(matchAlias('Test Alpha', [alias('1', 'test alpha', A)], merged)).toEqual({ tier: 'provisional' });
  });
  it('moveAliases dedupes; confirmed outranks an old rejection (B2-13)', () => {
    const out = moveAliases([alias('1', 'x y', A), alias('2', 'x y', B, { status: 'rejected' }), alias('3', 'z w', B)], B, A);
    expect(out.filter((a) => a.playerId === A).map((a) => [a.aliasNormalized, a.status])).toEqual([['x y', 'confirmed'], ['z w', 'confirmed']]);
    expect(out.some((a) => a.playerId === B)).toBe(false);
  });
});

describe('possible duplicates (never auto-merge)', () => {
  it('edit distance with cutoff', () => {
    expect(editDistance('kitten', 'sitting')).toBe(3);
    expect(editDistance('abc', 'abcdef', 1)).toBe(2);
  });
  it('finds close spellings and initial-order variants, skips dismissed, flags weak and override pairs', () => {
    const ps = [
      player({ id: A, displayName: 'Arunkumar Selvam' }),
      player({ id: B, displayName: 'Arunkumar Selvan' }),
      player({ id: C, displayName: 'Selvam Arunkumar' }),
      player({ id: '44444444-4444-4444-8444-444444444444', displayName: 'GANESH' }),
      player({ id: '55555555-5555-4555-8555-555555555555', displayName: 'Ganesh', ageStatus: 'minor_suspected' }),
      player({ id: '66666666-6666-4666-8666-666666666666', displayName: 'Karthik S' }),
      player({ id: '77777777-7777-4777-8777-777777777777', displayName: 'S. Karthik' }),
    ];
    const pairs = findPossibleDuplicates(ps);
    expect(pairs.find((p) => p.aId === A && p.bId === B)).toMatchObject({ reason: 'close_spelling', strength: 'strong', distance: 1 });
    expect(pairs.find((p) => p.aId === A && p.bId === C)).toBeUndefined();
    expect(pairs.find((p) => p.aId.startsWith('4') && p.bId.startsWith('5'))).toMatchObject({ strength: 'weak', needsOverride: true, reason: 'same_name_key' });
    expect(pairs.find((p) => p.aId.startsWith('6') && p.bId.startsWith('7'))).toMatchObject({ reason: 'same_name_key', strength: 'weak' });
    const dismissed = findPossibleDuplicates(ps, { dismissed: [`${A}|${B}`] });
    expect(dismissed.find((p) => p.aId === A && p.bId === B)).toBeUndefined();
  });
  it('ignores merged players', () => {
    expect(findPossibleDuplicates([player({ id: A, displayName: 'Same Name' }), player({ id: B, displayName: 'Same Name', mergedInto: A })])).toEqual([]);
  });
});

describe('suppression', () => {
  it('matches by normalised name, youtube id and player id', () => {
    const list = suppressionsForPlayer({ id: A, displayName: 'Test Alpha' });
    expect(isSuppressed(list, { name: 'TEST  alpha' })).toBe(true);
    expect(isSuppressed(list, { playerId: A })).toBe(true);
    expect(isSuppressed(list, { name: 'Other Person' })).toBe(false);
    expect(isSuppressed([{ kind: 'youtube_id', key: 'fake-vid-1' }], { youtubeId: 'fake-vid-1' })).toBe(true);
  });
});

function stateOf(players: IdPlayer[], aliases: IdAlias[] = [], redirects: IdentityState['redirects'] = []): IdentityState {
  return { players, aliases, redirects };
}

describe('planMerge', () => {
  const a = player({ id: A, displayName: 'Test Alpha', slug: 'test-alpha' });
  const b = player({ id: B, displayName: 'Test Alfa', slug: 'test-alfa' });
  it('merges two adults: alias moved, redirect created, drop tombstoned', () => {
    const r = planMerge(stateOf([a, b], [alias('1', 'test alfa', B)]), { keepId: A, dropId: B, newId });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.state.players.find((p) => p.id === B)).toMatchObject({ mergedInto: A, visibility: 'hidden' });
    expect(r.state.aliases.every((x) => x.playerId === A)).toBe(true);
    expect(r.state.redirects).toEqual([{ fromSlug: 'test-alfa', toSlug: 'test-alpha', type: 301 }]);
    expect(r.audit.action).toBe('player.merge');
  });
  it('undo restores the exact before-state', () => {
    const s = stateOf([a, b], [alias('1', 'test alfa', B)]);
    const r = planMerge(s, { keepId: A, dropId: B, newId });
    if (!r.ok) throw new Error('x');
    expect(applyMergeUndo(r.state, r.undo)).toEqual(s);
  });
  it('merging into a protected result retires public slugs with 410 and an opaque slug', () => {
    const u = player({ id: B, displayName: 'Test Alfa', slug: 'test-alfa', ageStatus: 'unknown' });
    const r = planMerge(stateOf([a, u]), { keepId: A, dropId: B, newId });
    if (!r.ok) throw new Error('x');
    const keep = r.state.players.find((p) => p.id === A)!;
    expect(keep.ageStatus).toBe('unknown');
    expect(keep.slug).toMatch(/^p-[0-9a-f]{16}$/);
    expect(r.state.redirects).toEqual([{ fromSlug: 'test-alpha', toSlug: null, type: 410 }]);
    // the protected drop never had a page: no redirect for it
    expect(r.state.redirects.some((x) => x.fromSlug === u.slug)).toBe(false);
  });
  it('blocked minor/adult merge, logged override passes', () => {
    const m = player({ id: B, displayName: 'Test Alfa', slug: 'p-aaaaaaaaaaaaaaaa', ageStatus: 'minor_confirmed' });
    expect(planMerge(stateOf([a, m]), { keepId: A, dropId: B, newId })).toEqual({ ok: false, code: 'MINOR_ADULT_MERGE_BLOCKED' });
    const r = planMerge(stateOf([a, m]), { keepId: A, dropId: B, newId, override: { reason: 'verified same person' } });
    expect(r.ok && r.overrideLogged).toEqual({ reason: 'verified same person' });
    expect(r.ok && r.state.players.find((p) => p.id === A)!.ageStatus).toBe('minor_confirmed');
  });
  it('refuses self, already merged, missing and suppressed', () => {
    expect(planMerge(stateOf([a, b]), { keepId: A, dropId: A, newId })).toMatchObject({ code: 'SAME_PLAYER' });
    expect(planMerge(stateOf([a, { ...b, mergedInto: C }]), { keepId: A, dropId: B, newId })).toMatchObject({ code: 'ALREADY_MERGED' });
    expect(planMerge(stateOf([a]), { keepId: A, dropId: B, newId })).toMatchObject({ code: 'NOT_FOUND' });
    expect(planMerge(stateOf([a, b]), { keepId: A, dropId: B, newId, suppressions: [{ kind: 'player_id', key: B }] })).toMatchObject({ code: 'SUPPRESSED' });
  });
});

describe('planSplit', () => {
  const parent = player({ id: A, displayName: 'Test Alpha', slug: 'test-alpha', ageStatus: 'minor_suspected', ageSignals: ['age_token:U15'] });
  it('child inherits protection, is provisional and hidden, opaque slug, rejected row on the parent', () => {
    const p = { ...parent, slug: 'p-1111111111111111' };
    const r = planSplit(stateOf([p], [alias('al1', 'test beta', A)]), { playerId: A, newPlayerId: C, newDisplayName: 'Test Beta', moveAliasIds: ['al1'], newId });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.child).toMatchObject({ ageStatus: 'minor_suspected', ageSignals: ['age_token:U15'], provisional: true, visibility: 'hidden' });
    expect(r.child.slug).toMatch(/^p-/);
    expect(r.state.aliases.find((x) => x.id === 'al1')!.playerId).toBe(C);
    expect(r.state.aliases.some((x) => x.playerId === A && x.status === 'rejected' && x.aliasNormalized === 'test beta')).toBe(true);
  });
  it('re-sync after split does not re-link the moved alias to the parent', () => {
    const p = player({ id: A, displayName: 'Test Alpha', slug: 'test-alpha' });
    const r = planSplit(stateOf([p], [alias('al1', 'test beta', A)]), { playerId: A, newPlayerId: C, newDisplayName: 'Test Beta', moveAliasIds: ['al1'], newId });
    if (!r.ok) throw new Error('x');
    expect(matchAlias('Test Beta', r.state.aliases, r.state.players)).toEqual({ tier: 'confirmed', playerId: C });
  });
  it('errors: empty name, foreign alias, merged parent', () => {
    const p = player({ id: A, displayName: 'Test Alpha' });
    expect(planSplit(stateOf([p]), { playerId: A, newPlayerId: C, newDisplayName: '  .. ', newId })).toMatchObject({ code: 'EMPTY_NAME' });
    expect(planSplit(stateOf([p]), { playerId: A, newPlayerId: C, newDisplayName: 'New Person', moveAliasIds: ['nope'], newId })).toMatchObject({ code: 'ALIAS_NOT_OWNED' });
    expect(planSplit(stateOf([{ ...p, mergedInto: B }]), { playerId: A, newPlayerId: C, newDisplayName: 'New Person', newId })).toMatchObject({ code: 'ALREADY_MERGED' });
  });
});

describe('planRename', () => {
  it('adult rename changes slug, redirects the old one, keeps the old name as alias', () => {
    const a = player({ id: A, displayName: 'Test Alpha', slug: 'test-alpha' });
    const r = planRename(stateOf([a]), { playerId: A, newDisplayName: 'Test Alfa', newId });
    if (!r.ok) throw new Error('x');
    const p = r.state.players[0]!;
    expect(p.slug).toBe('test-alfa');
    expect(r.state.redirects).toEqual([{ fromSlug: 'test-alpha', toSlug: 'test-alfa', type: 301 }]);
    expect(r.state.aliases.map((x) => x.aliasNormalized).sort()).toEqual(['test alfa', 'test alpha']);
  });
  it('slug collision gets a counter', () => {
    const a = player({ id: A, displayName: 'Test Alpha', slug: 'test-alpha' });
    const b = player({ id: B, displayName: 'Test Alfa', slug: 'test-alfa' });
    const r = planRename(stateOf([a, b]), { playerId: A, newDisplayName: 'Test Alfa', newId });
    expect(r.ok && r.state.players[0]!.slug).toBe('test-alfa-2');
  });
  it('protected rename never changes the slug and creates no redirect', () => {
    const a = player({ id: A, displayName: 'Test Alpha', slug: 'p-1111111111111111', ageStatus: 'unknown' });
    const r = planRename(stateOf([a]), { playerId: A, newDisplayName: 'Test Alfa', newId });
    expect(r.ok && r.state.players[0]!.slug).toBe('p-1111111111111111');
    expect(r.ok && r.state.redirects).toEqual([]);
  });
  it('empty name rejected', () => {
    expect(planRename(stateOf([player({ id: A, displayName: 'T A' })]), { playerId: A, newDisplayName: '...', newId })).toMatchObject({ code: 'EMPTY_NAME' });
  });
});
