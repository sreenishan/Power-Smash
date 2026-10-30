// The event page's near-live script (D-113): text only, polite summary, asks every minute only while something is live AND the page is
// visible, stays tiny. A small fake document stands in for the DOM (no DOM is installed in the test runner).
import { readFileSync } from 'node:fs';
import { gzipSync } from 'node:zlib';
import { build } from 'esbuild';
import { describe, expect, it } from 'vitest';
import { createPoller, matchesOf, render, summaryText, type DocLike, type El, type LiveParts } from '../../src/components/competition/live/client';

class FakeEl implements El {
  textContent: string | null = '';
  className = '';
  hidden = false;
  attrs: Record<string, string> = {};
  children: FakeEl[] = [];
  constructor(readonly tag: string) {}
  setAttribute(n: string, v: string) {
    this.attrs[n] = v;
  }
  appendChild<T>(c: T): T {
    this.children.push(c as unknown as FakeEl);
    return c;
  }
  replaceChildren(...nodes: unknown[]) {
    this.children = nodes as FakeEl[];
  }
  text(): string {
    return [this.textContent ?? '', ...this.children.map((c) => c.text())].join(' ').replace(/\s+/g, ' ').trim();
  }
  all(tag: string): FakeEl[] {
    return [...(this.tag === tag ? [this] : []), ...this.children.flatMap((c) => c.all(tag))];
  }
}
const doc: DocLike = { createElement: (t) => new FakeEl(t) };
const parts = (): LiveParts & { root: FakeEl; summary: FakeEl; checked: FakeEl; list: FakeEl } => ({
  root: Object.assign(new FakeEl('section'), { hidden: true }),
  summary: new FakeEl('p'),
  checked: new FakeEl('p'),
  list: new FakeEl('ul'),
});

const match = (over: Record<string, unknown> = {}) => ({
  id: 'aa000000-0000-4000-8000-000000000001',
  label: 'Final · Court 2',
  status: 'live',
  isLive: true,
  statusText: 'Live',
  sideA: 'Demo Arun',
  sideB: 'Protected player',
  games: [{ a: 21, b: 19 }],
  current: { a: 7, b: 5 },
  gameNumber: 2,
  gamesWon: { a: 1, b: 0 },
  server: 'A',
  lastUpdate: '2026-11-07T05:12:00Z',
  lastUpdateText: '10:42 am IST',
  ...over,
});

describe('reading the answer', () => {
  it('keeps only complete matches', () => {
    expect(matchesOf({ live: false })).toEqual([]);
    expect(matchesOf(null)).toEqual([]);
    expect(matchesOf({ matches: [match(), { id: 'x' }, match({ games: 'no' }), match({ current: { a: -1, b: 0 } })] })).toHaveLength(1);
  });
  it('a won match has no game in progress', () => {
    expect(matchesOf({ matches: [match({ games: [{ a: 21, b: 0 }, { a: 21, b: 0 }], gameNumber: 2, current: { a: 0, b: 0 } })] })[0]?.over).toBe(true);
    expect(matchesOf({ matches: [match()] })[0]?.over).toBe(false);
  });
  it('the summary says how many are live', () => {
    const m = matchesOf({ matches: [match(), match({ isLive: false })] });
    expect(summaryText(m)).toBe('Live now: 1 match. 1 match paused or waiting for the next point.');
    expect(summaryText(m.slice(0, 1))).toBe('Live now: 1 match.');
    expect(summaryText(m.slice(1))).toBe('1 match in progress, paused or waiting for the next point.');
  });
});

describe('drawing', () => {
  it('nothing live: the region stays hidden and empty', () => {
    const p = parts();
    expect(render(p, { live: false }, doc)).toBe(0);
    expect(p.root.hidden).toBe(true);
    expect(p.list.children).toHaveLength(0);
  });
  it('a live match: a card with a real table, the server marked in words, the status as words', () => {
    const p = parts();
    expect(render(p, { live: true, checkedAtText: '10:43 am IST', matches: [match()] }, doc)).toBe(1);
    expect(p.root.hidden).toBe(false);
    expect(p.summary.textContent).toBe('Live now: 1 match.');
    expect(p.checked.textContent).toContain('Checked at 10:43 am IST.');
    const t = p.list.text();
    expect(t).toContain('Demo Arun versus Protected player');
    expect(t).toContain('Demo Arun (serving)');
    expect(t).toContain('Game 2 (now)');
    expect(t).toContain('Last point at 10:42 am IST.');
    expect(t).toContain('Live');
    const ths = p.list.all('th');
    expect(ths.filter((h) => h.attrs.scope === 'row')).toHaveLength(2);
    expect(p.list.all('caption')).toHaveLength(1);
  });
  it('the polite summary changes only when its words change', () => {
    const p = parts();
    render(p, { matches: [match()] }, doc);
    const writes: string[] = [];
    let value = p.summary.textContent;
    Object.defineProperty(p.summary, 'textContent', { get: () => value, set: (v: string) => { writes.push(v); value = v; } });
    render(p, { matches: [match({ current: { a: 8, b: 5 } })] }, doc);
    expect(writes).toEqual([]);
    render(p, { matches: [match({ isLive: false, statusText: 'Paused' })] }, doc);
    expect(writes).toHaveLength(1);
  });
  it('names arrive as text, never as markup', () => {
    const p = parts();
    render(p, { matches: [match({ sideA: '<img src=x onerror=alert(1)>' })] }, doc);
    expect(p.list.all('img')).toHaveLength(0);
  });
});

