import { describe, expect, it } from 'vitest';
import { expiringWithin } from '../../src/lib/placements/expiry';
import { compareForSlot, findOverlaps, hasTie, isLive, istDateOf, resolveOne, resolveSlot } from '../../src/lib/placements/schedule';
import { placement } from './helpers';

describe('istDateOf', () => {
  it('reads the calendar date in India, not UTC', () => {
    expect(istDateOf(new Date('2026-11-01T18:29:59Z'))).toBe('2026-11-01');
    expect(istDateOf(new Date('2026-11-01T18:30:00Z'))).toBe('2026-11-02');
  });
});

describe('isLive', () => {
  const p = placement({ startDate: '2026-11-10', endDate: '2026-11-20' });
  it('is live from the start date through the end date inclusive', () => {
    expect(isLive(p, '2026-11-09')).toBe(false);
    expect(isLive(p, '2026-11-10')).toBe(true);
    expect(isLive(p, '2026-11-20')).toBe(true);
    expect(isLive(p, '2026-11-21')).toBe(false);
  });
  it('is not live unless the status is active', () => {
    for (const status of ['draft', 'paused', 'ended'] as const) expect(isLive({ ...p, status }, '2026-11-15')).toBe(false);
  });
  it('rejects a malformed date', () => {
    expect(isLive(p, '2026-11-1')).toBe(false);
  });
});

describe('resolveSlot', () => {
  it('returns nothing when no placement is live', () => {
    expect(resolveSlot([], { slot: 'player_page_banner', date: '2026-11-05' })).toEqual([]);
    expect(resolveSlot([placement({ endDate: '2026-11-02' })], { slot: 'player_page_banner', date: '2026-11-05' })).toEqual([]);
  });

  it('picks the higher priority in a one-item slot', () => {
    const low = placement({ priority: 1 });
    const high = placement({ priority: 5 });
    expect(resolveOne([low, high], { slot: 'player_page_banner', date: '2026-11-05' })?.id).toBe(high.id);
  });

  it('breaks an equal priority by the earlier start, then by id (stable, never random)', () => {
    const later = placement({ startDate: '2026-11-03' });
    const earlier = placement({ startDate: '2026-11-02' });
    expect(resolveOne([later, earlier], { slot: 'player_page_banner', date: '2026-11-05' })?.id).toBe(earlier.id);
    const a = placement({ startDate: '2026-11-02' });
    const b = placement({ startDate: '2026-11-02' });
    expect(resolveOne([b, a], { slot: 'player_page_banner', date: '2026-11-05' })?.id).toBe(a.id);
    expect(compareForSlot(a, a)).toBe(0);
  });

  it('only looks at the requested slot', () => {
    const other = placement({ slot: 'match_page_banner' });
    expect(resolveSlot([other], { slot: 'player_page_banner', date: '2026-11-05' })).toEqual([]);
  });

  it('a one-tournament placement beats a global one on that tournament page, and is ignored elsewhere', () => {
    const global = placement({ slot: 'tournament_page_banner', priority: 99 });
    const scoped = placement({ slot: 'tournament_page_banner', scopeKey: 'fictional-open', priority: 0 });
    expect(resolveOne([global, scoped], { slot: 'tournament_page_banner', date: '2026-11-05', scopeKey: 'fictional-open' })?.id).toBe(scoped.id);
    expect(resolveOne([global, scoped], { slot: 'tournament_page_banner', date: '2026-11-05', scopeKey: 'other-cup' })?.id).toBe(global.id);
    expect(resolveOne([scoped], { slot: 'tournament_page_banner', date: '2026-11-05' })).toBeNull();
  });

  it('a per-tournament slot shows nothing without a matching tournament', () => {
    const t = placement({ slot: 'tournament_coverage_title', scopeKey: 'fictional-open' });
    expect(resolveOne([t], { slot: 'tournament_coverage_title', date: '2026-11-05' })).toBeNull();
    expect(resolveOne([t], { slot: 'tournament_coverage_title', date: '2026-11-05', scopeKey: 'other-cup' })).toBeNull();
    expect(resolveOne([t], { slot: 'tournament_coverage_title', date: '2026-11-05', scopeKey: 'fictional-open' })?.id).toBe(t.id);
    // a global row in a slot that requires a tournament never applies
    const g = placement({ slot: 'tournament_coverage_title', scopeKey: null });
    expect(resolveOne([g], { slot: 'tournament_coverage_title', date: '2026-11-05', scopeKey: 'fictional-open' })).toBeNull();
  });

  it('a strip shows several partners up to its limit, best first', () => {
    const list = Array.from({ length: 8 }, (_, i) => placement({ slot: 'home_partner_strip', priority: i }));
    const out = resolveSlot(list, { slot: 'home_partner_strip', date: '2026-11-05' });
    expect(out).toHaveLength(6);
    expect(out[0]?.priority).toBe(7);
  });

  it('does not change the input array', () => {
    const list = [placement({ priority: 1 }), placement({ priority: 2 })];
    const copy = [...list];
    resolveSlot(list, { slot: 'player_page_banner', date: '2026-11-05' });
    expect(list).toEqual(copy);
  });
});

