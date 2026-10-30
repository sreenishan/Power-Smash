// Supabase REST provider for the public competition pages (platform wave 3). Reads ONLY the explicit-column api views with the
// PUBLISHABLE key (D-005): the six api.public_competition_* views (column lists from ../db.ts, kept in step with the SQL by
// tests/competition/db.test.ts) and the tournament facts of api.public_tournaments (0006). The build job never holds the secret key.
// Every list read is paginated (the REST API caps a response at 1,000 rows) and ordered by a stable key so pages never overlap.
// Written and tested with a MOCKED fetch only: no Supabase project exists yet.
//
// The events view carries is_junior (the SQL's own junior flag, which also covers a tournament with a minor signal); it is in the
// db.ts column list like every other column. A view without it fails the read and stops the build (fail closed), and the page model
// treats a missing or null flag as junior anyway.
//
// Only the tournaments that have a public competition event are kept (the rest of api.public_tournaments is the archive's business).
// Rows are passed on as the views give them; the page model (model.ts, protect.ts) applies its own fail-closed rules on top.
import { isAcceptableSupabaseUrl } from '../../supabase/rest';
import { COMPETITION_VIEW_COLUMNS, type CompetitionView } from '../db';
import type {
  PublicCompetitionDraw,
  PublicCompetitionDrawSlot,
  PublicCompetitionMatch,
  PublicCompetitionMatchGame,
  PublicCompetitionRanking,
} from '../db';
import { COMPETITION_TOURNAMENT_COLUMNS, type CompetitionEventRow, type CompetitionProvider, type CompetitionTournamentRow, type RawCompetitionData } from './provider';

export const REST_PAGE_SIZE = 1000;
/** A guard against a runaway loop: 200 pages = 200,000 rows. */
export const MAX_REST_PAGES = 200;

export interface CompetitionSupabaseOptions {
  /** Project URL, https://<ref>.supabase.co */
  url: string;
  /** The PUBLISHABLE key (never the secret key). */
  publishableKey: string;
  fetch: typeof fetch;
  /** Injected clock for `generatedAt`. */
  now?: () => Date;
  allowLocalUrl?: boolean;
}

/** Stable order of each view (unique keys, so pages never overlap or skip). */
export const COMPETITION_VIEW_ORDER: Readonly<Record<CompetitionView | 'public_tournaments', string>> = {
  public_competition_events: 'id.asc',
  public_competition_draws: 'id.asc',
  public_competition_draw_slots: 'draw_id.asc,position.asc',
  public_competition_matches: 'id.asc',
  public_competition_match_games: 'match_id.asc,game_number.asc',
  // player_slug is unique within a snapshot and set on every row the view returns (named adults only); a row without one is dropped by
  // the page model anyway, and nullslast keeps such rows at a fixed place.
  public_competition_rankings: 'snapshot_id.asc,rank.asc,player_slug.asc.nullslast',
  public_tournaments: 'id.asc',
};

/** One paginated read of an api view. Returns every row; throws a message that never contains a response body. */
export async function readAllRows<T>(opts: CompetitionSupabaseOptions, view: string, columns: readonly string[], orderBy: string): Promise<T[]> {
  const base = `${opts.url.replace(/\/+$/, '')}/rest/v1/${view}`;
  const select = columns.join(',');
  const rows: T[] = [];
  for (let page = 0; page < MAX_REST_PAGES; page += 1) {
    const url = `${base}?select=${encodeURIComponent(select)}&order=${encodeURIComponent(orderBy)}&limit=${REST_PAGE_SIZE}&offset=${page * REST_PAGE_SIZE}`;
    const res = await opts.fetch(url, {
      method: 'GET',
      headers: { apikey: opts.publishableKey, accept: 'application/json', 'accept-profile': 'api' },
    });
    if (!res.ok) throw new Error(`competition_read_failed_${view}_${res.status}`);
    const body: unknown = await res.json();
    if (!Array.isArray(body)) throw new Error(`competition_read_bad_shape_${view}`);
    rows.push(...(body as T[]));
    if (body.length < REST_PAGE_SIZE) return rows;
  }
  throw new Error(`competition_read_too_many_pages_${view}`);
}

export function createCompetitionSupabaseProvider(opts: CompetitionSupabaseOptions): CompetitionProvider {
  if (!opts.publishableKey) throw new Error('competition_publishable_key_missing');
  if (!isAcceptableSupabaseUrl(opts.url, opts.allowLocalUrl === true)) throw new Error('supabase_url_refused');
  const read = <T>(view: CompetitionView): Promise<T[]> =>
    readAllRows<T>(opts, view, COMPETITION_VIEW_COLUMNS[view], COMPETITION_VIEW_ORDER[view]);
  return {
    id: 'supabase',
    async load(): Promise<RawCompetitionData> {
      const [events, draws, slots, matches, games, rankings, allTournaments] = await Promise.all([
        read<CompetitionEventRow>('public_competition_events'),
        read<PublicCompetitionDraw>('public_competition_draws'),
        read<PublicCompetitionDrawSlot>('public_competition_draw_slots'),
        read<PublicCompetitionMatch>('public_competition_matches'),
        read<PublicCompetitionMatchGame>('public_competition_match_games'),
        read<PublicCompetitionRanking>('public_competition_rankings'),
        readAllRows<CompetitionTournamentRow>(opts, 'public_tournaments', COMPETITION_TOURNAMENT_COLUMNS, COMPETITION_VIEW_ORDER.public_tournaments),
      ]);
      const used = new Set(events.map((e) => e.tournament_id));
      return {
        tournaments: allTournaments.filter((t) => used.has(t.id)),
        events,
        draws,
        slots,
        matches,
        games,
        rankings,
        generatedAt: (opts.now?.() ?? new Date()).toISOString(),
      };
    },
  };
}
