import { useState } from 'react';
import type { DuplicatePairDto, PlayerSummary } from '../../lib/admin/types';
import { AGE_EXPLAIN, AGE_LABEL } from '../messages';
import { AgeBadge, Badge, Button, Confirm, Empty, Field, LoadState, TextInput, cardCls, cx, useAdmin, useAsync, useBusy } from '../ui';

type Tab = 'search' | 'duplicates' | 'requests';
const TAB_LABEL: Record<Tab, string> = { search: 'Find players', duplicates: 'Possible duplicates', requests: 'Player requests' };

export function Players() {
  const [tab, setTab] = useState<Tab>('search');
  return (
    <div className="flex flex-col gap-4">
      <div role="tablist" aria-label="Player tools" className="flex flex-wrap gap-2">
        {(Object.keys(TAB_LABEL) as Tab[]).map((t) => (
          <button
            key={t}
            role="tab"
            aria-selected={tab === t}
            onClick={() => setTab(t)}
            className={cx('min-h-tap rounded-md border-2 px-4 font-bold', tab === t ? 'border-ps-court bg-ps-court text-ps-white' : 'border-line-strong bg-surface text-fg')}
          >
            {TAB_LABEL[t]}
          </button>
        ))}
      </div>
      {tab === 'search' ? <Search /> : tab === 'duplicates' ? <Duplicates /> : <Requests />}
    </div>
  );
}

// ----------------------------------------------------------------------------- search, rename, split, bulk confirm

function Search() {
  const { client, actor, notify, check, bump } = useAdmin();
  const [query, setQuery] = useState('');
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const [asking, setAsking] = useState(false);
  const [evidence, setEvidence] = useState('');
  const [busy, run] = useBusy();
  const list = useAsync(() => client.searchPlayers({ query, limit: 50, offset: 0 }), [query]);

  const toggle = (id: string) =>
    setPicked((s) => {
      const n = new Set(s);
      if (n.has(id)) n.delete(id);
      else n.add(id);
      return n;
    });

  const confirmAdults = async () => {
    const r = await run(() => client.confirmAdultBulk(actor, { playerIds: [...picked], evidence: evidence.trim(), reason: 'Confirmed adult by owner review' }));
    setAsking(false);
    if (r && check(r)) {
      const { confirmed, rejected } = r.data.result;
      notify(`${confirmed.length} confirmed as adult.${rejected.length ? ` ${rejected.length} skipped (already adult, under 18 confirmed, or merged).` : ''}`, r.data.undo);
      setPicked(new Set());
      setEvidence('');
      bump();
    }
  };

  return (
    <div className="flex flex-col gap-3">
      <Field label="Search by name" htmlFor="player-search">
        <TextInput id="player-search" value={query} onChange={setQuery} placeholder="Type part of a name" />
      </Field>
      {picked.size > 0 ? (
        <div className={cardCls}>
          <p className="font-semibold">{picked.size} selected</p>
          <div className="mt-2 flex flex-wrap gap-2">
            <Button variant="primary" onClick={() => setAsking(true)}>Confirm as adult</Button>
            <Button onClick={() => setPicked(new Set())}>Clear</Button>
          </div>
          {asking ? (
            <Confirm title={`Confirm ${picked.size} players as adults?`} body="They get a public profile page once they have enough matches. Only do this when you know they are over 18. Players confirmed under 18 are never changed here." confirmLabel="Confirm as adult" busy={busy} onConfirm={() => { if (evidence.trim().length >= 3) void confirmAdults(); }} onCancel={() => setAsking(false)}>
              <div className="mt-3">
                <Field label="How do you know? (kept in the audit trail)" htmlFor="adult-evidence">
                  <TextInput id="adult-evidence" value={evidence} onChange={setEvidence} placeholder="For example: owner knows the player, age on entry list" />
                </Field>
              </div>
            </Confirm>
          ) : null}
        </div>
      ) : null}
      <LoadState loading={list.loading} error={list.error}>
        {list.data && list.data.items.length > 0 ? (
          <ul className="flex flex-col gap-3">
            {list.data.items.map((p) => (
              <PlayerRowCard key={p.id} p={p} picked={picked.has(p.id)} onToggle={() => toggle(p.id)} />
            ))}
          </ul>
        ) : (
          <Empty>No players found.</Empty>
        )}
      </LoadState>
      {asking && evidence.trim().length < 3 ? <p className="text-small text-fg-muted">Write how you know (at least 3 letters) before confirming.</p> : null}
    </div>
  );
}

