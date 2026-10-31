// A tournament's courts and its order of play. The plan is worked out on the server: first a preview (nothing saved) with every clash in
// plain English, then "Save this plan", which is refused if a match changed since the preview. Matches that already have a time stay
// where they are; a clash with them is reported, not prevented.
import { useState } from 'react';
import type { CompetitionTournamentDto, ScheduleResultDto } from '../../../lib/admin/competition/types';
import { formatDate, isIsoDate } from '../../../lib/dates';
import { formatTimeIst, istDateOf } from '../../../components/competition/helpers';
import { Badge, Button, Confirm, Empty, Field, LoadState, cardCls, inputCls, useAdmin, useAsync } from '../../ui';
import { COMP_LIMITS, compHash, eventTitle, includedIds, parseInRange, toggleLeftOut, windowsProblems, type WindowDraft } from './logic';
import { BackLink, ErrorText, H2, Input, Note, OwnerJob, PublicSwitchNote, useAction, useCompetitionCaps, byRole } from './shared';

export function TournamentSchedule({ tournamentId }: { tournamentId: string }) {
  const { client } = useAdmin();
  const caps = useCompetitionCaps();
  const listQ = useAsync(() => client.competitionTournaments(), []);
  const t = (listQ.data ?? []).find((x) => x.id === tournamentId) ?? null;
  if (!caps.courts && !caps.schedule) {
    return (
      <div className="flex flex-col gap-4">
        <BackLink href={compHash({ view: 'home' })}>Back to competitions</BackLink>
        <OwnerJob>Courts and the order of play are set by the tournament organizer or the owner. Your matches and their times are under each event.</OwnerJob>
      </div>
    );
  }
  return (
    <div className="flex flex-col gap-4">
      <BackLink href={compHash({ view: 'home' })}>Back to competitions</BackLink>
      <LoadState loading={listQ.loading && !listQ.data} error={listQ.error}>
        {t ? (
          <>
            <h2 className="text-h3 font-bold text-heading">{t.name}: courts and schedule</h2>
            <PublicSwitchNote />
            <Courts tournamentId={t.id} />
            {caps.schedule ? <Planner t={t} /> : null}
          </>
        ) : (
          <p role="alert" className="rounded-lg border-2 border-ps-live bg-ps-live-tint p-4 text-ps-ink">That tournament was not found. Go back and open it again.</p>
        )}
      </LoadState>
    </div>
  );
}

// ----------------------------------------------------------------------------- courts and venues

