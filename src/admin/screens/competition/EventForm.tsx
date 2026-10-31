// Create or change an event of a tournament: category, age group, format, number of places, scoring rules (in plain words) and status.
import { useState } from 'react';
import type { CompEventRow, CompetitionEventDetail, EventFormat, EventStatus } from '../../../lib/admin/competition/types';
import { okResult } from '../../../lib/admin/types';
import { rulesetProblems } from '../../../lib/admin/competition/validate';
import { EVENT_FORMATS, EVENT_STATUSES } from '../../../lib/competition/db';
import type { Ruleset } from '../../../lib/competition/scoring';
import { CATEGORIES, type Category } from '../../../lib/parser/types';
import { Button, Field, LoadState, TextInput, cardCls, inputCls, useAdmin, useAsync } from '../../ui';
import {
  AGE_GROUP_OPTIONS,
  ageGroupWords,
  categoryWords,
  compHash,
  EVENT_STATUS_HELP,
  EVENT_STATUS_LABEL,
  eventTitle,
  FORMAT_HELP,
  FORMAT_LABEL,
  isJuniorEvent,
  COMP_LIMITS,
  parseInRange,
  parseWhole,
  presetKeyFor,
  RULESET_PRESETS,
  rulesetWords,
} from './logic';
import { BackLink, ErrorText, Input, Note, useAction, byRole } from './shared';

interface Draft {
  category: Category;
  ageGroup: string;
  format: EventFormat;
  capacity: string;
  status: EventStatus;
  preset: string;
  custom: { gamesToWin: string; pointsToWin: string; winBy: string; pointCap: string; intervalAt: string; changeEnds: string };
}

const customFrom = (r: Ruleset): Draft['custom'] => ({
  gamesToWin: String(r.gamesToWin),
  pointsToWin: String(r.pointsToWin),
  winBy: String(r.winBy),
  pointCap: r.pointCap === null ? '' : String(r.pointCap),
  intervalAt: r.intervalAt === null ? '' : String(r.intervalAt),
  changeEnds: r.changeEndsInDecidingGameAt === null ? '' : String(r.changeEndsInDecidingGameAt),
});

function draftFrom(e: CompEventRow | null): Draft {
  const r = e?.ruleset ?? RULESET_PRESETS[0]!.ruleset;
  return {
    category: e?.category ?? 'MS',
    ageGroup: e?.ageGroup ?? '',
    format: e?.format ?? 'knockout',
    capacity: e?.capacity === null || e?.capacity === undefined ? '' : String(e.capacity),
    status: e?.status ?? 'draft',
    preset: presetKeyFor(r),
    custom: customFrom(r),
  };
}

/** The ruleset the draft describes, or null when a custom box is not a whole number. */
function rulesetOf(d: Draft): Ruleset | null {
  const p = RULESET_PRESETS.find((x) => x.key === d.preset);
  if (p) return { ...p.ruleset };
  const n = (s: string) => parseWhole(s);
  const vals = [n(d.custom.gamesToWin), n(d.custom.pointsToWin), n(d.custom.winBy)];
  if (vals.some((v) => v === null || Number.isNaN(v))) return null;
  const opt = (s: string) => n(s);
  const cap = opt(d.custom.pointCap);
  const interval = opt(d.custom.intervalAt);
  const ends = opt(d.custom.changeEnds);
  if ([cap, interval, ends].some((v) => v !== null && Number.isNaN(v))) return null;
  return { gamesToWin: vals[0]!, pointsToWin: vals[1]!, winBy: vals[2]!, pointCap: cap, intervalAt: interval, changeEndsInDecidingGameAt: ends };
}

export function EventFormScreen({ tournamentId, eventId }: { tournamentId: string | null; eventId: string | null }) {
  const { client, actor } = useAdmin();
  const listQ = useAsync(() => client.competitionTournaments(), []);
  const eventQ = useAsync<CompetitionEventDetail | null>(() => (eventId ? client.competitionEvent({ eventId }, actor) : Promise.resolve(okResult(null))), [eventId]);
  const tid = tournamentId ?? eventQ.data?.event.tournamentId ?? null;
  const tournament = (listQ.data ?? []).find((t) => t.id === tid) ?? null;
  const loading = (listQ.loading && !listQ.data) || (eventQ.loading && eventQ.data === null && eventId !== null);
  return (
    <div className="flex flex-col gap-4">
      <BackLink href={eventId ? compHash({ view: 'event', eventId, tab: 'entries' }) : compHash({ view: 'home' })}>{eventId ? 'Back to the event' : 'Back to competitions'}</BackLink>
      <LoadState loading={loading} error={listQ.error ?? eventQ.error}>
        {tournament && (eventId === null || eventQ.data) ? (
          <EventForm tournamentId={tournament.id} tournamentName={tournament.name} initial={eventQ.data?.event ?? null} hasEntries={(eventQ.data?.entries.length ?? 0) > 0} />
        ) : (
          <p role="alert" className="rounded-lg border border-ps-live border-l-4 bg-ps-live-tint p-4 text-ps-ink">That tournament was not found. Go back and open it again.</p>
        )}
      </LoadState>
    </div>
  );
}

