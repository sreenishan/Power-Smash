// The dispatcher: works through due outbox records with an INJECTED clock, a maximum number of attempts and exponential backoff,
// and marks each record sent, failed, skipped or queued again (for a retry).
//
// It sends nothing by itself: it runs only when something calls it, and even then only with `enabled: true` (no default
// switch-on; wiring it to a schedule needs the owner's yes). A record becomes `sent` ONLY when its channel adapter returned
// exactly `{ status: 'sent' }`; `not_configured` becomes `skipped` (channel_not_configured), never `sent` and never retried.
// Expired records (a reminder after the match started) are skipped, never sent late.
// Crash safety: a record is claimed (status `sending`, attempts + 1, a lease) by compare-and-set before the adapter is called,
// so two dispatchers never send the same record; a crash leaves a lease that expires, and the retry reuses the same idempotency
// key, which the email vendor uses to drop a duplicate.
// Delivery is AT LEAST ONCE: if the adapter delivered but the final compare-and-set fails, or the process crashes after
// delivery, the record stays `sending`; after its lease runs out it is claimed again and handed to the adapter again with the
// SAME `message.key`. In-app dedupes on the key (the inbox), email relies on the vendor idempotency key (Resend: a 24-hour
// window, see adapters.ts), and every push or WhatsApp MessageTransport MUST dedupe on `message.key` itself (the contract in
// adapters.ts), or those channels could send twice.
// Consent (fail closed): `recheck` is REQUIRED. A caller that does not pass a function gets every due record skipped with
// `consent_changed` and nothing sent, because consent withdrawn during a long backoff must never be sent through.
import { notConfiguredAdapter } from './adapters';
import type { OutboxStore } from './store';
import type { AdapterResult, Channel, ChannelAdapter, OutboxRecord, SkipReason } from './types';

export interface DispatchOptions {
  /** Must be exactly true, or the dispatcher returns at once without reading or changing anything. */
  enabled: boolean;
  now: () => Date;
  /** Total tries per record, including the first. Default 5. */
  maxAttempts?: number;
  /** Wait after the first failure; doubles each time. Default 60 seconds. */
  baseBackoffMs?: number;
  /** Longest wait between tries. Default 6 hours. */
  maxBackoffMs?: number;
  /** How long a claim holds a record. Default 5 minutes. */
  leaseMs?: number;
  /** Most records per run. Default 50. */
  batchSize?: number;
  /**
   * REQUIRED. Re-checks consent just before sending (it may have been withdrawn since the record was built, and a retry can
   * wait hours). Null = still allowed; a reason = skip. A missing recheck, or one that throws, = skip with consent_changed
   * (fail closed).
   */
  recheck: (record: OutboxRecord, now: Date) => Promise<SkipReason | null>;
}

export interface DispatchSummary {
  enabled: boolean;
  considered: number;
  sent: number;
  failed: number;
  skipped: number;
  retrying: number;
  /** Records another dispatcher changed first (left alone). */
  raced: number;
}

export const DEFAULTS = { maxAttempts: 5, baseBackoffMs: 60_000, maxBackoffMs: 6 * 3_600_000, leaseMs: 5 * 60_000, batchSize: 50 } as const;

/** Wait before the next try after `attempts` failed tries: base * 2^(attempts-1), capped. Deterministic (no jitter). */
export function backoffMs(attempts: number, base: number = DEFAULTS.baseBackoffMs, max: number = DEFAULTS.maxBackoffMs): number {
  const n = Math.max(1, Math.floor(attempts));
  return Math.min(max, base * 2 ** Math.min(n - 1, 30));
}

const iso = (d: Date): string => d.toISOString();

function isAdapterResult(r: unknown): r is AdapterResult {
  if (!r || typeof r !== 'object') return false;
  const s = (r as { status?: unknown }).status;
  return s === 'sent' || s === 'not_configured' || s === 'skipped' || s === 'failed';
}

