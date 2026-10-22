/**
 * Owner alerts for the sync (spec 10.4: alert on Telegram if anything fails; D-008 dead-man switch). Plain text, one line
 * each, small codes only: never a URL, key, header, response body or video title. `telegramNotifier` adapts the M1 sender.
 */
import { sendTelegram, TELEGRAM_TEXT_LIMIT } from '../notify/telegram';
import type { Notifier, SyncRunSummary } from './types';

const MODE_LABEL: Record<SyncRunSummary['mode'], string> = {
  backfill: 'Backfill',
  incremental: 'Sync',
  stats_recent: 'Daily statistics refresh',
  stats_all: 'Weekly statistics refresh',
  purge: 'Old-data clean-up',
  reparse: 'Title re-read',
};

export function buildSyncFailureText(s: SyncRunSummary): string {
  const head =
    s.status === 'quota_exhausted'
      ? `Power Smash: ${MODE_LABEL[s.mode]} stopped, the YouTube daily limit was reached. The site keeps showing saved data.`
      : `Power Smash: ${MODE_LABEL[s.mode]} ${s.status === 'partial' ? 'finished only partly' : 'failed'}. The site keeps showing saved data.`;
  const lines = [head, `Run: ${s.runId}`, `Reason code: ${s.errorCode ?? 'none'}`, `YouTube units used by this run: ${s.quotaUnits}`];
  if (s.resumable) lines.push('The next run continues where this one stopped.');
  lines.push(`Videos checked: ${s.counts.fetched}`);
  return Array.from(lines.join('\n')).slice(0, TELEGRAM_TEXT_LIMIT).join('');
}

export function buildDeadManText(lastSyncOkAt: string | null): string {
  return `Power Smash: no successful YouTube sync for 8 hours or more (last good sync: ${lastSyncOkAt ?? 'never'}). Open the admin and press Sync now, or check the sync run log.`;
}

export function telegramNotifier(o: { fetch: typeof fetch; token: string | null; chatId: string | null }): Notifier {
  return {
    async send(text) {
      try {
        await sendTelegram({ fetch: o.fetch, token: o.token, chatId: o.chatId, text });
      } catch {
        // an alert failure must never break the sync
      }
    },
  };
}
