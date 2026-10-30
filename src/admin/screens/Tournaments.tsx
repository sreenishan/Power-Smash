import { useState } from 'react';
import type { TournamentCandidate } from '../../lib/admin/types';
import { changedTournamentFields, TOURNAMENT_FIELD_LABELS, TOURNAMENT_LIMITS, validateTournamentEdit, type TournamentDetails, type TournamentEditInput } from '../../lib/admin/tournament-edit';
import { CATEGORY_LABELS } from '../../lib/archive/labels';
import { TOURNAMENT_LEVELS } from '../../lib/archive/types';
import { todayIst } from '../../lib/dates';
import { CATEGORIES } from '../../lib/parser/types';
import { Badge, Button, Confirm, Empty, Field, LoadState, TextInput, cardCls, inputCls, useAdmin, useAsync, useBusy } from '../ui';

const REGION = { tamil_nadu: 'Tamil Nadu', other_india: 'Elsewhere in India', international: 'International', unknown: 'Place not known' } as const;
const LEVEL_LABEL: Record<(typeof TOURNAMENT_LEVELS)[number], string> = {
  district: 'District', state: 'State', zonal: 'Zonal', national: 'National', open: 'Open', corporate: 'Corporate', veterans: 'Veterans', school_college: 'School or college', other: 'Other',
};

type Tab = 'submitted' | 'found' | 'approved';
const VISIBILITY = { public: 'Shown on the site', listed_no_player_pages: 'Listed only', hidden: 'Hidden' } as const;

// What a details save really changes today (D-102): the tournament pages built from the videos are not published yet
// (features.archivePages is off, and the build reads the database only with PS_ARCHIVE_SOURCE=supabase), and even then no page shows
// "featured", "Power Smash films this" or the venue yet. Remove or reword this in the change that publishes them.
export const TOURNAMENT_SWITCH_NOTE =
  'Saved in the admin only for now: the tournament pages made from your videos are not on the site yet, and "featured", "Power Smash films this" and the venue are not shown on any page yet. The tournaments you list yourself on the website are not changed here.';

export function Tournaments() {
  const { client } = useAdmin();
  const q = useAsync(() => client.listTournamentCandidates(), []);
  const approvedQ = useAsync(() => client.listApprovedTournaments(), []);
  const [tab, setTab] = useState<Tab>('submitted');
  // the memory store lists every tournament as a candidate; the database store lists pending ones only. Waiting = not approved yet.
  const waiting = (q.data ?? []).filter((t) => t.status === 'pending');
  const submitted = waiting.filter((t) => t.source === 'submitted');
  const found = waiting.filter((t) => t.source !== 'submitted');
  const approved = approvedQ.data ?? [];
  const list = tab === 'submitted' ? submitted : tab === 'found' ? found : approved;
  const TABS: readonly (readonly [Tab, string])[] = [
    ['submitted', `Submitted by organizers (${submitted.length})`],
    ['found', `Found in video titles (${found.length})`],
    ['approved', `Approved (${approved.length})`],
  ];
  return (
    <div className="flex flex-col gap-4">
      <div role="tablist" aria-label="Tournament lists" className="flex flex-wrap gap-2">
        {TABS.map(([k, label]) => (
          <button key={k} role="tab" aria-selected={tab === k} onClick={() => setTab(k)} className={`min-h-tap rounded-md border-2 px-3 text-small font-bold ${tab === k ? 'border-ps-court bg-ps-court text-ps-white' : 'border-line-strong bg-surface text-fg'}`}>{label}</button>
        ))}
      </div>
      <p className="text-fg-muted">
        {tab === 'submitted'
          ? 'Organizers send these through the website. Check the organizer is real before you approve.'
          : tab === 'found'
            ? 'Found in video titles. A tournament page needs 3 or more matches, or your approval.'
            : 'Tournaments you approved. Press "Details" to correct the name, place or dates, or to feature one.'}{' '}
        Events outside Tamil Nadu are only listed with their videos: they never get a tournament page.
      </p>
      {/* while a list reloads after a save, keep showing it, so other open Details forms keep what was typed */}
      <LoadState loading={tab === 'approved' ? approvedQ.loading && !approvedQ.data : q.loading && !q.data} error={tab === 'approved' ? approvedQ.error : q.error}>
        {list.length > 0 ? list.map((t) => <Candidate key={t.id} t={t} approved={tab === 'approved'} />) : <Empty>{tab === 'submitted' ? 'No organizer submissions waiting.' : tab === 'found' ? 'No tournaments waiting for a decision.' : 'No approved tournaments yet.'}</Empty>}
      </LoadState>
    </div>
  );
}

