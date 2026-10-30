// The event page's near-live script (D-113). Progressive enhancement: without it the page is the static snapshot and never says "Live".
//   - Asks /api/live-scores/<event-id> once when the page is visible; keeps asking about every minute ONLY while the answer lists a
//     live or paused match AND the page is visible (a hidden tab asks nothing). With nothing live it stops, and checks again when the
//     tab becomes visible, at most once a minute.
//   - Writes text only (textContent, createElement): no HTML from the network ever reaches the page. Every word comes ready from the
//     server (names already masked: "Protected player").
//   - The one-line summary is aria-live="polite"; the score tables update quietly (a screen reader is not interrupted every minute).
// No framework, no dependency but the shared constants: it must stay tiny (JS budget 81,920 bytes gzip per page, check:js-budget).
import { LIVE_IDLE_POLL_MS, LIVE_POLL_MS } from '../../../lib/live-scores/rules';

// ------------------------------------------------------------------ the answer, checked loosely (the server already checked it)

export interface ClientGame {
  a: number;
  b: number;
}
export interface ClientMatch {
  id: string;
  label: string;
  isLive: boolean;
  statusText: string;
  sideA: string;
  sideB: string;
  games: ClientGame[];
  current: ClientGame;
  gameNumber: number;
  gamesWon: ClientGame;
  server: 'A' | 'B' | null;
  lastUpdateText: string;
  over: boolean;
}

const str = (v: unknown): v is string => typeof v === 'string';
const num = (v: unknown): v is number => typeof v === 'number' && Number.isInteger(v) && v >= 0 && v <= 99;
const pair = (v: unknown): v is ClientGame => typeof v === 'object' && v !== null && num((v as ClientGame).a) && num((v as ClientGame).b);

/** The matches of an answer that have every field; anything else is ignored. */
export function matchesOf(data: unknown): ClientMatch[] {
  const list = (data as { matches?: unknown } | null)?.matches;
  if (!Array.isArray(list)) return [];
  const out: ClientMatch[] = [];
  for (const m of list.slice(0, 50)) {
    const x = m as Record<string, unknown>;
    if (!str(x.id) || !str(x.label) || typeof x.isLive !== 'boolean' || !str(x.statusText) || !str(x.sideA) || !str(x.sideB)) continue;
    if (!Array.isArray(x.games) || !x.games.every(pair) || !pair(x.current) || !num(x.gameNumber) || !pair(x.gamesWon)) continue;
    const games = (x.games as ClientGame[]).slice(0, 5);
    out.push({
      id: x.id,
      label: x.label,
      isLive: x.isLive,
      statusText: x.statusText,
      sideA: x.sideA,
      sideB: x.sideB,
      games,
      current: x.current as ClientGame,
      gameNumber: x.gameNumber as number,
      gamesWon: x.gamesWon as ClientGame,
      server: x.server === 'A' || x.server === 'B' ? x.server : null,
      lastUpdateText: str(x.lastUpdateText) ? x.lastUpdateText : '',
      // the game in progress is shown only while one is being played (after the last rally of a won match there is none)
      over: (x.gameNumber as number) <= games.length,
    });
  }
  return out;
}

/** The polite one-line summary. */
export function summaryText(matches: readonly ClientMatch[]): string {
  const live = matches.filter((m) => m.isLive).length;
  const rest = matches.length - live;
  const n = (k: number) => `${k} match${k === 1 ? '' : 'es'}`;
  if (live > 0 && rest > 0) return `Live now: ${n(live)}. ${n(rest)} paused or waiting for the next point.`;
  if (live > 0) return `Live now: ${n(live)}.`;
  return `${n(rest)} in progress, paused or waiting for the next point.`;
}

// ------------------------------------------------------------------ drawing (text only)

/** The few DOM features used, so tests can pass a small fake document. */
export interface El {
  textContent: string | null;
  className: string;
  hidden: boolean;
  setAttribute(name: string, value: string): void;
  appendChild<T>(child: T): T;
  replaceChildren(...nodes: unknown[]): void;
}
export interface DocLike {
  createElement(tag: string): El;
}

function el(doc: DocLike, tag: string, cls = '', text?: string): El {
  const e = doc.createElement(tag);
  if (cls) e.className = cls;
  if (text !== undefined) e.textContent = text;
  return e;
}

/** One match card, in the same shape as MatchScoreboard.astro (a real table, side A first, the status always as words). */
export function card(doc: DocLike, m: ClientMatch): El {
  const article = el(doc, 'article', 'ps-card p-4 sm:p-5');
  article.setAttribute('data-live-match', m.id);
  article.setAttribute('data-live', m.isLive ? 'true' : 'false');
  const top = article.appendChild(el(doc, 'div', 'flex flex-wrap items-center justify-between gap-2'));
  top.appendChild(el(doc, 'p', 'text-small font-bold uppercase tracking-wider text-fg-muted', m.label));
  top.appendChild(el(doc, 'span', `ps-chip ${m.isLive ? 'ps-chip-live' : 'ps-chip-ink'}`, m.statusText));
  const h = article.appendChild(el(doc, 'h3', 'mt-2 text-h4'));
  h.textContent = `${m.sideA} versus ${m.sideB}`;

  const wrap = article.appendChild(el(doc, 'div', 'mt-3 overflow-x-auto'));
  const table = wrap.appendChild(el(doc, 'table', 'ps-scoretable ps-num'));
  table.appendChild(el(doc, 'caption', 'sr-only', `Score: ${m.sideA} versus ${m.sideB}`));
  const headRow = table.appendChild(el(doc, 'thead')).appendChild(el(doc, 'tr'));
  const th = (row: El, text: string, scope: 'col' | 'row') => {
    const c = row.appendChild(el(doc, 'th', '', text));
    c.setAttribute('scope', scope);
    return c;
  };
  th(headRow, 'Side', 'col');
  m.games.forEach((_, i) => th(headRow, `Game ${i + 1}`, 'col'));
  if (!m.over) th(headRow, `Game ${m.gameNumber} (now)`, 'col');
  th(headRow, 'Games won', 'col');
  const body = table.appendChild(el(doc, 'tbody'));
  for (const s of ['A', 'B'] as const) {
    const row = body.appendChild(el(doc, 'tr'));
    const name = s === 'A' ? m.sideA : m.sideB;
    th(row, m.server === s ? `${name} (serving)` : name, 'row');
    const k = s === 'A' ? 'a' : 'b';
    for (const g of m.games) row.appendChild(el(doc, 'td', '', String(g[k])));
    if (!m.over) row.appendChild(el(doc, 'td', 'font-extrabold', String(m.current[k])));
    row.appendChild(el(doc, 'td', '', String(m.gamesWon[k])));
  }
  if (m.lastUpdateText) article.appendChild(el(doc, 'p', 'mt-2 text-caption text-fg-muted', `Last point at ${m.lastUpdateText}.`));
  return article;
}

