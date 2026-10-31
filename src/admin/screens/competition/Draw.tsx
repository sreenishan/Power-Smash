// An event's draw: made on the server from the CONFIRMED entries with a recorded draw number (the same number makes the same draw),
// previewed here (your view with names, or what the website will show, with "Protected player"), made again as often as wanted while it
// is a draft, then published. A published draw cannot be changed: publishing creates the matches.
import { useState } from 'react';
import type { CompetitionEventDetail, GenerateDrawResult, PublishDrawResult, MatchSyncOutcome } from '../../../lib/admin/competition/types';
import { formatInstantIst } from '../../../lib/dates';
import { gamesText, isByeMatch, isWinner, outcomeNote, seedText, slotText, type BracketColumn, type BracketMatchView } from '../../../components/competition/helpers';
import { Badge, Button, Confirm, Field, Icon, cardCls, cx, useAdmin } from '../../ui';
import { bracketMatchSummary, COMP_LIMITS, compHash, DRAW_STATUS_LABEL, groupPreview, knockoutPreview, parseDrawNumber, parseInRange, UPDATE_MATCHES_LABEL, type PreviewMode } from './logic';
import { ErrorText, H2, Input, Note, useAction, byRole } from './shared';
import { SyncOutcomeNote } from './UpdateMatches';

export function DrawTab({ detail }: { detail: CompetitionEventDetail }) {
  const draw = detail.draw;
  const confirmed = detail.entries.filter((e) => e.status === 'confirmed').length;
  const [made, setMade] = useState<GenerateDrawResult | null>(null);
  const [outcome, setOutcome] = useState<MatchSyncOutcome | null>(null);
  const published = draw !== null && draw.status !== 'draft';
  return (
    <div className="flex flex-col gap-4">
      {draw ? (
        <section aria-labelledby="draw-h" className={`${cardCls} flex flex-col gap-3`}>
          <H2 id="draw-h">The draw</H2>
          <p className="flex flex-wrap gap-1.5">
            <Badge tone={published ? 'good' : 'warn'}>{DRAW_STATUS_LABEL[draw.status]}</Badge>
            <Badge>{`Draw number ${draw.seed}`}</Badge>
          </p>
          {published && draw.publishedAt ? <p className="text-small text-fg-muted">Published {formatInstantIst(draw.publishedAt)}.</p> : null}
          {!published ? <p className="text-small">Write down the draw number. Typing the same number again makes exactly the same draw from the same confirmed entries.</p> : null}
          {made && made.drawId === draw.id && made.notes.length > 0 ? (
            <ul aria-label="About this draw" className="list-disc pl-5 text-small">
              {made.notes.map((n) => <li key={n}>{n}</li>)}
            </ul>
          ) : null}
          <DrawPreview detail={detail} />
          {published ? (
            <p className="text-small text-fg-muted">The draw is published and cannot change. To bring the matches in line with it, use &quot;{UPDATE_MATCHES_LABEL}&quot; at the top of this event.</p>
          ) : (
            <Publish detail={detail} onDone={(r) => setOutcome(r)} />
          )}
          {outcome ? <SyncOutcomeNote outcome={outcome} detail={detail} /> : null}
        </section>
      ) : (
        <p className="ps-admin-empty">No draw yet. {confirmed} confirmed {confirmed === 1 ? 'entry' : 'entries'}.</p>
      )}
      {!published ? <MakeDraw detail={detail} onMade={setMade} /> : null}
    </div>
  );
}

