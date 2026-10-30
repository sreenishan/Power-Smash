// Local rankings (D-110): the owner approves the points table (saving it IS the approval), works out a ranking snapshot from CONFIRMED
// results, checks it and publishes it. A ranking is never an official BWF ranking. Protected players and junior events are left out
// before the ranks are worked out (D-109), so no rank points at a protected player. Without an approved table nothing can be worked out.
import { useState } from 'react';
import type { CompetitionSettingsDto, CompetitionSnapshotSummary } from '../../../lib/admin/competition/types';
import { features } from '../../../content/legal/status';
import { TOURNAMENT_LEVELS } from '../../../lib/archive/types';
import { formatDate, isIsoDate, todayIst } from '../../../lib/dates';
import { FINISHES } from '../../../lib/competition/stats/ranking';
import { CATEGORIES, JUNIOR_CATEGORIES, type Category } from '../../../lib/parser/types';
import { isJuniorAgeGroup } from '../../../lib/competition/db';
import { Badge, Button, Confirm, Empty, Field, LoadState, cardCls, inputCls, useAdmin, useAsync } from '../../ui';
import { AGE_GROUP_OPTIONS, ageGroupWords, categoryWords, compHash, FINISH_LABEL, LEVEL_LABEL, pointsDraftFrom, pointsDraftToRecord, protectedRankingRows, rankingRowProtected, type PointsDraft } from './logic';
import { BackLink, ErrorText, H2, Input, Note, PublicSwitchNote, useAction } from './shared';

const ADULT_CATEGORIES = CATEGORIES.filter((c) => !(JUNIOR_CATEGORIES as readonly string[]).includes(c));
/** Shown instead of the publish button while a row of the ranking is a protected player now (fail closed, D-012). */
const PROTECTED_BLOCK =
  'This ranking cannot be published: it lists a protected player (under 18, or age not confirmed). Work the ranking out again: protected players are left out.';

/** A published ranking is on the website only when the owner's public-rankings switch AND the public competition pages are on. */
const onSite = (rankingsPublic: boolean): boolean => rankingsPublic && features.competitionPages;
const ADULT_AGE_GROUPS = AGE_GROUP_OPTIONS.filter((g) => g === '' || !isJuniorAgeGroup(g));

export function Rankings() {
  const { client } = useAdmin();
  const settingsQ = useAsync(() => client.competitionSettings(), []);
  const listQ = useAsync(() => client.competitionRankings(), []);
  return (
    <div className="flex flex-col gap-4">
      <BackLink href={compHash({ view: 'home' })}>Back to competitions</BackLink>
      <p className="text-fg-muted">A Power Smash local ranking, worked out from confirmed results on this site. It is not an official BWF ranking. Players who are not confirmed adults, and junior events, are always left out.</p>
      <PublicSwitchNote />
      <LoadState loading={settingsQ.loading && !settingsQ.data} error={settingsQ.error}>
        {settingsQ.data ? (
          <>
            <PointsTable settings={settingsQ.data} />
            <Compute settings={settingsQ.data} />
          </>
        ) : null}
      </LoadState>
      <section aria-labelledby="snapshots-h" className="flex flex-col gap-3">
        <H2 id="snapshots-h">Saved rankings</H2>
        <LoadState loading={listQ.loading && !listQ.data} error={listQ.error}>
          {(listQ.data ?? []).length === 0 ? <Empty>No ranking worked out yet.</Empty> : (listQ.data ?? []).map((s) => <Snapshot key={s.id} s={s} rankingsPublic={onSite(settingsQ.data?.rankingsPublic ?? false)} />)}
        </LoadState>
      </section>
    </div>
  );
}

// ----------------------------------------------------------------------------- the points table

function PointsTable({ settings }: { settings: CompetitionSettingsDto }) {
  const [editing, setEditing] = useState(false);
  return (
    <section aria-labelledby="points-h" className={`${cardCls} flex flex-col gap-3`}>
      <H2 id="points-h">Points table</H2>
      <p className="flex flex-wrap gap-2">
        <Badge tone={settings.pointsTable ? 'good' : 'warn'}>{settings.pointsTable ? 'Approved' : 'Not approved yet'}</Badge>
      </p>
      <p className="text-small">{settings.pointsTableSummary}</p>
      <div><Button small onClick={() => setEditing(!editing)}>{editing ? 'Close the points table' : settings.pointsTable ? 'Change the points table' : 'Enter the points table'}</Button></div>
      {editing ? <PointsForm settings={settings} onDone={() => setEditing(false)} /> : null}
    </section>
  );
}

