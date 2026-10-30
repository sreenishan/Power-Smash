// The public near-live contract (D-113): api.public_competition_live (0021) as the endpoint reads it, and the JSON the endpoint
// answers. The view already names nobody protected (app.competition_entry_faces, D-012/D-109/D-116); this file is the second,
// independent line of defence: a side is named only through publicSide() of src/lib/competition/public/protect.ts (the same rule as
// the static competition pages: a junior event, a protected flag that is not exactly false, or a missing name = "Protected player",
// and a doubles pair with one protected player is masked as a whole).
// Every row is checked field by field; a row that does not fit is dropped (never shown half-understood).
import { courtText, formatTimeIst, roundLabel, sideName } from '../../components/competition/helpers';
import { publicSide } from '../competition/public/protect';
import type { GameScore, Side } from '../competition/types';
import { isUuid, LIVE_WINDOW_SECONDS_MAX, LIVE_WINDOW_SECONDS_MIN } from './rules';

export const LIVE_VIEW = 'public_competition_live';

/** The view's columns in order (pinned against the SQL by tests/live-scores/public.test.ts and by 0021_assertions.sql). */
export const LIVE_VIEW_COLUMNS = [
  'match_id', 'event_id', 'category', 'age_group', 'is_junior', 'round_code', 'match_number', 'group_label', 'court_label', 'status',
  'is_live', 'live_window_seconds', 'game_number', 'points_a', 'points_b', 'games_a', 'games_b', 'finished_games', 'server_side',
  'last_update', 'side_a_player1_name', 'side_a_player2_name', 'side_a_protected', 'side_b_player1_name', 'side_b_player2_name',
  'side_b_protected',
] as const;

export interface LiveViewRow {
  match_id: string;
  event_id: string;
  category: string;
  age_group: string | null;
  is_junior: boolean;
  round_code: string;
  match_number: number;
  group_label: string | null;
  court_label: string | null;
  status: 'live' | 'paused';
  is_live: boolean;
  live_window_seconds: number;
  game_number: number;
  points_a: number;
  points_b: number;
  games_a: number;
  games_b: number;
  finished_games: GameScore[];
  server_side: Side | null;
  last_update: string | null;
  side_a_player1_name: string | null;
  side_a_player2_name: string | null;
  side_a_protected: boolean;
  side_b_player1_name: string | null;
  side_b_player2_name: string | null;
  side_b_protected: boolean;
}

/** One match in the endpoint's answer. Every text is ready to show (the page script only sets textContent). */
export interface LiveMatchJson {
  id: string;
  /** "Final · Court 2", "Group A · Court to be confirmed". */
  label: string;
  status: 'live' | 'paused';
  /** A point arrived within the window and the match is not paused. */
  isLive: boolean;
  /** "Live", "Paused", "Starting" (no point yet) or "Score may be out of date". */
  statusText: string;
  sideA: string;
  sideB: string;
  /** Finished games, then the game in progress. */
  games: GameScore[];
  current: GameScore;
  gameNumber: number;
  gamesWon: { a: number; b: number };
  server: Side | null;
  lastUpdate: string | null;
  /** "10:42 am IST", or "" when no point has been scored. */
  lastUpdateText: string;
}

/** The answer. Switched off: exactly {live: false}. */
export type LiveScoresResponse =
  | { live: false }
  | { live: boolean; eventId: string; windowSeconds: number | null; checkedAt: string; checkedAtText: string; matches: LiveMatchJson[] };

const ROUNDS = new Set(['F', 'SF', 'QF', 'R16', 'R32', 'R64', 'R128', '3P', 'group', 'league']);
const ZONED = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2}(\.\d+)?)?(Z|[+-]\d{2}(:?\d{2})?)$/;
const int = (v: unknown, min: number, max: number): v is number => typeof v === 'number' && Number.isInteger(v) && v >= min && v <= max;
const textOrNull = (v: unknown, max = 200): v is string | null => v === null || (typeof v === 'string' && v.length <= max);
const side = (v: unknown): v is Side | null => v === null || v === 'A' || v === 'B';
const bool = (v: unknown): v is boolean => typeof v === 'boolean';
const game = (g: unknown): g is GameScore =>
  typeof g === 'object' && g !== null && int((g as GameScore).a, 0, 30) && int((g as GameScore).b, 0, 30) && Object.keys(g).length === 2;

