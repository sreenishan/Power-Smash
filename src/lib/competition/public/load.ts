// Chooses the competition data source and loads the page model ONCE per build (memoised, like loadPublicArchive).
//  - Source: the real views only when PS_COMPETITION_SOURCE is exactly "supabase" AND the project URL and the PUBLISHABLE key are
//    set; anything else (a typo, a missing key) falls back to the FICTIONAL seed rather than guessing.
//  - Gate: when competitionInBuild() says this build carries no competition pages (the strict release build while
//    features.competitionPages is off), the site is empty: no tournament or event page is generated, and the fixed pages are not generated either
//    (competitionFixedPaths in ../in-build.ts), so the build writes no competitions folder.
//  - The strict build refuses the seed: CompetitionSampleNotice prints a Todo on every page built from it, so the release gate fails.
import { competitionInBuild, type EnvLike } from '../in-build';
import { buildCompetitionSite, type CompetitionSite } from './model';
import { emptyCompetitionData, type CompetitionProvider } from './provider';
import { competitionSeedProvider } from './seed';
import { createCompetitionSupabaseProvider } from './supabase-provider';

export function selectCompetitionProvider(env: EnvLike = readEnv(), fetchImpl: typeof fetch = fetch): CompetitionProvider {
  if (env.PS_COMPETITION_SOURCE === 'supabase') {
    const url = (env.PUBLIC_SUPABASE_URL ?? '').trim();
    const key = (env.PUBLIC_SUPABASE_PUBLISHABLE_KEY ?? '').trim();
    if (url && key) return createCompetitionSupabaseProvider({ url, publishableKey: key, fetch: fetchImpl });
  }
  return competitionSeedProvider;
}

/** The empty site of a build without competition pages. */
export function emptyCompetitionSite(): CompetitionSite {
  return buildCompetitionSite(emptyCompetitionData(), { source: 'supabase' });
}

let cached: Promise<CompetitionSite> | null = null;

export function loadCompetitionSite(): Promise<CompetitionSite> {
  if (!cached) {
    cached = (async () => {
      if (!competitionInBuild()) return emptyCompetitionSite();
      const provider = selectCompetitionProvider();
      const site = buildCompetitionSite(await provider.load(), { source: provider.id });
      const d = site.dropped;
      if (d.tournaments + d.events + d.rankingSnapshots > 0) {
        console.warn(
          `competitions: left out ${d.tournaments} tournament(s) with a missing, reserved or duplicate address, ${d.events} event(s) without a usable address, and ${d.rankingSnapshots} ranking(s) that may not be shown.`,
        );
      }
      return site;
    })();
  }
  return cached;
}

/** For tests: forget the memoised site. */
export function resetCompetitionSiteCache(): void {
  cached = null;
}

function readEnv(): EnvLike {
  const meta = (import.meta as unknown as { env?: Record<string, string | undefined> }).env ?? {};
  const proc = typeof process !== 'undefined' ? process.env : {};
  return { ...meta, ...proc };
}
