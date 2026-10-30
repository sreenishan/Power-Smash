// The data PROVIDER INTERFACE of the public competition pages (platform wave 3). The pages never talk to a database: they read ONE
// in-memory snapshot (`RawCompetitionData`) that a provider returns once per build (one snapshot, no per-page network calls, D-009).
//
// Providers:
//  - seed.ts: FICTIONAL data, the default for builds and tests (invented "Sample"/"Demo"/"Mock" names, no real player);
//  - supabase-provider.ts: reads the six api.public_competition_* views and the tournament facts of api.public_tournaments over REST
//    with the PUBLISHABLE key (paginated, 1,000-row cap, D-005). Tested with a mocked fetch only.
//
// The rows have the shapes of the api views (src/lib/competition/db.ts). The views already mask in SQL (a name only for a player whose
// age_status is adult_confirmed, who is public, not provisional, not merged and not suppressed, in a non-junior event; no published
// video is needed, unlike the archive's app.eligible_players; rankings without protected players); model.ts applies its own fail-closed rule on top (protect.ts),
// a second, independent line of defence (D-012, D-109).
import type {
  PublicCompetitionDraw,
  PublicCompetitionDrawSlot,
  PublicCompetitionEvent,
  PublicCompetitionMatch,
  PublicCompetitionMatchGame,
  PublicCompetitionRanking,
} from '../db';
import { COMPETITION_VIEW_COLUMNS } from '../db';

/** The tournament facts a competition page needs (a subset of api.public_tournaments, 0006). No organizer contact of any kind. */
export interface CompetitionTournamentRow {
  id: string;
  slug: string;
  name: string;
  /** YYYY-MM-DD, India calendar date. */
  start_date: string | null;
  end_date: string | null;
  city: string | null;
  venue: string | null;
  status: string | null;
}

export const COMPETITION_TOURNAMENT_COLUMNS = ['id', 'slug', 'name', 'start_date', 'end_date', 'city', 'venue', 'status'] as const satisfies readonly (keyof CompetitionTournamentRow)[];

/**
 * An event row as the pages read it: the api.public_competition_events columns (../db.ts, which include `is_junior`, the view's own
 * fail-closed flag: a junior category or age group, OR a tournament with a minor signal). The type still allows a missing or null flag
 * (an older view, a hand-made row): the page model treats that as junior (protect.ts eventIsJunior), so an event is only ever named
 * when the view says exactly false.
 */
export type CompetitionEventRow = Omit<PublicCompetitionEvent, 'is_junior'> & { is_junior?: boolean | null };

/** Columns read from api.public_competition_events: exactly the db.ts list (kept in step with the SQL by tests/competition/db.test.ts). */
export const COMPETITION_EVENT_READ_COLUMNS: readonly string[] = COMPETITION_VIEW_COLUMNS.public_competition_events;

export interface RawCompetitionData {
  tournaments: readonly CompetitionTournamentRow[];
  events: readonly CompetitionEventRow[];
  draws: readonly PublicCompetitionDraw[];
  slots: readonly PublicCompetitionDrawSlot[];
  matches: readonly PublicCompetitionMatch[];
  games: readonly PublicCompetitionMatchGame[];
  rankings: readonly PublicCompetitionRanking[];
  /** Instant (ISO 8601) the snapshot was taken. Injected, never read from a clock inside the model. */
  generatedAt: string;
}

export type CompetitionSource = 'seed' | 'supabase';

export interface CompetitionProvider {
  /** `seed` or `supabase`. The pages show the sample-data notice when this is `seed`, and the strict build refuses it. */
  readonly id: CompetitionSource;
  load(): Promise<RawCompetitionData>;
}

export function emptyCompetitionData(generatedAt = '1970-01-01T00:00:00.000Z'): RawCompetitionData {
  return { tournaments: [], events: [], draws: [], slots: [], matches: [], games: [], rankings: [], generatedAt };
}
