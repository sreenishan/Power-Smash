import { navAreasFor } from '../../lib/admin/accounts/access';
import { hashFor, ROUTE_NOTE, ROUTE_TITLE, type AdminRoute } from '../messages';
import { cardCls, Icon, useAdmin } from '../ui';

const ITEMS: AdminRoute[] = ['tournaments', 'submissions', 'sponsors', 'prices', 'posters', 'live', 'competitions', 'scoring', 'registrations', 'international', 'notices', 'accounts', 'settings'];

/** The More list for a role: every item for the owner; for anyone else only the areas their role may open (accounts/access.ts). */
export function moreItemsFor(role: Parameters<typeof navAreasFor>[0]): AdminRoute[] {
  const areas = navAreasFor(role);
  return areas === null ? ITEMS : ITEMS.filter((r) => areas.includes(r));
}

export function More() {
  const { actor } = useAdmin();
  return (
    <ul className="flex flex-col gap-3">
      {moreItemsFor(actor.role).map((r) => (
        <li key={r}>
          <a href={hashFor(r)} className={`${cardCls} ps-admin-linkcard`}>
            <span className="min-w-0">
              <span className="block text-body font-bold text-heading">{ROUTE_TITLE[r]}</span>
              <span className="block text-small text-fg-muted">{ROUTE_NOTE[r]}</span>
            </span>
            <Icon name="chevronRight" size={20} />
          </a>
        </li>
      ))}
    </ul>
  );
}