function PlayerRowCard({ p, picked, onToggle }: { p: PlayerSummary; picked: boolean; onToggle: () => void }) {
  const [mode, setMode] = useState<'none' | 'rename' | 'split'>('none');
  return (
    <li className={cardCls}>
      <div className="flex items-start gap-3">
        <input type="checkbox" className="mt-1 h-6 w-6" checked={picked} onChange={onToggle} aria-label={`Select ${p.displayName}`} />
        <div className="min-w-0 flex-1">
          <p className="break-words text-body font-bold">{p.displayName}</p>
          <p className="mt-1 flex flex-wrap items-center gap-2">
            <AgeBadge status={p.ageStatus} />
            {p.provisional ? <Badge>Provisional</Badge> : null}
            {p.visibility === 'hidden' ? <Badge>Not on the site</Badge> : <Badge tone="good">On the site</Badge>}
            <span className="text-small text-fg-muted">{p.aliasCount} known spellings</span>
          </p>
          <p className="mt-1 text-small text-fg-muted">{AGE_LABEL[p.ageStatus]}: {AGE_EXPLAIN[p.ageStatus]}</p>
          <div className="mt-2 flex flex-wrap gap-2">
            <Button small onClick={() => setMode(mode === 'rename' ? 'none' : 'rename')}>Rename</Button>
            <Button small onClick={() => setMode(mode === 'split' ? 'none' : 'split')}>Split into two people</Button>
          </div>
        </div>
      </div>
      {mode === 'rename' ? <RenameForm p={p} onDone={() => setMode('none')} /> : null}
      {mode === 'split' ? <SplitForm p={p} onDone={() => setMode('none')} /> : null}
    </li>
  );
}

function RenameForm({ p, onDone }: { p: PlayerSummary; onDone: () => void }) {
  const { client, actor, notify, check, bump } = useAdmin();
  const [name, setName] = useState(p.displayName);
  const [asking, setAsking] = useState(false);
  const [busy, run] = useBusy();
  const go = async () => {
    const r = await run(() => client.renamePlayer(actor, { playerId: p.id, newDisplayName: name, keepOldAsAlias: true, reason: 'Renamed by owner' }));
    setAsking(false);
    if (r && check(r)) {
      notify(p.ageStatus === 'adult_confirmed' ? 'Renamed. The old web address now forwards to the new one.' : 'Renamed.');
      bump();
      onDone();
    }
  };
  return (
    <form className="mt-3 flex flex-col gap-3" onSubmit={(e) => { e.preventDefault(); setAsking(true); }}>
      <Field label="New name" htmlFor={`rename-${p.id}`}>
        <TextInput id={`rename-${p.id}`} value={name} onChange={setName} />
      </Field>
      <div><Button type="submit" variant="primary" disabled={name.trim() === '' || name.trim() === p.displayName}>Rename</Button></div>
      {asking ? <Confirm title={`Rename to "${name.trim()}"?`} body="The old name is kept as another spelling of the same person." confirmLabel="Rename" busy={busy} onConfirm={() => void go()} onCancel={() => setAsking(false)} /> : null}
    </form>
  );
}