describe('findOverlaps', () => {
  it('reports an equal-priority overlap in a one-item slot as a tie', () => {
    const a = placement({ startDate: '2026-11-01', endDate: '2026-11-15' });
    const b = placement({ startDate: '2026-11-10', endDate: '2026-11-30' });
    const out = findOverlaps([a, b]);
    expect(out).toHaveLength(1);
    expect(out[0]).toMatchObject({ kind: 'tie', from: '2026-11-10', to: '2026-11-15', slot: 'player_page_banner' });
    expect(hasTie([a, b])).toBe(true);
  });

  it('reports a different-priority overlap as resolved by priority', () => {
    const out = findOverlaps([placement({ priority: 1 }), placement({ priority: 2 })]);
    expect(out[0]?.kind).toBe('priority');
  });

  it('treats touching ranges as overlapping only when they share a day', () => {
    const a = placement({ endDate: '2026-11-10' });
    expect(findOverlaps([a, placement({ startDate: '2026-11-10' })])).toHaveLength(1);
    expect(findOverlaps([a, placement({ startDate: '2026-11-11' })])).toHaveLength(0);
  });

  it('ignores other slots, other scopes, paused and ended placements', () => {
    const a = placement();
    expect(findOverlaps([a, placement({ slot: 'match_page_banner' })])).toEqual([]);
    expect(findOverlaps([placement({ slot: 'tournament_page_banner', scopeKey: 'x' }), placement({ slot: 'tournament_page_banner', scopeKey: 'y' })])).toEqual([]);
    expect(findOverlaps([a, placement({ status: 'paused' }), placement({ status: 'ended' })])).toEqual([]);
  });

  it('counts a draft as occupying the calendar', () => {
    expect(findOverlaps([placement(), placement({ status: 'draft' })])).toHaveLength(1);
  });

  it('a strip is only reported when it is overbooked', () => {
    const six = Array.from({ length: 6 }, () => placement({ slot: 'footer_partner_strip' }));
    expect(findOverlaps(six)).toEqual([]);
    expect(findOverlaps([...six, placement({ slot: 'footer_partner_strip' })]).length).toBeGreaterThan(0);
  });
});

describe('expiringWithin (dashboard: placements expiring within 14 days)', () => {
  const today = '2026-11-10';
  it('lists active placements ending from today through 14 days ahead, soonest first', () => {
    const today0 = placement({ endDate: '2026-11-10' });
    const in5 = placement({ endDate: '2026-11-15' });
    const in14 = placement({ endDate: '2026-11-24' });
    const in15 = placement({ endDate: '2026-11-25' });
    const out = expiringWithin([in14, in15, in5, today0], today);
    expect(out.map((e) => [e.id, e.daysLeft])).toEqual([
      [today0.id, 0],
      [in5.id, 5],
      [in14.id, 14],
    ]);
  });
  it('skips placements already over, not yet started, paused or ended', () => {
    expect(expiringWithin([placement({ endDate: '2026-11-09' })], today)).toEqual([]);
    expect(expiringWithin([placement({ startDate: '2026-11-11', endDate: '2026-11-12' })], today)).toEqual([]);
    expect(expiringWithin([placement({ status: 'paused', endDate: '2026-11-12' }), placement({ status: 'ended', endDate: '2026-11-12' })], today)).toEqual([]);
  });
  it('honours another window and rejects a bad date', () => {
    expect(expiringWithin([placement({ endDate: '2026-11-20' })], today, 7)).toEqual([]);
    expect(() => expiringWithin([], 'tomorrow')).toThrow(RangeError);
  });
});
