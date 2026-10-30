// Chooses the international data source and builds the /international/ page model ONCE per build (memoised, like
// loadCompetitionSite).
//  - Source: the real view only when PS_INTERNATIONAL_SOURCE is exactly "supabase" AND the project URL and the PUBLISHABLE key are set;
//    anything else (a typo, a missing key) falls back to the FICTIONAL seed rather than guessing.
//  - Gate: when internationalInBuild() says this build carries no international page (the strict release build while
//    features.internationalLinks is off), nothing is read and the page is empty; the route makes no page then (internationalPaths).
//  - The strict build refuses the seed: InternationalSampleNotice prints a Todo on a page built from it, so the release gate fails.
import { todayIst } from '../../dates';
import { internationalInBuild, type EnvLike } from '../in-build';
import { buildInternationalPage, emptyInternationalPage, type InternationalPage } from './model';
import type { InternationalProvider } from './provider';
import { internationalSeedProvider } from './seed';
import { createInternationalSupabaseProvider } from './supabase-provider';

export function selectInternationalProvider(env: EnvLike = readEnv(), fetchImpl: typeof fetch = fetch): InternationalProvider {
  if (env.PS_INTERNATIONAL_SOURCE === 'supabase') {
    const url = (env.PUBLIC_SUPABASE_URL ?? '').trim();
    const key = (env.PUBLIC_SUPABASE_PUBLISHABLE_KEY ?? '').trim();
    if (url && key) return createInternationalSupabaseProvider({ url, publishableKey: key, fetch: fetchImpl });
  }
  return internationalSeedProvider;
}

let cached: Promise<InternationalPage> | null = null;

export function loadInternationalPage(now: () => Date = () => new Date()): Promise<InternationalPage> {
  if (!cached) {
    cached = (async () => {
      if (!internationalInBuild()) return emptyInternationalPage();
      const provider = selectInternationalProvider();
      const page = buildInternationalPage(await provider.load(), { source: provider.id, today: todayIst(now()) });
      if (page.dropped > 0 && provider.id !== 'seed') console.warn(`international: left out ${page.dropped} event(s) with a bad date, text or link.`);
      return page;
    })();
  }
  return cached;
}

/** For tests: forget the memoised page. */
export function resetInternationalPageCache(): void {
  cached = null;
}

function readEnv(): EnvLike {
  const meta = (import.meta as unknown as { env?: Record<string, string | undefined> }).env ?? {};
  const proc = typeof process !== 'undefined' ? process.env : {};
  return { ...meta, ...proc };
}
