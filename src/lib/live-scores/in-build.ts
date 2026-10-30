// The two switches of near-live scores (D-113). Both default OFF and are on only when exactly true:
//   features.liveScores        the legal switch in src/content/legal/status.ts (the integrator adds it; read defensively here, so a
//                              missing flag means off). It decides whether the event page carries the live region and its script.
//   LIVE_SCORES_ENABLED        the server switch (Vercel environment variable, read only through src/lib/runtime-env.ts; until that
//                              file lists the name, getRuntimeEnv() never returns it and the endpoint answers {"live": false}).
// The database adds a third (competition_settings.live_scores_public, the owner's switch in the admin): while it is off the view is
// empty, so the endpoint answers no matches.
import { features } from '../../content/legal/status';
import { liveScoresEnvOn, liveScoresFlagOn } from './rules';

/** Does this build put the live region (and its small script) on the event pages? */
export function liveScoresInBuild(flags: unknown = features): boolean {
  return liveScoresFlagOn(flags);
}

/** Is the endpoint on? The legal switch AND the server switch. */
export function liveScoresServerOn(env: Readonly<Record<string, unknown>> | null | undefined, flags: unknown = features): boolean {
  return liveScoresFlagOn(flags) && liveScoresEnvOn(env);
}
