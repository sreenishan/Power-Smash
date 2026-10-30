// Entry checks shared by every draw generator (Module 4, Phase A). PURE. A draw is refused, never repaired: the referee fixes the
// entry list. Checks: at least 2 entries; non-blank unique entry ids; 1 or 2 non-blank players per entry, all entries the same
// size (no singles and doubles in one event); no player in two entries (or twice in one pair); seeds, when checked, are whole
// numbers 1..S with no repeats and no gaps (a gap usually means a withdrawn seed, and the referee decides how to re-seed).
import type { Entry } from '../types';

export type DrawRefusalCode =
  | 'too-few-entries'
  | 'too-many-entries'
  | 'invalid-entry'
  | 'mixed-entry-sizes'
  | 'duplicate-entry-id'
  | 'duplicate-player'
  | 'invalid-seed'
  | 'duplicate-seed'
  | 'seed-gap'
  | 'too-many-seeds'
  | 'invalid-random-seed'
  | 'invalid-group-config'
  | 'invalid-option';

/** Why a draw was not made. `message` is plain English for the admin. */
export interface DrawRefusal {
  code: DrawRefusalCode;
  message: string;
}

/** Either the draw or the reasons it was refused. */
export type DrawOutcome<T> = { ok: true; draw: T } | { ok: false; refusals: readonly DrawRefusal[] };

/** Checks the entry list; `checkSeeds` also checks seed numbers. Returns every problem found (empty = fine). */
export function validateEntries(entries: readonly Entry[], checkSeeds: boolean): DrawRefusal[] {
  const out: DrawRefusal[] = [];
  if (entries.length < 2) out.push({ code: 'too-few-entries', message: `A draw needs at least 2 entries (got ${entries.length}).` });

  const ids = new Set<string>();
  const players = new Set<string>();
  const sizes = new Set<number>();
  for (const entry of entries) {
    if (typeof entry.id !== 'string' || entry.id.trim() === '') {
      out.push({ code: 'invalid-entry', message: 'An entry has no id.' });
      continue;
    }
    if (ids.has(entry.id)) out.push({ code: 'duplicate-entry-id', message: `Entry id ${entry.id} appears more than once.` });
    ids.add(entry.id);
    if (entry.players.length < 1 || entry.players.length > 2 || entry.players.some((p) => typeof p !== 'string' || p.trim() === '')) {
      out.push({ code: 'invalid-entry', message: `Entry ${entry.id} must have 1 or 2 named players.` });
      continue;
    }
    sizes.add(entry.players.length);
    for (const player of entry.players) {
      if (players.has(player)) out.push({ code: 'duplicate-player', message: `Player ${player} is in more than one entry (entry ${entry.id}).` });
      players.add(player);
    }
  }
  if (sizes.size > 1) out.push({ code: 'mixed-entry-sizes', message: 'Singles and doubles entries cannot share one draw.' });

  if (checkSeeds) {
    const seeds = new Set<number>();
    for (const entry of entries) {
      if (entry.seed === undefined) continue;
      if (!Number.isInteger(entry.seed) || entry.seed < 1) {
        out.push({ code: 'invalid-seed', message: `Entry ${entry.id} has seed ${String(entry.seed)}; seeds are whole numbers from 1.` });
        continue;
      }
      if (seeds.has(entry.seed)) out.push({ code: 'duplicate-seed', message: `Seed ${entry.seed} is given to more than one entry.` });
      seeds.add(entry.seed);
    }
    for (let s = 1; s <= seeds.size; s++) {
      if (!seeds.has(s)) {
        out.push({ code: 'seed-gap', message: `Seeds must run 1 to ${seeds.size} without gaps (seed ${s} is missing).` });
        break;
      }
    }
  }
  return out;
}

/** Seeded entries ordered by seed, then unseeded entries ordered by id (so input order never changes a draw). */
export function splitBySeed(entries: readonly Entry[]): { seeded: Entry[]; unseeded: Entry[] } {
  const seeded = entries.filter((e) => e.seed !== undefined).sort((a, b) => (a.seed ?? 0) - (b.seed ?? 0));
  const unseeded = entries.filter((e) => e.seed === undefined).sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  return { seeded, unseeded };
}

/** The club key used by the separation rule: trimmed and lower-cased; blank or missing = no club (never separated). */
export function clubKey(entry: Entry): string | null {
  const club = entry.club?.trim().toLowerCase();
  return club ? club : null;
}