export function Courts({ tournamentId }: { tournamentId: string }) {
  const { client, actor, notify, bump } = useAdmin();
  const caps = useCompetitionCaps();
  const q = useAsync(() => client.competitionCourts({ tournamentId }), [tournamentId]);
  const [label, setLabel] = useState('');
  const [venueId, setVenueId] = useState('');
  const [venueName, setVenueName] = useState('');
  const [venueCity, setVenueCity] = useState('');
  const courtAct = useAction();
  const venueAct = useAction();
  const courts = [...(q.data?.courts ?? [])].sort((a, b) => a.sort - b.sort);
  const venues = q.data?.venues ?? [];
  const venueOf = new Map(venues.map((v) => [v.id, v]));

  const addCourt = async () => {
    const sort = courts.reduce((m, c) => Math.max(m, c.sort), 0) + 1;
    const r = await courtAct.run(() => client.competitionSaveCourt(actor, { id: null, tournamentId, venueId: venueId === '' ? null : venueId, label, sort, reason: `Court added ${byRole(actor.role)}` }));
    if (!r) return;
    notify('Court added.');
    setLabel('');
    bump();
  };
  const addVenue = async () => {
    const r = await venueAct.run(() => client.competitionSaveVenue(actor, { id: null, name: venueName, city: venueCity.trim() === '' ? null : venueCity, reason: 'Venue added by owner' }));
    if (!r) return;
    notify('Venue added.');
    setVenueName('');
    setVenueCity('');
    setVenueId(r.id);
    bump();
  };

  return (
    <section aria-labelledby="courts-h" className={`${cardCls} flex flex-col gap-3`}>
      <H2 id="courts-h">Courts</H2>
      <LoadState loading={q.loading && !q.data} error={q.error}>
        {courts.length === 0 ? <Empty>No courts yet. Add the courts the matches are played on.</Empty> : (
          <ul aria-label="Courts of this tournament" className="flex flex-col gap-1">
            {courts.map((c) => {
              const v = c.venueId ? venueOf.get(c.venueId) : undefined;
              return <li key={c.id}><span className="font-semibold">{c.label}</span>{v ? ` · ${v.name}${v.city ? `, ${v.city}` : ''}` : ''}</li>;
            })}
          </ul>
        )}
      </LoadState>
      {caps.courts ? <form aria-label="Add a court" className="flex flex-col gap-3" onSubmit={(e) => { e.preventDefault(); void addCourt(); }}>
        <Field label="Court name" htmlFor="court-label" hint='For example "Court 3" or "Centre court".'>
          <Input id="court-label" value={label} maxLength={40} onChange={setLabel} error={courtAct.fields['label']} />
        </Field>
        <ErrorText id="court-label-error" text={courtAct.fields['label']} />
        <Field label="Venue" htmlFor="court-venue">
          <select id="court-venue" className={inputCls} value={venueId} onChange={(e) => setVenueId(e.target.value)}>
            <option value="">Not stated</option>
            {venues.map((v) => <option key={v.id} value={v.id}>{v.name}{v.city ? `, ${v.city}` : ''}</option>)}
          </select>
        </Field>
        <ErrorText text={courtAct.error && !courtAct.fields['label'] ? courtAct.error : null} />
        <div><Button type="submit" variant="primary" busy={courtAct.busy}>Add the court</Button></div>
      </form> : null}
      {caps.venues ? <details className="rounded-lg border border-line p-3">
        <summary className="min-h-tap cursor-pointer py-2 font-semibold">Add a venue</summary>
        <form aria-label="Add a venue" className="mt-2 flex flex-col gap-3" onSubmit={(e) => { e.preventDefault(); void addVenue(); }}>
          <Field label="Venue name" htmlFor="venue-name">
            <Input id="venue-name" value={venueName} maxLength={160} onChange={setVenueName} error={venueAct.fields['name']} />
          </Field>
          <ErrorText id="venue-name-error" text={venueAct.fields['name']} />
          <Field label="City (optional)" htmlFor="venue-city">
            <Input id="venue-city" value={venueCity} maxLength={60} onChange={setVenueCity} error={venueAct.fields['city']} />
          </Field>
          <ErrorText id="venue-city-error" text={venueAct.fields['city']} />
          <ErrorText text={venueAct.error && !venueAct.fields['name'] && !venueAct.fields['city'] ? venueAct.error : null} />
          <div><Button type="submit" busy={venueAct.busy}>Add the venue</Button></div>
        </form>
      </details> : <OwnerJob>Venues are shared by every tournament, so only the owner adds them. If your venue is missing from the list, ask the owner to add it.</OwnerJob>}
    </section>
  );
}

// ----------------------------------------------------------------------------- the plan

