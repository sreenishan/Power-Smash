// The ONE place that decides whether a competition page may name a player (D-012, D-109). FAIL CLOSED: a name is shown only when
// every one of these holds, otherwise the whole side reads "Protected player" and nothing else about it is shown (no link, no club):
//   - the event is not a junior event (junior category BS/GS/BD/GD, or an age group that isJuniorAgeGroup() from ../db.ts does not
//     recognise as adult; an unknown category also counts as junior), AND the view's own is_junior flag is exactly false (the SQL
//     also treats every event of a tournament with a minor signal as junior, app.competition_public_events; a missing or null flag
//     counts as junior);
//   - the view marked the side `is_protected` exactly false;
//   - every player the side should have (1 in singles, 2 in doubles) has a non-empty name.
// The api views decide `is_protected` in SQL: a player is named only when age_status = 'adult_confirmed', visibility = 'public', not
// provisional, merged_into is null and not suppressed (app.suppressed_keys by player id or normalised name). No published YouTube match
// is needed (the archive's app.eligible_players keeps that extra rule for the archive only). The views already apply the junior rule
// too; this file is the second, independent line of defence. A pair with one protected
// player is masked as a whole: an adult partner's name next to a placeholder could still point at the junior in a small local field.
//
// Rankings: a protected player is LEFT OUT of a public ranking (not shown as a masked row), and a junior ranking is not shown at all.
import { CATEGORIES, JUNIOR_CATEGORIES } from '../../parser/types';
import { isJuniorAgeGroup } from '../db';
import type { PlayerRef } from '../../../components/competition/helpers';

const DOUBLES = new Set(['MD', 'WD', 'XD', 'BD', 'GD']);

export function isDoublesCategory(category: string | null | undefined): boolean {
  return typeof category === 'string' && DOUBLES.has(category);
}

/** True for a junior event, and for anything not recognised as an adult event (fail closed). */
export function isJuniorEvent(category: string | null | undefined, ageGroup: string | null | undefined): boolean {
  if (typeof category !== 'string' || !(CATEGORIES as readonly string[]).includes(category)) return true;
  if ((JUNIOR_CATEGORIES as readonly string[]).includes(category)) return true;
  if (ageGroup !== null && ageGroup !== undefined && typeof ageGroup !== 'string') return true;
  return isJuniorAgeGroup(ageGroup ?? null);
}

/** The event facts the protection rule needs. `isJunior` is the view's flag (event or tournament minor signal); only false clears it. */
export interface ProtectEvent {
  category: string;
  ageGroup: string | null;
  isJunior: boolean | null | undefined;
}

/** True when every player of this event is protected: a junior event by category or age group, or the view's flag is not exactly false. */
export function eventIsJunior(event: ProtectEvent): boolean {
  return event.isJunior !== false || isJuniorEvent(event.category, event.ageGroup);
}

/** A side as the api views give it (draw slot or one side of a match). */
export interface SideFace {
  player1_name: string | null;
  player2_name: string | null;
  is_protected: boolean | null;
}

const named = (n: unknown): n is string => typeof n === 'string' && n.trim() !== '';

/** True when the side may be named on a public page (see the file header). */
export function sideIsNameable(face: SideFace | null | undefined, event: ProtectEvent): boolean {
  if (!face) return false;
  if (eventIsJunior(event)) return false;
  if (face.is_protected !== false) return false;
  if (!named(face.player1_name)) return false;
  if (isDoublesCategory(event.category) && !named(face.player2_name)) return false;
  return true;
}

/** The players of one side for the display components: names only when sideIsNameable(), otherwise every player protected. */
export function publicSide(face: SideFace | null | undefined, event: ProtectEvent): PlayerRef[] {
  const count = isDoublesCategory(event.category) ? 2 : 1;
  if (!sideIsNameable(face, event)) return Array.from({ length: count }, () => ({ name: null, protected: true }));
  const f = face as SideFace;
  const names = count === 2 ? [f.player1_name, f.player2_name] : [f.player1_name];
  return names.map((n) => ({ name: (n as string).trim(), protected: false }));
}

/** A ranking may be shown only when it is not a junior ranking (category null = all categories). */
export function rankingIsShowable(category: string | null | undefined, ageGroup: string | null | undefined): boolean {
  if (category !== null && category !== undefined) {
    if (typeof category !== 'string' || !(CATEGORIES as readonly string[]).includes(category)) return false;
    if ((JUNIOR_CATEGORIES as readonly string[]).includes(category)) return false;
  }
  if (ageGroup !== null && ageGroup !== undefined && typeof ageGroup !== 'string') return false;
  return !isJuniorAgeGroup(ageGroup ?? null);
}

/** A ranking row stays only for a player the view named and did not mark protected. Everyone else is left out, not masked. */
export function rankingRowIsShowable(row: { is_protected: boolean | null; player_name: string | null }): boolean {
  return row.is_protected === false && named(row.player_name);
}
