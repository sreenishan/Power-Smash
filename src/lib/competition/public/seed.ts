// FICTIONAL seed provider for the public competition pages (platform wave 3). Every name, place and id below is invented ("Sample",
// "Demo", "Mock", "Trial" names, "sample-" slugs, ids starting with a letter code). It is the default data source for builds and
// tests, so no real player or tournament ever enters a preview (D-004). Deterministic: no clock, no randomness.
//
// The naming rule the rows follow (the lead's rule for COMPETITION data, separate from the archive's app.eligible_players): a player is
// named when age_status = 'adult_confirmed', visibility = 'public', not provisional, not merged and not suppressed. No published
// YouTube match is needed (SEED_NAMED_WITHOUT_ARCHIVE_MATCH below is such a player). Everyone else, and everyone in a junior event or
// a minor-signal tournament (is_junior), is "Protected player" and left out of rankings.
//
// The rows have the exact shapes of the api views, INCLUDING the masking the SQL does (a junior event or an unknown-age player has
// null names and is_protected = true; unconfirmed results read 'awaiting_result' with no winner and no games), so the page model is
// exercised on what the real views return. One row is deliberately "leaky" (a junior event row carrying a name the SQL would have
// nulled) to prove the page model's own rule still hides it (protect.ts).
//
// Shape:
//   1 tournament "Sample City Open 2026" (slug sample-city-open-2026) with
//     MS  knockout, 8 lines, 6 entries and 2 byes; quarter-finals and one semi-final confirmed, one semi-final awaiting its result,
//         the final not played; one entry is an unknown-age player (protected); one adult-confirmed player has no archive
//         (YouTube) match at all and is still named, in the draw and in the ranking;
//     XD  round robin, one group of 3 pairs, one pair has a protected partner (the whole pair is masked);
//     BS U15 knockout (junior: everyone protected), 4 entries;
//   1 tournament "Demo Corporate Shuttle League 2026" with WD groups then knockout (2 groups of 2, a final);
//   1 tournament "Trial College Games 2026" with a MINOR SIGNAL (a college event): its MS event is an adult category, but the view
//     flags it is_junior. Its rows are deliberately "leaky" (names the SQL would have nulled) to prove the page model's own rule
//     (protect.ts eventIsJunior) still hides everyone;
//   1 published ranking snapshot (MS, open) with one protected row the model must drop, and one junior snapshot it must not show.
import { DEFAULT_RULESET } from '../scoring';
import type {
  PublicCompetitionDraw,
  PublicCompetitionDrawSlot,
  PublicCompetitionMatch,
  PublicCompetitionMatchGame,
  PublicCompetitionRanking,
} from '../db';
import type { CompetitionEventRow, CompetitionProvider, CompetitionTournamentRow, RawCompetitionData } from './provider';

export const SEED_GENERATED_AT = '2026-10-30T06:30:00.000Z';

export const SEED_COMPETITION_TOURNAMENTS: readonly CompetitionTournamentRow[] = [
  { id: 'ct-1', slug: 'sample-city-open-2026', name: 'Sample City Open 2026', start_date: '2026-11-07', end_date: '2026-11-08', city: 'Sampleur', venue: 'Demo Indoor Stadium', status: 'scheduled' },
  { id: 'ct-2', slug: 'demo-corporate-shuttle-league-2026', name: 'Demo Corporate Shuttle League 2026', start_date: '2026-09-12', end_date: '2026-09-13', city: 'Mockpet', venue: null, status: 'completed' },
  { id: 'ct-3', slug: 'trial-college-games-2026', name: 'Trial College Games 2026', start_date: '2026-08-20', end_date: '2026-08-21', city: 'Demoville', venue: null, status: 'completed' },
];

const ruleset = { ...DEFAULT_RULESET };

