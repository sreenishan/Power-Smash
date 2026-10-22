// Tiny client for /matches (spec 7.2, D-010): loads the prebuilt list JSON on the first interaction and filters it in the browser.
// No framework, no innerHTML (cards are built with createElement and textContent, so a title can never become markup).
// The static page already holds the newest cards and a plain pager, so the page works without this script.
// The card markup must stay in step with src/components/archive/MatchCard.astro.
import { formatDate } from '../dates';
import { categoryLabel, roundLabel } from './labels';
import { ytThumb } from './youtube';
import { filterMatches, type MatchFilters, type MatchIndex, type MatchItem, type MatchSort } from './search';

const BATCH = 48;

function el<K extends keyof HTMLElementTagNameMap>(tag: K, className?: string, text?: string): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

export function renderCard(item: MatchItem, thumbs: boolean): HTMLElement {
  const card = el('article', 'group relative flex h-full flex-col overflow-hidden rounded-lg border border-line bg-surface shadow-card ps-transition hover:-translate-y-0.5 hover:shadow-raised');
  card.setAttribute('data-match-card', '');
  const block = el(
    'div',
    "relative aspect-video w-full overflow-hidden bg-ps-ink bg-[url('/brand/court-lines.svg')] bg-[length:70%] bg-[position:right_-10%_bottom_-20%] bg-no-repeat",
  );
  if (thumbs) {
    const img = el('img', 'absolute inset-0 h-full w-full object-cover');
    img.src = ytThumb(item.v);
    img.alt = '';
    img.width = 320;
    img.height = 180;
    img.loading = 'lazy';
    block.append(img);
  }
  const lower = el('div', 'absolute inset-x-0 bottom-0 flex items-stretch bg-gradient-to-t from-ps-ink/90 to-transparent pt-8');
  lower.setAttribute('aria-hidden', 'true');
  const vs = el('span', 'ml-3 -skew-x-12 bg-ps-volt px-3 py-1 font-[family-name:var(--ps-font-display)] text-lg font-extrabold uppercase leading-none text-ps-ink');
  vs.append(el('span', 'inline-block skew-x-12', 'VS'));
  lower.append(vs);
  const cat = categoryLabel(item.c);
  if (cat) lower.append(el('span', 'flex items-center px-3 font-[family-name:var(--ps-font-display)] text-lg font-bold uppercase tracking-wider text-ps-white', cat));
  block.append(lower);
  card.append(block);
  const body = el('div', 'flex flex-1 flex-col p-4 sm:p-5');
  body.append(el('p', 'text-small font-bold uppercase tracking-wider text-fg-muted ps-num', formatDate(item.d)));
  const h = el('h3', 'mt-1 text-h4');
  const a = el('a', 'text-heading no-underline after:absolute after:inset-0 hover:underline', item.t);
  a.href = `/matches/${item.s}/`;
  h.append(a);
  body.append(h);
  if (item.n) body.append(el('p', 'mt-2 text-fg-muted', item.n));
  const details = [categoryLabel(item.c), roundLabel(item.r)].filter(Boolean).join(' | ');
  if (details) body.append(el('p', 'mt-1 text-small text-fg-muted', details));
  card.append(body);
  return card;
}

export function readFilters(form: HTMLFormElement): { filters: MatchFilters; sort: MatchSort } {
  const data = new FormData(form);
  const get = (k: string) => String(data.get(k) ?? '').trim();
  return {
    filters: { year: get('year'), tournament: get('tournament'), category: get('category'), ageGroup: get('ageGroup'), round: get('round'), district: get('district'), q: get('q') },
    sort: get('sort') === 'views' ? 'views' : 'newest',
  };
}

export function installMatchFilters(doc: Document): void {
  const form = doc.querySelector<HTMLFormElement>('form[data-match-filters]');
  const grid = doc.querySelector<HTMLElement>('[data-match-grid]');
  const count = doc.querySelector<HTMLElement>('[data-match-count]');
  const more = doc.querySelector<HTMLButtonElement>('button[data-match-more]');
  const pager = doc.querySelector<HTMLElement>('[data-match-pager]');
  const staticCards = doc.querySelectorAll('[data-match-card]').length;
  if (!form || !grid || !count || !more) return;
  const indexUrl = form.getAttribute('data-index-url') ?? '';
  const thumbs = grid.getAttribute('data-thumbs') === '1';
  form.hidden = false;
  let items: MatchItem[] | null = null;
  let loading: Promise<void> | null = null;
  let shown: MatchItem[] = [];
  let used = 0;

  const load = (): Promise<void> => {
    loading ??= fetch(indexUrl, { headers: { accept: 'application/json' } })
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error('bad status'))))
      .then((json: MatchIndex) => {
        items = json.items;
      })
      .catch(() => {
        loading = null;
        count.textContent = 'The list could not be loaded. Please try again.';
      });
    return loading;
  };

  const draw = (reset: boolean) => {
    if (!items) return;
    if (reset) {
      const { filters, sort } = readFilters(form);
      shown = filterMatches(items, filters, sort);
      used = 0;
      grid.replaceChildren();
      if (pager) pager.hidden = true;
    }
    const next = shown.slice(used, used + BATCH);
    for (const item of next) grid.append(renderCard(item, thumbs));
    used += next.length;
    more.hidden = used >= shown.length;
    count.textContent = shown.length === 0 ? 'No matches found. Try fewer filters.' : `Showing ${used} of ${shown.length} matches`;
  };

  const onChange = () => {
    void load().then(() => draw(true));
  };
  form.addEventListener('change', onChange);
  form.addEventListener('input', (e) => {
    if ((e.target as HTMLElement).tagName === 'INPUT') onChange();
  });
  form.addEventListener('submit', (e) => {
    e.preventDefault();
    onChange();
  });
  form.addEventListener('reset', () => {
    // After the browser clears the fields, put the static page back.
    setTimeout(() => {
      if (items) draw(true);
    }, 0);
  });
  form.addEventListener('focusin', () => void load(), { once: true });
  more.addEventListener('click', () => draw(false));
  void staticCards;
}
