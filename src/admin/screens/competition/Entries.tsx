// An event's entries: add a player (or a pair) from the players list, confirm, seed, move to the waiting list, reject or withdraw.
// The owner sees every name here, protected players included; the badge says who is shown as "Protected player" on the site.
import { useEffect, useState } from 'react';
import type { CompetitionEntryDto, CompetitionEventDetail } from '../../../lib/admin/competition/types';
import type { PlayerSummary } from '../../../lib/admin/types';
import { AgeBadge, Badge, Button, Confirm, Empty, Field, cardCls, inputCls, useAdmin, useAsync } from '../../ui';
import { COMP_LIMITS, ENTRY_STATUS_LABEL, ownerEntryName, parseInRange, playersNeeded, publicEntryName, reasonProblem } from './logic';
import { ErrorText, H2, Input, Note, ReasonField, useAction } from './shared';

const OPEN = new Set(['pending', 'confirmed', 'waitlisted']);
const SEED_ERROR = `A seed is a whole number from ${COMP_LIMITS.seed.min} to ${COMP_LIMITS.seed.max}, or empty for no seed.`;

export function EntriesTab({ detail }: { detail: CompetitionEventDetail }) {
  const live = detail.entries.filter((e) => OPEN.has(e.status));
  const gone = detail.entries.filter((e) => !OPEN.has(e.status));
  const confirmed = live.filter((e) => e.status === 'confirmed').length;
  const published = detail.draw !== null && detail.draw.status !== 'draft';
  return (
    <div className="flex flex-col gap-4">
      <p className="text-fg-muted">
        {confirmed} confirmed, {live.length - confirmed} waiting. Only confirmed entries go into the draw.
        {detail.draw?.status === 'draft' ? ' A draft draw is removed when you confirm, reject or withdraw an entry or change a seed: make it again afterwards.' : ''}
      </p>
      {published ? <Note tone="warn">The draw is published. A new entry cannot join it; a withdrawn player stays in the draw and their next match is recorded as a walkover.</Note> : <AddEntry detail={detail} />}
      <section aria-labelledby="entries-h" className="flex flex-col gap-3">
        <H2 id="entries-h">Entries ({live.length})</H2>
        {live.length === 0 ? <Empty>No entries yet.</Empty> : live.map((e) => <EntryCard key={e.id} e={e} detail={detail} />)}
      </section>
      {gone.length > 0 ? (
        <details className="rounded-lg border border-line p-3">
          <summary className="min-h-tap cursor-pointer py-2 font-semibold">Withdrawn and rejected ({gone.length})</summary>
          <ul className="mt-2 flex flex-col gap-1">
            {gone.map((e) => <li key={e.id}>{ownerEntryName(e)} · {ENTRY_STATUS_LABEL[e.status]}</li>)}
          </ul>
        </details>
      ) : null}
    </div>
  );
}