export const SEED_COMPETITION_EVENTS: readonly CompetitionEventRow[] = [
  { id: 'ce-ms', tournament_id: 'ct-1', category: 'MS', age_group: null, format: 'knockout', status: 'closed', capacity: 8, ruleset, is_junior: false },
  { id: 'ce-xd', tournament_id: 'ct-1', category: 'XD', age_group: 'open', format: 'round_robin', status: 'closed', capacity: 4, ruleset, is_junior: false },
  { id: 'ce-bs', tournament_id: 'ct-1', category: 'BS', age_group: 'U15', format: 'knockout', status: 'closed', capacity: 4, ruleset, is_junior: true },
  { id: 'ce-wd', tournament_id: 'ct-2', category: 'WD', age_group: null, format: 'groups_knockout', status: 'closed', capacity: 4, ruleset, is_junior: false },
  // an adult category in a minor-signal tournament: the view says is_junior
  { id: 'ce-cms', tournament_id: 'ct-3', category: 'MS', age_group: null, format: 'knockout', status: 'closed', capacity: 2, ruleset, is_junior: true },
];

export const SEED_COMPETITION_DRAWS: readonly PublicCompetitionDraw[] = [
  { id: 'cd-ms', event_id: 'ce-ms', status: 'published', seed: 1234, published_at: '2026-11-01T04:30:00.000Z' },
  { id: 'cd-xd', event_id: 'ce-xd', status: 'published', seed: 2345, published_at: '2026-11-01T04:30:00.000Z' },
  { id: 'cd-bs', event_id: 'ce-bs', status: 'published', seed: 3456, published_at: '2026-11-01T04:30:00.000Z' },
  { id: 'cd-wd', event_id: 'ce-wd', status: 'locked', seed: 4567, published_at: '2026-09-01T04:30:00.000Z' },
  { id: 'cd-cms', event_id: 'ce-cms', status: 'locked', seed: 5678, published_at: '2026-08-15T04:30:00.000Z' },
];

type Face = Pick<PublicCompetitionDrawSlot, 'player1_slug' | 'player1_name' | 'player2_slug' | 'player2_name' | 'is_protected'>;
const adult = (name: string, slug: string): Face => ({ player1_slug: slug, player1_name: name, player2_slug: null, player2_name: null, is_protected: false });
const pair = (n1: string, s1: string, n2: string, s2: string): Face => ({ player1_slug: s1, player1_name: n1, player2_slug: s2, player2_name: n2, is_protected: false });
const masked = (partner?: { name: string; slug: string }): Face => ({
  player1_slug: partner?.slug ?? null,
  player1_name: partner?.name ?? null,
  player2_slug: null,
  player2_name: null,
  is_protected: true,
});

/** entry id -> face, the same as app.competition_entry_faces would give. */
export const SEED_ENTRY_FACES: Readonly<Record<string, Face>> = {
  'en-ms-1': adult('Demo Karthik R', 'demo-karthik-r'),
  'en-ms-2': adult('Mock Bala S', 'mock-bala-s'),
  'en-ms-3': adult('Sample Arul T', 'sample-arul-t'),
  'en-ms-4': masked(), // an unknown-age player: protected
  'en-ms-5': adult('Demo Vetri K', 'demo-vetri-k'),
  // adult_confirmed and public, but no published YouTube match (the archive would give him no profile): named all the same
  'en-ms-6': adult('Mock Siva P', 'mock-siva-p'),
  'en-xd-1': pair('Demo Ravi M', 'demo-ravi-m', 'Mock Nithya S', 'mock-nithya-s'),
  'en-xd-2': pair('Sample Ganesh V', 'sample-ganesh-v', 'Demo Selvi M', 'demo-selvi-m'),
  // the adult partner is named by the SQL, the other is protected: the page masks the whole pair
  'en-xd-3': masked({ name: 'Mock Prakash D', slug: 'mock-prakash-d' }),
  'en-bs-1': masked(),
  'en-bs-2': masked(),
  'en-bs-3': masked(),
  // deliberately leaky: a junior event row with a name (the SQL would have nulled it); protect.ts must still hide it
  'en-bs-4': { player1_slug: 'trial-junior-leak', player1_name: 'Trial Junior Leak', player2_slug: null, player2_name: null, is_protected: false },
  'en-wd-1': pair('Demo Kavya P', 'demo-kavya-p', 'Sample Divya L', 'sample-divya-l'),
  'en-wd-2': pair('Mock Anitha R', 'mock-anitha-r', 'Demo Priya K', 'demo-priya-k'),
  'en-wd-3': pair('Sample Meena J', 'sample-meena-j', 'Mock Latha V', 'mock-latha-v'),
  'en-wd-4': pair('Demo Revathi N', 'demo-revathi-n', 'Sample Uma B', 'sample-uma-b'),
  // deliberately leaky: a minor-signal tournament's rows with names (the SQL would have nulled them); protect.ts must still hide them
  'en-cms-1': adult('Trial College Leak A', 'trial-college-leak-a'),
  'en-cms-2': adult('Trial College Leak B', 'trial-college-leak-b'),
};