const CHECKLIST = ['I have checked the organizer is real (call or WhatsApp the number they gave).', 'The dates and place look right.', 'I am allowed to film and show the matches, or the organizer agreed.'];

function Candidate({ t, approved }: { t: TournamentCandidate; approved: boolean }) {
  const { client, actor, notify, check, bump } = useAdmin();
  const [asking, setAsking] = useState<'promote' | 'reject' | 'hide' | null>(null);
  const [editing, setEditing] = useState(false);
  const [checks, setChecks] = useState<number[]>([]);
  const [busy, run] = useBusy();
  const go = async (decision: 'promote' | 'reject' | 'hide') => {
    const r = await run(() => client.decideTournament(actor, { id: t.id, decision, reason: `${decision} by owner` }));
    setAsking(null);
    if (r && check(r)) {
      notify(decision === 'promote' ? (approved ? 'Shown again.' : 'Approved.') : decision === 'reject' ? 'Rejected.' : 'Hidden.');
      bump();
    }
  };
  const TEXT = {
    promote: t.region === 'tamil_nadu' ? 'It gets a tournament page after the next publish.' : 'It is outside Tamil Nadu: its videos are listed, but it gets no tournament page.',
    reject: 'It is removed from this list and not shown on the site.',
    hide: 'It is hidden from the site. You can approve it later.',
  } as const;
  return (
    <article className={cardCls}>
      <p className="break-words text-body font-bold">{t.name}{t.editionYear ? ` ${t.editionYear}` : ''}</p>
      <p className="mt-1 flex flex-wrap gap-2">
        <Badge>{REGION[t.region]}</Badge>
        <Badge>{t.matchCount} {t.matchCount === 1 ? 'match' : 'matches'}</Badge>
        {t.source === 'submitted' ? <Badge tone="warn">Submitted by organizer</Badge> : null}
        {t.isPromoted ? <Badge tone="good">Approved</Badge> : null}
        {approved ? <Badge tone={t.visibility === 'hidden' ? 'warn' : 'neutral'}>{VISIBILITY[t.visibility]}</Badge> : null}
      </p>
      <div className="mt-3 flex flex-wrap gap-2">
        {approved ? null : <Button small variant="primary" onClick={() => { setChecks([]); setAsking('promote'); }}>Approve</Button>}
        {/* an approved tournament that was hidden can be shown again (the same audited decision as Approve) */}
        {approved && t.visibility === 'hidden' ? <Button small variant="primary" onClick={() => setAsking('promote')}>Show again</Button> : null}
        {approved && t.visibility === 'hidden' ? null : <Button small onClick={() => setAsking('hide')}>Hide</Button>}
        {approved ? null : <Button small onClick={() => setAsking('reject')}>Reject</Button>}
        <Button small onClick={() => setEditing(!editing)}>{editing ? 'Close details' : 'Details'}</Button>
      </div>
      {asking ? <Confirm title={`${asking === 'promote' ? (approved ? 'Show again' : 'Approve') : asking === 'hide' ? 'Hide' : 'Reject'} "${t.name}"?`} body={TEXT[asking]} confirmLabel="Yes" busy={busy} onConfirm={() => { if (asking === 'promote' && !approved && t.source === 'submitted' && checks.length < CHECKLIST.length) return; void go(asking); }} onCancel={() => setAsking(null)}>
        {asking === 'promote' && !approved && t.source === 'submitted' ? (
          <fieldset className="mt-3"><legend className="font-semibold">Tick each one before approving</legend>
            {CHECKLIST.map((c, i) => <label key={c} className="flex min-h-tap items-start gap-2"><input type="checkbox" className="mt-1 h-5 w-5" checked={checks.includes(i)} onChange={(e) => setChecks((x) => (e.target.checked ? [...x, i] : x.filter((n) => n !== i)))} /><span>{c}</span></label>)}
          </fieldset>
        ) : null}
      </Confirm> : null}
      {editing ? <DetailsLoader t={t} onDone={() => setEditing(false)} /> : null}
    </article>
  );
}

