import { useState } from 'react';
import type { TournamentCandidate } from '../../lib/admin/types';
import { Badge, Button, Confirm, Empty, LoadState, cardCls, useAdmin, useAsync, useBusy } from '../ui';

const REGION = { tamil_nadu: 'Tamil Nadu', other_india: 'Elsewhere in India', international: 'International', unknown: 'Place not known' } as const;

export function Tournaments() {
  const { client } = useAdmin();
  const q = useAsync(() => client.listTournamentCandidates(), []);
  const [tab, setTab] = useState<'submitted' | 'found'>('submitted');
  const all = q.data ?? [];
  const submitted = all.filter((t) => t.source === 'submitted');
  const found = all.filter((t) => t.source !== 'submitted');
  const list = tab === 'submitted' ? submitted : found;
  return (
    <div className="flex flex-col gap-4">
      <div role="tablist" aria-label="Tournament lists" className="flex gap-2">
        {([['submitted', `Submitted by organizers (${submitted.length})`], ['found', `Found in video titles (${found.length})`]] as const).map(([k, label]) => (
          <button key={k} role="tab" aria-selected={tab === k} onClick={() => setTab(k)} className={`min-h-tap rounded-md border-2 px-3 text-small font-bold ${tab === k ? 'border-ps-court bg-ps-court text-ps-white' : 'border-line-strong bg-surface text-fg'}`}>{label}</button>
        ))}
      </div>
      <p className="text-fg-muted">
        {tab === 'submitted'
          ? 'Organizers send these through the website. Check the organizer is real before you approve.'
          : 'Found in video titles. A tournament page needs 3 or more matches, or your approval.'}{' '}
        Events outside Tamil Nadu are only listed with their videos: they never get a tournament page.
      </p>
      <LoadState loading={q.loading} error={q.error}>
        {list.length > 0 ? list.map((t) => <Candidate key={t.id} t={t} />) : <Empty>{tab === 'submitted' ? 'No organizer submissions waiting.' : 'No tournaments waiting for a decision.'}</Empty>}
      </LoadState>
    </div>
  );
}

const CHECKLIST = ['I have checked the organizer is real (call or WhatsApp the number they gave).', 'The dates and place look right.', 'I am allowed to film and show the matches, or the organizer agreed.'];

function Candidate({ t }: { t: TournamentCandidate }) {
  const { client, actor, notify, check, bump } = useAdmin();
  const [asking, setAsking] = useState<'promote' | 'reject' | 'hide' | null>(null);
  const [checks, setChecks] = useState<number[]>([]);
  const [busy, run] = useBusy();
  const go = async (decision: 'promote' | 'reject' | 'hide') => {
    const r = await run(() => client.decideTournament(actor, { id: t.id, decision, reason: `${decision} by owner` }));
    setAsking(null);
    if (r && check(r)) {
      notify(decision === 'promote' ? 'Approved.' : decision === 'reject' ? 'Rejected.' : 'Hidden.');
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
      </p>
      <div className="mt-3 flex flex-wrap gap-2">
        <Button small variant="primary" onClick={() => { setChecks([]); setAsking('promote'); }}>Approve</Button>
        <Button small onClick={() => setAsking('hide')}>Hide</Button>
        <Button small onClick={() => setAsking('reject')}>Reject</Button>
      </div>
      {asking ? <Confirm title={`${asking === 'promote' ? 'Approve' : asking === 'hide' ? 'Hide' : 'Reject'} "${t.name}"?`} body={TEXT[asking]} confirmLabel="Yes" busy={busy} onConfirm={() => { if (asking === 'promote' && t.source === 'submitted' && checks.length < CHECKLIST.length) return; void go(asking); }} onCancel={() => setAsking(null)}>
        {asking === 'promote' && t.source === 'submitted' ? (
          <fieldset className="mt-3"><legend className="font-semibold">Tick each one before approving</legend>
            {CHECKLIST.map((c, i) => <label key={c} className="flex min-h-tap items-start gap-2"><input type="checkbox" className="mt-1 h-5 w-5" checked={checks.includes(i)} onChange={(e) => setChecks((x) => (e.target.checked ? [...x, i] : x.filter((n) => n !== i)))} /><span>{c}</span></label>)}
          </fieldset>
        ) : null}
      </Confirm> : null}
    </article>
  );
}
