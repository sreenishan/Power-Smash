// FICTIONAL seed provider (M2c). Every name, tournament and video id below is invented ("Demo", "Sample", "Mock", "Trial" names,
// "fake-" video ids). It is the default data source for builds and tests, so no real player, title or video ever enters previews
// (D-004, the real-titles rule in CLAUDE.md). Deterministic: no clock, no randomness.
//
// Shape of the data (about 40 matches):
//   8 adult_confirmed players (two share a name in different districts, to exercise slug collisions),
//   2 unknown-age players, 1 minor_confirmed, 1 minor_suspected (protected: every rule of D-012 has something to bite on),
//   4 Tamil Nadu tournaments (public) and 1 non-Tamil-Nadu event (listed_no_player_pages, no parsed players, D-018),
//   32 Tamil Nadu matches (24 adult-only, 4 with an unknown-age player, 4 with a minor) and 8 non-TN matches.

import {
  DEFAULT_ARCHIVE_SETTINGS,
  type ArchiveProvider,
  type RawArchive,
  type RawMatch,
  type RawPlayer,
  type RawTournament,
} from './provider';

export const SEED_PLAYERS: readonly RawPlayer[] = [
  { id: 'p-a1', displayName: 'Demo Karthik R', ageStatus: 'adult_confirmed', district: 'Madurai' },
  { id: 'p-a2', displayName: 'Demo Karthik R', ageStatus: 'adult_confirmed', district: 'Chennai' },
  { id: 'p-a3', displayName: 'Sample Arul T', ageStatus: 'adult_confirmed', district: 'Salem', academy: 'Sample Smash Academy', bio: 'A fictional left-handed doubles player.\nSample text for the preview only.' },
  { id: 'p-a4', displayName: 'Mock Bala S', ageStatus: 'adult_confirmed', district: 'Tiruchirappalli' },
  { id: 'p-a5', displayName: 'Demo Selvi M', ageStatus: 'adult_confirmed', district: 'Madurai' },
  { id: 'p-a6', displayName: 'Mock Nithya S', ageStatus: 'adult_confirmed', district: 'Chennai' },
  { id: 'p-a7', displayName: 'Mock Kavya P', ageStatus: 'adult_confirmed', district: 'Coimbatore' },
  { id: 'p-a8', displayName: 'Sample Divya L', ageStatus: 'adult_confirmed', district: 'Salem' },
  // A slug stored while this player was believed adult: it must NOT survive (opaque slug + redirect, review B2-8).
  { id: 'p-u1', slug: 'sample-ilan-v', displayName: 'Sample Ilan V', ageStatus: 'unknown' },
  { id: 'p-u2', displayName: 'Sample Tara N', ageStatus: 'unknown' },
  { id: 'p-j1', slug: 'trial-junior-mugil', displayName: 'Trial Junior Mugil', ageStatus: 'minor_confirmed' },
  { id: 'p-j2', displayName: 'Trial Junior Oviya', ageStatus: 'minor_suspected' },
];

export const SEED_TOURNAMENTS: readonly RawTournament[] = [
  { id: 't-1', name: 'Fake District Open 2025', editionYear: 2025, city: 'Madurai', district: 'Madurai', level: 'district', startDate: '2025-01-10', endDate: '2025-01-12', visibility: 'public' },
  { id: 't-2', name: 'Mock State Ranking 2025', editionYear: 2025, city: 'Chennai', district: 'Chennai', level: 'state', startDate: '2025-04-18', endDate: '2025-04-20', visibility: 'public' },
  { id: 't-3', name: 'Sample Veterans Cup 2026', editionYear: 2026, city: 'Coimbatore', district: 'Coimbatore', level: 'veterans', startDate: '2026-02-07', endDate: '2026-02-08', visibility: 'public' },
  { id: 't-4', name: 'Demo Corporate League 2026', editionYear: 2026, city: 'Salem', district: 'Salem', level: 'corporate', startDate: '2026-06-13', endDate: '2026-06-14', visibility: 'public' },
  { id: 't-5', name: 'Fake All India Series 2026', editionYear: 2026, city: 'Bengaluru', district: null, level: 'national', startDate: '2026-08-01', endDate: '2026-08-05', visibility: 'listed_no_player_pages' },
];

