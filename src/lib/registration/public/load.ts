// Loads the registration pages ONCE per build (memoised). Empty when this build carries no registration pages
// (registrationInBuild: the strict release build while features.competitionPages or features.registrations is off), so no register
// folder is written at all. The competition site comes from the same memoised loader the competition pages use.
import { loadCompetitionSite } from '../../competition/public/load';
import type { EnvLike } from '../../competition/in-build';
import { registrationInBuild } from '../in-build';
import { buildRegistrationPages, type RegistrationPage } from './model';
import { selectRegistrationProvider, type RegistrationProvider } from './provider';

export interface RegistrationSite {
  source: RegistrationProvider['id'];
  pages: RegistrationPage[];
}

let cached: Promise<RegistrationSite> | null = null;

export function loadRegistrationSite(env: EnvLike = readEnv()): Promise<RegistrationSite> {
  if (!cached) {
    cached = (async () => {
      if (!registrationInBuild(env)) return { source: 'supabase', pages: [] } satisfies RegistrationSite;
      const provider = selectRegistrationProvider(env);
      const [site, raw] = await Promise.all([loadCompetitionSite(), provider.load()]);
      return { source: provider.id, pages: buildRegistrationPages(site, raw) };
    })();
  }
  return cached;
}

/** For tests: forget the memoised pages. */
export function resetRegistrationSiteCache(): void {
  cached = null;
}

function readEnv(): EnvLike {
  const meta = (import.meta as unknown as { env?: Record<string, string | undefined> }).env ?? {};
  const proc = typeof process !== 'undefined' ? process.env : {};
  return { ...meta, ...proc };
}
