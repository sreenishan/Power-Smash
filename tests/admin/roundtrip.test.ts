// Property tests for merge / split / rename round trips (review finding B2-13): no alias is lost, redirects are created, operations are idempotent.
import { describe, expect, it } from 'vitest';
import { matchAlias, planMerge, planRename, planSplit, type IdAlias, type IdentityState, type IdPlayer } from '../../src/lib/identity';

const A = '11111111-1111-4111-8111-111111111111';
const B = '22222222-2222-4222-8222-222222222222';

let n = 0;
const newId = () => `00000000-0000-4000-8000-${String(++n).padStart(12, '0')}`;

const player = (id: string, displayName: string, over: Partial<IdPlayer> = {}): IdPlayer => ({
  id,
  slug: displayName.toLowerCase().replace(/ /g, '-'),
  displayName,
  ageStatus: 'adult_confirmed',
  ageSignals: [],
  nameKey: null,
  latinKey: null,
  provisional: false,
  consentStatus: 'unknown',
  visibility: 'public',
  mergedInto: null,
  ...over,
});
const alias = (id: string, a: string, playerId: string, over: Partial<IdAlias> = {}): IdAlias => ({ id, aliasNormalized: a, playerId, status: 'confirmed', scopeTournamentId: null, scopeDistrict: null, ...over });