function PointsForm({ settings, onDone }: { settings: CompetitionSettingsDto; onDone: () => void }) {
  const { client, actor, notify, bump } = useAdmin();
  const [d, setD] = useState<PointsDraft>(() => pointsDraftFrom(settings.pointsTable));
  const [asking, setAsking] = useState(false);
  const act = useAction();
  const setLevel = (level: string, finish: string, v: string) => setD((x) => ({ ...x, levels: { ...x.levels, [level]: { ...(x.levels[level] ?? {}), [finish]: v } } }));
  const review = () => {
    const { errors } = pointsDraftToRecord(d);
    if (Object.keys(errors).length > 0) return act.fail('Check the points table.', errors);
    act.clear();
    setAsking(true);
  };
  const save = async () => {
    const { record } = pointsDraftToRecord(d);
    if (!record) return;
    const r = await act.run(() => client.competitionApprovePointsTable(actor, { ...record, reason: 'Ranking points table approved by owner' }));
    setAsking(false);
    if (!r) return;
    notify('Points table approved.');
    bump();
    onDone();
  };
  return (
    <form aria-label="Ranking points table" className="flex flex-col gap-3 border-t border-line pt-3" onSubmit={(e) => { e.preventDefault(); review(); }}>
      <p className="text-small text-fg-muted">You decide the points. Nothing is filled in for you: only the boxes you type count, and an empty box scores 0. Rankings use the tournament&apos;s level, so set the level on each tournament (Tournaments, Details).</p>
      <Field label="Name of the table" htmlFor="pt-label" hint='For example "Power Smash points 2026".'>
        <Input id="pt-label" value={d.label} maxLength={120} onChange={(v) => setD((x) => ({ ...x, label: v }))} error={act.fields['label']} />
      </Field>
      <ErrorText id="pt-label-error" text={act.fields['label']} />
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <Field label="Results from the last (days)" htmlFor="pt-window" hint="For example 364 for one year.">
          <Input id="pt-window" value={d.windowDays} inputMode="numeric" maxLength={4} onChange={(v) => setD((x) => ({ ...x, windowDays: v }))} error={act.fields['windowDays']} />
        </Field>
        <Field label="Best results that count per player" htmlFor="pt-best" hint="1 to 50.">
          <Input id="pt-best" value={d.bestN} inputMode="numeric" maxLength={2} onChange={(v) => setD((x) => ({ ...x, bestN: v }))} error={act.fields['bestN']} />
        </Field>
      </div>
      <ErrorText id="pt-window-error" text={act.fields['windowDays']} />
      <ErrorText id="pt-best-error" text={act.fields['bestN']} />
      <div className="flex flex-col gap-2" aria-describedby={act.fields['levels'] ? 'pt-levels-error' : undefined}>
        {TOURNAMENT_LEVELS.map((level) => {
          const typed = Object.values(d.levels[level] ?? {}).filter((v) => (v ?? '').trim() !== '').length;
          return (
            <details key={level} className="rounded-md border border-line p-2" open={typed > 0}>
              <summary className="min-h-tap cursor-pointer py-2 font-semibold">{LEVEL_LABEL[level]} tournaments{typed > 0 ? ` (${typed} filled in)` : ''}</summary>
              <div className="mt-2 grid grid-cols-1 gap-2 sm:grid-cols-2">
                {FINISHES.map((f) => (
                  <Field key={f} label={FINISH_LABEL[f]} htmlFor={`pt-${level}-${f}`}>
                    <Input id={`pt-${level}-${f}`} value={d.levels[level]?.[f] ?? ''} inputMode="numeric" maxLength={6} onChange={(v) => setLevel(level, f, v)} />
                  </Field>
                ))}
              </div>
            </details>
          );
        })}
      </div>
      <ErrorText id="pt-levels-error" text={act.fields['levels']} />
      <ErrorText text={act.error} />
      <div><Button type="submit" variant="primary">Review and approve</Button></div>
      {asking ? (
        <Confirm
          title="Approve this points table?"
          body="Saving it counts as your approval. Rankings worked out from now on use these points; rankings already saved keep their numbers. It is recorded with your name."
          confirmLabel="Approve the points table"
          busy={act.busy}
          onConfirm={() => void save()}
          onCancel={() => setAsking(false)}
        />
      ) : null}
    </form>
  );
}

