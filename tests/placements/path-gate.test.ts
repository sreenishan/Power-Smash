import { describe, expect, it } from 'vitest';
import { PATH_GATE_TTL_MS, createPathGate } from '../../src/lib/placements/path-gate';
import type { SupabaseRest } from '../../src/lib/supabase/rest';

function fakeDb(players: string[], tournaments: string[], counter = { n: 0 }, fail = { on: false }): SupabaseRest {
  return {
    select: (async (table: string) => {
      counter.n += 1;
      if (fail.on) throw new Error('db down');
      return (table === 'public_players' ? players : tournaments).map((slug) => ({ slug }));
    }) as SupabaseRest['select'],
  } as SupabaseRest;
}

describe('public path allow-list for the beacon (S2-3)', () => {
  it('accepts home and the index pages, listed players and tournaments; refuses everything else', async () => {
    const gate = createPathGate(fakeDb(['fictional-player'], ['fictional-open']));
    for (const p of ['/', '/players/', '/matches/', '/tournaments/', '/players/fictional-player/', '/tournaments/fictional-open/']) expect(await gate(p), p).toBe(true);
    for (const p of ['/players/p-3fa9c1/', '/players/unknown-name/', '/tournaments/ghost/', '/matches/match-abc12345/', '/matches/any/', '/gear/', '/book/', '/admin/']) expect(await gate(p), p).toBe(false);
  });

  it('reads only public, indexable rows (noindex minimal players and ineligible tournaments are filtered in the query)', async () => {
    const queries: string[] = [];
    const db = { select: (async (t: string, q: string) => (queries.push(`${t}?${q}`), [])) as SupabaseRest['select'] } as SupabaseRest;
    await createPathGate(db)('/players/x/');
    expect(queries.some((q) => q.startsWith('public_players?noindex=eq.false'))).toBe(true);
    expect(queries.some((q) => q.startsWith('public_tournaments?page_eligible=eq.true'))).toBe(true);
  });

  it('caches, then keeps the last good list when a refresh fails; with no list at all it refuses', async () => {
    let t = 0;
    const counter = { n: 0 };
    const fail = { on: false };
    const gate = createPathGate(fakeDb(['fictional-player'], [], counter, fail), () => t);
    expect(await gate('/players/fictional-player/')).toBe(true);
    const first = counter.n;
    expect(await gate('/players/fictional-player/')).toBe(true);
    expect(counter.n).toBe(first);
    t += PATH_GATE_TTL_MS + 1;
    fail.on = true;
    expect(await gate('/players/fictional-player/')).toBe(true);
    const cold = createPathGate(fakeDb([], [], { n: 0 }, { on: true }));
    expect(await cold('/players/fictional-player/')).toBe(false);
    expect(await cold('/')).toBe(true);
  });
});
