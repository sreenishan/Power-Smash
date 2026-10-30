// Shared fictional rows for the live-score tests (not a test file).
import type { LiveViewRow } from '../../src/lib/live-scores/public';

export function liveRow(over: Partial<Record<keyof LiveViewRow, unknown>> = {}): Record<string, unknown> {
  return {
    match_id: 'aa000000-0000-4000-8000-000000000001',
    event_id: 'ab000000-0000-4000-8000-000000000001',
    category: 'MS',
    age_group: null,
    is_junior: false,
    round_code: 'F',
    match_number: 1,
    group_label: null,
    court_label: 'Court 2',
    status: 'live',
    is_live: true,
    live_window_seconds: 300,
    game_number: 2,
    points_a: 7,
    points_b: 5,
    games_a: 1,
    games_b: 0,
    finished_games: [{ a: 21, b: 19 }],
    server_side: 'A',
    last_update: '2026-11-07T05:12:00.123456+00:00',
    side_a_player1_name: 'Demo Arun',
    side_a_player2_name: null,
    side_a_protected: false,
    side_b_player1_name: 'Demo Bala',
    side_b_player2_name: null,
    side_b_protected: false,
    ...over,
  };
}