/** An adult-confirmed, public player with NO archive (YouTube) match: the competition rule names him (no video needed). */
export const SEED_NAMED_WITHOUT_ARCHIVE_MATCH = { entryId: 'en-ms-6', name: 'Mock Siva P' } as const;

const SEEDS: Readonly<Record<string, number>> = { 'en-ms-1': 1, 'en-ms-2': 2, 'en-bs-1': 1, 'en-wd-1': 1, 'en-wd-3': 2 };

function slot(drawId: string, position: number, entryId: string | null, group: string | null = null): PublicCompetitionDrawSlot {
  const face = entryId ? SEED_ENTRY_FACES[entryId]! : { player1_slug: null, player1_name: null, player2_slug: null, player2_name: null, is_protected: false };
  return { draw_id: drawId, position, group_label: group, entry_id: entryId, is_bye: entryId === null, seed: entryId ? (SEEDS[entryId] ?? null) : null, ...face };
}

export const SEED_COMPETITION_SLOTS: readonly PublicCompetitionDrawSlot[] = [
  // MS: 8 lines; seed 1 on line 1, seed 2 on line 8; byes against both seeds
  slot('cd-ms', 1, 'en-ms-1'),
  slot('cd-ms', 2, null),
  slot('cd-ms', 3, 'en-ms-3'),
  slot('cd-ms', 4, 'en-ms-4'),
  slot('cd-ms', 5, 'en-ms-5'),
  slot('cd-ms', 6, 'en-ms-6'),
  slot('cd-ms', 7, null),
  slot('cd-ms', 8, 'en-ms-2'),
  // XD: one group
  slot('cd-xd', 1, 'en-xd-1', 'A'),
  slot('cd-xd', 2, 'en-xd-2', 'A'),
  slot('cd-xd', 3, 'en-xd-3', 'A'),
  // BS U15: 4 lines
  slot('cd-bs', 1, 'en-bs-1'),
  slot('cd-bs', 2, 'en-bs-4'),
  slot('cd-bs', 3, 'en-bs-3'),
  slot('cd-bs', 4, 'en-bs-2'),
  // WD: two groups of two
  slot('cd-wd', 1, 'en-wd-1', 'A'),
  slot('cd-wd', 2, 'en-wd-2', 'A'),
  slot('cd-wd', 3, 'en-wd-3', 'B'),
  slot('cd-wd', 4, 'en-wd-4', 'B'),
  // Trial College Games MS: a two-line final
  slot('cd-cms', 1, 'en-cms-1'),
  slot('cd-cms', 2, 'en-cms-2'),
];

type MatchInput = {
  id: string;
  event: string;
  round: PublicCompetitionMatch['round_code'];
  no: number;
  a: string | null;
  b: string | null;
  at: string | null;
  court: string | null;
  status: PublicCompetitionMatch['status'];
  winner?: 'A' | 'B' | null;
  group?: string | null;
};

