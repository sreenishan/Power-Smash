// An event's matches: set a time and court, record a result game by game (checked live by the scoring engine, the same check the
// server makes), then confirm it. A confirmed result cannot be changed; only then does the winner move on in the draw.
import { useMemo, useState } from 'react';
import type { CompetitionEventDetail, CompetitionMatchDto, ResultStatus } from '../../../lib/admin/competition/types';
import { maxGames, type Ruleset } from '../../../lib/competition/scoring';
import type { Side } from '../../../lib/competition/types';
import { gamesText, statusText } from '../../../components/competition/helpers';
import { Badge, Button, Confirm, Empty, Field, cardCls, inputCls, useAdmin } from '../../ui';
import {
  compHash,
  confirmResultNotice,
  draftFromMatch,
  emptyResultDraft,
  liveResultCheck,
  matchSides,
  outcomeSentence,
  RESULT_STATUS_HELP,
  RESULT_STATUS_LABEL,
  whenText,
  type ResultDraft,
} from './logic';
import { ErrorText, Input, useAction } from './shared';
import { istInstant, splitIst } from '../../../lib/dates';

const RESULT_STATUSES: readonly ResultStatus[] = ['completed', 'walkover', 'retired', 'abandoned'];
const EDITABLE = new Set(['scheduled', 'ready', 'postponed']);
const HAS_RESULT = new Set(['completed', 'walkover', 'retired', 'abandoned']);

export function ResultsTab({ detail }: { detail: CompetitionEventDetail }) {
  const [waitingOnly, setWaitingOnly] = useState(false);
  const list = detail.matches.filter((m) => !waitingOnly || !m.confirmed);
  if (detail.matches.length === 0) {
    return (
      <Empty>
        No matches yet. They are made when you publish the draw. <a href={compHash({ view: 'event', eventId: detail.event.id, tab: 'draw' })}>Go to the draw</a>.
      </Empty>
    );
  }
  return (
    <div className="flex flex-col gap-3">
      <label className="flex min-h-tap items-center gap-2">
        <input type="checkbox" className="h-5 w-5" checked={waitingOnly} onChange={(e) => setWaitingOnly(e.target.checked)} />
        Only matches without a confirmed result
      </label>
      <p className="text-small text-fg-muted">
        Set times for many matches at once under <a href={compHash({ view: 'tournament', tournamentId: detail.tournament.id })}>Courts and schedule</a>.
      </p>
      {list.length === 0 ? <Empty>Every result is confirmed.</Empty> : list.map((m) => <MatchCard key={m.id} m={m} detail={detail} />)}
    </div>
  );
}

function MatchCard({ m, detail }: { m: CompetitionMatchDto; detail: CompetitionEventDetail }) {
  const { client, actor, notify, bump } = useAdmin();
  const [open, setOpen] = useState<'result' | 'time' | 'confirm' | null>(null);
  const act = useAction();
  const sides = matchSides(m, detail.entries);
  const bothKnown = m.sideA !== null && m.sideB !== null;
  const canRecord = !m.confirmed && bothKnown && m.status !== 'cancelled';
  const canConfirm = !m.confirmed && HAS_RESULT.has(m.status);
  const score = gamesText(m.games);
  const confirm = async () => {
    const r = await act.run(() => client.competitionConfirmResult(actor, { matchId: m.id, expectedRevision: m.revision, reason: 'Result confirmed by owner' }));
    setOpen(null);
    if (!r) return;
    notify(confirmResultNotice(r));
    bump();
  };
  return (
    <article aria-label={`Match ${m.label}`} className={cardCls}>
      <p className="font-bold">{m.label}</p>
      <p className="mt-1 break-words">{sides.a}</p>
      <p className="text-small text-fg-muted">versus</p>
      <p className="break-words">{sides.b}</p>
      <p className="mt-2 flex flex-wrap gap-2">
        <Badge>{statusText(m.status)}</Badge>
        {HAS_RESULT.has(m.status) ? <Badge tone={m.confirmed ? 'good' : 'warn'}>{m.confirmed ? 'Result confirmed' : 'Result not confirmed yet'}</Badge> : null}
      </p>
      <p className="mt-1 text-small">{whenText(m.scheduledAt)}{m.courtLabel ? ` · ${m.courtLabel}` : ' · No court'}</p>
      {score ? <p className="mt-1">Score: {score}{m.winnerSide ? ` · winner: ${m.winnerSide === 'A' ? sides.a : sides.b}` : ''}</p> : m.status === 'walkover' && m.winnerSide ? <p className="mt-1">Walkover to {m.winnerSide === 'A' ? sides.a : sides.b}</p> : null}
      <div className="mt-3 flex flex-wrap gap-2">
        {canRecord ? <Button small variant={canConfirm ? 'quiet' : 'primary'} onClick={() => setOpen(open === 'result' ? null : 'result')}>{open === 'result' ? 'Close the result form' : HAS_RESULT.has(m.status) ? 'Change the result' : 'Record result'}</Button> : null}
        {canConfirm ? <Button small variant="primary" onClick={() => setOpen('confirm')}>Confirm result</Button> : null}
        {!m.confirmed && EDITABLE.has(m.status) ? <Button small onClick={() => setOpen(open === 'time' ? null : 'time')}>{open === 'time' ? 'Close time and court' : 'Time and court'}</Button> : null}
      </div>
      {!bothKnown && !m.confirmed ? <p className="mt-2 text-small text-fg-muted">The players are not known yet: they come from earlier results once those are confirmed.</p> : null}
      <ErrorText text={act.error} />
      {open === 'confirm' ? (
        <Confirm
          title={`Confirm the result of ${m.label}?`}
          body={<><strong>A confirmed result cannot be changed.</strong> The winner moves on in the draw and the result counts for rankings.{score ? ` Score: ${score}.` : ''}</>}
          confirmLabel="Confirm result"
          busy={act.busy}
          onConfirm={() => void confirm()}
          onCancel={() => setOpen(null)}
        />
      ) : null}
      {open === 'result' ? <ResultForm m={m} ruleset={detail.event.ruleset} sides={sides} onDone={() => setOpen(null)} /> : null}
      {open === 'time' ? <TimeForm m={m} detail={detail} onDone={() => setOpen(null)} /> : null}
    </article>
  );
}