function MakeDraw({ detail, onMade }: { detail: CompetitionEventDetail; onMade: (r: GenerateDrawResult) => void }) {
  const { client, actor, notify, bump } = useAdmin();
  const confirmedEntries = detail.entries.filter((e) => e.status === 'confirmed');
  const seededCount = confirmedEntries.filter((e) => e.seed !== null).length;
  const [number, setNumber] = useState('');
  const [seeds, setSeeds] = useState(String(seededCount));
  const [separate, setSeparate] = useState(true);
  const [groups, setGroups] = useState('2');
  const [advance, setAdvance] = useState('2');
  const act = useAction();
  const fmt = detail.event.format;
  const again = detail.draw !== null;

  const make = async () => {
    const n = parseDrawNumber(number);
    const errors: Record<string, string> = {};
    if (n !== null && Number.isNaN(n)) errors['seed'] = 'The draw number is a whole number from 0 to 4294967295 (as shown on an earlier draw), or empty for a new one.';
    const s = parseInRange(seeds, COMP_LIMITS.seeds);
    if (s === null || Number.isNaN(s)) errors['seeds'] = `Type how many seeds to use, from ${COMP_LIMITS.seeds.min} (none) to ${COMP_LIMITS.seeds.max}.`;
    const g = parseInRange(groups, COMP_LIMITS.groupCount);
    const a = parseInRange(advance, COMP_LIMITS.advancePerGroup);
    if (fmt === 'groups_knockout' && (g === null || Number.isNaN(g))) errors['groupCount'] = `Type the number of groups, ${COMP_LIMITS.groupCount.min} to ${COMP_LIMITS.groupCount.max}.`;
    if (fmt === 'groups_knockout' && (a === null || Number.isNaN(a))) errors['advancePerGroup'] = `Type how many go through from each group, ${COMP_LIMITS.advancePerGroup.min} to ${COMP_LIMITS.advancePerGroup.max}.`;
    if (Object.keys(errors).length > 0) return act.fail('Check the form.', errors);
    const r = await act.run(() =>
      client.competitionGenerateDraw(actor, {
        eventId: detail.event.id,
        seed: n,
        separateClubs: fmt === 'knockout' && separate,
        seeds: s ?? 0,
        ...(fmt === 'groups_knockout' ? { groupCount: g, advancePerGroup: a } : {}),
        reason: again ? `Draw made again ${byRole(actor.role)}` : `Draw made ${byRole(actor.role)}`,
      }),
    );
    if (!r) return;
    onMade(r);
    notify(`Draw made. Draw number ${r.seed}.`);
    bump();
  };

  return (
    <form aria-label={again ? 'Make the draw again' : 'Make the draw'} className={`${cardCls} flex flex-col gap-3`} onSubmit={(e) => { e.preventDefault(); void make(); }}>
      <H2>{again ? 'Make the draw again' : 'Make the draw'}</H2>
      <p className="text-small text-fg-muted">The draw uses the {confirmedEntries.length} confirmed {confirmedEntries.length === 1 ? 'entry' : 'entries'} only. {again ? 'Making it again replaces the draft above.' : ''}</p>
      <Field label="Draw number (optional)" htmlFor="draw-number" hint="Leave empty for a new random draw. To make an earlier draw again exactly, type its number.">
        <Input id="draw-number" value={number} inputMode="numeric" maxLength={10} onChange={setNumber} error={act.fields['seed']} />
      </Field>
      <ErrorText id="draw-number-error" text={act.fields['seed']} />
      <Field label="How many seeds" htmlFor="draw-seeds" hint={`${seededCount} confirmed ${seededCount === 1 ? 'entry has' : 'entries have'} a seed. Seeds above this number are drawn like everyone else. 0 to ${COMP_LIMITS.seeds.max}.`}>
        <Input id="draw-seeds" value={seeds} inputMode="numeric" maxLength={2} onChange={setSeeds} error={act.fields['seeds']} />
      </Field>
      <ErrorText id="draw-seeds-error" text={act.fields['seeds']} />
      {fmt === 'knockout' ? (
        <label className="flex min-h-tap items-start gap-2">
          <input type="checkbox" className="mt-1 h-5 w-5" checked={separate} onChange={(e) => setSeparate(e.target.checked)} />
          <span>Keep players from the same club apart in the first round, when possible</span>
        </label>
      ) : null}
      {fmt === 'groups_knockout' ? (
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <Field label="Number of groups" htmlFor="draw-groups">
            <Input id="draw-groups" value={groups} inputMode="numeric" maxLength={3} onChange={setGroups} error={act.fields['groupCount']} />
          </Field>
          <Field label="Go through from each group" htmlFor="draw-advance">
            <Input id="draw-advance" value={advance} inputMode="numeric" maxLength={3} onChange={setAdvance} error={act.fields['advancePerGroup']} />
          </Field>
          <ErrorText id="draw-groups-error" text={act.fields['groupCount']} />
          <ErrorText id="draw-advance-error" text={act.fields['advancePerGroup']} />
        </div>
      ) : null}
      <ErrorText text={act.error} />
      <div><Button type="submit" variant={again ? 'quiet' : 'primary'} busy={act.busy}>{again ? 'Make the draw again' : 'Make the draw'}</Button></div>
    </form>
  );
}