// ----------------------------------------------------------------------------- working one out

function Compute({ settings }: { settings: CompetitionSettingsDto }) {
  const { client, actor, notify, bump } = useAdmin();
  const [label, setLabel] = useState('');
  const [category, setCategory] = useState('');
  const [ageGroup, setAgeGroup] = useState('');
  const [asOf, setAsOf] = useState(() => todayIst());
  const [done, setDone] = useState<{ rows: number; protectedLeftOut: number; excluded: string[]; formula: string; disclaimer: string } | null>(null);
  const act = useAction();
  const go = async () => {
    setDone(null);
    const errors: Record<string, string> = {};
    if (label.trim().length < 2) errors['label'] = 'Give the ranking a name, for example "Men\'s singles, November 2026".';
    if (!isIsoDate(asOf.trim())) errors['asOf'] = 'Type the date like 2026-11-30.';
    if (Object.keys(errors).length > 0) return act.fail('Check the form.', errors);
    const r = await act.run(() => client.competitionComputeRanking(actor, { label: label.trim(), category: category === '' ? null : (category as Category), ageGroup: ageGroup === '' ? null : ageGroup, asOf: asOf.trim(), reason: 'Ranking worked out by owner' }));
    if (!r) return;
    setDone(r);
    notify(`Ranking saved as a draft with ${r.rows} ${r.rows === 1 ? 'player' : 'players'}. It is not published.`);
    bump();
  };
  return (
    <section aria-labelledby="compute-h" className={`${cardCls} flex flex-col gap-3`}>
      <H2 id="compute-h">Work out a ranking</H2>
      {!settings.pointsTable ? <Note tone="warn">No points table is approved yet, so a ranking cannot be worked out. Enter and approve the points table above first.</Note> : null}
      <form aria-label="Work out a ranking" className="flex flex-col gap-3" onSubmit={(e) => { e.preventDefault(); void go(); }}>
        <Field label="Name" htmlFor="rk-label">
          <Input id="rk-label" value={label} maxLength={120} onChange={setLabel} error={act.fields['label']} />
        </Field>
        <ErrorText id="rk-label-error" text={act.fields['label']} />
        <Field label="Category" htmlFor="rk-category" hint="Junior categories are never ranked.">
          <select id="rk-category" className={inputCls} value={category} onChange={(e) => setCategory(e.target.value)}>
            <option value="">All categories together</option>
            {ADULT_CATEGORIES.map((c) => <option key={c} value={c}>{categoryWords(c)}</option>)}
          </select>
        </Field>
        <Field label="Age group" htmlFor="rk-age">
          <select id="rk-age" className={inputCls} value={ageGroup} onChange={(e) => setAgeGroup(e.target.value)}>
            {ADULT_AGE_GROUPS.map((g) => <option key={g} value={g}>{g === '' ? 'Any age group' : ageGroupWords(g)}</option>)}
          </select>
        </Field>
        <Field label="Ranking date" htmlFor="rk-asof" hint="Results up to this day count. Today or earlier.">
          <Input id="rk-asof" value={asOf} placeholder="YYYY-MM-DD" maxLength={10} onChange={setAsOf} error={act.fields['asOf']} />
        </Field>
        <ErrorText id="rk-asof-error" text={act.fields['asOf']} />
        <ErrorText text={act.error} />
        <div><Button type="submit" variant="primary" busy={act.busy}>Work out the ranking</Button></div>
      </form>
      {done ? (
        <div role="status" className="rounded-lg border-2 border-ps-court p-3 text-small">
          <p className="font-semibold">Saved as a draft: {done.rows} {done.rows === 1 ? 'player' : 'players'}. Not published.</p>
          {done.protectedLeftOut > 0 ? <p>{done.protectedLeftOut} protected {done.protectedLeftOut === 1 ? 'player was' : 'players were'} left out (they are never ranked publicly).</p> : null}
          {done.excluded.length > 0 ? <ul aria-label="Results left out" className="mt-1 list-disc pl-5">{done.excluded.map((x) => <li key={x}>{x}</li>)}</ul> : null}
          <p className="mt-1">{done.formula}</p>
          <p className="mt-1">{done.disclaimer}</p>
        </div>
      ) : null}
    </section>
  );
}

// ----------------------------------------------------------------------------- saved snapshots