function ResultForm({ m, ruleset, sides, onDone }: { m: CompetitionMatchDto; ruleset: Ruleset; sides: { a: string; b: string }; onDone: () => void }) {
  const { client, actor, notify, bump } = useAdmin();
  const most = maxGames(ruleset);
  // Starts from the saved result (games, ending, walkover winner, retiring side), or an empty form when there is none.
  const [d, setD] = useState<ResultDraft>(() => draftFromMatch(m, Math.min(ruleset.gamesToWin, most)));
  const [touched, setTouched] = useState(HAS_RESULT.has(m.status));
  const act = useAction();
  const check = useMemo(() => liveResultCheck(d, ruleset), [d, ruleset]);
  const p = `res-${m.id}`;
  const update = (next: ResultDraft) => {
    setD(next);
    setTouched(true);
  };
  const setGame = (i: number, side: 'a' | 'b', v: string) => update({ ...d, games: d.games.map((g, j) => (j === i ? { ...g, [side]: v } : g)) });
  const save = async () => {
    setTouched(true);
    if (!check.ok || !check.record) return act.fail('The result does not add up yet. See the notes above the button.');
    const rec = check.record;
    const r = await act.run(() => client.competitionRecordResult(actor, { matchId: m.id, expectedRevision: m.revision, ...rec, reason: 'Result recorded by owner' }));
    if (!r) return;
    notify('Result saved. Check it, then press "Confirm result".');
    bump();
    onDone();
  };
  const sideRadio = (name: string, legend: string, value: Side | null, onPick: (s: Side) => void) => (
    <fieldset>
      <legend className="font-semibold">{legend}</legend>
      {(['A', 'B'] as const).map((s) => (
        <label key={s} className="flex min-h-tap items-center gap-2">
          <input type="radio" name={`${p}-${name}`} className="h-5 w-5" checked={value === s} onChange={() => onPick(s)} />
          <span className="break-words">{s === 'A' ? sides.a : sides.b}</span>
        </label>
      ))}
    </fieldset>
  );
  return (
    <form aria-label={`Result of ${m.label}`} className="mt-3 flex flex-col gap-3 border-t border-line pt-3" onSubmit={(e) => { e.preventDefault(); void save(); }}>
      <fieldset>
        <legend className="text-small font-bold uppercase tracking-wider text-fg">How did it end?</legend>
        {RESULT_STATUSES.map((s) => (
          <label key={s} className="flex min-h-tap items-start gap-2 py-1">
            <input type="radio" name={`${p}-status`} className="mt-1 h-5 w-5" checked={d.status === s} onChange={() => update({ ...d, status: s, walkoverWinner: null, retiringSide: null, games: s === 'walkover' ? [] : d.games.length === 0 ? emptyResultDraft(1).games : d.games })} />
            <span><span className="font-semibold">{RESULT_STATUS_LABEL[s]}</span><span className="block text-small text-fg-muted">{RESULT_STATUS_HELP[s]}</span></span>
          </label>
        ))}
      </fieldset>
      {d.status === 'walkover' ? sideRadio('wo', 'Who goes through?', d.walkoverWinner, (s) => update({ ...d, walkoverWinner: s })) : null}
      {d.status === 'retired' ? sideRadio('ret', 'Who stopped playing?', d.retiringSide, (s) => update({ ...d, retiringSide: s })) : null}
      {d.status !== 'walkover' ? (
        <>
          {d.games.map((g, i) => (
            <fieldset key={i} className="grid grid-cols-2 gap-3">
              <legend className="col-span-2 font-semibold">{`Game ${i + 1}`}</legend>
              <Field label={`${sides.a}: points`} htmlFor={`${p}-g${i}-a`}>
                <Input id={`${p}-g${i}-a`} value={g.a} inputMode="numeric" maxLength={2} onChange={(v) => setGame(i, 'a', v)} />
              </Field>
              <Field label={`${sides.b}: points`} htmlFor={`${p}-g${i}-b`}>
                <Input id={`${p}-g${i}-b`} value={g.b} inputMode="numeric" maxLength={2} onChange={(v) => setGame(i, 'b', v)} />
              </Field>
            </fieldset>
          ))}
          <div className="flex flex-wrap gap-2">
            {d.games.length < most ? <Button small onClick={() => update({ ...d, games: [...d.games, { a: '', b: '' }] })}>Add a game</Button> : null}
            {d.games.length > 0 ? <Button small onClick={() => update({ ...d, games: d.games.slice(0, -1) })}>Remove the last game</Button> : null}
          </div>
        </>
      ) : null}
      <div id={`${p}-check`} aria-live="polite" className="rounded-md border-2 border-line-strong p-3 text-small">
        {!touched ? <p>Type the scores; they are checked against the rules of this event as you type.</p> : check.ok ? (
          <p className="font-semibold">Looks right. {outcomeSentence(check, sides, d.status)}</p>
        ) : (
          <ul className="list-disc pl-5 font-semibold text-ps-live">
            {check.messages.map((t) => <li key={t}>{t}</li>)}
          </ul>
        )}
      </div>
      <ErrorText text={act.error} />
      <div><Button type="submit" variant="primary" busy={act.busy}>Save the result</Button></div>
    </form>
  );
}