function SplitForm({ p, onDone }: { p: PlayerSummary; onDone: () => void }) {
  const { client, actor, notify, check, bump } = useAdmin();
  const parts = useAsync(() => client.listParticipants({ playerId: p.id, limit: 200 }), [p.id]);
  const [name, setName] = useState('');
  const [chosen, setChosen] = useState<Set<string>>(new Set());
  const [asking, setAsking] = useState(false);
  const [busy, run] = useBusy();
  const go = async () => {
    const r = await run(() => client.splitPlayer(actor, { playerId: p.id, newDisplayName: name, participantIds: [...chosen], reason: 'Split by owner' }));
    setAsking(false);
    if (r && check(r)) {
      notify('Split. The new person starts hidden and needs your review before they appear anywhere.');
      bump();
      onDone();
    }
  };
  return (
    <form className="mt-3 flex flex-col gap-3" onSubmit={(e) => { e.preventDefault(); setAsking(true); }}>
      <p className="text-small text-fg-muted">Two different people were mixed into one. Tick the appearances that belong to the other person.</p>
      <LoadState loading={parts.loading} error={parts.error}>
        {parts.data && parts.data.length > 0 ? (
          <ul className="flex flex-col gap-1">
            {parts.data.map((x) => (
              <li key={x.id}>
                <label className="flex min-h-tap items-start gap-2">
                  <input type="checkbox" className="mt-1 h-5 w-5" checked={chosen.has(x.id)} onChange={() => setChosen((s) => { const n = new Set(s); if (n.has(x.id)) n.delete(x.id); else n.add(x.id); return n; })} />
                  <span className="min-w-0 break-words text-small">
                    <span className="font-semibold">{x.rawName}</span>
                    {x.videoTitleRaw ? <span className="block text-fg-muted">{x.videoTitleRaw}</span> : null}
                  </span>
                </label>
              </li>
            ))}
          </ul>
        ) : (
          <Empty>No match appearances to move.</Empty>
        )}
      </LoadState>
      <Field label="Name of the other person" htmlFor={`split-${p.id}`}>
        <TextInput id={`split-${p.id}`} value={name} onChange={setName} />
      </Field>
      <div><Button type="submit" variant="primary" disabled={name.trim() === '' || chosen.size === 0}>Split</Button></div>
      {asking ? <Confirm title={`Move ${chosen.size} appearance${chosen.size === 1 ? '' : 's'} to "${name.trim()}"?`} body={`The new person keeps the same protection as ${p.displayName} (${AGE_LABEL[p.ageStatus]}). They will not be linked to ${p.displayName} again by the next sync.`} confirmLabel="Split" busy={busy} onConfirm={() => void go()} onCancel={() => setAsking(false)} /> : null}
    </form>
  );
}

// ----------------------------------------------------------------------------- duplicates

function Duplicates() {
  const { client } = useAdmin();
  const q = useAsync(() => client.listDuplicates({ limit: 40 }), []);
  return (
    <div className="flex flex-col gap-3">
      <p className="text-fg-muted">These look alike. Nothing is merged unless you say so. Names with only one word match many people, so they are marked weak.</p>
      <LoadState loading={q.loading} error={q.error}>
        {q.data && q.data.length > 0 ? q.data.map((d) => <PairCard key={`${d.a.id}-${d.b.id}`} pair={d} />) : <Empty>No possible duplicates.</Empty>}
      </LoadState>
    </div>
  );
}

