// Retry, backoff with jitter, timeouts and Retry-After (international data adapter layer). Clock, sleep and random are injected.
import { describe, expect, it } from 'vitest';
import { seededRandom } from '../../src/lib/competition/types';
import {
  PermanentProviderError,
  ProviderAuthError,
  ProviderTimeoutError,
  RateLimitedError,
  SyncCancelledError,
  TransientProviderError,
  asProviderError,
  parseRetryAfter,
} from '../../src/lib/providers/errors';
import { DEFAULT_RETRY_POLICY, backoffDelay, callWithRetry, realSleep, withTimeout, type RetryPolicy } from '../../src/lib/providers/retry';
import { fakeScheduler } from './fake-provider';

const policy: RetryPolicy = { maxAttempts: 4, baseDelayMs: 100, maxDelayMs: 1_000, timeoutMs: 5_000, maxRetryAfterMs: 60_000 };

describe('backoffDelay', () => {
  it('grows exponentially, stays within [step/2, step] and never passes the cap', () => {
    const rnd = seededRandom(1);
    for (let attempt = 1; attempt <= 10; attempt++) {
      const step = Math.min(policy.maxDelayMs, policy.baseDelayMs * 2 ** (attempt - 1));
      const d = backoffDelay(attempt, policy, rnd);
      expect(d).toBeGreaterThanOrEqual(step / 2);
      expect(d).toBeLessThanOrEqual(step);
    }
  });
  it('is deterministic for the same random source and uses the jitter', () => {
    expect(backoffDelay(3, policy, () => 0)).toBe(200);
    expect(backoffDelay(3, policy, () => 0.999999)).toBe(400);
    const a = [1, 2, 3].map((n) => backoffDelay(n, policy, seededRandom(9)));
    const b = [1, 2, 3].map((n) => backoffDelay(n, policy, seededRandom(9)));
    expect(a).toEqual(b);
  });
  it('clamps a misbehaving random source', () => {
    expect(backoffDelay(1, policy, () => 5)).toBe(100);
    expect(backoffDelay(1, policy, () => -1)).toBe(50);
  });
  it('has conservative defaults', () => {
    expect(DEFAULT_RETRY_POLICY.maxAttempts).toBeGreaterThan(1);
    expect(Object.isFrozen(DEFAULT_RETRY_POLICY)).toBe(true);
  });
});

describe('parseRetryAfter', () => {
  const now = Date.UTC(2026, 9, 30, 10, 0, 0);
  it('reads delta-seconds', () => {
    expect(parseRetryAfter('120', now)).toBe(120_000);
    expect(parseRetryAfter(' 0 ', now)).toBe(0);
  });
  it('reads an HTTP-date, and a past date waits 0', () => {
    expect(parseRetryAfter('Fri, 30 Oct 2026 10:00:30 GMT', now)).toBe(30_000);
    expect(parseRetryAfter('Fri, 30 Oct 2026 09:00:00 GMT', now)).toBe(0);
  });
  it('returns null for missing or unreadable values', () => {
    for (const v of [null, undefined, '', '1.5', '-3', '10s', 'soon', '2026-10-30']) expect(parseRetryAfter(v, now)).toBeNull();
  });
});

describe('asProviderError', () => {
  it('keeps provider errors and treats anything else as transient', () => {
    const auth = new ProviderAuthError('no');
    expect(asProviderError(auth)).toBe(auth);
    expect(asProviderError(new Error('boom')).code).toBe('transient');
    expect(asProviderError('x').code).toBe('transient');
    expect(new PermanentProviderError('x').retryable).toBe(false);
    expect(new RateLimitedError('x', null).retryable).toBe(true);
  });
});

