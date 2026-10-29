// Browser side of the /tournaments filters (spec 7.6). The page renders every card with its filter keys in data-keys and a hidden
// filter form; this script shows the form, restores the filters from the address (only values that exist as options are accepted),
// hides the cards and the empty groups that do not match, says how many match, and keeps the address in step so a filtered view can
// be shared. Without JavaScript the form stays hidden and every tournament is listed. No innerHTML.
import { matchesTournamentFilters, TOURNAMENT_FILTER_NAMES, type TournamentFilterKeys, type TournamentFilters } from './tournament-filters';

function readKeys(card: HTMLElement): TournamentFilterKeys | null {
  try {
    return JSON.parse(card.dataset.keys ?? '') as TournamentFilterKeys;
  } catch {
    return null;
  }
}

export function initTournamentFilters(root: Document = document): void {
  const form = root.querySelector<HTMLFormElement>('[data-tournament-filters]');
  if (!form) return;
  const cards = [...root.querySelectorAll<HTMLElement>('[data-tournament-card]')];
  const groups = [...root.querySelectorAll<HTMLElement>('[data-tournament-group]')];
  const count = root.querySelector<HTMLElement>('[data-tournament-count]');
  const empty = root.querySelector<HTMLElement>('[data-tournament-empty]');
  const selects = new Map(
    TOURNAMENT_FILTER_NAMES.map((name) => [name, form.querySelector<HTMLSelectElement>(`select[name="${name}"]`)] as const),
  );

  const current = (): TournamentFilters => {
    const filters: TournamentFilters = {};
    for (const [name, select] of selects) if (select && select.value) filters[name] = select.value;
    return filters;
  };

  const apply = (): void => {
    const filters = current();
    let shown = 0;
    for (const card of cards) {
      const keys = readKeys(card);
      const match = keys === null || matchesTournamentFilters(keys, filters);
      card.hidden = !match;
      if (match) shown += 1;
    }
    for (const group of groups) group.hidden = !group.querySelector('[data-tournament-card]:not([hidden])');
    if (count) count.textContent = `Showing ${shown} of ${cards.length} tournament${cards.length === 1 ? '' : 's'}.`;
    if (empty) empty.hidden = shown !== 0;
    const params = new URLSearchParams();
    for (const [name, value] of Object.entries(filters)) params.set(name, value);
    const query = params.toString();
    history.replaceState(null, '', `${location.pathname}${query ? `?${query}` : ''}${location.hash}`);
  };

  // restore from the address: only a value that is one of the select's own options is taken (never free text)
  const fromUrl = new URLSearchParams(location.search);
  for (const [name, select] of selects) {
    const wanted = fromUrl.get(name);
    if (select && wanted && [...select.options].some((o) => o.value === wanted)) select.value = wanted;
  }

  form.addEventListener('change', apply);
  form.addEventListener('submit', (event) => event.preventDefault());
  for (const button of root.querySelectorAll<HTMLButtonElement>('[data-tournament-clear]')) {
    button.addEventListener('click', () => {
      for (const select of selects.values()) if (select) select.value = '';
      apply();
    });
  }
  form.hidden = false;
  apply();
}
