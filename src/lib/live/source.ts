// Chooses where /live reads its pin and past streams for a build (D-101). DEFAULT = src/content/live.ts (builds and tests never touch a
// network). The database is used only when PS_LIVE_SOURCE is exactly "supabase" AND the project URL and the PUBLISHABLE key are set; it is
// read through the two api views of migration 0013 (explicit columns, publishable key, `accept-profile: api`). A failed or malformed read
// FAILS the build (it never silently shows an old or an empty pin); anything else (a typo in the switch, a missing key) uses the file.
import { live as fileSettings } from '../../content/live';
import { liveProblems, type LiveSettings, type PastStream } from './rules';

export type EnvLike = Readonly<Record<string, string | undefined>>;

/** api.public_live_settings and api.public_live_past_streams (0013): names and explicit columns, kept in step with the SQL by a test. */
export const LIVE_VIEWS = {
  settings: { name: 'public_live_settings', columns: ['pinned_video_id'] },
  past: { name: 'public_live_past_streams', columns: ['video_id', 'title', 'streamed_on', 'position'] },
} as const;

export interface PublicLiveSettingsRow {
  pinned_video_id: string | null;
}
export interface PublicLivePastStreamRow {
  video_id: string;
  title: string;
  streamed_on: string | null;
  position: number;
}

export type LiveSourceId = 'file' | 'supabase';

export function liveSourceOf(env: EnvLike): { id: LiveSourceId; url: string; key: string } {
  const url = (env.PUBLIC_SUPABASE_URL ?? '').trim();
  const key = (env.PUBLIC_SUPABASE_PUBLISHABLE_KEY ?? '').trim();
  return env.PS_LIVE_SOURCE === 'supabase' && url && key ? { id: 'supabase', url, key } : { id: 'file', url: '', key: '' };
}

export async function loadLiveSettings(env: EnvLike = readEnv(), fetchImpl: typeof fetch = fetch): Promise<{ source: LiveSourceId; settings: LiveSettings }> {
  const src = liveSourceOf(env);
  if (src.id === 'file') return { source: 'file', settings: fileSettings };
  if (!/^https:\/\/[a-z0-9-]+\.supabase\.co\/?$/.test(src.url)) throw new Error('live: PUBLIC_SUPABASE_URL is not a Supabase project address');
  const get = async <T>(view: string, query: string): Promise<T[]> => {
    const res = await fetchImpl(`${src.url.replace(/\/+$/, '')}/rest/v1/${view}?${query}`, {
      method: 'GET',
      headers: { apikey: src.key, accept: 'application/json', 'accept-profile': 'api' },
    });
    // the status only: a response body can echo request details
    if (!res.ok) throw new Error(`live: reading api.${view} failed with HTTP ${res.status}`);
    const body: unknown = await res.json();
    if (!Array.isArray(body)) throw new Error(`live: api.${view} did not return a list`);
    return body as T[];
  };
  const [settingsRows, pastRows] = await Promise.all([
    get<PublicLiveSettingsRow>(LIVE_VIEWS.settings.name, `select=${LIVE_VIEWS.settings.columns.join(',')}&limit=1`),
    get<PublicLivePastStreamRow>(LIVE_VIEWS.past.name, `select=${LIVE_VIEWS.past.columns.join(',')}&order=position.asc&limit=100`),
  ]);
  const pinned = settingsRows[0]?.pinned_video_id ?? null;
  const pastStreams: PastStream[] = pastRows.map((r) => ({ videoId: String(r.video_id), title: String(r.title), date: r.streamed_on === null ? null : String(r.streamed_on) }));
  const settings: LiveSettings = { pinnedVideoId: pinned === null ? null : String(pinned), pastStreams };
  const problems = liveProblems(settings);
  if (problems.length > 0) throw new Error(`live: the database settings have problems:\n- ${problems.join('\n- ')}`);
  return { source: 'supabase', settings };
}

function readEnv(): EnvLike {
  const meta = (import.meta as unknown as { env?: Record<string, string | undefined> }).env ?? {};
  const proc = typeof process !== 'undefined' ? process.env : {};
  return { ...meta, ...proc };
}