describe('callWithRetry', () => {
  it('retries transient failures with backoff, then succeeds', async () => {
    const s = fakeScheduler();
    let n = 0;
    const retries: number[] = [];
    const out = await callWithRetry(
      async () => {
        n++;
        if (n < 3) throw new TransientProviderError('blip');
        return 'ok';
      },
      policy,
      s,
      undefined,
      (e) => retries.push(e.attempt),
    );
    expect(out).toBe('ok');
    expect(n).toBe(3);
    expect(retries).toEqual([1, 2]);
    expect(s.sleeps).toHaveLength(2);
    expect(s.sleeps[1]!).toBeGreaterThanOrEqual(100); // second step is 200 with jitter in [100, 200]
  });

  it('gives up after maxAttempts and throws the last error', async () => {
    const s = fakeScheduler();
    let n = 0;
    await expect(
      callWithRetry(
        async () => {
          n++;
          throw new TransientProviderError(`blip ${n}`);
        },
        policy,
        s,
      ),
    ).rejects.toThrow('blip 4');
    expect(n).toBe(4);
    expect(s.sleeps).toHaveLength(3);
  });

  it('never retries an auth or permanent error', async () => {
    for (const err of [new ProviderAuthError('bad key'), new PermanentProviderError('400')]) {
      const s = fakeScheduler();
      let n = 0;
      await expect(
        callWithRetry(
          async () => {
            n++;
            throw err;
          },
          policy,
          s,
        ),
      ).rejects.toBe(err);
      expect(n).toBe(1);
      expect(s.sleeps).toEqual([]);
    }
  });

  it('honours Retry-After exactly', async () => {
    const s = fakeScheduler();
    let n = 0;
    await callWithRetry(
      async () => {
        if (n++ === 0) throw new RateLimitedError('429', 7_000);
        return 1;
      },
      policy,
      s,
    );
    expect(s.sleeps).toEqual([7_000]);
  });

  it('uses backoff for a rate limit without Retry-After', async () => {
    const s = fakeScheduler();
    let n = 0;
    await callWithRetry(
      async () => {
        if (n++ === 0) throw new RateLimitedError('429', null);
        return 1;
      },
      policy,
      s,
    );
    expect(s.sleeps).toHaveLength(1);
    expect(s.sleeps[0]!).toBeGreaterThanOrEqual(50);
    expect(s.sleeps[0]!).toBeLessThanOrEqual(100);
  });

  it('stops at once when Retry-After is longer than allowed (does not wait for hours)', async () => {
    const s = fakeScheduler();
    let n = 0;
    const p = callWithRetry(
      async () => {
        n++;
        throw new RateLimitedError('429', 3_600_000);
      },
      policy,
      s,
    );
    await expect(p).rejects.toBeInstanceOf(RateLimitedError);
    expect(n).toBe(1);
    expect(s.sleeps).toEqual([]);
  });

  it('times out a hanging call, aborts its signal, and retries', async () => {
    const s = fakeScheduler({ timeoutsFire: true });
    const signals: AbortSignal[] = [];
    await expect(
      callWithRetry(
        (signal) => {
          signals.push(signal);
          return new Promise<never>((_, reject) => signal.addEventListener('abort', () => reject(new Error('aborted'))));
        },
        { ...policy, maxAttempts: 2 },
        s,
      ),
    ).rejects.toBeInstanceOf(ProviderTimeoutError);
    expect(signals).toHaveLength(2);
    expect(signals.every((sg) => sg.aborted)).toBe(true);
  });

  it('throws SyncCancelledError when the outer signal is aborted', async () => {
    const s = fakeScheduler();
    const ctl = new AbortController();
    ctl.abort();
    await expect(callWithRetry(async () => 1, policy, s, ctl.signal)).rejects.toBeInstanceOf(SyncCancelledError);
  });

  it('cancels during a call', async () => {
    const s = fakeScheduler();
    const ctl = new AbortController();
    const p = callWithRetry(
      (signal) =>
        new Promise<never>((_, reject) => {
          signal.addEventListener('abort', () => reject(new Error('aborted')));
          ctl.abort();
        }),
      policy,
      s,
      ctl.signal,
    );
    await expect(p).rejects.toBeInstanceOf(SyncCancelledError);
  });
});

describe('withTimeout and realSleep', () => {
  it('returns the value when the call wins and releases the timer', async () => {
    let timerSignal: AbortSignal | null = null;
    const v = await withTimeout(async () => 42, 1_000, {
      now: () => 0,
      random: () => 0,
      sleep: async () => {},
      timer: (_ms, signal) => {
        timerSignal = signal;
        return new Promise<void>((r) => signal.addEventListener('abort', () => r()));
      },
    });
    expect(v).toBe(42);
    expect((timerSignal as AbortSignal | null)?.aborted).toBe(true);
  });

  it('realSleep resolves early when aborted', async () => {
    const ctl = new AbortController();
    const p = realSleep(60_000, ctl.signal);
    ctl.abort();
    await expect(p).resolves.toBeUndefined();
    await expect(realSleep(0)).resolves.toBeUndefined();
    await expect(realSleep(10, ctl.signal)).resolves.toBeUndefined();
  });
});