function Publish({ detail, onDone }: { detail: CompetitionEventDetail; onDone: (r: PublishDrawResult) => void }) {
  const { client, actor, notify, bump } = useAdmin();
  const [asking, setAsking] = useState(false);
  const act = useAction();
  const draw = detail.draw!;
  const go = async () => {
    const r = await act.run(() => client.competitionPublishDraw(actor, { eventId: detail.event.id, drawId: draw.id, reason: `Draw published ${byRole(actor.role)}` }));
    setAsking(false);
    if (!r) return;
    onDone(r);
    notify(`Draw published. ${r.created} ${r.created === 1 ? 'match' : 'matches'} made.`);
    bump();
  };
  return (
    <div className="flex flex-col gap-2">
      {detail.event.status !== 'open' ? (
        <Note tone="warn">
          The event is not open yet, so the draw cannot be published. <a href={compHash({ view: 'editEvent', eventId: detail.event.id })}>Change the event status to Open</a> first.
        </Note>
      ) : null}
      <div><Button variant="primary" onClick={() => setAsking(true)}>Publish the draw</Button></div>
      <ErrorText text={act.error} />
      {asking ? (
        <Confirm
          title="Publish this draw?"
          body={
            <>
              <strong>A published draw cannot be changed or made again.</strong> The matches are made from it now, and no new entry can join. Check the names and positions first. It is not on the website until the public competition pages are switched on.
            </>
          }
          confirmLabel="Publish the draw"
          danger
          busy={act.busy}
          onConfirm={() => void go()}
          onCancel={() => setAsking(false)}
        />
      ) : null}
    </div>
  );
}

// ----------------------------------------------------------------------------- the preview

export function DrawPreview({ detail }: { detail: CompetitionEventDetail }) {
  const [mode, setMode] = useState<PreviewMode>('owner');
  const draw = detail.draw;
  if (!draw) return null;
  return (
    <div className="flex flex-col gap-3">
      <fieldset>
        <legend className="text-small font-semibold text-heading">Show</legend>
        <div className="mt-1 grid grid-cols-1 gap-2 sm:grid-cols-2">
          <label className="ps-admin-row flex min-h-tap cursor-pointer items-center gap-3 px-3 py-2 has-[:checked]:border-ps-court has-[:checked]:bg-ps-court-tint has-[:checked]:font-semibold"><input type="radio" name="draw-mode" className="h-5 w-5" checked={mode === 'owner'} onChange={() => setMode('owner')} />Your view (all names)</label>
          <label className="ps-admin-row flex min-h-tap cursor-pointer items-center gap-3 px-3 py-2 has-[:checked]:border-ps-court has-[:checked]:bg-ps-court-tint has-[:checked]:font-semibold"><input type="radio" name="draw-mode" className="h-5 w-5" checked={mode === 'public'} onChange={() => setMode('public')} />What the website will show</label>
        </div>
      </fieldset>
      {mode === 'public' ? <p className="text-small text-fg-muted">Players who are not confirmed adults, and everyone in a junior event, show as &quot;Protected player&quot;. Only confirmed results show a winner or a score.</p> : null}
      {detail.event.format === 'knockout' ? <KnockoutView detail={detail} mode={mode} /> : <GroupsView detail={detail} mode={mode} />}
    </div>
  );
}