export interface LiveParts {
  root: El;
  summary: El;
  checked: El;
  list: El;
}

/** Draws an answer; returns how many matches are shown (0 hides the whole region). */
export function render(parts: LiveParts, data: unknown, doc: DocLike): number {
  const matches = matchesOf(data);
  if (matches.length === 0) {
    parts.root.hidden = true;
    parts.list.replaceChildren();
    if (parts.summary.textContent !== '') parts.summary.textContent = '';
    return 0;
  }
  parts.root.hidden = false;
  const text = summaryText(matches);
  // only a real change is announced
  if (parts.summary.textContent !== text) parts.summary.textContent = text;
  const at = (data as { checkedAtText?: unknown }).checkedAtText;
  parts.checked.textContent = `${str(at) && at ? `Checked at ${at}. ` : ''}Scores refresh about every minute while this page is open. Results count only once the organiser confirms them.`;
  parts.list.replaceChildren(
    ...matches.map((m) => {
      const li = el(doc, 'li');
      li.appendChild(card(doc, m));
      return li;
    }),
  );
  return matches.length;
}

// ------------------------------------------------------------------ polling

export interface PollerDeps {
  load: () => Promise<unknown>;
  /** Draws the answer; returns the number of matches shown. */
  draw: (data: unknown) => number;
  visible: () => boolean;
  now: () => number;
  setTimer: (fn: () => void, ms: number) => unknown;
  clearTimer: (handle: unknown) => void;
  intervalMs?: number;
  /** How often a visible page looks again while nothing is live (default 5 minutes). */
  idleMs?: number;
}

export interface Poller {
  /** The first look (when the page is visible). */
  start: () => void;
  /** Call on every visibilitychange. */
  visibilityChanged: () => void;
  /** For tests: is a next look planned? */
  planned: () => boolean;
}

export function createPoller(d: PollerDeps): Poller {
  const every = d.intervalMs ?? LIVE_POLL_MS;
  const idle = d.idleMs ?? LIVE_IDLE_POLL_MS;
  let timer: unknown = null;
  let busy = false;
  let active = false;
  let last = -Infinity;

  const cancel = () => {
    if (timer !== null) d.clearTimer(timer);
    timer = null;
  };
  const plan = (ms: number) => {
    cancel();
    timer = d.setTimer(() => {
      timer = null;
      look();
    }, Math.max(0, ms));
  };
  function look(): void {
    if (busy || !d.visible()) return;
    busy = true;
    last = d.now();
    d.load()
      .then((data) => {
        active = d.draw(data) > 0;
      })
      // a failed look keeps what is shown; the next look comes at the same pace as before
      .catch(() => undefined)
      .finally(() => {
        busy = false;
        // every minute while something is live; every few minutes otherwise, so a match that starts later is picked up
        if (d.visible()) plan(active ? every : idle);
      });
  }
  return {
    start: () => look(),
    visibilityChanged: () => {
      if (!d.visible()) {
        cancel();
        return;
      }
      if (timer === null && !busy) plan(last + (active ? every : idle) - d.now());
    },
    planned: () => timer !== null,
  };
}

/** Wires the region of the page, if there is one. Called once by the page's module script. */
export function startLiveScores(doc: Document = document): void {
  const root = doc.querySelector<HTMLElement>('[data-live-scores]');
  const endpoint = root?.dataset.endpoint ?? '';
  const summary = root?.querySelector<HTMLElement>('[data-live-summary]');
  const checked = root?.querySelector<HTMLElement>('[data-live-checked]');
  const list = root?.querySelector<HTMLElement>('[data-live-list]');
  if (!root || !summary || !checked || !list || !/^\/api\/live-scores\/[0-9a-f-]{36}$/i.test(endpoint)) return;
  const parts = { root, summary, checked, list } as unknown as LiveParts;
  const poller = createPoller({
    load: async () => {
      const res = await fetch(endpoint, { headers: { accept: 'application/json' }, credentials: 'omit' });
      if (!res.ok) throw new Error(String(res.status));
      return res.json();
    },
    draw: (data) => render(parts, data, doc as unknown as DocLike),
    visible: () => doc.visibilityState === 'visible',
    now: () => Date.now(),
    setTimer: (fn, ms) => setTimeout(fn, ms),
    clearTimer: (h) => clearTimeout(h as ReturnType<typeof setTimeout>),
  });
  doc.addEventListener('visibilitychange', poller.visibilityChanged);
  poller.start();
}