function match(m: MatchInput): PublicCompetitionMatch {
  const fa = m.a ? SEED_ENTRY_FACES[m.a]! : null;
  const fb = m.b ? SEED_ENTRY_FACES[m.b]! : null;
  const confirmed = ['completed', 'walkover', 'retired', 'abandoned'].includes(m.status);
  return {
    id: m.id,
    event_id: m.event,
    round_code: m.round,
    match_number: m.no,
    group_label: m.group ?? null,
    scheduled_at: m.at,
    court_label: m.court,
    status: m.status,
    side_a_entry: m.a,
    side_a_player1_slug: fa?.player1_slug ?? null,
    side_a_player1_name: fa?.player1_name ?? null,
    side_a_player2_slug: fa?.player2_slug ?? null,
    side_a_player2_name: fa?.player2_name ?? null,
    side_a_protected: fa?.is_protected ?? false,
    side_b_entry: m.b,
    side_b_player1_slug: fb?.player1_slug ?? null,
    side_b_player1_name: fb?.player1_name ?? null,
    side_b_player2_slug: fb?.player2_slug ?? null,
    side_b_player2_name: fb?.player2_name ?? null,
    side_b_protected: fb?.is_protected ?? false,
    winner_side: confirmed ? (m.winner ?? null) : null,
    result_confirmed: confirmed,
    updated_at: '2026-11-07T12:00:00.000Z',
  };
}

export const SEED_COMPETITION_MATCHES: readonly PublicCompetitionMatch[] = [
  // MS quarter-finals (two real matches; lines 1 and 8 have byes and no match row)
  match({ id: 'cm-ms-qf2', event: 'ce-ms', round: 'QF', no: 2, a: 'en-ms-3', b: 'en-ms-4', at: '2026-11-07T04:00:00.000Z', court: '1', status: 'completed', winner: 'B' }),
  match({ id: 'cm-ms-qf3', event: 'ce-ms', round: 'QF', no: 3, a: 'en-ms-6', b: 'en-ms-5', at: '2026-11-07T04:00:00.000Z', court: '2', status: 'walkover', winner: 'A' }),
  // MS semi-finals: one confirmed (the protected player loses to seed 1), one waiting for its result to be confirmed
  match({ id: 'cm-ms-sf1', event: 'ce-ms', round: 'SF', no: 5, a: 'en-ms-1', b: 'en-ms-4', at: '2026-11-07T09:30:00.000Z', court: '1', status: 'completed', winner: 'A' }),
  match({ id: 'cm-ms-sf2', event: 'ce-ms', round: 'SF', no: 6, a: 'en-ms-6', b: 'en-ms-2', at: '2026-11-07T09:30:00.000Z', court: '2', status: 'awaiting_result' }),
  // MS final: sides not known yet
  match({ id: 'cm-ms-f', event: 'ce-ms', round: 'F', no: 7, a: 'en-ms-1', b: null, at: '2026-11-08T10:30:00.000Z', court: 'Centre court', status: 'scheduled' }),
  // XD round robin: one played, one in progress (never "Live" on a static page), one not timed yet
  match({ id: 'cm-xd-1', event: 'ce-xd', round: 'group', no: 1, a: 'en-xd-1', b: 'en-xd-2', at: '2026-11-07T05:00:00.000Z', court: '3', status: 'completed', winner: 'B', group: 'A' }),
  match({ id: 'cm-xd-2', event: 'ce-xd', round: 'group', no: 2, a: 'en-xd-1', b: 'en-xd-3', at: '2026-11-07T06:00:00.000Z', court: '3', status: 'live', group: 'A' }),
  match({ id: 'cm-xd-3', event: 'ce-xd', round: 'group', no: 3, a: 'en-xd-2', b: 'en-xd-3', at: null, court: null, status: 'scheduled', group: 'A' }),
  // BS U15 semi-finals (junior: names never shown)
  match({ id: 'cm-bs-sf1', event: 'ce-bs', round: 'SF', no: 1, a: 'en-bs-1', b: 'en-bs-4', at: '2026-11-07T03:30:00.000Z', court: '4', status: 'completed', winner: 'A' }),
  match({ id: 'cm-bs-sf2', event: 'ce-bs', round: 'SF', no: 2, a: 'en-bs-3', b: 'en-bs-2', at: '2026-11-07T03:30:00.000Z', court: '5', status: 'scheduled' }),
  // WD groups then final
  match({ id: 'cm-wd-a', event: 'ce-wd', round: 'group', no: 1, a: 'en-wd-1', b: 'en-wd-2', at: '2026-09-12T04:00:00.000Z', court: '1', status: 'completed', winner: 'A', group: 'A' }),
  match({ id: 'cm-wd-b', event: 'ce-wd', round: 'group', no: 2, a: 'en-wd-3', b: 'en-wd-4', at: '2026-09-12T04:00:00.000Z', court: '2', status: 'retired', winner: 'A', group: 'B' }),
  match({ id: 'cm-cms-f', event: 'ce-cms', round: 'F', no: 1, a: 'en-cms-1', b: 'en-cms-2', at: '2026-08-21T05:00:00.000Z', court: '1', status: 'completed', winner: 'A' }),
  match({ id: 'cm-wd-f', event: 'ce-wd', round: 'F', no: 3, a: 'en-wd-1', b: 'en-wd-3', at: '2026-09-13T08:00:00.000Z', court: '1', status: 'completed', winner: 'B' }),
];

