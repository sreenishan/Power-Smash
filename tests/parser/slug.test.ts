/**
 * GREEN (M0): slug helpers (spec 6.3, PC-10, PC-14, D-009, D-012).
 * Protected players get opaque slugs; Tamil names never become an empty or invented slug.
 */
import { describe, expect, it } from 'vitest';
import { opaquePlayerSlug, playerSlug, slugify, tournamentSlug } from '../../src/lib/parser/slug';
import type { AgeStatus } from '../../src/lib/parser/types';

const ID_A = '0b6f2c1e-8d4a-4f3b-9a57-1c2d3e4f5a6b';
const ID_B = '7e91d0aa-3b52-4c68-8f10-aabbccddeeff';

describe('slugify', () => {
  it.each([
    ['Karthik R', 'karthik-r'],
    ['S. Karthik', 's-karthik'],
    ['K. P. Arun', 'k-p-arun'],
    ['Mohamed-Ali', 'mohamed-ali'],
    ["D'Souza", 'dsouza'],
    ['José', 'jose'],
    ['  Arun   Kumar  ', 'arun-kumar'],
    ['TNBA/DBA Joint Cup', 'tnba-dba-joint-cup'],
  ])('%s -> %s', (input, slug) => {
    expect(slugify(input)).toBe(slug);
  });

  it('only ever produces lower-case ASCII, digits and single hyphens', () => {
    for (const input of ['Karthik R', 'S. V. Kumar', 'Test Cup 2026', "O'Brien-Smith", 'Café Open']) {
      expect(slugify(input)).toMatch(/^[a-z0-9]+(?:-[a-z0-9]+)*$/u);
    }
  });

  it('returns null, never an empty string, for Tamil-only, mixed-script and empty input (manual slug, D-017)', () => {
    for (const input of ['கார்த்திக்', 'அருண்', 'Karthik கார்த்திக்', '', '   ', '...', '---']) {
      expect(slugify(input), JSON.stringify(input)).toBeNull();
    }
  });
});

describe('playerSlug: adult_confirmed players get a name slug', () => {
  it('uses the display name', () => {
    expect(playerSlug({ id: ID_A, displayName: 'Karthik R', ageStatus: 'adult_confirmed' })).toEqual({ ok: true, slug: 'karthik-r', opaque: false });
  });

  it('adds a disambiguator or a counter when asked (spec 6.3)', () => {
    expect(playerSlug({ id: ID_A, displayName: 'Karthik R', ageStatus: 'adult_confirmed', disambiguator: 'Madurai' })).toEqual({ ok: true, slug: 'karthik-r-madurai', opaque: false });
    expect(playerSlug({ id: ID_A, displayName: 'Karthik', ageStatus: 'adult_confirmed', counter: 2 })).toEqual({ ok: true, slug: 'karthik-2', opaque: false });
    expect(() => playerSlug({ id: ID_A, displayName: 'Karthik', ageStatus: 'adult_confirmed', counter: 1 })).toThrow(RangeError);
  });

  it('needs a manual slug for a Tamil name instead of producing an empty one', () => {
    const result = playerSlug({ id: ID_A, displayName: 'கார்த்திக்', ageStatus: 'adult_confirmed' });
    expect(result).toEqual({ ok: false, slug: null, reason: 'NON_LATIN_NAME' });
    expect(playerSlug({ id: ID_A, displayName: '', ageStatus: 'adult_confirmed' })).toEqual({ ok: false, slug: null, reason: 'EMPTY_NAME' });
    expect(playerSlug({ id: ID_A, displayName: 'Karthik R', ageStatus: 'adult_confirmed', disambiguator: 'சென்னை' })).toEqual({ ok: false, slug: null, reason: 'NON_LATIN_DISAMBIGUATOR' });
  });
});

