import { lazy, Suspense, useState } from 'react';
import { PARSED_FIELDS, type ParsedField, type ReviewVideo } from '../../lib/admin/types';
import { Badge, Button, Empty, Field, LoadState, TextInput, cardCls, useAdmin, useAsync, useBusy } from '../ui';

const FIELD_LABEL: Record<ParsedField, string> = {
  tournament: 'Tournament',
  category: 'Category (MS, WS, MD...)',
  age_group: 'Age group',
  round: 'Round',
  participants: 'Players',
};
// Tournament and players are changed in the Tournaments and Players tools; here they can be read and locked.
const EDITABLE: ParsedField[] = ['category', 'age_group', 'round'];

// The title tool pulls in the title reader: its own chunk, loaded when the tab opens.
const TitleCheck = lazy(() => import('./TitleCheck').then((m) => ({ default: m.TitleCheck })));

export function Videos() {
  const [tab, setTab] = useState<'queue' | 'title'>('queue');
  return (
    <div className="flex flex-col gap-4">
      <div role="tablist" aria-label="Video tools" className="flex gap-2">
        {([['queue', 'Videos to check'], ['title', 'Title check']] as const).map(([k, label]) => (
          <button key={k} role="tab" aria-selected={tab === k} onClick={() => setTab(k)} className={`min-h-tap rounded-md border-2 px-3 text-small font-bold ${tab === k ? 'border-ps-court bg-ps-court text-ps-white' : 'border-line-strong bg-surface text-fg'}`}>{label}</button>
        ))}
      </div>
      {tab === 'queue' ? <ReviewQueue /> : <Suspense fallback={<p className="text-fg-muted">Loading...</p>}><TitleCheck /></Suspense>}
    </div>
  );
}

function ReviewQueue() {
  const { client } = useAdmin();
  const q = useAsync(() => client.listReviewQueue({ limit: 20, offset: 0 }), []);
  return (
    <div className="flex flex-col gap-4">
      <p className="text-fg-muted">Each video below could not be read with confidence. The YouTube title is shown exactly as written. Check the details Power Smash read from it.</p>
      <LoadState loading={q.loading} error={q.error}>
        {q.data && q.data.length > 0 ? q.data.map((v) => <ReviewRow key={rowKey(v)} video={v} />) : <Empty>Nothing to check. All videos are sorted.</Empty>}
      </LoadState>
    </div>
  );
}

const rowKey = (v: ReviewVideo): string => v.youtubeId;
const ReviewRow = (props: { video: ReviewVideo }) => <ReviewCard video={props.video} />;