const g = (match_id: string, game_number: number, points_a: number, points_b: number, finished = true): PublicCompetitionMatchGame => ({ match_id, game_number, points_a, points_b, finished });

/** Games of CONFIRMED results only (the view returns nothing for the others). */
export const SEED_COMPETITION_GAMES: readonly PublicCompetitionMatchGame[] = [
  g('cm-ms-qf2', 1, 18, 21),
  g('cm-ms-qf2', 2, 21, 19),
  g('cm-ms-qf2', 3, 17, 21),
  g('cm-ms-sf1', 1, 21, 12),
  g('cm-ms-sf1', 2, 21, 15),
  g('cm-xd-1', 1, 15, 21),
  g('cm-xd-1', 2, 19, 21),
  g('cm-bs-sf1', 1, 21, 10),
  g('cm-bs-sf1', 2, 21, 8),
  g('cm-wd-a', 1, 21, 16),
  g('cm-wd-a', 2, 21, 18),
  g('cm-wd-b', 1, 21, 11),
  g('cm-wd-b', 2, 6, 2, false),
  g('cm-wd-f', 1, 21, 23),
  g('cm-wd-f', 2, 21, 14),
  g('cm-wd-f', 3, 20, 22),
  g('cm-cms-f', 1, 21, 17),
  g('cm-cms-f', 2, 21, 19),
];

const rank = (snapshot_id: string, label: string, category: PublicCompetitionRanking['category'], age_group: string | null, r: number, points: number, events: number, name: string | null, isProtected: boolean): PublicCompetitionRanking => ({
  snapshot_id,
  label,
  category,
  age_group,
  as_of: '2026-10-15',
  published_at: '2026-10-16T05:00:00.000Z',
  rank: r,
  points,
  events_counted: events,
  player_slug: name ? name.toLowerCase().replace(/\s+/g, '-') : null,
  player_name: name,
  is_protected: isProtected,
});

export const SEED_COMPETITION_RANKINGS: readonly PublicCompetitionRanking[] = [
  rank('rs-ms', 'Sample district ladder', 'MS', 'open', 1, 120, 3, 'Demo Karthik R', false),
  rank('rs-ms', 'Sample district ladder', 'MS', 'open', 2, 95, 3, 'Mock Siva P', false),
  rank('rs-ms', 'Sample district ladder', 'MS', 'open', 2, 95, 2, 'Sample Arul T', false),
  // a protected row the SQL would never return; the page model must drop it, not mask it
  rank('rs-ms', 'Sample district ladder', 'MS', 'open', 4, 60, 2, null, true),
  rank('rs-ms', 'Sample district ladder', 'MS', 'open', 5, 40, 1, 'Mock Bala S', false),
  // a junior snapshot: never shown, even with a name in it
  rank('rs-bs', 'Sample junior ladder', 'BS', 'U15', 1, 80, 2, 'Trial Junior Leak', false),
];

export function seedCompetitionData(): RawCompetitionData {
  return {
    tournaments: SEED_COMPETITION_TOURNAMENTS,
    events: SEED_COMPETITION_EVENTS,
    draws: SEED_COMPETITION_DRAWS,
    slots: SEED_COMPETITION_SLOTS,
    matches: SEED_COMPETITION_MATCHES,
    games: SEED_COMPETITION_GAMES,
    rankings: SEED_COMPETITION_RANKINGS,
    generatedAt: SEED_GENERATED_AT,
  };
}

export const competitionSeedProvider: CompetitionProvider = {
  id: 'seed',
  async load() {
    return seedCompetitionData();
  },
};