const CATEGORIES = ['MS', 'WS', 'MD', 'WD', 'XD'] as const;
const ROUNDS = ['F', 'SF', 'QF', 'R16', 'R32'] as const;
const ROUND_TEXT: Record<string, string> = { F: 'Final', SF: 'Semi-final', QF: 'Quarter-final', R16: 'Round of 16', R32: 'Round of 32' };
const MEN = ['p-a1', 'p-a2', 'p-a3', 'p-a4'] as const;
const WOMEN = ['p-a5', 'p-a6', 'p-a7', 'p-a8'] as const;
const DAY_MS = 86_400_000;

function sidesFor(category: (typeof CATEGORIES)[number], i: number): [string[], string[]] {
  const m = (n: number) => MEN[(i + n) % 4] as string;
  const w = (n: number) => WOMEN[(i + n) % 4] as string;
  switch (category) {
    case 'MS':
      return [[m(0)], [m(1)]];
    case 'WS':
      return [[w(0)], [w(1)]];
    case 'MD':
      return [[m(0), m(1)], [m(2), m(3)]];
    case 'WD':
      return [[w(0), w(1)], [w(2), w(3)]];
    default:
      return [[m(0), w(0)], [m(1), w(2)]];
  }
}

function buildSeedMatches(): RawMatch[] {
  const names = new Map(SEED_PLAYERS.map((p) => [p.id, p.displayName]));
  const tournaments = new Map(SEED_TOURNAMENTS.map((t) => [t.id, t]));
  const out: RawMatch[] = [];
  let j = 0; // counter of Tamil Nadu matches
  for (let k = 0; k < 40; k += 1) {
    const videoId = `fake-m${String(k + 1).padStart(5, '0')}`;
    const publishedAt = new Date(Date.UTC(2025, 0, 5, 4, 30) + k * 12 * DAY_MS).toISOString();
    const round = ROUNDS[(k * 3) % 5] as string;
    const base = {
      id: `m-${String(k + 1).padStart(3, '0')}`,
      videoId,
      publishedAt,
      updatedAt: publishedAt,
      durationSeconds: 600 + k * 47,
      views: 1200 + k * 137,
      round,
    };
    if (k % 5 === 4) {
      // Non-Tamil-Nadu event: listed with the raw title, no parsed players (D-018).
      const t = tournaments.get('t-5') as RawTournament;
      out.push({
        ...base,
        rawTitle: `${t.name} | Court ${(k % 4) + 1} | ${ROUND_TEXT[round]}`,
        tournamentId: t.id,
        category: null,
        ageGroup: null,
        sideA: [],
        sideB: [],
      });
      continue;
    }
    const category = CATEGORIES[j % 5] as (typeof CATEGORIES)[number];
    const t = tournaments.get(`t-${(j % 4) + 1}`) as RawTournament;
    const [sideA, sideB] = sidesFor(category, j);
    if (j % 8 === 5) sideB[0] = j % 16 === 5 ? 'p-u1' : 'p-u2'; // an unknown-age player
    if (j % 8 === 7) sideB[0] = j % 16 === 7 ? 'p-j1' : 'p-j2'; // a minor (confirmed, then suspected)
    const label = (ids: string[]) => ids.map((id) => names.get(id)).join(' / ');
    out.push({
      ...base,
      rawTitle: `${label(sideA)} vs ${label(sideB)} | ${t.name} | ${category} | ${ROUND_TEXT[round]}`,
      tournamentId: t.id,
      category,
      ageGroup: t.level === 'veterans' ? '35+' : 'open',
      sideA,
      sideB,
    });
    j += 1;
  }
  return out;
}

export const SEED_MATCHES: readonly RawMatch[] = buildSeedMatches();

export const SEED_GENERATED_AT = '2026-10-20T00:00:00.000Z';

export const seedArchive: RawArchive = {
  players: SEED_PLAYERS,
  tournaments: SEED_TOURNAMENTS,
  matches: SEED_MATCHES,
  settings: DEFAULT_ARCHIVE_SETTINGS,
  generatedAt: SEED_GENERATED_AT,
  // A fictional rename: the old address of an adult profile redirects to the current one.
  redirects: [{ from: '/players/demo-selvi-old/', to: '/players/demo-selvi-m/' }],
  suppressedNames: [],
  gonePaths: [],
};

export const seedProvider: ArchiveProvider = {
  id: 'seed',
  load: async () => seedArchive,
};

/** Display names of every protected (not adult_confirmed) player of the seed: what the leakage tests look for. */
export function protectedSeedNames(archive: RawArchive = seedArchive): string[] {
  return archive.players.filter((p) => p.ageStatus !== 'adult_confirmed').map((p) => p.displayName);
}