function EntryCard({ e, detail }: { e: CompetitionEntryDto; detail: CompetitionEventDetail }) {
  const { client, actor, notify, bump } = useAdmin();
  const act = useAction();
  const [seed, setSeed] = useState(e.seed === null ? '' : String(e.seed));
  // Follow the saved seed after a reload (the card is keyed by entry id, so it is not made again when only the seed changes).
  useEffect(() => setSeed(e.seed === null ? '' : String(e.seed)), [e.seed]);
  const [asking, setAsking] = useState<'reject' | 'withdraw' | null>(null);
  const [reason, setReason] = useState('');
  const [reasonError, setReasonError] = useState<string | null>(null);
  const name = ownerEntryName(e);
  const seedId = `seed-${e.id}`;
  const after = (draftDrawCleared: boolean, text: string) => {
    notify(draftDrawCleared ? `${text} The draft draw was removed because the entries changed: make the draw again.` : text);
    bump();
  };
  const setStatus = async (status: 'pending' | 'confirmed' | 'waitlisted' | 'rejected', seedValue: number | null, text: string) => {
    const r = await act.run(() => client.competitionSetEntry(actor, { entryId: e.id, status, seed: status === 'rejected' ? null : seedValue, reason: `Entry set to ${status} by owner` }));
    setAsking(null);
    if (r) after(r.draftDrawCleared, text);
  };
  const saveSeed = async () => {
    const n = parseInRange(seed, COMP_LIMITS.seed);
    if (n !== null && Number.isNaN(n)) return act.fail('Check the seed.', { seed: SEED_ERROR });
    await setStatus(e.status as 'pending' | 'confirmed' | 'waitlisted', n, n === null ? 'Seed removed.' : `Seed ${n} saved.`);
  };
  const withdraw = async () => {
    const p = reasonProblem(reason);
    setReasonError(p);
    if (p) return;
    const r = await act.run(() => client.competitionWithdrawEntry(actor, { entryId: e.id, reason: reason.trim() }));
    setAsking(null);
    if (!r) return;
    notify(r.inPublishedDraw ? 'Withdrawn. They stay in the published draw: record a walkover for their next match.' : 'Withdrawn.');
    bump();
  };
  return (
    <article aria-label={`Entry ${name}`} className={cardCls}>
      <ul className="flex flex-col gap-1">
        {e.players.map((p) => (
          <li key={p.id} className="flex flex-wrap items-center gap-2">
            <span className="break-words font-bold">{p.displayName}</span>
            <AgeBadge status={p.ageStatus} />
          </li>
        ))}
      </ul>
      <p className="mt-2 flex flex-wrap gap-2">
        <Badge tone={e.status === 'confirmed' ? 'good' : 'neutral'}>{ENTRY_STATUS_LABEL[e.status]}</Badge>
        {e.seed !== null ? <Badge>{`Seed ${e.seed}`}</Badge> : null}
        {e.isProtected ? <Badge tone="warn">On the site: Protected player</Badge> : null}
      </p>
      {e.isProtected ? <p className="mt-1 text-small text-fg-muted">The website will show &quot;{publicEntryName(e)}&quot; for this entry{detail.event.isJunior ? ' (junior event)' : ''}.</p> : null}
      <div className="mt-3 flex flex-wrap items-end gap-2">
        <div className="w-28">
          <Field label="Seed" htmlFor={seedId} hint={`${COMP_LIMITS.seed.min} to ${COMP_LIMITS.seed.max}`}>
            <Input id={seedId} value={seed} inputMode="numeric" maxLength={3} onChange={setSeed} error={act.fields['seed']} />
          </Field>
        </div>
        <Button small onClick={() => void saveSeed()} busy={act.busy}>Save seed</Button>
      </div>
      <ErrorText id={`${seedId}-error`} text={act.fields['seed']} />
      <div className="mt-3 flex flex-wrap gap-2">
        {e.status !== 'confirmed' ? <Button small variant="primary" onClick={() => void setStatus('confirmed', e.seed, 'Entry confirmed.')} busy={act.busy}>Confirm entry</Button> : null}
        {e.status !== 'waitlisted' ? <Button small onClick={() => void setStatus('waitlisted', e.seed, 'Moved to the waiting list.')} busy={act.busy}>Move to waiting list</Button> : null}
        {e.status === 'pending' ? <Button small onClick={() => setAsking('reject')}>Reject</Button> : null}
        <Button small onClick={() => { setReason(''); setReasonError(null); setAsking('withdraw'); }}>Withdraw</Button>
      </div>
      <ErrorText text={act.error} />
      {asking === 'reject' ? (
        <Confirm title={`Reject ${name}?`} body="The entry is taken off this event. It can be added again later." confirmLabel="Reject" danger busy={act.busy} onConfirm={() => void setStatus('rejected', null, 'Entry rejected.')} onCancel={() => setAsking(null)} />
      ) : null}
      {asking === 'withdraw' ? (
        <Confirm
          title={`Withdraw ${name}?`}
          body={detail.draw && detail.draw.status !== 'draft' ? 'The draw is published, so they stay in it: their next match becomes a walkover for the other side.' : 'They leave this event and free a place.'}
          confirmLabel="Withdraw"
          danger
          busy={act.busy}
          onConfirm={() => void withdraw()}
          onCancel={() => setAsking(null)}
        >
          <div className="mt-3">
            <ReasonField id={`withdraw-reason-${e.id}`} value={reason} onChange={setReason} error={reasonError} label="Why are they withdrawing?" />
          </div>
        </Confirm>
      ) : null}
    </article>
  );
}

