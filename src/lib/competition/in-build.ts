// Does this build carry the public competition pages (/competitions/...: entry lists, draws, order of play, results and published
// local rankings)? The same rule as the video archive (src/lib/archive/in-build.ts, D-107), with its own legal switch:
//  - The STRICT release build (PS_STRICT=1, the only build deploy.yml runs) carries them only when features.competitionPages is true
//    (the owner and the lawyer approve what the pages say about players, D-012 / D-109).
//  - Every other build (developer, private preview, CI, tests) builds them, with the fictional-sample notice while the data comes
//    from the seed provider, so the pages can be built and tested.
// Competition data is OWNER-ENTERED (admin RPCs, migration 0017), not read from YouTube, so this gate does not depend on the archive
// being in the build: the pages live under /competitions/ and never link to an archive page.
import { features } from '../../content/legal/status';

export type EnvLike = Readonly<Record<string, string | undefined>>;

export function competitionInBuild(env: EnvLike = readEnv(), flags: { competitionPages: boolean } = features): boolean {
  return env.PS_STRICT !== '1' || flags.competitionPages === true;
}

/** Which of the two fixed competition pages a static path renders. */
export type CompetitionFixedPage = 'index' | 'rankings';

/**
 * The static paths of the FIXED competition pages (/competitions/ and /competitions/rankings/), for the getStaticPaths of
 * src/pages/competitions/[...page].astro. EMPTY when this build carries no competition pages, so a build without them writes no
 * competitions folder at all: no prune step is needed, and the strict release build never meets the pages' owner marker while the
 * switch is off. (The tournament and event pages are not generated either: loadCompetitionSite returns an empty site.)
 */
export function competitionFixedPaths(
  env: EnvLike = readEnv(),
  flags: { competitionPages: boolean } = features,
): Array<{ params: { page: string | undefined }; props: { which: CompetitionFixedPage } }> {
  if (!competitionInBuild(env, flags)) return [];
  return [
    { params: { page: undefined }, props: { which: 'index' } },
    { params: { page: 'rankings' }, props: { which: 'rankings' } },
  ];
}

/**
 * The output folder of the competition pages, relative to .vercel/output/static. A build without the pages writes none of it
 * (competitionFixedPaths above); an optional belt-and-braces prune step (like scripts/prune-archive.mjs) may remove it anyway.
 */
export const COMPETITION_OUTPUT_PATHS = ['competitions'] as const;

function readEnv(): EnvLike {
  const meta = (import.meta as unknown as { env?: Record<string, string | undefined> }).env ?? {};
  const proc = typeof process !== 'undefined' ? process.env : {};
  return { ...meta, ...proc };
}