// A tournament's details (D-102). Region and visibility stay with Approve / Hide / Reject; the year, the address and the organizer's
// contact are not edited here.
function DetailsLoader({ t, onDone }: { t: TournamentCandidate; onDone: () => void }) {
  const { client } = useAdmin();
  const q = useAsync(() => client.getTournamentDetails({ id: t.id }), [t.id]);
  return (
    <div className="mt-3 border-t border-line pt-3">
      <LoadState loading={q.loading} error={q.error}>
        {q.data ? <DetailsForm t={t} initial={q.data} onDone={onDone} /> : null}
      </LoadState>
    </div>
  );
}

function DetailsForm({ t, initial, onDone }: { t: TournamentCandidate; initial: TournamentDetails; onDone: () => void }) {
  const { client, actor, notify, check, bump } = useAdmin();
  const [f, setF] = useState<TournamentEditInput>(() => ({ ...initial, categories: [...initial.categories] }));
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [asking, setAsking] = useState<string[] | null>(null);
  const [busy, run] = useBusy();
  const set = <K extends keyof TournamentEditInput>(k: K, v: TournamentEditInput[K]) => setF((x) => ({ ...x, [k]: v }));
  const text = (k: 'name' | 'city' | 'district' | 'venue' | 'startDate' | 'endDate' | 'featuredUntil') => (f[k] ?? '') as string;
  const id = (k: string) => `t-${k}-${t.id}`;
  const err = (k: string) => (errors[k] ? <p role="alert" className="font-semibold text-ps-live">{errors[k]}</p> : null);

  // the confirm step names what will change, so a cleared date or an unticked box is never a surprise
  const review = () => {
    const v = validateTournamentEdit(f, todayIst(), initial);
    setErrors(v.ok ? {} : (v.errors as Record<string, string>));
    if (v.ok) setAsking(changedTournamentFields(initial, v.value).map((k) => TOURNAMENT_FIELD_LABELS[k]));
  };
  const save = async () => {
    const r = await run(() => client.updateTournamentDetails(actor, { ...f, id: t.id, reason: 'Tournament details edited by owner', expected: initial }));
    setAsking(null);
    if (!r) return;
    if (check(r)) {
      notify(r.data.fields.length > 0 ? 'Saved in the admin.' : 'Nothing to change.');
      bump();
      onDone();
    } else setErrors(r.errors ?? {});
  };

  return (
    <form className="flex flex-col gap-3" onSubmit={(e) => { e.preventDefault(); review(); }}>
      <p className="rounded-lg border-2 border-ps-live bg-ps-live-tint p-3 text-small text-ps-ink">{TOURNAMENT_SWITCH_NOTE}</p>
      <Field label="Name" htmlFor={id('name')}>
        <TextInput id={id('name')} value={text('name')} onChange={(v) => set('name', v)} maxLength={TOURNAMENT_LIMITS.name + 20} />
      </Field>
      {err('name')}
      <Field label="Level" htmlFor={id('level')}>
        <select id={id('level')} className={inputCls} value={f.level ?? ''} onChange={(e) => set('level', e.target.value === '' ? null : e.target.value)}>
          <option value="">Not stated</option>
          {TOURNAMENT_LEVELS.map((l) => <option key={l} value={l}>{LEVEL_LABEL[l]}</option>)}
        </select>
      </Field>
      {err('level')}
      <Field label="City" htmlFor={id('city')}>
        <TextInput id={id('city')} value={text('city')} onChange={(v) => set('city', v)} maxLength={TOURNAMENT_LIMITS.city + 20} />
      </Field>
      {err('city')}
      <Field label="District" htmlFor={id('district')}>
        <TextInput id={id('district')} value={text('district')} onChange={(v) => set('district', v)} maxLength={TOURNAMENT_LIMITS.district + 20} />
      </Field>
      {err('district')}
      <Field label="Venue" htmlFor={id('venue')}>
        <TextInput id={id('venue')} value={text('venue')} onChange={(v) => set('venue', v)} maxLength={TOURNAMENT_LIMITS.venue + 20} />
      </Field>
      {err('venue')}
      <Field label="First day" htmlFor={id('start')} hint="For example 2026-11-14.">
        <TextInput id={id('start')} value={text('startDate')} placeholder="YYYY-MM-DD" maxLength={20} onChange={(v) => set('startDate', v)} />
      </Field>
      {err('startDate')}
      <Field label="Last day" htmlFor={id('end')} hint="Leave empty for a one-day tournament.">
        <TextInput id={id('end')} value={text('endDate')} placeholder="YYYY-MM-DD" maxLength={20} onChange={(v) => set('endDate', v)} />
      </Field>
      {err('endDate')}
      <fieldset>
        <legend className="text-small font-bold uppercase tracking-wider text-fg">Categories</legend>
        <div className="mt-1 grid grid-cols-1 gap-1 sm:grid-cols-2">
          {CATEGORIES.map((c) => (
            <label key={c} className="flex min-h-tap items-center gap-2">
              <input type="checkbox" className="h-5 w-5" checked={f.categories.includes(c)} onChange={(e) => set('categories', e.target.checked ? [...f.categories, c] : f.categories.filter((x) => x !== c))} />
              {CATEGORY_LABELS[c] ?? c}
            </label>
          ))}
        </div>
      </fieldset>
      {err('categories')}
      <label className="flex min-h-tap items-center gap-2"><input type="checkbox" className="h-5 w-5" checked={f.isFeatured} onChange={(e) => set('isFeatured', e.target.checked)} />Feature this tournament at the top of the list (free)</label>
      {f.isFeatured ? (
        <Field label="Featured until" htmlFor={id('until')} hint="The last day it is featured, for example 2026-11-30. Today or later.">
          <TextInput id={id('until')} value={text('featuredUntil')} placeholder="YYYY-MM-DD" maxLength={20} onChange={(v) => set('featuredUntil', v)} />
        </Field>
      ) : null}
      {err('featuredUntil')}
      <label className="flex min-h-tap items-center gap-2"><input type="checkbox" className="h-5 w-5" checked={f.coveredByPowerSmash} onChange={(e) => set('coveredByPowerSmash', e.target.checked)} />Power Smash films this tournament</label>
      {errors.form ? <p role="alert" className="font-semibold text-ps-live">{errors.form}</p> : null}
      <div><Button type="submit" variant="primary">Review and save</Button></div>
      {asking ? (
        <Confirm
          title={`Save the details of "${t.name}"?`}
          body={asking.length > 0 ? `You are changing: ${asking.join(', ')}. The change is recorded with your name.` : 'Nothing has changed.'}
          confirmLabel="Save"
          busy={busy}
          onConfirm={() => void save()}
          onCancel={() => setAsking(null)}
        />
      ) : null}
    </form>
  );
}
