import { hashFor, ROUTE_NOTE, ROUTE_TITLE, type AdminRoute } from '../messages';
import { cardCls } from '../ui';

const ITEMS: AdminRoute[] = ['tournaments', 'submissions', 'sponsors', 'prices', 'posters', 'live', 'settings'];

export function More() {
  return (
    <ul className="flex flex-col gap-3">
      {ITEMS.map((r) => (
        <li key={r}>
          <a href={hashFor(r)} className={`${cardCls} block no-underline hover:bg-ps-court-tint`}>
            <span className="block text-body font-bold text-heading">{ROUTE_TITLE[r]}</span>
            <span className="text-small text-fg-muted">{ROUTE_NOTE[r]}</span>
          </a>
        </li>
      ))}
    </ul>
  );
}
