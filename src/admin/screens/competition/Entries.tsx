// An event's entries: add a player (or a pair) from the players list, confirm, seed, move to the waiting list, reject or withdraw.
// The owner sees every name here, protected players included; the badge says who is shown as "Protected player" on the site.
// An organizer (D-117/D-122, 0024) finds players with their own search (id and name only; a protected player only by the full name or
// once entered in this tournament) and may add a NEW provisional player of unknown age when no found name is exactly the typed one; they
// never edit an existing player. The "On the site" badge shows on the entry card once the player is entered.
import { useEffect, useState } from 'react';
import type { AgeStatus } from '../../../lib/archive/types';
import type { CompetitionEntryDto, CompetitionEventDetail } from '../../../lib/admin/competition/types';
import { normalizeName } from '../../../lib/parser/normalize';
import { newPlayerNameProblem, ORGANIZER_PLAYER_LIMITS } from '../../../lib/admin/competition/validate';
import { okResult } from '../../../lib/admin/types';
import { AgeBadge, Badge, Button, Confirm, Empty, Field, cardCls, inputCls, useAdmin, useAsync } from '../../ui';
import { COMP_LIMITS, ENTRY_STATUS_LABEL, ownerEntryName, parseInRange, playersNeeded, publicEntryName, reasonProblem } from './logic';
import { ErrorText, H2, Input, Note, ReasonField, useAction, useCompetitionCaps, byRole } from './shared';

const OPEN = new Set(['pending', 'confirmed', 'waitlisted']);
const SEED_ERROR = `A seed is a whole number from ${COMP_LIMITS.seed.min} to ${COMP_LIMITS.seed.max}, or empty for no seed.`;