/** A view row checked field by field; null when anything does not fit (the row is then left out). */
export function parseLiveRow(raw: unknown): LiveViewRow | null {
  if (typeof raw !== 'object' || raw === null) return null;
  const r = raw as Record<string, unknown>;
  if (!isUuid(r.match_id) || !isUuid(r.event_id)) return null;
  if (typeof r.category !== 'string' || !textOrNull(r.age_group, 20) || !bool(r.is_junior)) return null;
  if (typeof r.round_code !== 'string' || !ROUNDS.has(r.round_code) || !int(r.match_number, 1, 9999) || !textOrNull(r.group_label, 2) || !textOrNull(r.court_label, 60)) return null;
  if (r.status !== 'live' && r.status !== 'paused') return null;
  if (!bool(r.is_live) || !int(r.live_window_seconds, LIVE_WINDOW_SECONDS_MIN, LIVE_WINDOW_SECONDS_MAX)) return null;
  if (!int(r.game_number, 1, 5) || !int(r.points_a, 0, 30) || !int(r.points_b, 0, 30) || !int(r.games_a, 0, 3) || !int(r.games_b, 0, 3)) return null;
  if (!Array.isArray(r.finished_games) || r.finished_games.length > 5 || !r.finished_games.every(game)) return null;
  if (!side(r.server_side)) return null;
  if (!(r.last_update === null || (typeof r.last_update === 'string' && ZONED.test(r.last_update) && !Number.isNaN(Date.parse(r.last_update))))) return null;
  for (const k of ['side_a_player1_name', 'side_a_player2_name', 'side_b_player1_name', 'side_b_player2_name'] as const) if (!textOrNull(r[k])) return null;
  if (!bool(r.side_a_protected) || !bool(r.side_b_protected)) return null;
  return {
    match_id: r.match_id,
    event_id: r.event_id,
    category: r.category,
    age_group: r.age_group as string | null,
    is_junior: r.is_junior,
    round_code: r.round_code,
    match_number: r.match_number as number,
    group_label: r.group_label as string | null,
    court_label: r.court_label as string | null,
    status: r.status,
    is_live: r.is_live,
    live_window_seconds: r.live_window_seconds as number,
    game_number: r.game_number as number,
    points_a: r.points_a as number,
    points_b: r.points_b as number,
    games_a: r.games_a as number,
    games_b: r.games_b as number,
    finished_games: (r.finished_games as GameScore[]).map((g) => ({ a: g.a, b: g.b })),
    server_side: r.server_side as Side | null,
    last_update: r.last_update as string | null,
    side_a_player1_name: r.side_a_player1_name as string | null,
    side_a_player2_name: r.side_a_player2_name as string | null,
    side_a_protected: r.side_a_protected,
    side_b_player1_name: r.side_b_player1_name as string | null,
    side_b_player2_name: r.side_b_player2_name as string | null,
    side_b_protected: r.side_b_protected,
  };
}

/** The status words: "Live" only while points arrive (is_live), never for a paused match. */
export function liveStatusText(row: Pick<LiveViewRow, 'status' | 'is_live'> & Partial<Pick<LiveViewRow, 'last_update'>>): string {
  if (row.status === 'paused') return 'Paused';
  if (row.is_live) return 'Live';
  // just started, no point yet: not "out of date" (the view's is_live needs a point inside the window)
  if (row.status === 'live' && (row.last_update === null || row.last_update === undefined)) return 'Starting';
  return 'Score may be out of date';
}

/** One view row as the page shows it; names only through publicSide (fail closed). */
export function toLiveMatchJson(row: LiveViewRow): LiveMatchJson {
  const event = { category: row.category, ageGroup: row.age_group, isJunior: row.is_junior };
  const a = publicSide({ player1_name: row.side_a_player1_name, player2_name: row.side_a_player2_name, is_protected: row.side_a_protected }, event);
  const b = publicSide({ player1_name: row.side_b_player1_name, player2_name: row.side_b_player2_name, is_protected: row.side_b_protected }, event);
  const round = row.round_code === 'group' ? `Group ${row.group_label ?? ''}`.trim() : roundLabel(row.round_code) || row.round_code;
  const isLive = row.status === 'live' && row.is_live;
  return {
    id: row.match_id,
    label: [round, courtText(row.court_label)].filter(Boolean).join(' · '),
    status: row.status,
    isLive,
    statusText: liveStatusText(row),
    sideA: sideName(a),
    sideB: sideName(b),
    games: row.finished_games,
    current: { a: row.points_a, b: row.points_b },
    gameNumber: row.game_number,
    gamesWon: { a: row.games_a, b: row.games_b },
    server: row.server_side,
    lastUpdate: row.last_update,
    lastUpdateText: row.last_update ? (formatTimeIst(row.last_update) ?? '') : '',
  };
}
