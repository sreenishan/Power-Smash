/**
 * Slug helpers (spec 6.3, PC-10, PC-14, D-009, D-012). Pure functions. Slugs are persisted once
 * assigned (PC-14), so these only PROPOSE a slug; collision handling beyond an explicit
 * disambiguator or counter belongs to the pipeline.
 *
 * Rules implemented:
 *  - Name slugs are kebab-case ASCII built from `latinKey`. There is NO transliteration of
 *    Tamil (none is pinned, PC-24): a name with no Latin form yields `{ ok: false }`, meaning
 *    "needs a manual slug" (D-017), never an empty string and never a guess.
 *  - PROTECTED players (every age status except `adult_confirmed`, D-012) get an OPAQUE slug
 *    that is derived only from the stable player id: no name, no district, no disambiguator.
 *  - Tournament slugs are `{series}-{year}-{city}` with the year taken from the edition, never
 *    from the name, so the slug can not become '...-2026-2026' (PC-10).
 */
import { isProtectedAgeStatus } from './types';
import type { AgeStatus } from './types';
import { latinKey, normalizeName } from './normalize';

export type SlugFailure = 'EMPTY_NAME' | 'NON_LATIN_NAME' | 'NON_LATIN_CITY' | 'NON_LATIN_DISAMBIGUATOR';

export type SlugResult =
  | { ok: true; slug: string; opaque: boolean }
  | { ok: false; slug: null; reason: SlugFailure };

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/iu;

/** kebab-case of the Latin key; null when the text has no Latin form (never ''). */
export function slugify(text: string): string | null {
  const key = latinKey(text);
  if (key === null) return null;
  const slug = key.replace(/ /gu, '-');
  return slug === '' ? null : slug;
}

/**
 * Opaque player slug: 'p-' plus the last 16 hex characters of the player id (random for a v4
 * uuid, so it reveals nothing and carries no name or district). Deterministic and stable. The
 * database UNIQUE index on `players.slug` is the collision guard.
 */
export function opaquePlayerSlug(playerId: string): string {
  if (!UUID.test(playerId)) throw new TypeError('opaquePlayerSlug needs a uuid player id');
  return `p-${playerId.replace(/-/gu, '').slice(-16).toLowerCase()}`;
}

export type PlayerSlugInput = {
  /** Stable uuid of the player row. */
  id: string;
  displayName: string;
  ageStatus: AgeStatus;
  /** Used only for `adult_confirmed` players, e.g. a district: 'karthik-r-madurai'. */
  disambiguator?: string;
  /** Used only for `adult_confirmed` players when no disambiguator exists: 'karthik-2'. Must be >= 2. */
  counter?: number;
};

export function playerSlug(input: PlayerSlugInput): SlugResult {
  if (isProtectedAgeStatus(input.ageStatus)) {
    // D-012: nothing about the person enters a protected slug.
    return { ok: true, slug: opaquePlayerSlug(input.id), opaque: true };
  }
  const base = slugify(input.displayName);
  if (base === null) {
    return { ok: false, slug: null, reason: normalizeName(input.displayName) === null ? 'EMPTY_NAME' : 'NON_LATIN_NAME' };
  }
  if (input.disambiguator !== undefined && input.disambiguator.trim() !== '') {
    const extra = slugify(input.disambiguator);
    if (extra === null) return { ok: false, slug: null, reason: 'NON_LATIN_DISAMBIGUATOR' };
    return { ok: true, slug: `${base}-${extra}`, opaque: false };
  }
  if (input.counter !== undefined) {
    if (!Number.isInteger(input.counter) || input.counter < 2) {
      throw new RangeError('slug counter must be an integer >= 2');
    }
    return { ok: true, slug: `${base}-${input.counter}`, opaque: false };
  }
  return { ok: true, slug: base, opaque: false };
}

export type TournamentSlugInput = {
  /** Series name WITHOUT the year (PC-10). A trailing year equal to `year` is defensively removed once. */
  name: string;
  year?: number | null;
  city?: string | null;
};

export function tournamentSlug(input: TournamentSlugInput): SlugResult {
  let base = slugify(input.name);
  if (base === null) {
    return { ok: false, slug: null, reason: normalizeName(input.name) === null ? 'EMPTY_NAME' : 'NON_LATIN_NAME' };
  }
  if (input.year != null) {
    const suffix = `-${input.year}`;
    // never turn '...-2026' + year 2026 into '...-2026-2026'; keep a name that is only the year
    if (base.endsWith(suffix) && base.length > suffix.length) base = base.slice(0, -suffix.length);
  }
  const parts = [base];
  if (input.year != null) parts.push(String(input.year));
  if (input.city != null && input.city.trim() !== '') {
    const city = slugify(input.city);
    if (city === null) return { ok: false, slug: null, reason: 'NON_LATIN_CITY' };
    parts.push(city);
  }
  return { ok: true, slug: parts.join('-'), opaque: false };
}
