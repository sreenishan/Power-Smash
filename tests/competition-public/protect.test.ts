// The ONE rule that decides whether a competition page names a player (src/lib/competition/public/protect.ts). Fail closed.
import { describe, expect, it } from 'vitest';
import { eventIsJunior, isJuniorEvent, publicSide, rankingIsShowable, rankingRowIsShowable, sideIsNameable } from '../../src/lib/competition/public/protect';

const adult = { player1_name: 'Demo Adult A', player2_name: null, is_protected: false };
const pairFace = { player1_name: 'Demo Adult A', player2_name: 'Mock Adult B', is_protected: false };
const MS = { category: 'MS', ageGroup: null, isJunior: false };
const MD = { category: 'MD', ageGroup: null, isJunior: false };

describe('junior events (fail closed)', () => {
  it('junior categories and junior or unknown age groups are junior', () => {
    for (const c of ['BS', 'GS', 'BD', 'GD']) expect(isJuniorEvent(c, null)).toBe(true);
    for (const a of ['U15', 'U19', '18+', 'junior', 'sub_junior', 'mini', 'U-17', 'whatever']) expect(isJuniorEvent('MS', a)).toBe(true);
    expect(isJuniorEvent('ZZ', null)).toBe(true);
    expect(isJuniorEvent(null, null)).toBe(true);
  });

  it('adult events are not junior', () => {
    for (const a of [null, 'open', 'senior', 'veterans', 'masters', 'U20', '35+']) expect(isJuniorEvent('MS', a)).toBe(false);
  });
});

describe('naming a side', () => {
  it('names an adult side the view marked not protected', () => {
    expect(publicSide(adult, MS)).toEqual([{ name: 'Demo Adult A', protected: false }]);
    expect(publicSide(pairFace, MD)).toEqual([
      { name: 'Demo Adult A', protected: false },
      { name: 'Mock Adult B', protected: false },
    ]);
  });

  it('masks every player of a side marked protected, even when the view left a partner name', () => {
    const half = { player1_name: 'Demo Adult A', player2_name: null, is_protected: true };
    expect(publicSide(half, MD)).toEqual([
      { name: null, protected: true },
      { name: null, protected: true },
    ]);
  });

  it('masks anything that is not exactly is_protected false, and any missing name', () => {
    for (const p of [null, undefined, true, 'false']) {
      expect(sideIsNameable({ ...adult, is_protected: p as unknown as boolean | null }, MS)).toBe(false);
    }
    expect(sideIsNameable({ ...adult, player1_name: '  ' }, MS)).toBe(false);
    expect(sideIsNameable({ ...pairFace, player2_name: null }, MD)).toBe(false);
    expect(sideIsNameable(null, MS)).toBe(false);
  });

  it('never names anyone in a junior event, whatever the row says', () => {
    expect(publicSide(adult, { category: 'BS', ageGroup: null, isJunior: false })).toEqual([{ name: null, protected: true }]);
    expect(publicSide(adult, { category: 'MS', ageGroup: 'U17', isJunior: false })).toEqual([{ name: null, protected: true }]);
  });

  it("follows the view's junior flag (a minor-signal tournament), failing closed when it is missing", () => {
    expect(eventIsJunior({ category: 'MS', ageGroup: null, isJunior: false })).toBe(false);
    for (const flag of [true, null, undefined, 'false' as unknown as boolean]) {
      expect(eventIsJunior({ category: 'MS', ageGroup: null, isJunior: flag })).toBe(true);
      expect(publicSide(adult, { category: 'MS', ageGroup: null, isJunior: flag })).toEqual([{ name: null, protected: true }]);
    }
    // the flag never clears a junior category or age group
    expect(eventIsJunior({ category: 'BS', ageGroup: null, isJunior: false })).toBe(true);
    expect(eventIsJunior({ category: 'MS', ageGroup: 'U15', isJunior: false })).toBe(true);
  });
});

describe('rankings', () => {
  it('junior rankings are not shown', () => {
    expect(rankingIsShowable('BS', null)).toBe(false);
    expect(rankingIsShowable(null, 'U15')).toBe(false);
    expect(rankingIsShowable('MS', 'bogus')).toBe(false);
    expect(rankingIsShowable('MS', 'open')).toBe(true);
    expect(rankingIsShowable(null, null)).toBe(true);
  });

  it('protected rows are left out, not masked', () => {
    expect(rankingRowIsShowable({ is_protected: false, player_name: 'Demo Adult A' })).toBe(true);
    expect(rankingRowIsShowable({ is_protected: true, player_name: 'Demo Adult A' })).toBe(false);
    expect(rankingRowIsShowable({ is_protected: null, player_name: 'Demo Adult A' })).toBe(false);
    expect(rankingRowIsShowable({ is_protected: false, player_name: null })).toBe(false);
  });
});