function ReviewCard({ video }: { video: ReviewVideo }) {
  const { client, actor, notify, check, bump } = useAdmin();
  const [edits, setEdits] = useState<Partial<Record<ParsedField, string>>>({});
  const [locks, setLocks] = useState<Partial<Record<ParsedField, boolean>>>(() => ({ ...video.locks }));
  const [reason, setReason] = useState('Checked in review queue');
  const [busy, run] = useBusy();
  const lockedCount = PARSED_FIELDS.filter((f) => locks[f] === true).length;

  const submit = async (decision: 'approve' | 'ignore' | 'keep_hidden') => {
    const changes: Partial<Record<ParsedField, string | null>> = {};
    for (const f of EDITABLE) if (edits[f] !== undefined && edits[f] !== (video.parsed[f] ?? '')) changes[f] = edits[f]!.trim() === '' ? null : edits[f]!.trim();
    const lockFields = PARSED_FIELDS.filter((f) => locks[f] && !video.locks[f]);
    const r = await run(() => client.resolveReview(actor, { videoId: video.youtubeId, decision, changes, lockFields, reason: reason.trim() }));
    if (r && check(r)) {
      notify(decision === 'approve' ? 'Approved.' : decision === 'ignore' ? 'Marked as not a match video.' : 'Kept hidden.');
      bump();
    }
  };

  return (
    <article className={cardCls} aria-label={`Video ${video.youtubeId}`}>
      <p className="text-small font-semibold text-fg-muted">YouTube title (exactly as on YouTube)</p>
      <p className="mt-1 break-words text-body font-semibold">{video.titleRaw}</p>
      <div className="mt-2 flex flex-wrap gap-2">
        {video.minorHold ? <Badge tone="warn">Possible under-18 player: stays hidden</Badge> : null}
        {video.overrideStale ? <Badge tone="warn">Title changed since you locked a field</Badge> : null}
        {video.hardFlags.map((f) => <Badge key={f} tone="warn">{f}</Badge>)}
        {video.reviewReasons.filter((r) => !video.hardFlags.includes(r)).map((r) => <Badge key={r}>{r}</Badge>)}
      </div>

      <h3 className="mt-4 text-h4 font-bold text-heading">Match details by Power Smash</h3>
      <div className="mt-2 flex flex-col gap-3">
        {PARSED_FIELDS.map((f) => (
          <div key={f} className="flex flex-col gap-1">
            {EDITABLE.includes(f) ? (
              <Field label={FIELD_LABEL[f]} htmlFor={`${video.youtubeId}-${f}`}>
                <TextInput id={`${video.youtubeId}-${f}`} value={edits[f] ?? video.parsed[f] ?? ''} onChange={(v) => setEdits((e) => ({ ...e, [f]: v }))} />
              </Field>
            ) : (
              <div>
                <span className="block text-body font-semibold">{FIELD_LABEL[f]}</span>
                <span className="text-body">{video.parsed[f] ?? 'not found'}</span>
              </div>
            )}
          </div>
        ))}
      </div>

      {/* Locking is the rare case, so the five ticks live in one closed panel instead of under every field. */}
      <details className="group mt-4 rounded-md border-2 border-line-strong bg-page open:border-ps-court">
        <summary className="flex min-h-tap cursor-pointer list-none items-center justify-between gap-3 px-3 text-body font-bold text-fg [&::-webkit-details-marker]:hidden">
          <span>Lock fields ({lockedCount})</span>
          <svg aria-hidden="true" viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="shrink-0 ps-transition group-open:rotate-180">
            <path d="m6 9 6 6 6-6" />
          </svg>
        </summary>
        <fieldset className="min-w-0 border-t border-line px-3 pb-2 pt-3">
          <legend className="sr-only">Lock fields: the sync must not change a locked field</legend>
          <p className="text-small text-fg-muted">Lock this: the sync must not change it. Tick each field you want to lock.</p>
          {PARSED_FIELDS.map((f) => (
            <label key={f} className="flex min-h-tap items-center gap-3 text-body">
              <input type="checkbox" className="h-5 w-5" checked={locks[f] === true} onChange={(e) => setLocks((l) => ({ ...l, [f]: e.target.checked }))} />
              {FIELD_LABEL[f]}
            </label>
          ))}
        </fieldset>
      </details>

      <div className="mt-4">
        <Field label="Note for the audit trail" htmlFor={`${video.youtubeId}-reason`}>
          <TextInput id={`${video.youtubeId}-reason`} value={reason} onChange={setReason} />
        </Field>
      </div>
      <div className="mt-3 grid grid-cols-2 gap-2">
        <Button variant="primary" className="col-span-2" busy={busy} disabled={reason.trim().length < 3} onClick={() => void submit('approve')}>Approve</Button>
        <Button busy={busy} disabled={reason.trim().length < 3} onClick={() => void submit('ignore')}>Not a match video</Button>
        <Button busy={busy} disabled={reason.trim().length < 3} onClick={() => void submit('keep_hidden')}>Keep hidden</Button>
      </div>
      {video.minorHold ? <p className="mt-2 text-small text-fg-muted">Approving does not publish a video held for a possible under-18 player. The protected-players setting still decides what the public sees.</p> : null}
    </article>
  );
}