describe('polling', () => {
  function rig(answers: unknown[], visible = { v: true }) {
    let now = 0;
    const timers: { fn: () => void; at: number }[] = [];
    let loads = 0;
    const poller = createPoller({
      load: async () => {
        loads += 1;
        const a = answers.shift();
        if (a instanceof Error) throw a;
        return a;
      },
      draw: (d) => matchesOf(d).length,
      visible: () => visible.v,
      now: () => now,
      setTimer: (fn, ms) => {
        const t = { fn, at: now + ms };
        timers.push(t);
        return t;
      },
      clearTimer: (h) => {
        const i = timers.indexOf(h as never);
        if (i >= 0) timers.splice(i, 1);
      },
      intervalMs: 60_000,
      idleMs: 300_000,
    });
    const flush = () => new Promise((r) => setTimeout(r, 0));
    const advance = async (ms: number) => {
      now += ms;
      for (const t of [...timers]) {
        if (t.at <= now) {
          timers.splice(timers.indexOf(t), 1);
          t.fn();
        }
      }
      await flush();
    };
    return { poller, flush, advance, loads: () => loads, timers, visible };
  }

  it('keeps asking every minute while a match is live, then slows to every five minutes when none is', async () => {
    const r = rig([{ matches: [match()] }, { matches: [match()] }, { live: false }, { matches: [match()] }]);
    r.poller.start();
    await r.flush();
    expect(r.loads()).toBe(1);
    expect(r.poller.planned()).toBe(true);
    await r.advance(59_999);
    expect(r.loads()).toBe(1);
    await r.advance(1);
    expect(r.loads()).toBe(2);
    await r.advance(60_000);
    expect(r.loads()).toBe(3);
    expect(r.poller.planned()).toBe(true);
    await r.advance(299_999);
    expect(r.loads()).toBe(3);
    await r.advance(1);
    expect(r.loads()).toBe(4);
  });
  it('nothing live at first: a page left open still picks up a match that starts later (a slow look every five minutes)', async () => {
    const r = rig([{ live: false }, { live: false }, { matches: [match()] }, { matches: [match()] }]);
    r.poller.start();
    await r.flush();
    expect(r.poller.planned()).toBe(true);
    await r.advance(300_000);
    expect(r.loads()).toBe(2);
    await r.advance(300_000);
    expect(r.loads()).toBe(3);
    // live now: back to every minute
    await r.advance(60_000);
    expect(r.loads()).toBe(4);
  });
  it('a hidden then shown tab keeps the slow pace while nothing is live', async () => {
    const r = rig([{ live: false }, { matches: [match()] }]);
    r.poller.start();
    await r.flush();
    r.visible.v = false;
    r.poller.visibilityChanged();
    expect(r.poller.planned()).toBe(false);
    r.visible.v = true;
    r.poller.visibilityChanged();
    expect(r.poller.planned()).toBe(true);
    await r.advance(300_000);
    expect(r.loads()).toBe(2);
    expect(r.poller.planned()).toBe(true);
  });
  it('a hidden tab asks nothing', async () => {
    const r = rig([{ matches: [match()] }, { matches: [match()] }]);
    r.visible.v = false;
    r.poller.start();
    await r.flush();
    expect(r.loads()).toBe(0);
    r.visible.v = true;
    r.poller.start();
    await r.flush();
    r.visible.v = false;
    r.poller.visibilityChanged();
    expect(r.poller.planned()).toBe(false);
    await r.advance(600_000);
    expect(r.loads()).toBe(1);
  });
  it('a failed look keeps the pace it had', async () => {
    const r = rig([{ matches: [match()] }, new Error('offline'), { matches: [match()] }]);
    r.poller.start();
    await r.flush();
    await r.advance(60_000);
    expect(r.loads()).toBe(2);
    expect(r.poller.planned()).toBe(true);
    await r.advance(60_000);
    expect(r.loads()).toBe(3);
  });
});

describe('size and safety of the shipped script', () => {
  it('bundles to well under 4 KB gzip (the page budget is 81,920 bytes)', async () => {
    const out = await build({
      stdin: { contents: "import { startLiveScores } from './client'; startLiveScores();", resolveDir: 'src/components/competition/live', loader: 'ts' },
      bundle: true,
      minify: true,
      format: 'esm',
      write: false,
      target: 'es2022',
      logLevel: 'silent',
    });
    const bytes = gzipSync(out.outputFiles[0]!.contents).length;
    expect(bytes).toBeLessThan(4096);
  });
  it('writes text only and calls nothing but its own endpoint', () => {
    const src = readFileSync('src/components/competition/live/client.ts', 'utf8');
    expect(src).not.toMatch(/innerHTML|outerHTML|insertAdjacentHTML|document\.write|eval\(|new Function/);
    expect(src).toContain("/^\\/api\\/live-scores\\/[0-9a-f-]{36}$/i");
    expect(src).toContain("credentials: 'omit'");
  });
});