function AddEntry({ detail }: { detail: CompetitionEventDetail }) {
  const { client, actor, notify, bump } = useAdmin();
  const need = playersNeeded(detail.event.category);
  const [query, setQuery] = useState('');
  const [picked, setPicked] = useState<PlayerSummary[]>([]);
  const [seed, setSeed] = useState('');
  const [status, setStatus] = useState<'confirmed' | 'pending' | 'waitlisted'>('confirmed');
  const act = useAction();
  const search = useAsync(() => client.searchPlayers({ query: query.trim(), limit: 8, offset: 0 }), [query]);
  const entered = new Set(detail.entries.filter((e) => OPEN.has(e.status)).flatMap((e) => e.players.map((p) => p.id)));
  const full = picked.length >= need;

  const add = async () => {
    if (picked.length !== need) return act.fail(need === 1 ? 'Choose one player.' : 'Choose two players for the pair.', { players: need === 1 ? 'Choose one player.' : 'Choose two players.' });
    const n = parseInRange(seed, COMP_LIMITS.seed);
    if (n !== null && Number.isNaN(n)) return act.fail('Check the seed.', { seed: SEED_ERROR });
    const r = await act.run(() => client.competitionAddEntry(actor, { eventId: detail.event.id, players: picked.map((p) => p.id), seed: n, status, reason: 'Entry added by owner' }));
    if (!r) return;
    notify('Entry added.');
    setPicked([]);
    setSeed('');
    setQuery('');
    bump();
  };

  return (
    <form aria-label="Add an entry" className={`${cardCls} flex flex-col gap-3`} onSubmit={(ev) => { ev.preventDefault(); void add(); }}>
      <H2>Add an entry</H2>
      <p className="text-small text-fg-muted">{need === 1 ? 'Singles: choose one player.' : 'Doubles: choose two players.'} The club used to keep players apart in the draw is the academy on the player&apos;s profile (Players screen).</p>
      {picked.length > 0 ? (
        <ul aria-label="Chosen players" className="flex flex-col gap-2">
          {picked.map((p) => (
            <li key={p.id} className="flex flex-wrap items-center gap-2">
              <span className="font-bold">{p.displayName}</span>
              <AgeBadge status={p.ageStatus} />
              <Button small onClick={() => setPicked((x) => x.filter((y) => y.id !== p.id))}>{`Remove ${p.displayName}`}</Button>
            </li>
          ))}
        </ul>
      ) : null}
      {!full ? (
        <>
          <Field label="Find a player" htmlFor="entry-find" hint="Type part of the name.">
            <Input id="entry-find" value={query} onChange={setQuery} maxLength={80} error={act.fields['players']} />
          </Field>
          <ul aria-label="Players found" className="flex flex-col gap-2">
            {(search.data?.items ?? []).map((p) => {
              const taken = entered.has(p.id) || picked.some((x) => x.id === p.id);
              return (
                <li key={p.id} className="flex flex-wrap items-center gap-2">
                  <span className="break-words">{p.displayName}</span>
                  <AgeBadge status={p.ageStatus} />
                  <Button small disabled={taken} onClick={() => setPicked((x) => [...x, p])}>{taken ? 'Already entered' : `Choose ${p.displayName}`}</Button>
                </li>
              );
            })}
          </ul>
          {search.data && search.data.items.length === 0 ? <p className="text-fg-muted">No player has that name. Players come from your videos and the Players screen.</p> : null}
        </>
      ) : null}
      <ErrorText id="entry-find-error" text={act.fields['players']} />
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <Field label="Seed (optional)" htmlFor="entry-seed" hint={`1 for the top seed, up to ${COMP_LIMITS.seed.max}. Leave empty for no seed.`}>
          <Input id="entry-seed" value={seed} inputMode="numeric" maxLength={3} onChange={setSeed} error={act.fields['seed']} />
        </Field>
        <Field label="Status" htmlFor="entry-status">
          <select id="entry-status" className={inputCls} value={status} onChange={(e) => setStatus(e.target.value as typeof status)}>
            <option value="confirmed">{ENTRY_STATUS_LABEL.confirmed}</option>
            <option value="pending">{ENTRY_STATUS_LABEL.pending}</option>
            <option value="waitlisted">{ENTRY_STATUS_LABEL.waitlisted}</option>
          </select>
        </Field>
      </div>
      <ErrorText id="entry-seed-error" text={act.fields['seed']} />
      <ErrorText text={act.error} />
      <div><Button type="submit" variant="primary" busy={act.busy}>Add the entry</Button></div>
    </form>
  );
}
