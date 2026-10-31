// Checks made before a write reaches the database (PURE). The SQL repeats each rule; these give the owner the reason in plain English
// without a round trip. Messages are short sentences for a non-developer on a phone.
import { TOURNAMENT_LEVELS } from '../../archive/types';
import { isCompetitionAgeGroup } from '../../competition/db';
import { validateRuleset, type Ruleset } from '../../competition/scoring';
import { FINISHES } from '../../competition/stats/ranking';
import type { Category } from '../../parser/types';
import type { PointsTableRecord, SaveEventRecord } from './types';

const SINGLES = new Set<Category>(['MS', 'WS', 'BS', 'GS']);
export const playersPerEntry = (category: Category): 1 | 2 => (SINGLES.has(category) ? 1 : 2);

/** The ruleset rules of the database (stricter than the engine: a point cap is required and at most 30; best of five at most). */
export function rulesetProblems(r: Readonly<Ruleset>): string[] {
  const out = validateRuleset(r);
  if (out.length > 0) return out;
  if (r.gamesToWin > 3) out.push('Games to win must be 1, 2 or 3 (best of five at most).');
  if (r.pointsToWin > 30) out.push('Points to win a game must be 30 or fewer.');
  if (r.winBy > 10) out.push('The winning lead must be 10 or fewer.');
  if (r.pointCap === null) out.push('Set a point cap (30 under the Laws of Badminton).');
  else if (r.pointCap > 30) out.push('The point cap must be 30 or fewer.');
  return out;
}

export function eventProblems(e: SaveEventRecord): Record<string, string> {
  const errors: Record<string, string> = {};
  if (!isCompetitionAgeGroup(e.ageGroup)) errors['ageGroup'] = 'Write the age group like U15, 35+, senior, open, veterans or masters, or leave it empty.';
  const r = rulesetProblems(e.ruleset);
  if (r.length > 0) errors['ruleset'] = r.join(' ');
  if (e.capacity !== null && (!Number.isInteger(e.capacity) || e.capacity < 2 || e.capacity > 1024)) errors['capacity'] = 'The number of places must be 2 to 1024, or empty for no limit.';
  return errors;
}

export function pointsTableProblems(t: PointsTableRecord): Record<string, string> {
  const errors: Record<string, string> = {};
  const label = t.label.trim();
  if (label.length < 2 || label.length > 120) errors['label'] = 'Give the table a name of 2 to 120 characters.';
  const levels = Object.keys(t.levels);
  if (levels.length === 0) errors['levels'] = 'Add points for at least one tournament level.';
  for (const level of levels) {
    if (!(TOURNAMENT_LEVELS as readonly string[]).includes(level)) {
      errors['levels'] = `"${level}" is not a tournament level. Use: ${TOURNAMENT_LEVELS.join(', ')}.`;
      break;
    }
    const row = t.levels[level] ?? {};
    for (const [finish, points] of Object.entries(row)) {
      if (!(FINISHES as readonly string[]).includes(finish)) {
        errors['levels'] = `"${finish}" is not a finish. Use: ${FINISHES.join(', ')}.`;
        break;
      }
      if (points === undefined || !Number.isInteger(points) || points < 0 || points > 100000) {
        errors['levels'] = 'Points must be whole numbers from 0 to 100000.';
        break;
      }
    }
  }
  if (!errors['levels'] && !levels.some((l) => Object.values(t.levels[l] ?? {}).some((p) => (p ?? 0) > 0))) errors['levels'] = 'At least one finish must give some points.';
  if (!Number.isInteger(t.windowDays) || t.windowDays < 1 || t.windowDays > 3660) errors['windowDays'] = 'The ranking window must be 1 to 3660 days.';
  if (!Number.isInteger(t.bestN) || t.bestN < 1 || t.bestN > 50) errors['bestN'] = 'Count 1 to 50 best results per player.';
  return errors;
}

/** A plain-English summary of the approved table for the Settings screen. */
export function describePointsTable(t: PointsTableRecord | null): string {
  if (t === null) return 'No ranking points table is approved yet, so no local ranking can be calculated. Enter the points for each level and approve them.';
  const levels = Object.entries(t.levels).map(([level, row]) => `${level}: ${FINISHES.filter((f) => row[f] !== undefined).map((f) => `${f} ${row[f]}`).join(', ')}`);
  return `"${t.label.trim()}": ${levels.join('; ')}. The best ${t.bestN} results of the last ${t.windowDays} days count. Power Smash local ranking, not an official BWF ranking.`;
}

// ----------------------------------------------------------------------------- an organizer's player search and new player (0024)

/** The same bounds as admin_competition_search_players and admin_competition_create_player (0024). */
export const ORGANIZER_PLAYER_LIMITS = { queryMin: 3, queryMax: 80, pageMax: 25, offsetMax: 500, nameMin: 2, nameMax: 80 } as const;

/**
 * The one refusal an organizer gets when a new player's name already exists, belongs to a hidden player or is on the removal list
 * (0024): the same words for all three, so nobody can learn that a person asked to be removed.
 */
export const NEW_PLAYER_REFUSED = 'this name cannot be added here; choose the player from the list, or ask the owner';

export const SEARCH_TOO_SHORT = `Type at least ${ORGANIZER_PLAYER_LIMITS.queryMin} letters of the name.`;

/**
 * The plain-English problem with a new player's name, or null. Same rule as the SQL: 2 to 80 characters after trimming, no control
 * characters or angle brackets, and no contact details (an @ or a run of 7 or more digits: a phone number does not belong in a name).
 */
export function newPlayerNameProblem(raw: string): string | null {
  const name = raw.trim();
  if (name.length < ORGANIZER_PLAYER_LIMITS.nameMin || name.length > ORGANIZER_PLAYER_LIMITS.nameMax) return `Type the player's full name (${ORGANIZER_PLAYER_LIMITS.nameMin} to ${ORGANIZER_PLAYER_LIMITS.nameMax} letters).`;
  // eslint-disable-next-line no-control-regex
  if (/[\u0000-\u001f\u007f<>]/.test(name)) return "Type the player's name only, without special symbols.";
  if (name.includes('@') || name.replace(/[^0-9]/g, '').length >= 7) return "Type the player's name only, no phone number or email.";
  return null;
}