function Planner({ t }: { t: CompetitionTournamentDto }) {
  const { client, actor, notify, bump } = useAdmin();
  const courtsQ = useAsync(() => client.competitionCourts({ tournamentId: t.id }), [t.id]);
  const courts = [...(courtsQ.data?.courts ?? [])].sort((a, b) => a.sort - b.sort);
  const [windows, setWindows] = useState<WindowDraft[]>(() => [{ date: t.startDate && isIsoDate(t.startDate) ? t.startDate : '', start: '', end: '' }]);
  const [duration, setDuration] = useState('');
  const [rest, setRest] = useState('');
  // The boxes the owner UNticked: a court or event added later is ticked by default.
  const [eventsLeftOut, setEventsLeftOut] = useState<string[]>([]);
  const [courtsLeftOut, setCourtsLeftOut] = useState<string[]>([]);
  const [plan, setPlan] = useState<ScheduleResultDto | null>(null);
  const [asking, setAsking] = useState(false);
  const act = useAction();
  const chosenEvents = includedIds(t.events.map((e) => e.id), eventsLeftOut);
  const chosenCourts = includedIds(courts.map((c) => c.id), courtsLeftOut);
  const setWindow = (i: number, k: keyof WindowDraft, v: string) => {
    setWindows((ws) => ws.map((w, j) => (j === i ? { ...w, [k]: v } : w)));
    setPlan(null);
  };

  const input = () => {
    const errors: Record<string, string> = {};
    const wp = windowsProblems(windows.map((w) => ({ date: w.date.trim(), start: w.start.trim(), end: w.end.trim() })));
    if (wp.length > 0) errors['windows'] = wp.join(' ');
    const d = parseInRange(duration, COMP_LIMITS.durationMinutes);
    const r = parseInRange(rest, COMP_LIMITS.restMinutes);
    if (d === null || Number.isNaN(d)) errors['duration'] = `Type how long one match takes, in minutes (${COMP_LIMITS.durationMinutes.min} to ${COMP_LIMITS.durationMinutes.max}).`;
    if (r === null || Number.isNaN(r)) errors['rest'] = `Type the shortest rest between two matches of one player, in minutes (${COMP_LIMITS.restMinutes.min} to ${COMP_LIMITS.restMinutes.max}).`;
    if (chosenEvents.length === 0) errors['events'] = 'Choose at least one event.';
    if (chosenCourts.length === 0) errors['courts'] = 'Choose at least one court.';
    if (Object.keys(errors).length > 0) {
      act.fail('Check the form.', errors);
      return null;
    }
    return { tournamentId: t.id, eventIds: chosenEvents, courtIds: chosenCourts, windows: windows.map((w) => ({ date: w.date.trim(), start: w.start.trim(), end: w.end.trim() })), durationMinutes: d as number, restMinutes: r as number };
  };
  const preview = async () => {
    const i = input();
    if (!i) return;
    const r = await act.run(() => client.competitionSchedule(actor, { ...i, save: false, reason: `Schedule previewed ${byRole(actor.role)}` }));
    setPlan(r);
  };
  const save = async () => {
    const i = input();
    if (!i || !plan) return;
    const r = await act.run(() => client.competitionSchedule(actor, { ...i, save: true, expected: plan.revisions, reason: `Schedule saved ${byRole(actor.role)}` }));
    setAsking(false);
    if (!r) {
      setPlan(null);
      return;
    }
    setPlan(r);
    notify(`${r.saved} ${r.saved === 1 ? 'match' : 'matches'} given a time and court.${r.problems.length > 0 ? ' Some could not be saved: see the list.' : ''}`);
    bump();
  };

  return (
    <section aria-labelledby="plan-h" className={`${cardCls} flex flex-col gap-3`}>
      <H2 id="plan-h">Plan the order of play</H2>
      <p className="text-small text-fg-muted">Gives a time and a court to every match that has no result yet. Matches already given a time stay where they are. A later round waits for the matches that feed it.</p>
      <form aria-label="Plan the order of play" className="flex flex-col gap-3" onSubmit={(e) => { e.preventDefault(); void preview(); }}>
        <fieldset className="flex flex-col gap-3" aria-describedby={act.fields['windows'] ? 'plan-windows-error' : undefined}>
          <legend className="text-small font-bold uppercase tracking-wider text-fg">Playing days (India time, 24-hour clock)</legend>
          {windows.map((w, i) => (
            <div key={i} className="grid grid-cols-1 gap-2 rounded-md border border-line p-2 sm:grid-cols-3">
              <Field label={`Day ${i + 1}: date`} htmlFor={`plan-d${i}`}><Input id={`plan-d${i}`} value={w.date} placeholder="YYYY-MM-DD" maxLength={10} onChange={(v) => setWindow(i, 'date', v)} /></Field>
              <Field label="From" htmlFor={`plan-s${i}`}><Input id={`plan-s${i}`} value={w.start} placeholder="09:00" maxLength={5} onChange={(v) => setWindow(i, 'start', v)} /></Field>
              <Field label="Until" htmlFor={`plan-e${i}`}><Input id={`plan-e${i}`} value={w.end} placeholder="18:00" maxLength={5} onChange={(v) => setWindow(i, 'end', v)} /></Field>
              {windows.length > 1 ? <div><Button small onClick={() => { setWindows((ws) => ws.filter((_, j) => j !== i)); setPlan(null); }}>{`Remove day ${i + 1}`}</Button></div> : null}
            </div>
          ))}
          {windows.length < COMP_LIMITS.playingDays.max ? <div><Button small onClick={() => setWindows((ws) => [...ws, { date: '', start: '', end: '' }])}>Add a day</Button></div> : <p className="text-small text-fg-muted">{`At most ${COMP_LIMITS.playingDays.max} playing days in one plan.`}</p>}
        </fieldset>
        <ErrorText id="plan-windows-error" text={act.fields['windows']} />
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <Field label="One match takes (minutes)" htmlFor="plan-duration" hint={`For example 30. ${COMP_LIMITS.durationMinutes.min} to ${COMP_LIMITS.durationMinutes.max}.`}>
            <Input id="plan-duration" value={duration} inputMode="numeric" maxLength={3} onChange={(v) => { setDuration(v); setPlan(null); }} error={act.fields['duration']} />
          </Field>
          <Field label="Rest between a player's matches (minutes)" htmlFor="plan-rest" hint={`For example 20. ${COMP_LIMITS.restMinutes.min} to ${COMP_LIMITS.restMinutes.max}.`}>
            <Input id="plan-rest" value={rest} inputMode="numeric" maxLength={3} onChange={(v) => { setRest(v); setPlan(null); }} error={act.fields['rest']} />
          </Field>
        </div>
        <ErrorText id="plan-duration-error" text={act.fields['duration']} />
        <ErrorText id="plan-rest-error" text={act.fields['rest']} />
        <fieldset>
          <legend className="text-small font-bold uppercase tracking-wider text-fg">Events</legend>
          {t.events.length === 0 ? <p className="text-fg-muted">No events yet.</p> : t.events.map((e) => (
            <label key={e.id} className="flex min-h-tap items-center gap-2">
              <input type="checkbox" className="h-5 w-5" checked={chosenEvents.includes(e.id)} onChange={(ev) => { setEventsLeftOut((l) => toggleLeftOut(l, e.id, ev.target.checked)); setPlan(null); }} />
              {eventTitle(e)} ({e.matchCount} {e.matchCount === 1 ? 'match' : 'matches'})
            </label>
          ))}
        </fieldset>
        <ErrorText text={act.fields['events']} />
        <fieldset>
          <legend className="text-small font-bold uppercase tracking-wider text-fg">Courts</legend>
          {courts.length > 0 ? <p className="text-small text-fg-muted">All courts are ticked, including any you add later. Untick a court to leave it out of this plan.</p> : null}
          {courts.length === 0 ? <p className="text-fg-muted">Add courts above first.</p> : courts.map((c) => (
            <label key={c.id} className="flex min-h-tap items-center gap-2">
              <input type="checkbox" className="h-5 w-5" checked={chosenCourts.includes(c.id)} onChange={(ev) => { setCourtsLeftOut((l) => toggleLeftOut(l, c.id, ev.target.checked)); setPlan(null); }} />
              {c.label}
            </label>
          ))}
        </fieldset>
        <ErrorText text={act.fields['courts']} />
        <ErrorText text={act.error} />
        <div><Button type="submit" variant="primary" busy={act.busy}>See the plan</Button></div>
      </form>
      {plan ? <PlanView plan={plan} /> : null}
      {plan && plan.saved === 0 && plan.placed.length > 0 ? (
        <div>
          <Button variant="primary" onClick={() => setAsking(true)}>Save this plan</Button>
          {asking ? (
            <Confirm
              title="Save this plan?"
              body={`${plan.placed.length} ${plan.placed.length === 1 ? 'match gets' : 'matches get'} the time and court shown.${plan.conflicts.length > 0 ? ` There ${plan.conflicts.length === 1 ? 'is 1 clash' : `are ${plan.conflicts.length} clashes`}: you can still change single matches afterwards.` : ''} You can change any match later until it has a result.`}
              confirmLabel="Save this plan"
              busy={act.busy}
              onConfirm={() => void save()}
              onCancel={() => setAsking(false)}
            />
          ) : null}
        </div>
      ) : null}
    </section>
  );
}

