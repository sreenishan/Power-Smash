// Tiny client for the player search box on /players (D-010): loads the prebuilt search index on first focus and lists matches as links.
// The index holds adult_confirmed players and tournaments only, so a protected player cannot be found here. No innerHTML.
import { searchIndex, type SearchIndex } from './search';

export function installPlayerSearch(doc: Document): void {
  const box = doc.querySelector<HTMLInputElement>('input[data-player-search]');
  const list = doc.querySelector<HTMLUListElement>('[data-player-results]');
  const status = doc.querySelector<HTMLElement>('[data-player-status]');
  if (!box || !list || !status) return;
  const url = box.getAttribute('data-index-url') ?? '';
  let index: SearchIndex | null = null;
  let loading: Promise<void> | null = null;

  const load = (): Promise<void> => {
    loading ??= fetch(url, { headers: { accept: 'application/json' } })
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error('bad status'))))
      .then((json: SearchIndex) => {
        index = json;
      })
      .catch(() => {
        loading = null;
        status.textContent = 'Search could not be loaded. Use the A to Z list below.';
      });
    return loading;
  };

  const run = () => {
    list.replaceChildren();
    const query = box.value.trim();
    if (!index || query === '') {
      status.textContent = '';
      return;
    }
    const hits = searchIndex(index, query, 10);
    status.textContent = hits.length === 0 ? 'No players or tournaments found.' : `${hits.length} result${hits.length === 1 ? '' : 's'}`;
    for (const hit of hits) {
      const li = doc.createElement('li');
      li.className = 'py-1';
      const label = hit.kind === 'tournament' ? `${hit.name} (tournament${hit.detail ? `, ${hit.detail}` : ''})` : hit.name;
      if (hit.href) {
        const a = doc.createElement('a');
        a.href = hit.href;
        a.className = 'inline-flex min-h-tap items-center font-semibold';
        a.textContent = label;
        li.append(a);
      } else {
        li.textContent = label;
      }
      list.append(li);
    }
  };

  box.addEventListener('focus', () => void load(), { once: true });
  box.addEventListener('input', () => void load().then(run));
}
