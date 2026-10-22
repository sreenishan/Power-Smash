/**
 * Read-only sync rehearsal (CONNECT_DAY part G.3, BUILD_PLAN DoD 1). Runs the real backfill against the REAL YouTube client but into
 * in-memory stores, so nothing is written anywhere: no database, no Telegram, no file. The owner runs it first to see how many of the
 * channel's videos the parser accepts before any row reaches Supabase.
 *
 * The report holds COUNTS only. It never carries a title, a video id, a player name or a URL: real titles stay out of terminal logs,
 * screenshots and chat (CLAUDE.md privacy rules). Imported only by scripts/sync-run.ts and tests (tests/legal/reality.test.ts).
 */
import { isProtectedPlayer } from '../archive/types';
import { MemoryArchiveStore } from './memory-archive';
import { MemorySyncStore } from './memory-store';
import { runSync, type SyncDeps } from './pipeline';
import type { SyncCounts, SyncMode, SyncRunSummary, SyncStatus } from './types';

export type DryRunDeps = Pick<SyncDeps, 'channelId' | 'makeClient' | 'now' | 'signals' | 'quotaLimit' | 'maxIncrementalPages' | 'newId'>;

export interface DryRunReport {
  dryRun: true;
  status: SyncStatus;
  errorCode: string | null;
  quotaDay: string;
  quotaUnits: number;
  counts: SyncCounts;
  videos: {
    total: number;
    byType: Record<string, number>;
    byParseStatus: Record<string, number>;
    reviewReasons: Record<string, number>;
    hardFlags: Record<string, number>;
  };
  /** Of the videos typed `match`, the share the parser accepted without review (percent, one decimal); null when there are none. */
  matchParseRatePercent: number | null;
  entities: { players: number; protectedPlayers: number; tournaments: number; matches: number };
}

const tally = (items: Iterable<string>): Record<string, number> => {
  const out: Record<string, number> = {};
  for (const k of items) out[k] = (out[k] ?? 0) + 1;
  return Object.fromEntries(Object.entries(out).sort(([a], [b]) => a.localeCompare(b)));
};

export async function runDryRun(deps: DryRunDeps): Promise<DryRunReport> {
  const store = new MemorySyncStore();
  const archive = new MemoryArchiveStore((id, patch) => {
    const v = store.videos.get(id);
    if (v) Object.assign(v, patch);
  });
  let n = 0;
  // No notifier on purpose: a rehearsal must never message anyone.
  const summary: SyncRunSummary = await runSync('backfill', {
    newId: () => `00000000-0000-4000-8000-${String(++n).padStart(12, '0')}`,
    ...deps,
    store,
    identity: archive,
  });

  const videos = [...store.videos.values()];
  const matches = videos.filter((v) => v.type === 'match');
  const accepted = matches.filter((v) => v.parse_status === 'parsed').length;
  return {
    dryRun: true,
    status: summary.status,
    errorCode: summary.errorCode,
    quotaDay: summary.quotaDay,
    quotaUnits: summary.quotaUnits,
    counts: summary.counts,
    videos: {
      total: videos.length,
      byType: tally(videos.map((v) => v.type)),
      byParseStatus: tally(videos.map((v) => v.parse_status)),
      reviewReasons: tally(videos.flatMap((v) => v.review_reasons)),
      hardFlags: tally(videos.flatMap((v) => v.hard_flags)),
    },
    matchParseRatePercent: matches.length === 0 ? null : Math.round((accepted / matches.length) * 1000) / 10,
    entities: {
      players: archive.players.size,
      protectedPlayers: [...archive.players.values()].filter((p) => isProtectedPlayer(p.age_status)).length,
      tournaments: archive.tournaments.size,
      matches: archive.matches.size,
    },
  };
}

const MODES: readonly SyncMode[] = ['backfill', 'incremental', 'stats_recent', 'stats_all', 'purge', 'reparse'];

export type SyncArgs = { ok: true; mode: SyncMode; dryRun: boolean } | { ok: false; message: string };

/** `sync-run <mode> [--dry-run]`. A dry run is only meaningful for `backfill` (the other modes work on rows that already exist). */
export function parseSyncArgs(argv: readonly string[]): SyncArgs {
  const flags = argv.filter((a) => a.startsWith('--'));
  const unknown = flags.filter((f) => f !== '--dry-run');
  if (unknown.length > 0) return { ok: false, message: `Unknown option ${unknown[0]}. Usage: sync-run <${MODES.join('|')}> [--dry-run]` };
  const words = argv.filter((a) => !a.startsWith('--'));
  const mode = words[0] as SyncMode | undefined;
  if (words.length !== 1 || !mode || !MODES.includes(mode)) return { ok: false, message: `Usage: sync-run <${MODES.join('|')}> [--dry-run]` };
  const dryRun = flags.includes('--dry-run');
  if (dryRun && mode !== 'backfill') return { ok: false, message: '--dry-run only works with backfill (the other modes need rows that already exist).' };
  return { ok: true, mode, dryRun };
}