export function EntriesTab({ detail }: { detail: CompetitionEventDetail }) {
  const live = detail.entries.filter((e) => OPEN.has(e.status));
  const gone = detail.entries.filter((e) => !OPEN.has(e.status));
  const confirmed = live.filter((e) => e.status === 'confirmed').length;
  const published = detail.draw !== null && detail.draw.status !== 'draft';
  return (
    <div className="flex flex-col gap-4">
      <p className="ps-num text-fg-muted">
        {confirmed} confirmed, {live.length - confirmed} waiting. Only confirmed entries go into the draw.
        {detail.draw?.status === 'draft' ? ' A draft draw is removed when you confirm, reject or withdraw an entry or change a seed: make it again afterwards.' : ''}
      </p>
      {published ? <Note tone="warn">The draw is published. A new entry cannot join it; a withdrawn player stays in the draw and their next match is recorded as a walkover.</Note> : <AddEntry detail={detail} />}
      <section aria-labelledby="entries-h" className="flex flex-col gap-3">
        <H2 id="entries-h">Entries ({live.length})</H2>
        {live.length === 0 ? <Empty>No entries yet.</Empty> : live.map((e) => <EntryCard key={e.id} e={e} detail={detail} />)}
      </section>
      {gone.length > 0 ? (
        <details className="ps-admin-row px-3 py-1">
          <summary className="min-h-tap cursor-pointer py-2 font-semibold">Withdrawn and rejected ({gone.length})</summary>
          <ul className="mb-2 mt-1 flex flex-col gap-1 text-small text-fg-muted">
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
    const r = await act.run(() => client.competitionSetEntry(actor, { entryId: e.id, status, seed: status === 'rejected' ? null : seedValue, reason: `Entry set to ${status} ${byRole(actor.role)}` }));
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
      <ul className="flex flex-col gap-1.5">
        {e.players.map((p) => (
          <li key={p.id} className="flex flex-wrap items-center gap-x-2 gap-y-1">
            <span className="break-words text-body font-bold text-heading">{p.displayName}</span>
            <AgeBadge status={p.ageStatus} />
          </li>
        ))}
      </ul>
      <p className="mt-3 flex flex-wrap gap-1.5">
        <Badge tone={e.status === 'confirmed' ? 'good' : 'neutral'}>{ENTRY_STATUS_LABEL[e.status]}</Badge>
        {e.seed !== null ? <Badge>{`Seed ${e.seed}`}</Badge> : null}
        {e.isProtected ? <Badge tone="warn">On the site: Protected player</Badge> : null}
      </p>
      {e.isProtected ? <p className="mt-1 text-small text-fg-muted">The website will show &quot;{publicEntryName(e)}&quot; for this entry{detail.event.isJunior ? ' (junior event)' : ''}.</p> : null}
      <div className="mt-4 flex flex-wrap items-end gap-2 border-t border-line pt-4">
        <div className="w-28">
          <Field label="Seed" htmlFor={seedId}>
            <Input id={seedId} value={seed} inputMode="numeric" maxLength={3} onChange={setSeed} error={act.fields['seed']} />
          </Field>
        </div>
        <Button small onClick={() => void saveSeed()} busy={act.busy} className="min-h-[3rem]">Save seed</Button>
      </div>
      <p className="ps-num mt-1 text-small text-fg-muted">{`${COMP_LIMITS.seed.min} to ${COMP_LIMITS.seed.max}`}</p>
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

/** A player the Add an entry form can choose: from the owner's Players search (with the age status) or the organizer's search (0024). */
export interface EntryChoice {
  id: string;
  displayName: string;
  /** The owner's search only. */
  ageStatus?: AgeStatus;
  /** Known only for a player the organizer just added (always false: a new player starts protected). The organizer search sends no
   * naming flag (D-012); the entry card shows it once the player is entered. */
  named?: boolean;
}

/** What the website will show for a chosen player: the owner sees the age status; for an organizer only a new player's is known. */
export function ChoiceBadge({ p }: { p: EntryChoice }) {
  if (p.ageStatus) return <AgeBadge status={p.ageStatus} />;
  if (p.named === undefined) return null;
  return <Badge tone={p.named ? 'good' : 'warn'}>{p.named ? 'On the site: named' : 'On the site: Protected player'}</Badge>;
}

/** The found players with a Choose button each (split out so it renders without effects). */
export function FoundPlayers({ items, taken, onChoose }: { items: readonly EntryChoice[]; taken: (id: string) => boolean; onChoose: (p: EntryChoice) => void }) {
  return (
    <ul aria-label="Players found" className="ps-admin-list">
      {items.map((p) => {
        const isTaken = taken(p.id);
        return (
          <li key={p.id}>
            <span className="flex min-w-0 flex-col items-start gap-1">
              <span className="break-words font-semibold text-heading">{p.displayName}</span>
              <ChoiceBadge p={p} />
            </span>
            {isTaken ? (
              <Badge>Already entered</Badge>
            ) : (
              <Button small onClick={() => onChoose(p)} className="shrink-0">
                Choose<span className="sr-only">{` ${p.displayName}`}</span>
              </Button>
            )}
          </li>
        );
      })}
    </ul>
  );
}

/** How many players one search page shows. */
export const SEARCH_PAGE = 8;

/** One search answer, tied to the query and page it answered (a slower old answer is never read as the new one). */
export interface SearchAnswer {
  query: string;
  offset: number;
  items: EntryChoice[];
  hasMore: boolean;
}

/**
 * Offer "add as a new player" when no found player has exactly the typed name (matching copies compared), so "Ravi" can be added while
 * "Ravi Shankar" exists. The server still refuses an exact duplicate.
 */
export function offerNewPlayer(typed: string, items: readonly EntryChoice[]): boolean {
  const t = normalizeName(typed);
  if (t === null || t.length < ORGANIZER_PLAYER_LIMITS.queryMin) return false;
  return !items.some((p) => normalizeName(p.displayName) === t);
}

/** The text when more players match than one page shows. */
export const MORE_PLAYERS_NOTE = 'More players match. Type more of the name to narrow the list, or show the next ones.';

/**
 * What the search found for the typed text (split out so it renders without effects in tests). Shows nothing about "no match" while a
 * search is still running or when the answer is for an older query.
 */
export function SearchOutcome(props: {
  typed: string;
  answer: SearchAnswer | null;
  loading: boolean;
  canCreate: boolean;
  tournamentId: string;
  taken: (id: string) => boolean;
  onChoose: (p: EntryChoice) => void;
  onAdded: (p: EntryChoice) => void;
  onPage: (offset: number) => void;
}) {
  const { answer, typed } = props;
  const current = answer !== null && !props.loading && answer.query === typed;
  if (!current) return props.loading && typed !== '' ? <p className="text-small text-fg-muted" role="status">Searching...</p> : null;
  const items = answer.items;
  return (
    <>
      <FoundPlayers items={items} taken={props.taken} onChoose={props.onChoose} />
      {answer.hasMore || answer.offset > 0 ? (
        <div className="flex flex-col gap-2">
          {answer.hasMore ? <p className="text-small text-fg-muted">{MORE_PLAYERS_NOTE}</p> : null}
          <div className="flex flex-wrap gap-2">
            {answer.offset > 0 ? <Button small onClick={() => props.onPage(Math.max(0, answer.offset - SEARCH_PAGE))}>Previous players</Button> : null}
            {answer.hasMore ? <Button small onClick={() => props.onPage(answer.offset + SEARCH_PAGE)}>More players</Button> : null}
          </div>
        </div>
      ) : null}
      {props.canCreate ? (
        offerNewPlayer(typed, items) ? <NewPlayer tournamentId={props.tournamentId} typed={typed} onAdded={props.onAdded} /> : null
      ) : items.length === 0 && answer.offset === 0 ? (
        <p className="text-fg-muted">No player has that name. Players come from your videos and the Players screen.</p>
      ) : null}
    </>
  );
}

const NO_SEARCH = Promise.resolve(okResult(null));

function AddEntry({ detail }: { detail: CompetitionEventDetail }) {
  const { client, actor, notify, bump } = useAdmin();
  const caps = useCompetitionCaps();
  const need = playersNeeded(detail.event.category);
  const [query, setQuery] = useState('');
  const [offset, setOffset] = useState(0);
  const [picked, setPicked] = useState<EntryChoice[]>([]);
  const [seed, setSeed] = useState('');
  const [status, setStatus] = useState<'confirmed' | 'pending' | 'waitlisted'>('confirmed');
  const act = useAction();
  const q = query.trim();
  // the owner keeps the full Players search; an organizer gets the scoped one of 0024 (id, name and named-or-protected only), and it
  // asks only once 3 letters are typed (the server refuses fewer)
  const scoped = caps.playerSearch === 'tournament';
  const tooShort = scoped && q.length < ORGANIZER_PLAYER_LIMITS.queryMin;
  // a new text starts again at the first page
  useEffect(() => setOffset(0), [q]);
  const search = useAsync<SearchAnswer | null>(async () => {
    if (caps.playerSearch === 'owner') {
      const r = await client.searchPlayers({ query: q, limit: SEARCH_PAGE, offset });
      return r.ok ? okResult({ query: q, offset, items: r.data.items, hasMore: r.data.total > offset + r.data.items.length }) : r;
    }
    if (scoped && !tooShort) {
      const r = await client.competitionSearchPlayers(actor, { tournamentId: detail.tournament.id, q, limit: SEARCH_PAGE, offset });
      return r.ok ? okResult({ query: q, offset, items: r.data.items, hasMore: r.data.hasMore }) : r;
    }
    return NO_SEARCH;
  }, [q, offset, caps.playerSearch]);
  const entered = new Set(detail.entries.filter((e) => OPEN.has(e.status)).flatMap((e) => e.players.map((p) => p.id)));
  const full = picked.length >= need;

  const add = async () => {
    if (picked.length !== need) return act.fail(need === 1 ? 'Choose one player.' : 'Choose two players for the pair.', { players: need === 1 ? 'Choose one player.' : 'Choose two players.' });
    const n = parseInRange(seed, COMP_LIMITS.seed);
    if (n !== null && Number.isNaN(n)) return act.fail('Check the seed.', { seed: SEED_ERROR });
    const r = await act.run(() => client.competitionAddEntry(actor, { eventId: detail.event.id, players: picked.map((p) => p.id), seed: n, status, reason: `Entry added ${byRole(actor.role)}` }));
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
      <p className="text-small text-fg-muted">
        {need === 1 ? 'Singles: choose one player.' : 'Doubles: choose two players.'}{' '}
        {caps.playerSearch === 'owner'
          ? "The club used to keep players apart in the draw is the academy on the player's profile (Players screen)."
          : "The club used to keep players apart in the draw is the academy the owner keeps on each player's profile."}
      </p>
      {picked.length > 0 ? (
        <ul aria-label="Chosen players" className="ps-admin-list">
          {picked.map((p) => (
            <li key={p.id}>
              <span className="flex min-w-0 flex-col items-start gap-1">
                <span className="break-words font-bold text-heading">{p.displayName}</span>
                <ChoiceBadge p={p} />
              </span>
              <Button small onClick={() => setPicked((x) => x.filter((y) => y.id !== p.id))} className="shrink-0">
                Remove<span className="sr-only">{` ${p.displayName}`}</span>
              </Button>
            </li>
          ))}
        </ul>
      ) : null}
      {!full ? (
        <>
          <Field label="Find a player" htmlFor="entry-find" hint={scoped ? `Type at least ${ORGANIZER_PLAYER_LIMITS.queryMin} letters of the name.` : 'Type part of the name.'}>
            <Input id="entry-find" value={query} onChange={setQuery} maxLength={80} error={act.fields['players']} />
          </Field>
          {scoped && !tooShort ? <p className="text-small text-fg-muted">A player not yet in this tournament is found by part of the name only when the website already shows them; otherwise type the full name.</p> : null}
          <SearchOutcome
            typed={q}
            answer={search.data}
            loading={search.loading}
            canCreate={caps.createPlayer}
            tournamentId={detail.tournament.id}
            taken={(id) => entered.has(id) || picked.some((x) => x.id === id)}
            onChoose={(p) => setPicked((x) => [...x, p])}
            onAdded={(p) => { setPicked((x) => [...x, p]); setQuery(''); }}
            onPage={setOffset}
          />
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

/** The new-player sentence, shared by the form and the tests. */
export const NEW_PLAYER_NOTE = 'Not in the list? You can add them as a new player: they start with an unknown age and are shown on the website as "Protected player" until the owner confirms they are an adult. You cannot change an existing player.';

/**
 * An organizer adds a NEW player when the search finds nobody (0024): provisional, hidden, unknown age. Never an edit of an existing
 * player, never an age. Exported so it renders without effects in tests.
 */
export function NewPlayer({ tournamentId, typed, onAdded }: { tournamentId: string; typed: string; onAdded: (p: EntryChoice) => void }) {
  const { client, actor, notify } = useAdmin();
  const act = useAction();
  const [name, setName] = useState(typed);
  useEffect(() => setName(typed), [typed]);
  const [asking, setAsking] = useState(false);
  const ask = () => {
    const problem = newPlayerNameProblem(name);
    if (problem) return act.fail(problem, { name: problem });
    act.clear();
    setAsking(true);
  };
  const create = async () => {
    const r = await act.run(() => client.competitionCreatePlayer(actor, { tournamentId, name: name.trim(), reason: `New player added for an entry ${byRole(actor.role)}` }));
    setAsking(false);
    if (!r) return;
    notify(`${r.displayName} added as a new player.`);
    onAdded({ id: r.id, displayName: r.displayName, named: false });
  };
  return (
    <div className="ps-admin-row flex flex-col gap-2 p-3">
      <p className="text-small text-fg-muted">{NEW_PLAYER_NOTE}</p>
      <Field label="New player's full name" htmlFor="new-player-name">
        <Input id="new-player-name" value={name} maxLength={ORGANIZER_PLAYER_LIMITS.nameMax} onChange={setName} error={act.fields['name']} />
      </Field>
      <ErrorText id="new-player-name-error" text={act.fields['name']} />
      <ErrorText text={act.error && !act.fields['name'] ? act.error : null} />
      <div><Button small onClick={ask} busy={act.busy}>Add as a new player</Button></div>
      {asking ? (
        <Confirm
          title={`Add ${name.trim()} as a new player?`}
          body="Check the spelling first: a new player cannot be renamed or removed by you. They start with an unknown age and stay hidden from the website until the owner checks them."
          confirmLabel="Add the player"
          busy={act.busy}
          onConfirm={() => void create()}
          onCancel={() => setAsking(false)}
        />
      ) : null}
    </div>
  );
}