function EventForm({ tournamentId, tournamentName, initial, hasEntries }: { tournamentId: string; tournamentName: string; initial: CompEventRow | null; hasEntries: boolean }) {
  const { client, actor, notify, bump } = useAdmin();
  const [d, setD] = useState<Draft>(() => draftFrom(initial));
  const act = useAction();
  const set = <K extends keyof Draft>(k: K, v: Draft[K]) => setD((x) => ({ ...x, [k]: v }));
  const setCustom = (k: keyof Draft['custom'], v: string) => setD((x) => ({ ...x, custom: { ...x.custom, [k]: v } }));
  const ruleset = rulesetOf(d);
  const rulesetIssues = ruleset ? rulesetProblems(ruleset) : ['Type whole numbers in the scoring boxes.'];
  const junior = isJuniorEvent(d.category, d.ageGroup === '' ? null : d.ageGroup);
  const f = act.fields;
  const id = (k: string) => `ev-${k}`;
  const described = (k: string) => (f[k] ? { 'aria-invalid': true as const, 'aria-describedby': `${id(k)}-error` } : {});

  const save = async () => {
    const cap = parseInRange(d.capacity, COMP_LIMITS.capacity);
    if (cap !== null && Number.isNaN(cap)) return act.fail('Check the form.', { capacity: `Type the number of places, ${COMP_LIMITS.capacity.min} to ${COMP_LIMITS.capacity.max}, or leave it empty for no limit.` });
    if (!ruleset || rulesetIssues.length > 0) return act.fail('Check the scoring rules.', { ruleset: rulesetIssues.join(' ') });
    const r = await act.run(() =>
      client.competitionSaveEvent(actor, {
        id: initial?.id ?? null,
        tournamentId,
        category: d.category,
        ageGroup: d.ageGroup === '' ? null : d.ageGroup,
        format: d.format,
        ruleset,
        capacity: cap,
        status: d.status,
        reason: initial ? `Event changed ${byRole(actor.role)}` : `Event added ${byRole(actor.role)}`,
      }),
    );
    if (!r) return;
    notify(r.created ? 'Event added.' : r.fields.length > 0 ? 'Event saved.' : 'Nothing to change.');
    bump();
    location.hash = compHash({ view: 'event', eventId: r.id, tab: 'entries' });
  };

  return (
    <form aria-label={initial ? `Change ${eventTitle(initial)}` : `Add an event to ${tournamentName}`} className={`${cardCls} flex flex-col gap-3`} onSubmit={(e) => { e.preventDefault(); void save(); }}>
      <p className="font-bold">{initial ? `Change ${eventTitle(initial)}` : 'New event'} · {tournamentName}</p>
      <Field label="Category" htmlFor={id('category')} hint={hasEntries ? 'The category cannot change once the event has entries.' : undefined}>
        <select id={id('category')} className={inputCls} value={d.category} disabled={hasEntries} onChange={(e) => set('category', e.target.value as Category)} {...described('category')}>
          {CATEGORIES.map((c) => <option key={c} value={c}>{categoryWords(c)}</option>)}
        </select>
      </Field>
      <ErrorText id={`${id('category')}-error`} text={f['category']} />
      <Field label="Age group" htmlFor={id('ageGroup')}>
        <select id={id('ageGroup')} className={inputCls} value={d.ageGroup} onChange={(e) => set('ageGroup', e.target.value)} {...described('ageGroup')}>
          {AGE_GROUP_OPTIONS.map((g) => <option key={g} value={g}>{ageGroupWords(g)}</option>)}
          {d.ageGroup !== '' && !(AGE_GROUP_OPTIONS as readonly string[]).includes(d.ageGroup) ? <option value={d.ageGroup}>{d.ageGroup}</option> : null}
        </select>
      </Field>
      <ErrorText id={`${id('ageGroup')}-error`} text={f['ageGroup']} />
      {junior ? <Note tone="warn">This is a junior event. Nobody in it is ever named on the website (they show as &quot;Protected player&quot;), and it is left out of rankings.</Note> : null}

      <fieldset>
        <legend className="text-small font-semibold text-heading">Format</legend>
        {EVENT_FORMATS.map((fm) => (
          <label key={fm} className="flex min-h-tap items-start gap-2 py-1">
            <input type="radio" name="ev-format" className="mt-1 h-5 w-5" checked={d.format === fm} onChange={() => set('format', fm)} />
            <span><span className="font-semibold">{FORMAT_LABEL[fm]}</span><span className="block text-small text-fg-muted">{FORMAT_HELP[fm]}</span></span>
          </label>
        ))}
      </fieldset>

      <Field label="Number of places" htmlFor={id('capacity')} hint={`Leave empty for no limit. ${COMP_LIMITS.capacity.min} to ${COMP_LIMITS.capacity.max}.`}>
        <Input id={id('capacity')} value={d.capacity} inputMode="numeric" maxLength={4} onChange={(v) => set('capacity', v)} error={f['capacity']} />
      </Field>
      <ErrorText id={`${id('capacity')}-error`} text={f['capacity']} />

      <fieldset aria-describedby="ev-ruleset-words">
        <legend className="text-small font-semibold text-heading">Scoring rules</legend>
        {[...RULESET_PRESETS.map((p) => [p.key, p.label] as const), ['custom', 'Other rules (type them below)'] as const].map(([key, label]) => (
          <label key={key} className="flex min-h-tap items-center gap-2">
            <input type="radio" name="ev-ruleset" className="h-5 w-5" checked={d.preset === key} onChange={() => set('preset', key)} />
            {label}
          </label>
        ))}
        {d.preset === 'custom' ? (
          <div className="mt-2 grid grid-cols-1 gap-3 sm:grid-cols-2">
            <Field label="Games" htmlFor={id('games')}>
              <select id={id('games')} className={inputCls} value={d.custom.gamesToWin} onChange={(e) => setCustom('gamesToWin', e.target.value)}>
                <option value="1">One game</option>
                <option value="2">Best of 3</option>
                <option value="3">Best of 5</option>
              </select>
            </Field>
            <Field label="Points to win a game" htmlFor={id('points')}><TextInput id={id('points')} inputMode="numeric" maxLength={3} value={d.custom.pointsToWin} onChange={(v) => setCustom('pointsToWin', v)} /></Field>
            <Field label="Lead needed near the end" htmlFor={id('winBy')} hint="2 under the Laws of Badminton."><TextInput id={id('winBy')} inputMode="numeric" maxLength={2} value={d.custom.winBy} onChange={(v) => setCustom('winBy', v)} /></Field>
            <Field label="Top score that wins outright" htmlFor={id('cap')} hint="30 under the Laws."><TextInput id={id('cap')} inputMode="numeric" maxLength={2} value={d.custom.pointCap} onChange={(v) => setCustom('pointCap', v)} /></Field>
            <Field label="Break at (points)" htmlFor={id('interval')} hint="Empty for no break."><TextInput id={id('interval')} inputMode="numeric" maxLength={2} value={d.custom.intervalAt} onChange={(v) => setCustom('intervalAt', v)} /></Field>
            <Field label="Change ends in the last game at" htmlFor={id('ends')} hint="Empty for no change."><TextInput id={id('ends')} inputMode="numeric" maxLength={2} value={d.custom.changeEnds} onChange={(v) => setCustom('changeEnds', v)} /></Field>
          </div>
        ) : null}
        <p id="ev-ruleset-words" className="mt-2 text-small" aria-live="polite">
          {ruleset && rulesetIssues.length === 0 ? rulesetWords(ruleset) : <span className="font-semibold text-ps-live">{rulesetIssues.join(' ')}</span>}
        </p>
      </fieldset>
      <ErrorText id={`${id('ruleset')}-error`} text={f['ruleset']} />

      <Field label="Status" htmlFor={id('status')} hint={EVENT_STATUS_HELP[d.status]}>
        <select id={id('status')} className={inputCls} value={d.status} onChange={(e) => set('status', e.target.value as EventStatus)}>
          {EVENT_STATUSES.map((s) => <option key={s} value={s}>{EVENT_STATUS_LABEL[s]}</option>)}
        </select>
      </Field>
      <ErrorText text={act.error} />
      <div><Button type="submit" variant="primary" busy={act.busy}>{initial ? 'Save the event' : 'Add the event'}</Button></div>
    </form>
  );
}
