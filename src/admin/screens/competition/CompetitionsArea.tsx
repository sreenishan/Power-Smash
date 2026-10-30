// The Competitions area of the admin (D-108 to D-114): tournaments with their events, then one screen per job (an event's entries, draw
// and results; a tournament's courts and schedule; rankings). Sub-pages live in the hash (#/competitions/event/<id>/draw) so the phone's
// back button works. Each sub-page is its own lazy chunk.
import { lazy, Suspense, useEffect, useState } from 'react';
import type { CompetitionEventSummary, CompetitionTournamentDto } from '../../../lib/admin/competition/types';
import { formatDateRange, isIsoDate } from '../../../lib/dates';
import { Badge, Empty, LoadState, cardCls, useAdmin, useAsync } from '../../ui';
import { compHash, DRAW_STATUS_LABEL, EVENT_STATUS_LABEL, eventTitle, FORMAT_LABEL, LEVEL_LABEL, parseCompHash, type CompView } from './logic';
import { H2, PublicSwitchNote } from './shared';

const EventDetail = lazy(() => import('./EventDetail').then((m) => ({ default: m.EventDetail })));
const EventForm = lazy(() => import('./EventForm').then((m) => ({ default: m.EventFormScreen })));
const TournamentSchedule = lazy(() => import('./Schedule').then((m) => ({ default: m.TournamentSchedule })));
const Rankings = lazy(() => import('./Rankings').then((m) => ({ default: m.Rankings })));

function useCompView(): CompView {
  const [v, setV] = useState<CompView>(() => parseCompHash(typeof location === 'undefined' ? '' : location.hash));
  useEffect(() => {
    const on = () => {
      setV(parseCompHash(location.hash));
      window.scrollTo(0, 0);
    };
    window.addEventListener('hashchange', on);
    return () => window.removeEventListener('hashchange', on);
  }, []);
  return v;
}

export function Competitions() {
  const v = useCompView();
  return (
    <Suspense fallback={<p className="text-fg-muted">Loading...</p>}>
      {v.view === 'home' ? <Home /> : null}
      {v.view === 'event' ? <EventDetail key={v.eventId} eventId={v.eventId} tab={v.tab} /> : null}
      {v.view === 'newEvent' ? <EventForm key={`new-${v.tournamentId}`} tournamentId={v.tournamentId} eventId={null} /> : null}
      {v.view === 'editEvent' ? <EventForm key={`edit-${v.eventId}`} tournamentId={null} eventId={v.eventId} /> : null}
      {v.view === 'tournament' ? <TournamentSchedule key={v.tournamentId} tournamentId={v.tournamentId} /> : null}
      {v.view === 'rankings' ? <Rankings /> : null}
    </Suspense>
  );
}

function Home() {
  const { client } = useAdmin();
  const q = useAsync(() => client.competitionTournaments(), []);
  const list = q.data ?? [];
  return (
    <div className="flex flex-col gap-4">
      <p className="text-fg-muted">Events, entries, draws, the order of play and results for each tournament. Players who are not confirmed adults, and everyone in a junior event, are never named on the website: it shows &quot;Protected player&quot; instead.</p>
      <PublicSwitchNote />
      <a href={compHash({ view: 'rankings' })} className={`${cardCls} block no-underline hover:bg-ps-court-tint`}>
        <span className="block text-body font-bold text-heading">Rankings and points table</span>
        <span className="text-small text-fg-muted">Approve the points table, work out a local ranking and publish it.</span>
      </a>
      <LoadState loading={q.loading && !q.data} error={q.error}>
        {list.length === 0 ? <Empty>No tournaments yet. Approve a tournament under More, Tournaments first.</Empty> : list.map((t) => <TournamentCard key={t.id} t={t} />)}
      </LoadState>
    </div>
  );
}

function TournamentCard({ t }: { t: CompetitionTournamentDto }) {
  const headingId = `ct-${t.id}`;
  const dates = t.startDate && isIsoDate(t.startDate) ? formatDateRange(t.startDate, t.endDate && isIsoDate(t.endDate) ? t.endDate : null) : 'Dates not set';
  return (
    <article className={cardCls} aria-labelledby={headingId}>
      <H2 id={headingId}>{t.name}</H2>
      <p className="text-small text-fg-muted">
        {dates}
        {t.level ? ` · ${LEVEL_LABEL[t.level as keyof typeof LEVEL_LABEL] ?? t.level}` : ' · Level not set (needed for rankings)'}
      </p>
      {t.events.length === 0 ? <p className="mt-2 text-fg-muted">No events yet.</p> : (
        <ul className="mt-2 flex flex-col gap-2" aria-label={`Events of ${t.name}`}>
          {t.events.map((e) => <EventRow key={e.id} e={e} />)}
        </ul>
      )}
      <div className="mt-3 flex flex-wrap gap-2">
        <a href={compHash({ view: 'newEvent', tournamentId: t.id })} className="inline-flex min-h-tap items-center rounded-md bg-ps-court px-4 text-small font-bold text-ps-white no-underline hover:bg-ps-court-deep">Add an event</a>
        <a href={compHash({ view: 'tournament', tournamentId: t.id })} className="inline-flex min-h-tap items-center rounded-md border-2 border-line-strong bg-surface px-4 text-small font-bold text-fg no-underline hover:bg-ps-court-tint">Courts and schedule</a>
      </div>
    </article>
  );
}

function EventRow({ e }: { e: CompetitionEventSummary }) {
  const places = e.capacity === null ? 'no limit' : `${e.capacity} places`;
  return (
    <li>
      <a href={compHash({ view: 'event', eventId: e.id, tab: 'entries' })} className="block min-h-tap rounded-md border-2 border-line-strong bg-surface p-3 no-underline hover:bg-ps-court-tint">
        <span className="block font-bold text-fg">{eventTitle(e)}</span>
        <span className="mt-1 flex flex-wrap gap-2">
          <Badge>{FORMAT_LABEL[e.format]}</Badge>
          <Badge tone={e.status === 'open' ? 'good' : 'neutral'}>{EVENT_STATUS_LABEL[e.status]}</Badge>
          <Badge tone={e.drawStatus === 'published' ? 'good' : 'neutral'}>{e.drawStatus ? `Draw: ${DRAW_STATUS_LABEL[e.drawStatus]}` : 'No draw yet'}</Badge>
          {e.isJunior ? <Badge tone="warn">Junior: nobody named on the site</Badge> : null}
        </span>
        <span className="mt-1 block text-small text-fg-muted">
          {e.activeEntries} {e.activeEntries === 1 ? 'entry' : 'entries'} ({e.confirmedEntries} confirmed), {places}. {e.matchCount > 0 ? `${e.confirmedResults} of ${e.matchCount} results confirmed.` : 'No matches yet.'}
        </span>
      </a>
    </li>
  );
}
