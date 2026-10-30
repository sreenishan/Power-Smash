// Does this build carry the international events page (/international/, D-112)? The same rule as the competition pages
// (src/lib/competition/in-build.ts), with a legal switch of its own:
//  - the STRICT release build (PS_STRICT=1, the only build deploy.yml runs) carries it only when features.internationalLinks is true
//    (the owner and the lawyer approve listing other organisers' events with a link);
//  - every other build (developer, private preview, CI, tests) builds it, from FICTIONAL sample data unless the real source is chosen,
//    with the sample notice and noindex, so the page can be built and tested.
// The page lists owner-entered events only (name, level, dates, place and ONE official link); it never depends on the archive or on the
// competition pages being built.
// features.internationalLinks does not exist until the integrator adds it to src/content/legal/status.ts; it is read defensively, so a
// missing flag counts as OFF.
import { features } from '../../content/legal/status';

export type EnvLike = Readonly<Record<string, string | undefined>>;

export interface InternationalFlags {
  internationalLinks?: boolean;
}

/** features.internationalLinks, or false while the flag does not exist yet (only exactly true counts). */
export function internationalLinksFlag(flags: Readonly<Record<string, unknown>> = features as unknown as Readonly<Record<string, unknown>>): boolean {
  return flags.internationalLinks === true;
}

export function internationalInBuild(env: EnvLike = readEnv(), flags: InternationalFlags = { internationalLinks: internationalLinksFlag() }): boolean {
  return env.PS_STRICT !== '1' || flags.internationalLinks === true;
}

/**
 * The static paths of src/pages/international/[...page].astro: the one page /international/, or NONE when this build carries no
 * international page, so the strict release build writes no international folder while the switch is off (no prune step needed, and
 * the release gate never meets the page's owner marker).
 */
export function internationalPaths(env: EnvLike = readEnv(), flags: InternationalFlags = { internationalLinks: internationalLinksFlag() }): Array<{ params: { page: undefined } }> {
  if (!internationalInBuild(env, flags)) return [];
  return [{ params: { page: undefined } }];
}

/** The output folder of the page, relative to .vercel/output/static (for an optional belt-and-braces prune step). */
export const INTERNATIONAL_OUTPUT_PATHS = ['international'] as const;

/** The page address (internal links end with a slash, src/lib/urls.ts). */
export const INTERNATIONAL_PATH = '/international/';

function readEnv(): EnvLike {
  const meta = (import.meta as unknown as { env?: Record<string, string | undefined> }).env ?? {};
  const proc = typeof process !== 'undefined' ? process.env : {};
  return { ...meta, ...proc };
}
