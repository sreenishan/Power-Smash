// The owner's Featured pins from the database on /tournaments/ (D-104): which are current today, which tournaments qualify, the link
// only to a real page, and the provider mapping. Fictional tournaments only; the date is injected.
import { describe, expect, it } from 'vitest';
import { currentFeatured, featuredFilterKeys } from '../../src/lib/archive/featured';
import { buildPublicArchive, type FeaturedTournament } from '../../src/lib/archive/model';
import { seedArchive } from '../../src/lib/archive/seed';
import type { RawArchive } from '../../src/lib/archive/provider';

const TODAY = '2026-11-01';
const pin = (over: Partial<FeaturedTournament> = {}): FeaturedTournament => ({
  id: 'x', name: 'Demo Pinned Open', year: 2026, city: 'Madurai', district: 'Madurai', level: 'district', startDate: '2026-11-20', endDate: '2026-11-21', featuredUntil: '2026-11-21', pageSlug: null, ...over,
});

describe('currentFeatured (which pins show today)', () => {
  it('keeps a pin until its featured-until day and while the tournament is not over', () => {
    expect(currentFeatured([pin()], TODAY)).toHaveLength(1);
    expect(currentFeatured([pin({ featuredUntil: TODAY })], TODAY)).toHaveLength(1); // the last day counts
    expect(currentFeatured([pin({ featuredUntil: '2026-10-31' })], TODAY)).toEqual([]); // pin ended
    expect(currentFeatured([pin({ startDate: '2026-10-20', endDate: '2026-10-22', featuredUntil: '2026-12-31' })], TODAY)).toEqual([]); // tournament over
    expect(currentFeatured([pin({ startDate: '2026-10-31', endDate: '2026-11-02' })], TODAY)).toHaveLength(1); // running today
    expect(currentFeatured([pin({ featuredUntil: null })], TODAY)).toHaveLength(1); // no end day: until it is over
  });
  it('a pin with no dates shows only while it has a featured-until day', () => {
    expect(currentFeatured([pin({ startDate: null, endDate: null, featuredUntil: '2026-11-05' })], TODAY)).toHaveLength(1);
    expect(currentFeatured([pin({ startDate: null, endDate: null, featuredUntil: null })], TODAY)).toEqual([]);
  });
  it('lists the soonest first, undated last', () => {
    const list = [pin({ id: 'b', name: 'B', startDate: '2026-12-01', endDate: null }), pin({ id: 'u', name: 'U', startDate: null, endDate: null, featuredUntil: '2026-11-30' }), pin({ id: 'a', name: 'A', startDate: '2026-11-10', endDate: null })];
    expect(currentFeatured(list, TODAY).map((t) => t.id)).toEqual(['a', 'b', 'u']);
  });
  it('gives the card the same filter keys as the hand-written cards', () => {
    expect(featuredFilterKeys(pin())).toEqual({ district: 'Madurai', level: 'district', month: '2026-11', categories: [] });
    expect(featuredFilterKeys(pin({ startDate: null, district: null, level: null }))).toEqual({ district: '', level: '', month: '', categories: [] });
  });
});

describe('the archive model collects the pins', () => {
  const withPins = (): RawArchive => ({
    ...seedArchive,
    tournaments: [
      ...seedArchive.tournaments.map((t) => (t.id === 't-1' ? { ...t, featured: true, featuredUntil: '2026-12-31' } : t)),
      // an approved organizer submission: visible, no matches, so no page
      { id: 't-sub', name: 'Demo Submitted Cup 2026', editionYear: 2026, city: 'Salem', district: 'Salem', level: 'open', startDate: '2026-12-05', endDate: '2026-12-06', visibility: 'public', featured: true, featuredUntil: '2026-12-06' },
      // hidden: never shown, even pinned (D-018, suppression)
      { id: 't-hidden', name: 'Demo Hidden Cup 2026', editionYear: 2026, city: null, district: null, level: null, startDate: '2026-12-10', endDate: null, visibility: 'hidden', featured: true, featuredUntil: '2026-12-10' },
    ],
  });

  it('takes every visible pinned tournament, links only to a real page, and never a hidden one', () => {
    const a = buildPublicArchive(withPins());
    const byId = new Map(a.featured.map((t) => [t.id, t]));
    expect([...byId.keys()].sort()).toEqual(['t-1', 't-sub']);
    expect(byId.get('t-1')!.pageSlug).toBe(a.tournaments.find((t) => t.id === 't-1')!.slug); // has a page
    expect(byId.get('t-sub')!.pageSlug).toBeNull(); // no videos yet, so no page
    expect(JSON.stringify(a.featured)).not.toContain('Demo Hidden Cup');
    // pinning does not change which tournaments get a page
    expect(a.tournaments.map((t) => t.id).sort()).toEqual(buildPublicArchive(seedArchive).tournaments.map((t) => t.id).sort());
  });

  it('the sample data pins nothing', () => {
    expect(buildPublicArchive(seedArchive).featured).toEqual([]);
  });
});
