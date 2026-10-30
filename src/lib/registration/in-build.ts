// Does this build carry the registration pages (/register/<tournament>/<event>/)? The competition pages' rule
// (src/lib/competition/in-build.ts) PLUS a switch of its own:
//  - the STRICT release build (PS_STRICT=1) carries them only when features.competitionPages AND features.registrations are both true
//    (registration collects personal data: the owner and the lawyer approve the notice first, D-111);
//  - every other build (developer, private preview, CI, tests) builds them from FICTIONAL sample data, with the sample notice and
//    noindex, so the form can be built and tested.
// features.registrations does not exist until the integrator adds it to src/content/legal/status.ts; it is read defensively, so a
// missing flag counts as OFF.
import { features } from '../../content/legal/status';
import { competitionInBuild, type EnvLike } from '../competition/in-build';

export interface RegistrationFlags {
  competitionPages: boolean;
  registrations?: boolean;
}

/** features.registrations, or false while the flag does not exist yet. */
export function registrationsFlag(flags: Readonly<Record<string, unknown>> = features as unknown as Readonly<Record<string, unknown>>): boolean {
  return flags.registrations === true;
}

export function registrationInBuild(env: EnvLike = readEnv(), flags: RegistrationFlags = { competitionPages: features.competitionPages, registrations: registrationsFlag() }): boolean {
  if (!competitionInBuild(env, { competitionPages: flags.competitionPages })) return false;
  return env.PS_STRICT !== '1' || flags.registrations === true;
}

function readEnv(): EnvLike {
  const meta = (import.meta as unknown as { env?: Record<string, string | undefined> }).env ?? {};
  const proc = typeof process !== 'undefined' ? process.env : {};
  return { ...meta, ...proc };
}
