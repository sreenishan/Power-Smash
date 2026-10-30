// Does this build carry the video archive (player pages, match pages, tournament pages made from videos, and the archive sections on
// other pages)? Owner decision 2026-10-30 (D-107): the first public release (G1) leaves the archive out until its legal switch,
// features.archivePages, is on (the owner and the lawyer approve the protected-player rules, D-012; a G2 item).
//  - The STRICT release build (PS_STRICT=1, the only build deploy.yml runs) carries it only when features.archivePages is true.
//  - Every other build (developer, private preview, CI, tests) keeps it, with the sample-data notice, so the archive can still be
//    built and tested.
// Owner-entered tournaments (src/content/tournaments.ts) are not archive and are always built.
import { features } from '../../content/legal/status';

export type EnvLike = Readonly<Record<string, string | undefined>>;

export function archiveInBuild(env: EnvLike = readEnv(), flags: { archivePages: boolean } = features): boolean {
  return env.PS_STRICT !== '1' || flags.archivePages === true;
}

/**
 * Output files Astro always writes for the archive's fixed routes (pages without getStaticPaths, JSON and XML endpoints). When the
 * archive is left out, scripts/prune-archive.mjs removes them after the build; the dynamic archive pages are simply not generated
 * (loadPublicArchive returns an empty archive). Paths are relative to .vercel/output/static.
 */
export const ARCHIVE_OUTPUT_PATHS = [
  'matches',
  'players',
  'search-index.json',
  'sitemap-matches.xml',
  'sitemap-players.xml',
] as const;

function readEnv(): EnvLike {
  const meta = (import.meta as unknown as { env?: Record<string, string | undefined> }).env ?? {};
  const proc = typeof process !== 'undefined' ? process.env : {};
  return { ...meta, ...proc };
}