describe('playerSlug: PROTECTED players get opaque slugs (D-012: every status except adult_confirmed)', () => {
  const protectedStatuses: AgeStatus[] = ['unknown', 'minor_suspected', 'minor_confirmed'];

  it.each(protectedStatuses)('%s gets p-<16 hex> with no trace of the name, district or disambiguator', (ageStatus) => {
    const result = playerSlug({ id: ID_A, displayName: 'Karthik R', ageStatus, disambiguator: 'Madurai', counter: 2 });
    expect(result.ok).toBe(true);
    expect(result.slug).toMatch(/^p-[0-9a-f]{16}$/u);
    expect(result).toMatchObject({ opaque: true });
    for (const leak of ['karthik', 'madurai', 'r-', '-2']) expect(result.slug?.toLowerCase()).not.toContain(leak);
  });

  it('is derived only from the id: stable for the same id, different for another id, blind to the name', () => {
    const one = playerSlug({ id: ID_A, displayName: 'Karthik R', ageStatus: 'unknown' });
    const sameId = playerSlug({ id: ID_A, displayName: 'Someone Else Entirely', ageStatus: 'minor_suspected' });
    const other = playerSlug({ id: ID_B, displayName: 'Karthik R', ageStatus: 'unknown' });
    expect(sameId.slug).toBe(one.slug);
    expect(other.slug).not.toBe(one.slug);
  });

  it('works for a Tamil name (opaque slugs do not need a Latin form)', () => {
    expect(playerSlug({ id: ID_A, displayName: 'கார்த்திக்', ageStatus: 'unknown' })).toMatchObject({ ok: true, opaque: true });
  });

  it('opaquePlayerSlug rejects anything that is not a uuid (a name must never be passed by mistake)', () => {
    expect(opaquePlayerSlug(ID_A)).toBe(opaquePlayerSlug(ID_A.toUpperCase()));
    expect(() => opaquePlayerSlug('karthik-r')).toThrow(TypeError);
    expect(() => opaquePlayerSlug('')).toThrow(TypeError);
  });
});

describe('tournamentSlug (PC-10: {name}-{year}-{city}, year never doubled)', () => {
  it('PF-050: TNBA/DBA Joint Cup 2026', () => {
    expect(tournamentSlug({ name: 'TNBA/DBA Joint Cup', year: 2026 })).toEqual({ ok: true, slug: 'tnba-dba-joint-cup-2026', opaque: false });
  });

  it('adds the city after the year', () => {
    expect(tournamentSlug({ name: 'Example District Championship', year: 2026, city: 'Madurai' })).toEqual({
      ok: true,
      slug: 'example-district-championship-2026-madurai',
      opaque: false,
    });
  });

  it("never produces '-2026-2026' when the name still carries the year", () => {
    expect(tournamentSlug({ name: 'South India Level Badminton Tournament 2026', year: 2026 })).toMatchObject({
      slug: 'south-india-level-badminton-tournament-2026',
    });
  });

  it('keeps a year that is part of the name (PF-047) and separates two editions of one series', () => {
    expect(tournamentSlug({ name: '1990 Batch Alumni Meet', year: 2026 })).toMatchObject({ slug: '1990-batch-alumni-meet-2026' });
    const a = tournamentSlug({ name: 'Test Cup', year: 2025 });
    const b = tournamentSlug({ name: 'Test Cup', year: 2026 });
    expect(a.slug).not.toBe(b.slug);
  });

  it('omits the year when there is none and needs a manual slug for a Tamil name or city', () => {
    expect(tournamentSlug({ name: 'Test Cup' })).toMatchObject({ slug: 'test-cup' });
    expect(tournamentSlug({ name: 'சென்னை மாவட்ட போட்டி', year: 2026 })).toEqual({ ok: false, slug: null, reason: 'NON_LATIN_NAME' });
    expect(tournamentSlug({ name: 'Test Cup', year: 2026, city: 'சென்னை' })).toEqual({ ok: false, slug: null, reason: 'NON_LATIN_CITY' });
    expect(tournamentSlug({ name: '', year: 2026 })).toEqual({ ok: false, slug: null, reason: 'EMPTY_NAME' });
  });
});
