// Chooses the archive data source for a build. DEFAULT = the fictional seed (builds and tests never touch a network).
// The real source is used only when PS_ARCHIVE_SOURCE is exactly "supabase" AND the project URL and the PUBLISHABLE key are set;
// anything else (a typo, a missing key) falls back to the seed rather than guessing. The strict release build refuses seed data
// (the archive pages print a Todo while the source is the seed, see ArchiveSeedNotice.astro).
import { createSupabaseProvider } from './supabase-provider';
import { seedProvider } from './seed';
import type { ArchiveProvider } from './provider';

export type EnvLike = Readonly<Record<string, string | undefined>>;

export function selectArchiveProvider(env: EnvLike = readEnv(), fetchImpl: typeof fetch = fetch): ArchiveProvider {
  if (env.PS_ARCHIVE_SOURCE === 'supabase') {
    const url = (env.PUBLIC_SUPABASE_URL ?? '').trim();
    const key = (env.PUBLIC_SUPABASE_PUBLISHABLE_KEY ?? '').trim();
    if (url && key) return createSupabaseProvider({ url, publishableKey: key, fetch: fetchImpl });
  }
  return seedProvider;
}

function readEnv(): EnvLike {
  const meta = (import.meta as unknown as { env?: Record<string, string | undefined> }).env ?? {};
  const proc = typeof process !== 'undefined' ? process.env : {};
  return { ...meta, ...proc };
}