function PairCard({ pair }: { pair: DuplicatePairDto }) {
  const { client, actor, notify, check, bump } = useAdmin();
  const [keep, setKeep] = useState<'a' | 'b' | null>(null);
  const [override, setOverride] = useState('');
  const [busy, run] = useBusy();
  const keepP = keep === 'a' ? pair.a : pair.b;
  const dropP = keep === 'a' ? pair.b : pair.a;

  const merge = async () => {
    const r = await run(() => client.mergePlayers(actor, { keepId: keepP.id, dropId: dropP.id, reason: 'Merged by owner', ...(pair.needsOverride ? { overrideReason: override.trim() } : {}) }));
    setKeep(null);
    if (r && check(r)) {
      notify(`Merged "${dropP.displayName}" into "${keepP.displayName}".`, r.data.undo);
      bump();
    }
  };
  const dismiss = async () => {
    const r = await run(() => client.dismissDuplicate(actor, { aId: pair.a.id, bId: pair.b.id, reason: 'Not the same person' }));
    if (r && check(r)) {
      notify('Marked as different people.');
      bump();
    }
  };

  const side = (p: PlayerSummary) => (
    <div className="min-w-0 flex-1 rounded-md border border-line p-3">
      <p className="break-words font-bold">{p.displayName}</p>
      <p className="mt-1"><AgeBadge status={p.ageStatus} /></p>
    </div>
  );

  return (
    <article className={cardCls}>
      <div className="mb-2 flex flex-wrap gap-2">
        <Badge tone={pair.strength === 'strong' ? 'good' : 'neutral'}>{pair.strength === 'strong' ? 'Likely the same' : 'Weak match: one-word name'}</Badge>
        {pair.needsOverride ? <Badge tone="warn">One may be under 18, one is confirmed adult</Badge> : null}
      </div>
      <div className="flex flex-col gap-2 sm:flex-row">{side(pair.a)}{side(pair.b)}</div>
      <div className="mt-3 flex flex-wrap gap-2">
        <Button small onClick={() => setKeep('a')}>Keep first, merge second</Button>
        <Button small onClick={() => setKeep('b')}>Keep second, merge first</Button>
        <Button small busy={busy} onClick={() => void dismiss()}>Not the same person</Button>
      </div>
      {keep ? (
        <Confirm
          title={`Merge "${dropP.displayName}" into "${keepP.displayName}"?`}
          body={<>The merged person gets the stricter protection of the two. {pair.needsOverride ? 'This mixes an under-18 player with a confirmed adult: write why you are sure they are the same person.' : ''}</>}
          confirmLabel="Merge"
          busy={busy}
          onConfirm={() => { if (!pair.needsOverride || override.trim().length >= 3) void merge(); }}
          onCancel={() => setKeep(null)}
        >
          {pair.needsOverride ? (
            <div className="mt-3">
              <Field label="Why are they the same person? (kept in the audit trail)" htmlFor={`ov-${pair.a.id}`}>
                <TextInput id={`ov-${pair.a.id}`} value={override} onChange={setOverride} />
              </Field>
            </div>
          ) : null}
        </Confirm>
      ) : null}
    </article>
  );
}

// ----------------------------------------------------------------------------- profile requests

function Requests() {
  const { client, actor, notify, check, bump } = useAdmin();
  const q = useAsync(() => client.listProfileRequests(), []);
  const [busy, run] = useBusy();
  const decide = async (id: string, decision: 'resolve' | 'reject') => {
    const r = await run(() => client.resolveProfileRequest(actor, { id, decision, reason: decision === 'resolve' ? 'Handled by owner' : 'Rejected by owner' }));
    if (r && check(r)) {
      notify(decision === 'resolve' ? 'Request marked as done.' : 'Request rejected.');
      bump();
    }
  };
  const KIND = { claim: 'Claim a profile', correction: 'Correction', removal: 'Removal', junior: 'Junior player request' } as const;
  return (
    <div className="flex flex-col gap-3">
      <p className="text-fg-muted">Requests from players or parents. Contact details are not shown here: reply from the original message.</p>
      <LoadState loading={q.loading} error={q.error}>
        {q.data && q.data.length > 0 ? (
          q.data.map((r) => (
            <article key={r.id} className={cardCls}>
              <p className="font-bold">{KIND[r.kind]}</p>
              <p className="text-small text-fg-muted">{new Date(r.receivedAt).toLocaleString('en-IN', { timeZone: 'Asia/Kolkata' })}</p>
              <p className="mt-1">{r.summary}</p>
              <div className="mt-3 flex flex-wrap gap-2">
                <Button small variant="primary" busy={busy} onClick={() => void decide(r.id, 'resolve')}>Mark as done</Button>
                <Button small busy={busy} onClick={() => void decide(r.id, 'reject')}>Reject</Button>
              </div>
            </article>
          ))
        ) : (
          <Empty>No open requests.</Empty>
        )}
      </LoadState>
    </div>
  );
}