function KnockoutView({ detail, mode }: { detail: CompetitionEventDetail; mode: PreviewMode }) {
  const { columns, problems, unconfirmed } = knockoutPreview(detail.draw!.slots, detail.entries, detail.matches, mode);
  const pending = new Set(unconfirmed);
  return (
    <div className="flex flex-col gap-5" data-testid={`draw-preview-${mode}`}>
      {problems.length > 0 ? <ErrorText text={problems.join(' ')} /> : null}
      {pending.size > 0 ? <p className="text-small text-fg-muted">A result marked &quot;not confirmed yet&quot; is saved but not confirmed: the winner moves on, and the website shows it, only after you confirm it under Matches.</p> : null}
      {columns.map((c) => <RoundList key={c.code} column={c} pending={pending} />)}
    </div>
  );
}

function RoundList({ column, pending }: { column: BracketColumn; pending: ReadonlySet<string> }) {
  const headingId = `round-${column.code}`;
  return (
    <section aria-labelledby={headingId}>
      <h3 id={headingId} className="ps-admin-vs !text-small">{column.label}</h3>
      <ol className="mt-2 grid grid-cols-1 gap-2 sm:grid-cols-2">
        {column.matches.map((m) => <BracketLine key={m.id} m={m} pending={pending.has(m.id)} />)}
      </ol>
    </section>
  );
}

function BracketLine({ m, pending }: { m: BracketMatchView; pending: boolean }) {
  const bye = isByeMatch(m);
  const side = (s: 'A' | 'B') => {
    const slot = s === 'A' ? m.a : m.b;
    const win = isWinner(s, m.winner, m.status);
    const seed = slot.kind === 'entry' ? seedText(slot.seed) : '';
    return (
      <span className={cx('ps-admin-match-side', win && 'is-winner')}>
        {seed ? <span className="ps-num shrink-0 text-small font-semibold text-fg-muted">{seed}</span> : null}
        <span className="ps-admin-match-name">
          {slotText(slot)}
          {win ? <span className="sr-only">{pending ? ' (winner, not confirmed yet)' : ' (winner)'}</span> : ''}
        </span>
        {win ? <Icon name="check" size={18} /> : null}
      </span>
    );
  };
  const note = outcomeNote(m.status);
  const score = gamesText(m.games);
  return (
    <li aria-label={pending ? `${bracketMatchSummary(m)}. Not confirmed yet.` : bracketMatchSummary(m)} className="ps-admin-match">
      {side('A')}
      {side('B')}
      {bye ? <span className="ps-admin-match-foot block">Goes through without a match (bye)</span> : null}
      {!bye && (score || note) ? <span className="ps-admin-match-foot ps-num block">{[note, score, pending ? 'not confirmed yet' : ''].filter(Boolean).join(' · ')}</span> : null}
    </li>
  );
}

function GroupsView({ detail, mode }: { detail: CompetitionEventDetail; mode: PreviewMode }) {
  const groups = groupPreview(detail.draw!.slots, detail.entries, mode);
  return (
    <div className="flex flex-col gap-3" data-testid={`draw-preview-${mode}`}>
      {groups.map((g) => (
        <section key={g.label} aria-label={g.label}>
          <h3 className="ps-admin-vs !text-small">{g.label}</h3>
          <ol className="ps-admin-list mt-2">
            {g.names.map((n, i) => <li key={`${g.label}-${i}`} className="!justify-start break-words"><span className="ps-num w-6 shrink-0 text-small font-semibold text-fg-muted">{i + 1}</span><span className="min-w-0">{n}</span></li>)}
          </ol>
        </section>
      ))}
    </div>
  );
}
