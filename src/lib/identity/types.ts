// Identity model used by the admin merge / split / rename tools (D-012, D-013, D-014, PC-01, PC-02).
// PURE data shapes: no I/O. The database rows (src/lib/archive/types.ts, written by the SCHEMA worker) map onto these.
import type { AgeStatus } from '../parser/types';

export type { AgeStatus };

export type ConsentStatus = 'unknown' | 'parent_verified' | 'withdrawn';
export type Visibility = 'public' | 'hidden';
export type AliasStatus = 'confirmed' | 'provisional' | 'rejected';

export interface IdPlayer {
  id: string;
  /** Public slug for adult_confirmed players, opaque `p-...` slug for protected players (D-012). */
  slug: string;
  displayName: string;
  ageStatus: AgeStatus;
  ageSignals: string[];
  nameKey: string | null;
  latinKey: string | null;
  provisional: boolean;
  consentStatus: ConsentStatus;
  visibility: Visibility;
  /** Set when this player was merged into another; the row stays as a tombstone, never hard-deleted (D-014). */
  mergedInto: string | null;
}

export interface IdAlias {
  id: string;
  aliasNormalized: string;
  playerId: string;
  status: AliasStatus;
  scopeTournamentId: string | null;
  scopeDistrict: string | null;
}

export type RedirectType = 301 | 410;

export interface SlugRedirect {
  fromSlug: string;
  /** null for a 410 (gone). */
  toSlug: string | null;
  type: RedirectType;
}

export type SuppressionKind = 'youtube_id' | 'player_id' | 'name_normalized' | 'tournament_id';

export interface Suppression {
  kind: SuppressionKind;
  /** Normalised name key (`normalizeName` output), a YouTube video id, or a player uuid. */
  key: string;
}

export interface OverrideRecord {
  /** Owner's written reason; must be non-empty. It is written to the audit log. */
  reason: string;
}