/** mulberry32: a tiny seeded generator so failures reproduce. */
function rng(seed: number) {
  return () => {
    seed |= 0;
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const confirmedKeys = (s: IdentityState, playerId: string): Set<string> => new Set(s.aliases.filter((a) => a.playerId === playerId && a.status === 'confirmed' && a.scopeTournamentId === null).map((a) => a.aliasNormalized));

describe('B2-13: split then merge back keeps the alias', () => {
  const base = (): IdentityState => ({
    players: [player(A, 'Arun Kumar', { slug: 'arun-kumar' })],
    aliases: [alias('a1', 'arun kumar', A), alias('a2', 'a kumar', A)],
    redirects: [],
  });

  it('the exact repro from the review: the re-joined name links to the survivor', () => {
    const s0 = base();
    const split = planSplit(s0, { playerId: A, newPlayerId: B, newDisplayName: 'Arun Kumarr', moveAliasIds: ['a2'], newId });
    if (!split.ok) throw new Error('split');
    const merged = planMerge(split.state, { keepId: A, dropId: B, newId });
    if (!merged.ok) throw new Error('merge');
    expect(matchAlias('A Kumar', merged.state.aliases, merged.state.players)).toEqual({ tier: 'confirmed', playerId: A });
    expect(confirmedKeys(merged.state, A).has('a kumar')).toBe(true);
    expect(merged.state.aliases.some((a) => a.playerId === A && a.aliasNormalized === 'a kumar' && a.status === 'rejected')).toBe(false);
  });

  it('merging always leaves the dropped display name as a CONFIRMED alias of the survivor, even over a rejected or provisional row', () => {
    for (const status of ['rejected', 'provisional'] as const) {
      const s: IdentityState = {
        players: [player(A, 'Meena Devi', { slug: 'meena-devi' }), player(B, 'Meena D', { slug: 'meena-d' })],
        aliases: [alias('x1', 'meena d', A, { status })],
        redirects: [],
      };
      const m = planMerge(s, { keepId: A, dropId: B, newId });
      if (!m.ok) throw new Error('merge');
      expect(confirmedKeys(m.state, A).has('meena d'), status).toBe(true);
      expect(m.state.aliases.filter((a) => a.playerId === A && a.aliasNormalized === 'meena d' && a.scopeTournamentId === null)).toHaveLength(1);
    }
  });
});

describe('merge / split / rename invariants over random sequences', () => {
  it('no confirmed alias is ever lost by a merge, a merge creates the redirect, and a second identical merge changes nothing', () => {
    for (let seed = 1; seed <= 60; seed++) {
      const r = rng(seed);
      const names = ['Arun Kumar', 'Arun Kumarr', 'Meena Devi', 'Meena Devy', 'Karthik Raja', 'Karthik Rajan'];
      const players = names.slice(0, 2 + Math.floor(r() * 4)).map((nm, i) => player(`aaaaaaaa-0000-4000-8000-00000000000${i + 1}`, nm, { slug: nm.toLowerCase().replace(/ /g, '-') }));
      const aliases: IdAlias[] = [];
      players.forEach((p, i) => {
        aliases.push(alias(`al-${i}-0`, p.displayName.toLowerCase(), p.id));
        if (r() < 0.6) aliases.push(alias(`al-${i}-1`, `${p.displayName.toLowerCase()} x${i}`, p.id, { status: r() < 0.3 ? 'rejected' : 'confirmed' }));
      });
      let state: IdentityState = { players, aliases, redirects: [] };
      for (let step = 0; step < 4; step++) {
        const live = state.players.filter((p) => p.mergedInto === null);
        if (live.length < 2) break;
        const op = r();
        if (op < 0.5) {
          const keep = live[Math.floor(r() * live.length)]!;
          const drop = live.filter((p) => p.id !== keep.id)[Math.floor(r() * (live.length - 1))]!;
          const before = state;
          const res = planMerge(state, { keepId: keep.id, dropId: drop.id, newId });
          if (!res.ok) continue;
          // no confirmed alias of either player is lost, or downgraded to non-confirmed, on the survivor
          for (const a of before.aliases.filter((x) => (x.playerId === keep.id || x.playerId === drop.id) && x.status === 'confirmed' && x.scopeTournamentId === null)) {
            expect(confirmedKeys(res.state, keep.id).has(a.aliasNormalized), `seed ${seed}: ${a.aliasNormalized}`).toBe(true);
          }
          // the redirect from the dropped public page to the survivor exists (both adults)
          expect(res.state.redirects.some((x) => x.fromSlug === drop.slug && x.toSlug === keep.slug && x.type === 301), `seed ${seed}`).toBe(true);
          // idempotent: the same merge again is refused and nothing changes
          expect(planMerge(res.state, { keepId: keep.id, dropId: drop.id, newId })).toEqual({ ok: false, code: 'ALREADY_MERGED' });
          state = res.state;
        } else if (op < 0.8) {
          const p = live[Math.floor(r() * live.length)]!;
          const mine = state.aliases.filter((a) => a.playerId === p.id && a.status === 'confirmed');
          const res = planSplit(state, { playerId: p.id, newPlayerId: newId(), newDisplayName: `Zed Person ${step}${seed}`, moveAliasIds: mine.slice(0, 1).map((a) => a.id), newId });
          if (!res.ok) continue;
          // every alias row survives a split (moved or kept), and the parent gets a rejected row for what moved
          for (const a of state.aliases) expect(res.state.aliases.some((x) => x.id === a.id), `seed ${seed}`).toBe(true);
          for (const a of mine.slice(0, 1)) expect(res.state.aliases.some((x) => x.playerId === p.id && x.aliasNormalized === a.aliasNormalized && x.status === 'rejected')).toBe(true);
          // split then merge the child straight back: the moved name links to the parent again
          const back = planMerge(res.state, { keepId: p.id, dropId: res.child.id, newId });
          if (!back.ok) throw new Error(`seed ${seed}: merge back failed ${back.code}`);
          for (const a of mine.slice(0, 1)) {
            if (a.aliasNormalized.split(' ').length >= 2) expect(matchAlias(a.aliasNormalized, back.state.aliases, back.state.players), `seed ${seed}`).toEqual({ tier: 'confirmed', playerId: p.id });
          }
          state = back.state;
        } else {
          const p = live[Math.floor(r() * live.length)]!;
          const newName = `${p.displayName} Jr${seed}${step}`;
          const first = planRename(state, { playerId: p.id, newDisplayName: newName, newId });
          if (!first.ok) continue;
          const second = planRename(first.state, { playerId: p.id, newDisplayName: newName, newId });
          if (!second.ok) throw new Error('second rename');
          // idempotent: renaming to the same name again adds no alias, no redirect, no slug change
          expect(second.state.aliases.length, `seed ${seed}`).toBe(first.state.aliases.length);
          expect(second.state.redirects).toEqual(first.state.redirects);
          expect(second.state.players.find((x) => x.id === p.id)!.slug).toBe(first.state.players.find((x) => x.id === p.id)!.slug);
          // the old name is kept as an alias, the old public slug redirects
          expect(confirmedKeys(first.state, p.id).has(p.displayName.toLowerCase())).toBe(true);
          expect(first.state.redirects.some((x) => x.fromSlug === p.slug && x.type === 301)).toBe(true);
          state = first.state;
        }
        // global invariant: no (alias, player) pair is duplicated
        const keys = state.aliases.map((a) => `${a.playerId}|${a.aliasNormalized}|${a.scopeTournamentId ?? ''}|${a.scopeDistrict ?? ''}|${a.status}`);
        expect(new Set(keys).size, `seed ${seed}: duplicate alias rows`).toBe(keys.length);
        // no redirect chain: a target is never itself redirected
        for (const rd of state.redirects) if (rd.toSlug) expect(state.redirects.some((x) => x.fromSlug === rd.toSlug && x.type === 301), `seed ${seed}: chain`).toBe(false);
      }
    }
  });
});
