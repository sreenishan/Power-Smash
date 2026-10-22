import type { Placement } from '../../src/lib/placements/schedule';

export const SPONSOR_A = '10000000-0000-4000-8000-00000000000a';
export const SPONSOR_B = '10000000-0000-4000-8000-00000000000b';

let n = 0;
/** A fictional placement; every field can be overridden. Ids are sequential uuids so ordering in tests is predictable. */
export function placement(over: Partial<Placement> = {}): Placement {
  n += 1;
  const id = `20000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
  return {
    id,
    sponsorId: SPONSOR_A,
    slot: 'player_page_banner',
    scopeKey: null,
    creativeDesktopPath: `sponsors/fictional/${n}-d.png`,
    creativeMobilePath: `sponsors/fictional/${n}-m.png`,
    alt: 'Fictional sponsor banner',
    headline: null,
    goSlug: `fictional-${n}`,
    startDate: '2026-11-01',
    endDate: '2026-11-30',
    priority: 0,
    label: 'Sponsored',
    status: 'active',
    ...over,
  };
}
