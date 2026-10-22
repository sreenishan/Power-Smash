// Builds the dependencies of the pure cron handler (src/lib/sync/cron.ts) from the runtime environment (process.env on Vercel). No platform imports:
// tests drive it with plain objects and a mocked fetch. Every switch is off unless exactly "true" (CRON_ENABLED).
import { createSupabaseRest } from '../../src/lib/supabase/rest';
import { createSupabaseSyncStore } from '../../src/lib/sync/supabase-store';
import { telegramNotifier } from '../../src/lib/sync/alerts';
import { buildWorkflowDispatchRequest, handleScheduled } from '../../src/lib/sync/cron';
import type { CronDeps, CronOutcome } from '../../src/lib/sync/cron';

export interface CronEnv {
  CRON_ENABLED?: string;
  SUPABASE_URL?: string;
  PUBLIC_SUPABASE_URL?: string;
  SUPABASE_SECRET_KEY?: string;
  REBUILD_DISPATCH_TOKEN?: string;
  ADMIN_GITHUB_REPO?: string;
  ADMIN_DEPLOY_WORKFLOW?: string;
  ADMIN_SYNC_WORKFLOW?: string;
  ADMIN_DISPATCH_REF?: string;
  YOUTUBE_CHANNEL_ID?: string;
  TELEGRAM_BOT_TOKEN?: string;
  TELEGRAM_CHAT_ID?: string;
}

const NAMES: readonly (keyof CronEnv)[] = [
  'CRON_ENABLED', 'SUPABASE_URL', 'PUBLIC_SUPABASE_URL', 'SUPABASE_SECRET_KEY', 'REBUILD_DISPATCH_TOKEN', 'ADMIN_GITHUB_REPO',
  'ADMIN_DEPLOY_WORKFLOW', 'ADMIN_SYNC_WORKFLOW', 'ADMIN_DISPATCH_REF', 'YOUTUBE_CHANNEL_ID', 'TELEGRAM_BOT_TOKEN', 'TELEGRAM_CHAT_ID',
];

export function pickCronEnv(source: Record<string, unknown>): CronEnv {
  const out: Record<string, string> = {};
  for (const n of NAMES) {
    const v = source[n];
    if (typeof v === 'string' && v.trim() !== '') out[n] = v.trim();
  }
  return out as CronEnv;
}

/** Null when the cron is off or not fully configured (the cron then does nothing, never guesses). */
export function buildCronDeps(env: CronEnv, io: { fetch: typeof fetch; now: Date }): CronDeps | null {
  if (env.CRON_ENABLED !== 'true') return null;
  const url = env.SUPABASE_URL ?? env.PUBLIC_SUPABASE_URL;
  if (!url || !env.SUPABASE_SECRET_KEY || !env.REBUILD_DISPATCH_TOKEN || !env.ADMIN_GITHUB_REPO) return null;
  const [owner, repo, ...extra] = env.ADMIN_GITHUB_REPO.split('/');
  if (!owner || !repo || extra.length > 0) return null;
  let rest;
  try {
    rest = createSupabaseRest({ url, secretKey: env.SUPABASE_SECRET_KEY, fetch: io.fetch });
  } catch {
    return null;
  }
  const store = createSupabaseSyncStore(rest);
  const token = env.REBUILD_DISPATCH_TOKEN;
  const ref = env.ADMIN_DISPATCH_REF ?? 'main';
  const channelId = env.YOUTUBE_CHANNEL_ID;
  return {
    now: io.now,
    loadState: () => store.loadState(),
    dispatch: async (reason) => {
      // A new video needs a sync first (when a sync workflow is configured); a dirty site only needs a deploy.
      const workflowFile = reason === 'new_video' && env.ADMIN_SYNC_WORKFLOW ? env.ADMIN_SYNC_WORKFLOW : (env.ADMIN_DEPLOY_WORKFLOW ?? 'deploy.yml');
      const inputs: Record<string, string> = workflowFile === env.ADMIN_SYNC_WORKFLOW ? { mode: 'incremental' } : {};
      const req = buildWorkflowDispatchRequest({ owner, repo, workflowFile, ref, token, inputs });
      try {
        const res = await io.fetch(req.url, req.init);
        return res.status === 204;
      } catch {
        return false;
      }
    },
    fetchRss: async () => {
      if (!channelId || !/^UC[A-Za-z0-9_-]{22}$/.test(channelId)) return null;
      try {
        const res = await io.fetch(`https://www.youtube.com/feeds/videos.xml?channel_id=${channelId}`);
        return res.ok ? await res.text() : null;
      } catch {
        return null;
      }
    },
    notifier: telegramNotifier({ fetch: io.fetch, token: env.TELEGRAM_BOT_TOKEN ?? null, chatId: env.TELEGRAM_CHAT_ID ?? null }),
  };
}

/** Never throws: a failed cron run must not be retried into a loop. */
export async function runScheduled(env: CronEnv, io: { fetch: typeof fetch; now: Date }): Promise<CronOutcome | null> {
  const deps = buildCronDeps(env, io);
  if (!deps) return null;
  try {
    return await handleScheduled(deps);
  } catch {
    return null;
  }
}
