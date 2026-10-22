import { describe, expect, it } from 'vitest';
import { CLICK_LIMIT_DEFAULTS, createClickLimiter } from '../../src/lib/infra/click-limit';

describe('click limiter: dedupe', () => {
  it('the same slug and user agent inside the window is refused, outside it allowed again', () => {
    const l = createClickLimiter({ dedupeMs: 5_000 });
    expect(l.allow('a', 'ua-1', 1_000)).toBe(true);
    expect(l.allow('a', 'ua-1', 1_001)).toBe(false);
    expect(l.allow('a', 'ua-1', 5_999)).toBe(false);
    expect(l.allow('a', 'ua-1', 6_000)).toBe(true);
  });

  it('a refused duplicate does not extend the window (a loop cannot keep itself blocked or alive)', () => {
    const l = createClickLimiter({ dedupeMs: 5_000 });
    expect(l.allow('a', 'u', 0)).toBe(true);
    for (let t = 100; t < 5_000; t += 100) expect(l.allow('a', 'u', t)).toBe(false);
    expect(l.allow('a', 'u', 5_000)).toBe(true);
  });

  it('another slug or another user agent is a different click', () => {
    const l = createClickLimiter();
    expect(l.allow('a', 'u', 0)).toBe(true);
    expect(l.allow('b', 'u', 1)).toBe(true);
    expect(l.allow('a', 'v', 2)).toBe(true);
  });

  it('a clock that goes backwards does not block counting forever', () => {
    const l = createClickLimiter({ dedupeMs: 5_000 });
    expect(l.allow('a', 'u', 10_000)).toBe(true);
    expect(l.allow('a', 'u', 1_000)).toBe(true);
  });
});

describe('click limiter: flood cap', () => {
  it('allows slugMax clicks per window per slug whatever the user agents are, then refuses until the window ends', () => {
    const l = createClickLimiter({ slugMax: 5, slugWindowMs: 60_000 });
    let allowed = 0;
    for (let i = 0; i < 100; i++) if (l.allow('a', `ua-${i}`, 1_000 + i)) allowed++;
    expect(allowed).toBe(5);
    expect(l.allow('a', 'fresh', 60_999)).toBe(false);
    expect(l.allow('a', 'fresh', 61_000)).toBe(true);
    expect(l.allow('b', 'fresh', 61_000)).toBe(true); // another slug has its own budget
  });

  it('refused duplicates do not use up the cap', () => {
    const l = createClickLimiter({ slugMax: 2, dedupeMs: 5_000 });
    expect(l.allow('a', 'u', 0)).toBe(true);
    for (let i = 0; i < 50; i++) expect(l.allow('a', 'u', 10 + i)).toBe(false);
    expect(l.allow('a', 'v', 100)).toBe(true); // the second and last slot was still free
    expect(l.allow('a', 'w', 101)).toBe(false);
  });

  it('the defaults are the documented ones', () => {
    expect(CLICK_LIMIT_DEFAULTS).toEqual({ dedupeMs: 5_000, slugWindowMs: 60_000, slugMax: 120, maxKeys: 2_000 });
    const l = createClickLimiter();
    let allowed = 0;
    for (let i = 0; i < 1_000; i++) if (l.allow('a', `ua-${i}`, i)) allowed++;
    expect(allowed).toBe(120);
  });
});

describe('click limiter: memory', () => {
  it('never remembers more than maxKeys pairs, however many user agents arrive', () => {
    const l = createClickLimiter({ maxKeys: 50, slugMax: 1_000_000, slugWindowMs: 1_000_000 });
    for (let i = 0; i < 5_000; i++) l.allow('a', `ua-${i}`, i);
    expect(l.size()).toBeLessThanOrEqual(50);
  });

  it('a very long user agent is cut, so one request cannot cost much memory', () => {
    const l = createClickLimiter();
    const long = 'x'.repeat(100_000);
    expect(l.allow('a', long, 0)).toBe(true);
    expect(l.allow('a', `${long}different tail`, 1)).toBe(false); // same first 256 characters: the same key
  });
});