function Snapshot({ s, rankingsPublic }: { s: CompetitionSnapshotSummary; rankingsPublic: boolean }) {
  const [open, setOpen] = useState(false);
  return (
    <article aria-label={`Ranking ${s.label}`} className={cardCls}>
      <p className="break-words font-bold">{s.label}</p>
      <p className="text-small text-fg-muted">
        {isIsoDate(s.asOf) ? `As of ${formatDate(s.asOf)}` : 'Date not known'} · {s.category ? categoryWords(s.category) : 'All categories'}{s.ageGroup ? ` ${s.ageGroup}` : ''} · {s.rows} {s.rows === 1 ? 'player' : 'players'}
      </p>
      <p className="mt-1 flex flex-wrap gap-2">
        <Badge tone={s.published ? 'good' : 'neutral'}>{s.published ? 'Published' : 'Draft'}</Badge>
        {s.published ? <Badge tone={rankingsPublic ? 'good' : 'warn'}>{rankingsPublic ? 'On the website' : 'Not on the website yet: public rankings are off'}</Badge> : null}
      </p>
      <div className="mt-2"><Button small onClick={() => setOpen(!open)}>{open ? 'Close' : 'Open the ranking'}</Button></div>
      {open ? <SnapshotDetail id={s.id} rankingsPublic={rankingsPublic} /> : null}
    </article>
  );
}

function SnapshotDetail({ id, rankingsPublic }: { id: string; rankingsPublic: boolean }) {
  const { client, actor, notify, bump } = useAdmin();
  // the actor lets the preview (memory store) name players; over the network the server uses its own verified actor
  const q = useAsync(() => client.competitionRanking({ snapshotId: id }, actor), [id]);
  const [asking, setAsking] = useState(false);
  const act = useAction();
  const protectedRows = q.data ? protectedRankingRows(q.data.rows) : 0;
  const publish = async () => {
    if (protectedRows > 0) return act.fail(PROTECTED_BLOCK);
    const r = await act.run(() => client.competitionPublishRanking(actor, { snapshotId: id, reason: 'Ranking published by owner' }));
    setAsking(false);
    if (!r) return;
    notify(r.publiclyVisible && features.competitionPages ? 'Ranking published. It is on the website.' : 'Ranking published. It is not on the website yet: public rankings are switched off.');
    bump();
  };
  return (
    <div className="mt-3 border-t border-line pt-3">
      <LoadState loading={q.loading && !q.data} error={q.error}>
        {q.data ? (
          <div className="flex flex-col gap-3">
            <p className="text-small font-semibold">{q.data.disclaimer}</p>
            {q.data.rows.length === 0 ? <Empty>No players in this ranking.</Empty> : (
              <ol aria-label="Ranking" className="flex flex-col gap-1">
                {q.data.rows.map((r) => (
                  <li key={r.playerId} className="flex flex-wrap gap-x-2 rounded-md border border-line p-2">
                    <span className="font-bold">{r.rank}.</span>
                    <span className="break-words">{r.displayName}</span>
                    {rankingRowProtected(r) ? <Badge tone="warn">Protected player: will be left out</Badge> : null}
                    <span className="text-fg-muted">{r.points} points, {r.eventsCounted} {r.eventsCounted === 1 ? 'result' : 'results'} counted</span>
                  </li>
                ))}
              </ol>
            )}
            {!q.data.snapshot.published && protectedRows > 0 ? <Note tone="warn">{PROTECTED_BLOCK}</Note> : null}
            {!q.data.snapshot.published && protectedRows === 0 ? (
              <>
                <div><Button variant="primary" onClick={() => setAsking(true)}>Publish this ranking</Button></div>
                {asking ? (
                  <Confirm
                    title={`Publish "${q.data.snapshot.label}"?`}
                    body={`${rankingsPublic ? 'It goes on the website. Publishing cannot be undone here.' : 'It is marked as published, but it shows on the website only once public rankings and the competition pages are switched on (they are off). Publishing cannot be undone here.'} Before you publish, check the names: if anyone on the list is under 18 or their age is not confirmed, do not publish. Mark their age on their player page and work the ranking out again.`}
                    confirmLabel="Publish the ranking"
                    danger
                    busy={act.busy}
                    onConfirm={() => void publish()}
                    onCancel={() => setAsking(false)}
                  />
                ) : null}
              </>
            ) : null}
            <ErrorText text={act.error} />
          </div>
        ) : null}
      </LoadState>
    </div>
  );
}