export async function dispatchOutbox(store: OutboxStore, adapters: Partial<Record<Channel, ChannelAdapter>>, options: DispatchOptions): Promise<DispatchSummary> {
  const summary: DispatchSummary = { enabled: options.enabled === true, considered: 0, sent: 0, failed: 0, skipped: 0, retrying: 0, raced: 0 };
  if (options.enabled !== true) return summary;

  const maxAttempts = Math.max(1, Math.floor(options.maxAttempts ?? DEFAULTS.maxAttempts));
  const base = options.baseBackoffMs ?? DEFAULTS.baseBackoffMs;
  const maxBackoff = options.maxBackoffMs ?? DEFAULTS.maxBackoffMs;
  const leaseMs = options.leaseMs ?? DEFAULTS.leaseMs;
  const batch = options.batchSize ?? DEFAULTS.batchSize;

  const due = await store.listDue(iso(options.now()), batch);
  for (const record of due) {
    summary.considered += 1;
    const now = options.now();
    const expect = { status: record.status, attempts: record.attempts };

    const finish = async (next: OutboxRecord, from: { status: OutboxRecord['status']; attempts: number }): Promise<boolean> => {
      const ok = await store.compareAndSet(record.key, from, next);
      if (!ok) summary.raced += 1;
      return ok;
    };
    const skip = async (reason: SkipReason, from = expect, base_: OutboxRecord = record): Promise<void> => {
      if (await finish({ ...base_, status: 'skipped', skipReason: reason, leaseUntil: null }, from)) summary.skipped += 1;
    };

    // 1. Too late: never send a stale message.
    if (record.expiresAt !== null && Date.parse(record.expiresAt) <= now.getTime()) {
      await skip('expired');
      continue;
    }
    // 2. A crashed attempt that already used the last try.
    if (record.status === 'sending' && record.attempts >= maxAttempts) {
      if (await finish({ ...record, status: 'failed', leaseUntil: null, lastError: 'lease_expired' }, expect)) summary.failed += 1;
      continue;
    }
    // 3. Consent may have changed since the record was built.
    {
      // Read through `unknown`: a JavaScript caller (or a cast) can still leave it out, and that must not send.
      const recheck: unknown = (options as { recheck?: unknown }).recheck;
      let reason: SkipReason | null;
      if (typeof recheck !== 'function') {
        reason = 'consent_changed'; // no way to prove consent: do not send (fail closed)
      } else {
        try {
          reason = await (recheck as DispatchOptions['recheck'])(record, now);
        } catch {
          reason = 'consent_changed'; // cannot prove consent: do not send (fail closed)
        }
      }
      if (reason) {
        await skip(reason);
        continue;
      }
    }
    // 4. Claim.
    const claimed: OutboxRecord = { ...record, status: 'sending', attempts: record.attempts + 1, leaseUntil: iso(new Date(now.getTime() + leaseMs)) };
    if (!(await finish(claimed, expect))) continue;
    const held = { status: 'sending' as const, attempts: claimed.attempts };

    // 5. Send through the adapter for this channel (a missing or mismatched adapter = not configured).
    const candidate = adapters[record.channel];
    const adapter = candidate && candidate.channel === record.channel ? candidate : notConfiguredAdapter(record.channel);
    let result: AdapterResult;
    try {
      const raw: unknown = await adapter.send({ key: record.key, kind: record.kind, recipientId: record.recipientId, channel: record.channel, subject: record.subject, body: record.body, createdAt: record.createdAt });
      result = isAdapterResult(raw) ? raw : { status: 'failed', retryable: false, code: 'bad_adapter_result' };
    } catch {
      result = { status: 'failed', retryable: true, code: 'adapter_threw' };
    }
    const after = options.now();

    // 6. Record the outcome.
    if (result.status === 'sent') {
      if (await finish({ ...claimed, status: 'sent', sentAt: iso(after), leaseUntil: null, lastError: null, skipReason: null }, held)) summary.sent += 1;
    } else if (result.status === 'not_configured') {
      await skip('channel_not_configured', held, claimed);
    } else if (result.status === 'skipped') {
      await skip(result.reason === 'no_address' ? 'no_address' : 'channel_not_configured', held, claimed);
    } else {
      const code = typeof result.code === 'string' ? result.code.replace(/[^a-z_]/gi, '').slice(0, 40) || 'failed' : 'failed';
      if (result.retryable === true && claimed.attempts < maxAttempts) {
        const notBefore = iso(new Date(after.getTime() + backoffMs(claimed.attempts, base, maxBackoff)));
        if (await finish({ ...claimed, status: 'queued', notBefore, leaseUntil: null, lastError: code }, held)) summary.retrying += 1;
      } else if (await finish({ ...claimed, status: 'failed', leaseUntil: null, lastError: code }, held)) {
        summary.failed += 1;
      }
    }
  }
  return summary;
}
