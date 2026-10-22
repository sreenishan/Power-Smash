// YouTube sync runner (spec 10.3, D-008): one sync mode per run, for the GitHub sync workflow or the owner's PC.
//
//   npx esbuild scripts/sync-run.ts --bundle --platform=node --format=esm --outfile=tmp/sync-run.mjs
//   node tmp/sync-run.mjs <backfill|incremental|stats_recent|stats_all|purge|reparse>
//   node tmp/sync-run.mjs backfill --dry-run      rehearsal: real YouTube reads, in-memory stores, nothing written, counts only
//
// (The src modules import each other without file extensions, so Node cannot run this file directly: bundle it first.)
// Reads YOUTUBE_API_KEY, YOUTUBE_CHANNEL_ID, SUPABASE_URL (or PUBLIC_SUPABASE_URL), SUPABASE_SECRET_KEY and optionally
// TELEGRAM_BOT_TOKEN and TELEGRAM_CHAT_ID from the environment. A --dry-run needs only the first two. Claude never runs this with real
// values (D-027): the owner or the sync workflow does. It prints a run summary only: no key, URL, header, title or response body is
// ever printed.
import { createSupabaseRest } from '../src/lib/supabase/rest.ts';
import { createYouTubeClient } from '../src/lib/youtube/client.ts';
import { runSync } from '../src/lib/sync/pipeline.ts';
import { createSupabaseSyncStore } from '../src/lib/sync/supabase-store.ts';
import { createSupabaseIdentityStore } from '../src/lib/sync/supabase-identity.ts';
import { telegramNotifier } from '../src/lib/sync/alerts.ts';
import { parseSyncArgs, runDryRun } from '../src/lib/sync/dry-run.ts';

function need(name: string, alt?: string): string {
  const v = process.env[name] ?? (alt ? process.env[alt] : undefined);
  if (!v) {
    console.error(`Missing environment variable ${name}.`);
    process.exit(2);
  }
  return v;
}

const args = parseSyncArgs(process.argv.slice(2));
if (!args.ok) {
  console.error(args.message);
  process.exit(2);
}

const apiKey = need('YOUTUBE_API_KEY');
const channelId = need('YOUTUBE_CHANNEL_ID');
const makeClient = (ledger: Parameters<typeof createYouTubeClient>[0]['ledger']) =>
  createYouTubeClient({ apiKey, fetch, ledger, sleep: (ms) => new Promise((r) => setTimeout(r, ms)), random: Math.random });

if (args.dryRun) {
  const report = await runDryRun({ channelId, makeClient, now: () => new Date() });
  console.log(JSON.stringify(report, null, 2));
  process.exit(report.status === 'ok' ? 0 : 1);
}

const rest = createSupabaseRest({ url: need('SUPABASE_URL', 'PUBLIC_SUPABASE_URL'), secretKey: need('SUPABASE_SECRET_KEY'), fetch });

const summary = await runSync(args.mode, {
  store: createSupabaseSyncStore(rest),
  identity: createSupabaseIdentityStore(rest),
  channelId,
  makeClient,
  now: () => new Date(),
  notifier: telegramNotifier({ fetch, token: process.env.TELEGRAM_BOT_TOKEN ?? null, chatId: process.env.TELEGRAM_CHAT_ID ?? null }),
});
console.log(JSON.stringify(summary));
process.exit(summary.status === 'ok' ? 0 : 1);
