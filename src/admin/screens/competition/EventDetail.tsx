// One event: its entries, its draw and its matches and results, one tab each (the tab is in the address, so the back button works).
// What shows depends on the signed-in role (accounts/access.ts competitionUiFor): a scorer sees only the matches, with the result form;
// an organizer sees the three tabs of the tournaments given to them. The server refuses anything else anyway.
import type { CompetitionEventDetail } from '../../../lib/admin/competition/types';
import { Badge, btnCls, Icon, LoadState, cardCls, useAdmin, useAsync } from '../../ui';
import { DrawTab } from './Draw';
import { EntriesTab } from './Entries';
import { compHash, EVENT_STATUS_LABEL, EVENT_TAB_LABEL, EVENT_TABS, eventTitle, FORMAT_LABEL, rulesetWords, type EventTab } from './logic';
import { ResultsTab } from './Results';
import { BackLink, PublicSwitchNote, useCompetitionCaps } from './shared';
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
        {d ? <EventDetailView detail={d} tab={tab} /> : null}
      </LoadState>
    </div>
  );
}

/** The tabs this role may open, in order. Matches and results is always there (a scorer records results in it). */
export function eventTabsFor(caps: { entries: boolean; draw: boolean }): EventTab[] {
  return EVENT_TABS.filter((t) => (t === 'entries' ? caps.entries : t === 'draw' ? caps.draw : true));
}

/** The event once loaded (split out so it renders without effects; tests render it per role). */
export function EventDetailView({ detail: d, tab: asked }: { detail: CompetitionEventDetail; tab: EventTab }) {
  const caps = useCompetitionCaps();
  const tabs = eventTabsFor(caps);
  // a tab this role cannot use (an old link, a typed address) falls back to the matches
  const tab: EventTab = tabs.includes(asked) ? asked : 'matches';
  const eventId = d.event.id;
  return (
    <>
      <section aria-labelledby="ev-title" className={`${cardCls} flex flex-col gap-3`}>
        <div>
          <p className="ps-admin-code">{d.tournament.name}</p>
          <h2 id="ev-title" className="mt-1 text-h3 font-bold text-heading">{eventTitle(d.event)}</h2>
        </div>
        <p className="flex flex-wrap gap-1.5">
          <Badge>{FORMAT_LABEL[d.event.format]}</Badge>
          <Badge tone={d.event.status === 'open' ? 'good' : 'neutral'}>{EVENT_STATUS_LABEL[d.event.status]}</Badge>
          <Badge>{d.event.capacity === null ? 'No limit on places' : `${d.event.capacity} places`}</Badge>
          {d.event.isJunior ? <Badge tone="warn">Junior: nobody named on the site</Badge> : null}
        </p>
        <p className="max-w-prose border-l-2 border-line pl-3 text-small text-fg-muted">{rulesetWords(d.event.ruleset)}</p>
        {caps.editEvent ? <p><a href={compHash({ view: 'editEvent', eventId })} className={btnCls('quiet', true)}><Icon name="pencil" size={18} />Change the event details</a></p> : null}
        {caps.updateMatches ? <UpdateMatches detail={d} /> : null}
        <PublicSwitchNote />
      </section>
      {tabs.length > 1 ? (
        <nav aria-label="Parts of this event">
          <ul className="ps-admin-seg">
            {tabs.map((t) => (
              <li key={t}>
                <a href={compHash({ view: 'event', eventId, tab: t })} aria-current={tab === t ? 'page' : undefined}>
                  {EVENT_TAB_LABEL[t]}
                </a>
              </li>
            ))}
          </ul>
        </nav>
      ) : null}
      {tab === 'entries' ? <EntriesTab detail={d} /> : null}
      {tab === 'draw' ? <DrawTab detail={d} /> : null}
      {tab === 'matches' ? <ResultsTab detail={d} /> : null}
    </>
  );
}
