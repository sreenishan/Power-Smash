// The filter rule for /tournaments (spec 7.6: district, level, month, category), shared by the page (which writes each card's keys
// into data attributes) and the small browser script (which hides cards that do not match). No imports, so the script stays tiny.

/** The values one card can be filtered on. Text is trimmed; empty means "not stated". `month` is YYYY-MM of the first day. */
export interface TournamentFilterKeys {
  district: string;
  level: string;
  month: string;
  categories: string[];
}

export type TournamentFilterName = 'district' | 'level' | 'month' | 'category';
export const TOURNAMENT_FILTER_NAMES: readonly TournamentFilterName[] = ['district', 'level', 'month', 'category'];
export type TournamentFilters = Partial<Record<TournamentFilterName, string>>;

/** True when a card matches every chosen filter (an empty or absent filter matches everything). */
export function matchesTournamentFilters(keys: TournamentFilterKeys, filters: TournamentFilters): boolean {
  if (filters.district && keys.district !== filters.district) return false;
  if (filters.level && keys.level !== filters.level) return false;
  if (filters.month && keys.month !== filters.month) return false;
  if (filters.category && !keys.categories.includes(filters.category)) return false;
  return true;
}