function TimeForm({ m, detail, onDone }: { m: CompetitionMatchDto; detail: CompetitionEventDetail; onDone: () => void }) {
  const { client, actor, notify, bump } = useAdmin();
  const start = splitIst(m.scheduledAt);
  const [date, setDate] = useState(start.date);
  const [time, setTime] = useState(start.time);
  const [court, setCourt] = useState(m.courtId ?? '');
  const act = useAction();
  const p = `time-${m.id}`;
  const save = async () => {
    let at: string | null = null;
    if (date.trim() !== '' || time.trim() !== '') {
      at = istInstant(date.trim(), time.trim());
      if (!at) return act.fail('Check the date and time.', { scheduledAt: 'Type the date like 2026-11-14 and the time like 09:30 (24-hour clock), or leave both empty.' });
    }
    const r = await act.run(() =>
      client.competitionSaveMatch(actor, {
        id: m.id,
        expectedRevision: m.revision,
        eventId: detail.event.id,
        roundCode: m.roundCode,
        matchNumber: m.matchNumber,
        groupLabel: m.groupLabel,
        sideA: m.sideA,
        sideB: m.sideB,
        scheduledAt: at,
        courtId: court === '' ? null : court,
        reason: 'Match time and court set by owner',
      }),
    );
    if (!r) return;
    notify('Time and court saved.');
    bump();
    onDone();
  };
  return (
    <form aria-label={`Time and court of ${m.label}`} className="mt-3 flex flex-col gap-3 border-t border-line pt-3" onSubmit={(e) => { e.preventDefault(); void save(); }}>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <Field label="Day" htmlFor={`${p}-date`} hint="For example 2026-11-14.">
          <Input id={`${p}-date`} value={date} placeholder="YYYY-MM-DD" maxLength={10} onChange={setDate} error={act.fields['scheduledAt']} />
        </Field>
        <Field label="Start time (India time)" htmlFor={`${p}-time`} hint="24-hour clock, for example 09:30 or 14:00.">
          <Input id={`${p}-time`} value={time} placeholder="HH:MM" maxLength={5} onChange={setTime} error={act.fields['scheduledAt']} errorId={`${p}-date-error`} />
        </Field>
      </div>
      <ErrorText id={`${p}-date-error`} text={act.fields['scheduledAt']} />
      <Field label="Court" htmlFor={`${p}-court`}>
        <select id={`${p}-court`} className={inputCls} value={court} onChange={(e) => setCourt(e.target.value)}>
          <option value="">No court yet</option>
          {detail.courts.map((c) => <option key={c.id} value={c.id}>{c.label}</option>)}
        </select>
      </Field>
      <ErrorText text={act.error} />
      <div><Button type="submit" variant="primary" busy={act.busy}>Save time and court</Button></div>
    </form>
  );
}
