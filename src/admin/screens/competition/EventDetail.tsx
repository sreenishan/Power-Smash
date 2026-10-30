// One event: its entries, its draw and its matches and results, one tab each (the tab is in the address, so the back button works).
import { Badge, LoadState, cx, useAdmin, useAsync } from '../../ui';
import { DrawTab } from './Draw';
import { EntriesTab } from './Entries';
import { compHash, EVENT_STATUS_LABEL, EVENT_TAB_LABEL, EVENT_TABS, eventTitle, FORMAT_LABEL, rulesetWords, type EventTab } from './logic';
import { ResultsTab } from './Results';
import { BackLink, PublicSwitchNote } from './shared';
import { UpdateMatches } from './UpdateMatches';

export function EventDetail({ eventId, tab }: { eventId: string; tab: EventTab }) {
  const { client, actor } = useAdmin();
  // the actor lets the preview (memory store) name players; over the network the server uses its own verified actor
  const q = useAsync(() => client.competitionEvent({ eventId }, actor), [eventId]);
  const d = q.data;
  return (
    <div className="flex flex-col gap-4">
      <BackLink href={compHash({ view: 'home' })}>Back to competitions</BackLink>
      {/* keep showing the event while it reloads after a change, so open forms keep what was typed */}
      <LoadState loading={q.loading && !d} error={q.error}>
        {d ? (
          <>
            <section aria-labelledby="ev-title" className="flex flex-col gap-2">
              <h2 id="ev-title" className="text-h3 font-bold text-heading">{eventTitle(d.event)}</h2>
              <p className="text-small text-fg-muted">{d.tournament.name}</p>
              <p className="flex flex-wrap gap-2">
                <Badge>{FORMAT_LABEL[d.event.format]}</Badge>
                <Badge tone={d.event.status === 'open' ? 'good' : 'neutral'}>{EVENT_STATUS_LABEL[d.event.status]}</Badge>
                <Badge>{d.event.capacity === null ? 'No limit on places' : `${d.event.capacity} places`}</Badge>
                {d.event.isJunior ? <Badge tone="warn">Junior: nobody named on the site</Badge> : null}
              </p>
              <p className="text-small">{rulesetWords(d.event.ruleset)}</p>
              <p><a href={compHash({ view: 'editEvent', eventId })} className="inline-flex min-h-tap items-center font-semibold">Change the event details</a></p>
              <UpdateMatches detail={d} />
              <PublicSwitchNote />
            </section>
            <nav aria-label="Parts of this event">
              <ul className="flex flex-wrap gap-2">
                {EVENT_TABS.map((t) => (
                  <li key={t}>
                    <a href={compHash({ view: 'event', eventId, tab: t })} aria-current={tab === t ? 'page' : undefined} className={cx('inline-flex min-h-tap items-center rounded-md border-2 px-3 text-small font-bold no-underline', tab === t ? 'border-ps-court bg-ps-court text-ps-white' : 'border-line-strong bg-surface text-fg')}>
                      {EVENT_TAB_LABEL[t]}
                    </a>
                  </li>
                ))}
              </ul>
            </nav>
            {tab === 'entries' ? <EntriesTab detail={d} /> : null}
            {tab === 'draw' ? <DrawTab detail={d} /> : null}
            {tab === 'matches' ? <ResultsTab detail={d} /> : null}
          </>
        ) : null}
      </LoadState>
    </div>
  );
}
