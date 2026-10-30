// Retry with exponential backoff and jitter, per-call timeouts and Retry-After handling. The clock, the sleep, the timeout timer and
// the random source are INJECTED (no Date.now / Math.random / setTimeout in the logic), so tests run instantly and deterministically.
import type { Random } from '../competition/types';
import { asProviderError, ProviderTimeoutError, RateLimitedError, SyncCancelledError, type ProviderErrorCode } from './errors';

export interface RetryPolicy {
  /** Total attempts per call, including the first. */
  maxAttempts: number;
  /** First backoff step; doubles every attempt. */
  baseDelayMs: number;
  /** Backoff cap. */
  maxDelayMs: number;
  /** Per-call timeout; the call's AbortSignal fires when it passes. */
  timeoutMs: number;
  /** A Retry-After longer than this stops the run ('rate_limited') instead of waiting (we never sit for hours or hammer the source). */
  maxRetryAfterMs: number;
}

/** Conservative defaults. A provider's licence may set stricter limits; the lead sets the policy per provider (TODO when one exists). */
export const DEFAULT_RETRY_POLICY: RetryPolicy = Object.freeze({
  maxAttempts: 4,
  baseDelayMs: 1_000,
  maxDelayMs: 30_000,
  timeoutMs: 20_000,
  maxRetryAfterMs: 5 * 60_000,
});

export interface Scheduler {
  /** Waits `ms`; should resolve early (not reject) when `signal` aborts. */
  sleep(ms: number, signal?: AbortSignal): Promise<void>;
  /** The timeout timer; defaults to `sleep`. Must resolve early (not reject) when `signal` aborts. */
  timer?(ms: number, signal: AbortSignal): Promise<void>;
  random: Random;
  /** Milliseconds since the epoch (for Retry-After dates and the sync history). */
  now(): number;
}

/** The real sleep for production wiring (the only place a timer is created). Resolves early on abort. */
export function realSleep(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise<void>((resolve) => {
    if (signal?.aborted) return resolve();
    const t = globalThis.setTimeout(() => {
      signal?.removeEventListener('abort', onAbort);
      resolve();
    }, Math.max(0, ms));
    const onAbort = () => {
      globalThis.clearTimeout(t);
      resolve();
    };
    signal?.addEventListener('abort', onAbort, { once: true });
  });
}

/** Exponential backoff with "equal jitter": half the step fixed, half random. Never 0, never above maxDelayMs. */
export function backoffDelay(attempt: number, policy: RetryPolicy, random: Random): number {
  const step = Math.min(policy.maxDelayMs, policy.baseDelayMs * 2 ** Math.max(0, attempt - 1));
  const r = Math.min(Math.max(random(), 0), 1);
  return Math.round(step / 2 + r * (step / 2));
}

export interface RetryEvent {
  attempt: number;
  delayMs: number;
  code: ProviderErrorCode;
  message: string;
}

/** Runs `fn` once with a timeout. The signal given to `fn` aborts on timeout or when `outer` aborts. */
export async function withTimeout<T>(fn: (signal: AbortSignal) => Promise<T>, timeoutMs: number, scheduler: Scheduler, outer?: AbortSignal): Promise<T> {
  if (outer?.aborted) throw new SyncCancelledError();
  const call = new AbortController();
  const timerCtl = new AbortController();
  const onOuter = () => call.abort();
  outer?.addEventListener('abort', onOuter, { once: true });
  const timerFn = scheduler.timer ?? scheduler.sleep;
  const timeoutError = () => new ProviderTimeoutError(`The provider did not answer within ${timeoutMs} ms`);
  let timedOut = false;
  const timeout = timerFn(timeoutMs, timerCtl.signal).then((): never => {
    if (timerCtl.signal.aborted) return undefined as never; // the call already settled; this branch loses the race
    timedOut = true;
    call.abort();
    throw timeoutError();
  });
  try {
    return await Promise.race([fn(call.signal), timeout]);
  } catch (err) {
    // The aborted call may reject before the timer's own rejection is seen: report it as the timeout it is.
    if (timedOut && !outer?.aborted) throw timeoutError();
    throw err;
  } finally {
    timerCtl.abort();
    outer?.removeEventListener('abort', onOuter);
  }
}

/**
 * Calls `fn` with retries. Retries transient errors and timeouts with backoff; on a rate limit waits exactly Retry-After when given
 * (backoff otherwise). Throws the last ProviderError when attempts run out, a non-retryable error at once, a RateLimitedError at once
 * when Retry-After exceeds `maxRetryAfterMs`, and SyncCancelledError when `outer` aborts.
 */
export async function callWithRetry<T>(
  fn: (signal: AbortSignal) => Promise<T>,
  policy: RetryPolicy,
  scheduler: Scheduler,
  outer?: AbortSignal,
  onRetry?: (e: RetryEvent) => void,
): Promise<T> {
  const attempts = Math.max(1, Math.floor(policy.maxAttempts));
  for (let attempt = 1; ; attempt++) {
    if (outer?.aborted) throw new SyncCancelledError();
    try {
      return await withTimeout(fn, policy.timeoutMs, scheduler, outer);
    } catch (err) {
      if (outer?.aborted) throw new SyncCancelledError();
      const pe = asProviderError(err);
      if (!pe.retryable || attempt >= attempts) throw pe;
      let delay = backoffDelay(attempt, policy, scheduler.random);
      if (pe instanceof RateLimitedError && pe.retryAfterMs !== null) {
        if (pe.retryAfterMs > policy.maxRetryAfterMs) {
          throw new RateLimitedError(`Rate limited for ${pe.retryAfterMs} ms, longer than the allowed ${policy.maxRetryAfterMs} ms; stopping`, pe.retryAfterMs);
        }
        delay = Math.max(pe.retryAfterMs, 0);
      }
      onRetry?.({ attempt, delayMs: delay, code: pe.code, message: pe.message });
      await scheduler.sleep(delay, outer);
    }
  }
}