function PlanView({ plan }: { plan: ScheduleResultDto }) {
  const sorted = [...plan.placed].sort((a, b) => Date.parse(a.start) - Date.parse(b.start) || a.courtLabel.localeCompare(b.courtLabel, 'en-IN', { numeric: true }));
  const days = new Map<string, typeof sorted>();
  for (const p of sorted) {
    const day = istDateOf(p.start) ?? 'unknown';
    days.set(day, [...(days.get(day) ?? []), p]);
  }
  return (
    <div role="region" aria-label={plan.saved > 0 ? 'Saved plan' : 'Plan preview'} className="flex flex-col gap-3">
      <p className="flex flex-wrap gap-2">
        <Badge tone={plan.saved > 0 ? 'good' : 'neutral'}>{plan.saved > 0 ? `Saved: ${plan.saved}` : 'Preview: nothing saved yet'}</Badge>
        <Badge>{`${plan.placed.length} placed`}</Badge>
        {plan.unplaced.length > 0 ? <Badge tone="warn">{`${plan.unplaced.length} not placed`}</Badge> : null}
        <Badge tone={plan.conflicts.length > 0 ? 'warn' : 'good'}>{plan.conflicts.length === 0 ? 'No clashes' : `${plan.conflicts.length} ${plan.conflicts.length === 1 ? 'clash' : 'clashes'}`}</Badge>
      </p>
      {plan.conflicts.length > 0 ? (
        <section aria-labelledby="plan-clashes" className="rounded-lg border-2 border-ps-live bg-ps-live-tint p-3 text-ps-ink">
          <h3 id="plan-clashes" className="font-bold">Clashes</h3>
          <ul className="list-disc pl-5">{plan.conflicts.map((c, i) => <li key={`${c.kind}-${i}`}>{c.message}</li>)}</ul>
        </section>
      ) : null}
      {plan.unplaced.length > 0 ? (
        <section aria-labelledby="plan-unplaced">
          <h3 id="plan-unplaced" className="font-bold">Not placed</h3>
          <ul className="list-disc pl-5">{plan.unplaced.map((u) => <li key={u.matchId}>{u.label}: {u.reason}</li>)}</ul>
        </section>
      ) : null}
      {plan.problems.length > 0 ? <Note tone="warn">{plan.problems.join(' ')}</Note> : null}
      {sorted.length === 0 ? <Empty>No match needs a time.</Empty> : [...days.entries()].map(([day, items]) => (
        <section key={day} aria-label={isIsoDate(day) ? formatDate(day) : 'Day not known'}>
          <h3 className="font-bold">{isIsoDate(day) ? formatDate(day) : 'Day not known'}</h3>
          <ol className="mt-1 flex flex-col gap-1">
            {items.map((p) => <li key={p.matchId} className="rounded-md border border-line p-2"><span className="font-semibold">{formatTimeIst(p.start) ?? 'Time not known'}</span> · {p.courtLabel} · {p.label}</li>)}
          </ol>
        </section>
      ))}
    </div>
  );
}
