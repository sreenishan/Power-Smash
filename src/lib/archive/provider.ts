// The data PROVIDER INTERFACE of the public archive (M2c). The pages never talk to a database: they read ONE in-memory snapshot
// (`RawArchive`) that a provider returns once per build (D-009: one snapshot, no per-page network calls).
//
// Providers:
//  - seed.ts: FICTIONAL data, the default for builds and tests;
//  - supabase-provider.ts: reads the `api` views over REST with the PUBLISHABLE key (paginated, 1,000-row cap, D-005). Tested with a
//    mocked fetch only; no real project exists yet.
//
// A provider returns EVERY record including protected players, each with its `ageStatus`. The policy layer (protected.ts and model.ts)
// decides what is public and fails closed: a participant that is missing or has any status other than adult_confirmed is protected.
// The `api` views also mask in SQL (D-005); this layer is the second, independent line of defence (D-012).

import type { AgeStatus } from '../parser/types';

export type { AgeStatus };

/** D-018: how an event (or video) is shown. `hidden` = not at all; `listed_no_player_pages` = listed with the raw title, no player or tournament pages. */
export type ScopeVisibility = 'hidden' | 'listed_no_player_pages' | 'public';

export interface RawPlayer {
  id: string;
  /** A stored slug (kept forever). Missing = assigned by slugs.ts. */
  slug?: string | null;
  displayName: string;
  ageStatus: AgeStatus;
  district?: string | null;
  academy?: string | null;
  /** false = an adult named in a full match who has no public profile page (the page is never built for them). Default true. */
  hasProfile?: boolean;
}

export interface RawTournament {
  id: string;
  slug?: string | null;
  name: string;
  editionYear?: number | null;
  city?: string | null;
  district?: string | null;
  level?: string | null;
  /** Calendar date (YYYY-MM-DD, Asia/Kolkata). */
  startDate?: string | null;
  endDate?: string | null;
  visibility: ScopeVisibility;
  /** false = the source says no tournament page is warranted (fewer than 3 matches and not promoted, D-013). Default true. */
  pageEligible?: boolean;
  /** Instant (ISO 8601) of the last change, for sitemap lastmod. */
  updatedAt?: string | null;
}

export interface RawMatch {
  id: string;
  slug?: string | null;
  /** The 11-character YouTube video id. Everything is keyed on it, never on the title (D-017). */
  videoId: string;
  /** The title exactly as YouTube has it (D-016). Never edited. */
  rawTitle: string;
  /** Instant (ISO 8601). */
  publishedAt: string;
  updatedAt?: string | null;
  durationSeconds?: number | null;
  /** Stored API statistic (refreshed or deleted before day 30). Shown as a plain count, never turned into a score (D-016). */
  views?: number | null;
  tournamentId?: string | null;
  /** MS, WS, MD, WD, XD, BS, GS, BD, GD. */
  category?: string | null;
  ageGroup?: string | null;
  round?: string | null;
  /** Player ids of the two sides, as parsed "by Power Smash". Empty for a video with no parsed players. */
  sideA: readonly string[];
  sideB: readonly string[];
  visibility?: ScopeVisibility;
  /** Set by a provider whose source already decided (the `api` views): `minimal` = noindex page with the raw title only. Never relaxes a stricter rule. */
  pageMode?: 'full' | 'minimal' | null;
}

export interface ArchiveSettings {
  /** `unknown_match_mode`: `noindex_minimal` (a minimal noindex page, no parsed links) or `hidden`. */
  unknownMatchMode: 'noindex_minimal' | 'hidden';
  /** `minor_match_mode`: minors are hidden. */
  minorMatchMode: 'hidden';
}

export const DEFAULT_ARCHIVE_SETTINGS: ArchiveSettings = {
  unknownMatchMode: 'noindex_minimal',
  minorMatchMode: 'hidden',
};

export interface RawArchive {
  players: readonly RawPlayer[];
  tournaments: readonly RawTournament[];
  matches: readonly RawMatch[];
  settings: ArchiveSettings;
  /** Instant (ISO 8601) the snapshot was taken. Injected, never read from a clock inside the model. */
  generatedAt: string;
  /**
   * Tombstoned names (suppression, D-014). A player with one of these names is treated as protected-and-hidden, and any video whose
   * raw title contains one is hidden, EVEN WHEN no player row is linked to it (review S2-7).
   */
  suppressedNames?: readonly string[];
  /** 301 rows (slug_redirects): public paths only, for the `_redirects` file (redirects.ts). */
  redirects?: readonly { from: string; to: string }[];
  /** Paths that must answer "gone" (410 rows are private, so only a privileged build can supply them). */
  gonePaths?: readonly string[];
}

export interface ArchiveProvider {
  /** `seed` or `supabase`. The pages show a notice when this is `seed` (fictional data). */
  readonly id: 'seed' | 'supabase';
  load(): Promise<RawArchive>;
}

/**
 * The tournament PAGES (/tournaments/<slug>/ for archive tournaments) are built by another milestone item. Until the lead flips this
 * to true, the archive writes tournament names as plain text and puts no tournament URL in the search index or the sitemap, so no
 * link can point at a page that does not exist (tests/build/links.test.ts).
 */
export const TOURNAMENT_PAGES_BUILT = false;
