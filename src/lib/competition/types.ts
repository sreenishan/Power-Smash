// Shared vocabulary of the competition engines (Phase A of the platform brief, 2026-10-30): draws, scoring, brackets, scheduling,
// statistics and local rankings. PURE: no I/O, no database, no clock or randomness except what the caller injects. Nothing here is
// wired into a page or the admin yet; owner decisions (accounts, junior visibility, rankings, registrations) decide how it is used.
// Fictional data only in tests. Round codes and categories reuse the existing ones (src/lib/archive/labels.ts, src/lib/parser/types.ts).
import type { Category } from '../parser/types';

export type { Category };

/** A player or a pair in one event. `players` holds 1 id (singles) or 2 ids (doubles); ids are opaque strings. */
export interface Entry {
  id: string;
  players: readonly string[];
  /** 1 = top seed; absent = unseeded. */
  seed?: number;
  /** For draw separation rules (for example, keep two players of one club apart in the first round). Optional. */
  club?: string | null;
}

/** Round codes, the same as the archive (src/lib/archive/labels.ts ROUND_ORDER): F, SF, QF, R16, R32, R64, R128, 3P, group, league. */
export type RoundCode = 'F' | 'SF' | 'QF' | 'R16' | 'R32' | 'R64' | 'R128' | '3P' | 'group' | 'league';

export const MATCH_STATUSES = ['scheduled', 'ready', 'live', 'paused', 'completed', 'walkover', 'retired', 'abandoned', 'postponed', 'cancelled'] as const;
export type MatchStatus = (typeof MATCH_STATUSES)[number];

/** A finished match ends in one of these; only `completed` is a match played to the end. */
export const DECIDED_STATUSES = ['completed', 'walkover', 'retired'] as const;
export type DecidedStatus = (typeof DECIDED_STATUSES)[number];

export type Side = 'A' | 'B';

/** One game's final points, side A first. */
export interface GameScore {
  a: number;
  b: number;
}

/** A confirmed match result. A result only counts once `confirmed` is true (winners never advance on an unconfirmed result). */
export interface MatchResult {
  status: DecidedStatus | 'abandoned';
  /** Null only for `abandoned`. */
  winner: Side | null;
  games: readonly GameScore[];
  confirmed: boolean;
}

/** Calendar date YYYY-MM-DD read as India time (src/lib/dates.ts). Instants are ISO strings in UTC. */
export type IsoDate = string;
export type IsoInstant = string;

/** An injected random source in [0, 1): draws record the seed they used, so a draw can be reproduced exactly. */
export type Random = () => number;

/** A small deterministic PRNG (mulberry32) from a 32-bit integer seed: same seed, same sequence, on every machine. */
export function seededRandom(seed: number): Random {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
