// Slugs for the public archive (spec 6.3). Pure functions, unit-tested in tests/archive/slugs.test.ts.
//
// Rules:
//  - lowercase letters, digits and single hyphens; accents are stripped; a name with no Latin letters (Tamil only) falls back to a word;
//  - a slug that is already stored is NEVER recomputed (stability): `assignPlayerSlugs` keeps every given slug and only gives new ones
//    to records without one, in id order, so adding a record cannot rename another;
//  - player collisions get a district disambiguator ("karthik-r-madurai") and then a counter ("karthik-r-2");
//  - a match slug is `{side-a}-vs-{side-b}-{short-id}`; a PROTECTED match (anything that is not fully adult) gets the opaque
//    `match-{short-id}` so a protected player's name can never sit in a URL, sitemap or link (D-012).

export const MAX_SLUG_PART = 40;
const MAX_SLUG = 80;

/** Lowercase, hyphenated ASCII. May return "" (no Latin letters or digits at all). */
export function slugify(text: string): string {
  return text
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/&/g, ' and ')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

function clip(slug: string, max: number): string {
  if (slug.length <= max) return slug;
  return slug.slice(0, max).replace(/-+$/, '');
}

/** Slugs that a player or match may never take because another page sits at that address. */
export const RESERVED_PLAYER_SLUGS: ReadonlySet<string> = new Set(['page', 'index']);
export const RESERVED_MATCH_SLUGS: ReadonlySet<string> = new Set(['page', 'index', 'gone']);

export function playerSlugBase(displayName: string): string {
  return clip(slugify(displayName), MAX_SLUG_PART) || 'player';
}

export interface SlugPlayerInput {
  id: string;
  displayName: string;
  district?: string | null;
  /** A slug already stored for this record: kept unchanged. */
  slug?: string | null;
}

/**
 * One slug per player id. Stored slugs win (and are reserved first); new ones are assigned in id order so the result does not
 * depend on the order the provider happens to return rows.
 */
export function assignPlayerSlugs(players: readonly SlugPlayerInput[]): Map<string, string> {
  const out = new Map<string, string>();
  const taken = new Set<string>(RESERVED_PLAYER_SLUGS);
  for (const p of players) {
    if (p.slug) {
      out.set(p.id, p.slug);
      taken.add(p.slug);
    }
  }
  const fresh = players.filter((p) => !p.slug).sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  for (const p of fresh) {
    const base = playerSlugBase(p.displayName);
    const candidates: string[] = [base];
    const district = p.district ? slugify(p.district) : '';
    if (district) candidates.push(clip(`${base}-${district}`, MAX_SLUG));
    let slug = candidates.find((c) => !taken.has(c));
    for (let n = 2; slug === undefined; n += 1) {
      const c = `${base}-${n}`;
      if (!taken.has(c)) slug = c;
    }
    taken.add(slug);
    out.set(p.id, slug);
  }
  return out;
}

/** The short id part of a match slug: the video id with non-alphanumerics removed, lowercase, LAST 8 characters (the tail of a YouTube id is as random as the head, while test ids share a prefix; more characters on a collision). */
export function shortVideoId(videoId: string, length = 8): string {
  const cleaned = videoId.toLowerCase().replace(/[^a-z0-9]/g, '');
  return cleaned.slice(-length) || 'video';
}

function sidePart(names: readonly string[]): string {
  const parts = names.map((n) => clip(slugify(n), MAX_SLUG_PART) || 'player');
  return parts.length === 0 ? 'unknown' : clip(parts.join('-'), 34);
}

export interface SlugMatchInput {
  id: string;
  videoId: string;
  /** Display names of the two sides, ONLY for a match whose participants are all adult_confirmed. */
  sideA: readonly string[];
  sideB: readonly string[];
  /** true = a protected or name-free match: the slug carries no name. */
  opaque: boolean;
  /** A slug already stored: kept unchanged unless `opaque` is true. */
  slug?: string | null;
}

/**
 * One slug per match id. Stored slugs win (except for opaque matches). A new slug is `{a}-vs-{b}-{short}` (or `match-{short}`), and the short id grows
 * to the whole cleaned video id, then takes a counter, when two matches would collide. Assigned in id order.
 */
export function assignMatchSlugs(matches: readonly SlugMatchInput[]): Map<string, string> {
  const out = new Map<string, string>();
  const taken = new Set<string>(RESERVED_MATCH_SLUGS);
  for (const m of matches) {
    // A stored slug is kept ONLY for a match whose slug may carry names. An opaque (protected or name-free) match ignores it: a name
    // stored while the players were adult must not survive an age change (review B2-8). The old address is redirected by redirects.ts.
    if (m.slug && !m.opaque) {
      out.set(m.id, m.slug);
      taken.add(m.slug);
    }
  }
  const fresh = matches.filter((m) => !(m.slug && !m.opaque)).sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  for (const m of fresh) {
    const prefix = m.opaque ? 'match' : `${sidePart(m.sideA)}-vs-${sidePart(m.sideB)}`;
    const full = m.videoId.toLowerCase().replace(/[^a-z0-9]/g, '').length;
    let slug: string | undefined;
    for (const len of [8, 11, full]) {
      const c = `${prefix}-${shortVideoId(m.videoId, len)}`;
      if (!taken.has(c)) {
        slug = c;
        break;
      }
    }
    for (let n = 2; slug === undefined; n += 1) {
      const c = `${prefix}-${shortVideoId(m.videoId, full)}-${n}`;
      if (!taken.has(c)) slug = c;
    }
    taken.add(slug);
    out.set(m.id, slug);
  }
  return out;
}

export const SLUG_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
