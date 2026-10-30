// Which of the owner's Featured pins from the database show on /tournaments/ today (D-104). PURE: the page passes today's India date.
// The same rule as the hand-written list (src/content/tournaments.ts isFeatured): pinned, the tournament is not over yet, and the
// "featured until" day (if any) has not passed. A pin with no dates at all shows only while it has a "featured until" day.
import { isUpcoming } from '../dates';
import type { FeaturedTournament } from './model';

export function currentFeatured(list: readonly FeaturedTournament[], today: string): FeaturedTournament[] {
  return list
    .filter((t) => {
      if (t.featuredUntil !== null && t.featuredUntil < today) return false;
      if (t.startDate !== null) return isUpcoming(t.startDate, t.endDate, today);
      return t.featuredUntil !== null;
    })
    .sort((a, b) => {
      // soonest first; undated last; then by name
      const sa = a.startDate ?? '9999-12-31';
      const sb = b.startDate ?? '9999-12-31';
      if (sa !== sb) return sa < sb ? -1 : 1;
      return a.name.localeCompare(b.name, 'en-IN');
    });
}

/** The filter keys a card carries on /tournaments/ (same shape as tournamentFilterKeys; categories are not stored for these). */
export function featuredFilterKeys(t: FeaturedTournament): { district: string; level: string; month: string; categories: string[] } {
  return { district: t.district?.trim() ?? '', level: t.level?.trim() ?? '', month: t.startDate?.slice(0, 7) ?? '', categories: [] };
}
