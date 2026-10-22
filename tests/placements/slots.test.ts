import { describe, expect, it } from 'vitest';
import { PLACEMENT_LABELS, SLOT_KEYS, SLOTS, isSlotKey, slotsAvailableInM3 } from '../../src/lib/placements/slots';

describe('slot catalogue (spec 8.3)', () => {
  it('has exactly the seven slots of the spec', () => {
    expect([...SLOT_KEYS].sort()).toEqual(
      ['footer_partner_strip', 'gear_page_banner', 'home_partner_strip', 'match_page_banner', 'player_page_banner', 'tournament_coverage_title', 'tournament_page_banner'].sort(),
    );
    for (const key of SLOT_KEYS) expect(SLOTS[key].key).toBe(key);
  });

  it('only offers the slots whose page exists in Phase 1 (no gear page yet)', () => {
    const keys = slotsAvailableInM3().map((s) => s.key);
    expect(keys).not.toContain('gear_page_banner');
    expect(keys).toHaveLength(6);
  });

  it('reserves a size for every slot so the layout never shifts', () => {
    for (const key of SLOT_KEYS) {
      const r = SLOTS[key].reserved;
      for (const v of Object.values(r)) expect(Number.isInteger(v) && v > 0).toBe(true);
    }
  });

  it('shows one item in a banner or title and several in a strip', () => {
    for (const key of SLOT_KEYS) {
      const def = SLOTS[key];
      if (def.form === 'strip') expect(def.maxItems).toBeGreaterThan(1);
      else expect(def.maxItems).toBe(1);
    }
  });

  it('keeps the match banner off by default and requires independent content everywhere (D-016, D-035)', () => {
    expect(SLOTS.match_page_banner.offByDefault).toBe(true);
    for (const key of SLOT_KEYS) expect(SLOTS[key].requiresIndependentContent).toBe(true);
  });

  it('labels are Sponsored or Partner', () => {
    expect([...PLACEMENT_LABELS]).toEqual(['Sponsored', 'Partner']);
  });

  it('isSlotKey rejects anything else', () => {
    expect(isSlotKey('home_partner_strip')).toBe(true);
    for (const v of ['', 'HOME', 'toString', '__proto__', null, undefined, 1]) expect(isSlotKey(v)).toBe(false);
  });
});
