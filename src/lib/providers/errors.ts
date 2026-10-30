// Errors a provider adapter throws, so the sync runner can decide: retry, wait (rate limit), or stop.
// Messages never contain credential values (an adapter must not put a key, token or header into a message).

export type ProviderErrorCode = 'transient' | 'timeout' | 'rate_limited' | 'auth' | 'permanent' | 'cancelled';

export class ProviderError extends Error {
  readonly code: ProviderErrorCode;
  constructor(code: ProviderErrorCode, message: string) {
    super(message);
    this.name = 'ProviderError';
    this.code = code;
  }
  get retryable(): boolean {
    return this.code === 'transient' || this.code === 'timeout' || this.code === 'rate_limited';
  }
}

/** A network blip or a 5xx: retried with backoff. */
export class TransientProviderError extends ProviderError {
  constructor(message: string) {
    super('transient', message);
  }
}

/** The call took longer than the configured timeout (raised by the runner; adapters may raise it too). */
export class ProviderTimeoutError extends ProviderError {
  constructor(message: string) {
    super('timeout', message);
  }
}

/** HTTP 429 or the provider's equivalent. `retryAfterMs` comes from Retry-After (see parseRetryAfter); null = not given. */
export class RateLimitedError extends ProviderError {
  readonly retryAfterMs: number | null;
  constructor(message: string, retryAfterMs: number | null) {
    super('rate_limited', message);
    this.retryAfterMs = retryAfterMs;
  }
}

/** 401/403: credentials missing, wrong or revoked. Never retried; the run stops with 'credentials_rejected'. */
export class ProviderAuthError extends ProviderError {
  constructor(message: string) {
    super('auth', message);
  }
}

/** 4xx other than 401/403/429, or a malformed response: not retried. */
export class PermanentProviderError extends ProviderError {
  constructor(message: string) {
    super('permanent', message);
  }
}

export class SyncCancelledError extends ProviderError {
  constructor() {
    super('cancelled', 'The sync was cancelled');
  }
}

/** Anything that is not a ProviderError is treated as transient (an unknown failure is retried a bounded number of times). */
export function asProviderError(err: unknown): ProviderError {
  if (err instanceof ProviderError) return err;
  const msg = err instanceof Error ? err.message : 'Unknown provider failure';
  return new TransientProviderError(msg);
}

/**
 * Parses an HTTP Retry-After value: either delta-seconds (`120`) or an HTTP-date. `nowMs` is injected (no clock here).
 * Returns milliseconds to wait (0 for a date in the past), or null when the value is missing or unreadable.
 */
export function parseRetryAfter(value: string | null | undefined, nowMs: number): number | null {
  if (value === null || value === undefined) return null;
  const v = value.trim();
  if (v === '') return null;
  if (/^\d+$/.test(v)) return Number(v) * 1000;
  if (!/^[A-Za-z]{3},/.test(v)) return null; // "1.5", "-3", "10s": not delta-seconds; an HTTP-date starts with a day name ("Wed,")
  const at = Date.parse(v);
  if (Number.isNaN(at)) return null;
  return Math.max(0, at - nowMs);
}
