// FIX 2 (security review): `waitUntil` from @vercel/functions silently does nothing without a request context, so a handler must only
// hand work to it when a real one exists, and must await its own work otherwise (src/lib/after-response.ts).
import { readdirSync, readFileSync } from 'node:fs';
import { join, relative } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
vi.mock('@vercel/functions', () => ({ waitUntil: vi.fn() }));
import { waitUntil as vercelWaitUntil } from '@vercel/functions';
import { afterResponse, afterResponseIfAvailable, hasRequestContext } from '../../src/lib/after-response';
import { installRequestContext } from '../mocks/request-context';

const KEY = Symbol.for('@vercel/request-context');
const g = globalThis as Record<symbol, unknown>;

let remove: (() => void) | null = null;
afterEach(() => {
  remove?.();
  remove = null;
  delete g[KEY];
  vi.mocked(vercelWaitUntil).mockReset();
});

describe('hasRequestContext', () => {
  it('is false when nothing sets the context (local dev, tests)', () => {
    expect(hasRequestContext()).toBe(false);
  });

  it('is false for a context without a usable waitUntil', () => {
    g[KEY] = {};
    expect(hasRequestContext()).toBe(false);
    g[KEY] = { get: () => undefined };
    expect(hasRequestContext()).toBe(false);
    g[KEY] = { get: () => ({}) };
    expect(hasRequestContext()).toBe(false);
    g[KEY] = { get: () => ({ waitUntil: 'nope' }) };
    expect(hasRequestContext()).toBe(false);
  });

  it('is false (never throws) when reading the context throws', () => {
    g[KEY] = {
      get: () => {
        throw new Error('no store');
      },
    };
    expect(hasRequestContext()).toBe(false);
  });

  it('is true only when .get()?.waitUntil is a function', () => {
    remove = installRequestContext();
    expect(hasRequestContext()).toBe(true);
    remove();
    remove = null;
    expect(hasRequestContext()).toBe(false);
  });
});

describe('afterResponseIfAvailable', () => {
  it('returns undefined without a request context, so the handler awaits its own work', () => {
    expect(afterResponseIfAvailable()).toBeUndefined();
  });

  it('returns afterResponse when the runtime has a waitUntil', () => {
    remove = installRequestContext();
    expect(afterResponseIfAvailable()).toBe(afterResponse);
  });
});

describe('afterResponse', () => {
  it('hands a promise that never rejects to waitUntil', async () => {
    afterResponse(Promise.reject(new Error('alert failed')));
    const handed = vi.mocked(vercelWaitUntil).mock.calls[0]?.[0] as Promise<unknown>;
    await expect(handed).resolves.toBeUndefined();
  });

  it('does not throw when waitUntil throws', () => {
    vi.mocked(vercelWaitUntil).mockImplementation(() => {
      throw new Error('no context');
    });
    expect(() => afterResponse(Promise.resolve())).not.toThrow();
  });
});

describe('every route that takes work after the response asks first (source guard)', () => {
  const root = join(process.cwd(), 'src');
  const files: string[] = [];
  const walk = (dir: string): void => {
    for (const e of readdirSync(dir, { withFileTypes: true })) {
      const p = join(dir, e.name);
      if (e.isDirectory()) walk(p);
      else if (/\.(ts|tsx|astro)$/.test(e.name)) files.push(p);
    }
  };
  walk(root);
  const rel = (p: string) => relative(root, p).split('\\').join('/');

  it('no route passes the bare afterResponse as its waitUntil (it would be a silent no-op without a request context)', () => {
    const offenders = files.filter((f) => rel(f) !== 'lib/after-response.ts' && /\bafterResponse\b(?!IfAvailable)/.test(readFileSync(f, 'utf8')));
    expect(offenders.map(rel)).toEqual([]);
  });

  it('the lead, placements and /go routes use afterResponseIfAvailable', () => {
    for (const f of ['pages/api/lead.ts', 'pages/api/placements.ts', 'pages/go/[slug].ts']) {
      expect(readFileSync(join(root, f), 'utf8'), f).toMatch(/waitUntil:\s*afterResponseIfAvailable\(\)/);
    }
  });

  it('the event and beacon handlers take no waitUntil at all: they await everything before answering', () => {
    for (const f of ['pages/api/event.ts', 'pages/api/placement-beacon.ts', 'lib/leads/event-handler.ts', 'lib/placements/beacon.ts']) {
      expect(readFileSync(join(root, f), 'utf8'), f).not.toMatch(/waitUntil|afterResponse/);
    }
  });
});
