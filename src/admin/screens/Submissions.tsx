// Submissions: review a video somebody sent (spec 14, D-019). The link is shown as plain text; it is never fetched or embedded.
import { useState } from 'react';
import { nextSubmissionStatuses, safeHttpsHref, YOUTUBE_ID, type SubmissionStatus, type VideoSubmission } from '../../lib/admin/submissions';
import { Badge, Button, Confirm, Empty, Field, LoadState, TextInput, cardCls, cx, useAdmin, useAsync, useBusy } from '../ui';

const STATUS_LABEL: Record<SubmissionStatus, string> = { new: 'New', approved: 'Approved', uploaded: 'Uploaded', rejected: 'Rejected' };
const TONE = { new: 'neutral', approved: 'good', uploaded: 'good', rejected: 'warn' } as const;
const SOURCE: Record<string, string> = { self: 'Filmed by the sender', asked_by_organizer: 'Filmed because the organizer asked', organizer_owns: 'The organizer owns the footage', other: 'Other' };
const PERMISSION: Record<string, string> = { yes: 'Yes, agreed in writing', no: 'No', unsure: 'Not sure' };
const ROLE: Record<string, string> = { player: 'Player', parent_guardian: 'Parent or guardian', coach: 'Coach', organizer: 'Organizer', other: 'Other' };

export function Submissions() {
  const { client } = useAdmin();
  const q = useAsync(() => client.listSubmissions({ limit: 100 }), []);
  const [filter, setFilter] = useState<SubmissionStatus | 'open'>('open');
  const all = q.data ?? [];
  const shown = all.filter((s) => (filter === 'open' ? s.status === 'new' || s.status === 'approved' : s.status === filter));
  return (
    <div className="flex flex-col gap-4">
      <p className="text-fg-muted">Videos people sent you. Watch the link yourself: the site never opens it. Approve only when the rights boxes are ticked and you are happy to upload it.</p>
      <div role="group" aria-label="Filter by stage" className="flex flex-wrap gap-2">
        {(['open', 'new', 'approved', 'uploaded', 'rejected'] as const).map((s) => (
          <button key={s} aria-pressed={filter === s} onClick={() => setFilter(s)} className={cx('min-h-tap rounded-md border-2 px-3 text-small font-bold', filter === s ? 'border-ps-court bg-ps-court text-ps-white' : 'border-line-strong bg-surface text-fg')}>
            {s === 'open' ? 'To do' : STATUS_LABEL[s]}
          </button>
        ))}
      </div>
      <LoadState loading={q.loading} error={q.error}>
        {shown.length > 0 ? shown.map((s) => <SubmissionCard key={s.id} s={s} />) : <Empty>No submissions here.</Empty>}
      </LoadState>
    </div>
  );
}

function Detail({ label, value }: { label: string; value: string | null }) {
  return value ? (
    <>
      <dt className="text-fg-muted">{label}</dt>
      <dd className="break-words">{value}</dd>
    </>
  ) : null;
}

function SubmissionCard({ s }: { s: VideoSubmission }) {
  const { client, actor, notify, check, bump } = useAdmin();
  const [mode, setMode] = useState<'approve' | 'reject' | 'upload' | null>(null);
  const [reason, setReason] = useState('');
  const [ytId, setYtId] = useState('');
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [busy, run] = useBusy();
  const next = nextSubmissionStatuses(s.status);
  const href = safeHttpsHref(s.videoUrl);
  const missing = s.consents.filter((c) => !c.given).length;

  const go = async (input: { action: 'approve' | 'reject' | 'mark_uploaded'; reason?: string; youtubeId?: string }, done: string) => {
    setErrors({});
    const r = await run(() => client.reviewSubmission(actor, { id: s.id, ...input }));
    if (!r) return;
    if (check(r)) {
      setMode(null);
      notify(done);
      bump();
    } else setErrors(r.errors ?? {});
  };

  return (
    <article className={cardCls} aria-label={`Submission ${s.refCode}`}>
      <div className="flex flex-wrap items-center gap-2">
        <Badge tone={TONE[s.status]}>{STATUS_LABEL[s.status]}</Badge>
        <span className="text-small text-fg-muted">{s.refCode} · {new Date(s.createdAt).toLocaleDateString('en-IN', { timeZone: 'Asia/Kolkata' })}</span>
      </div>
      <p className="mt-2 text-small text-fg-muted">The link (shown as text; never opened by the site)</p>
      <p className="break-all font-mono text-small" data-testid="video-link">{s.videoUrl}</p>
      {href ? (
        <p className="mt-1"><a href={href} target="_blank" rel="noopener nofollow noreferrer" className="text-small font-semibold">Open the link in a new tab (your own risk: it is the sender's site)</a></p>
      ) : (
        <p className="mt-1 text-small text-fg-muted">This link is not a plain https address, so it is not clickable. Copy it only if you trust it.</p>
      )}

      <dl className="mt-3 grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 text-small">
        <Detail label="From" value={`${s.submitterName}${s.role ? `, ${ROLE[s.role] ?? s.role}` : ''}`} />
        <Detail label="Tournament" value={s.tournamentName} />
        <Detail label="Match day" value={s.matchDate} />
        <Detail label="Category and round" value={[s.category, s.round].filter(Boolean).join(' ') || null} />
        <Detail label="Players" value={s.players} />
        <Detail label="Footage" value={s.footageSource ? SOURCE[s.footageSource] ?? s.footageSource : null} />
        <Detail label="Organizer" value={s.organizerName} />
        <Detail label="Filming permission" value={s.filmingPermission ? PERMISSION[s.filmingPermission] ?? s.filmingPermission : null} />
        <Detail label="Under-18 players visible" value={s.minorsVisible ? PERMISSION[s.minorsVisible] ?? s.minorsVisible : null} />
        <Detail label="Note" value={s.notes} />
        {s.youtubeId ? <Detail label="YouTube video id" value={s.youtubeId} /> : null}
        {s.rejectReason ? <Detail label="Rejected because" value={s.rejectReason} /> : null}
      </dl>
      {s.minorsVisible === 'yes' || s.minorsVisible === 'unsure' ? <p role="note" className="mt-2 rounded-md border border-ps-live bg-ps-live-tint p-2 text-small text-ps-ink">Players under 18 may be visible. Do not name them in posts, and expect the protected-player rules to apply.</p> : null}

      <h3 className="mt-3 text-h4 font-bold text-heading">Rights the sender confirmed</h3>
      <ul className="mt-1 flex flex-col gap-1 text-small" aria-label="Rights confirmations">
        {s.consents.map((c) => (
          <li key={c.id} className="flex flex-wrap items-start gap-2">
            <Badge tone={c.given ? 'good' : 'danger'}>{c.given ? 'Ticked' : 'Not ticked'}</Badge>
            <span className="min-w-0 flex-1">{c.label}<span className="block text-fg-muted">Wording version {c.version}{c.currentVersion && c.currentVersion !== c.version ? ` (the site now has ${c.currentVersion})` : ''}</span></span>
          </li>
        ))}
      </ul>
      {missing > 0 ? <p role="alert" className="mt-1 font-semibold text-ps-live">{missing} of the rights boxes are not recorded as ticked. Do not approve without asking the sender.</p> : null}

      {next.length > 0 ? (
        <div className="mt-3 flex flex-wrap gap-2">
          {next.includes('approved') ? <Button small variant="primary" onClick={() => { setErrors({}); setMode('approve'); }}>Approve</Button> : null}
          {next.includes('uploaded') ? <Button small variant="primary" onClick={() => { setErrors({}); setMode('upload'); }}>Mark uploaded with YouTube video id</Button> : null}
          {next.includes('rejected') ? <Button small onClick={() => { setErrors({}); setMode('reject'); }}>Reject</Button> : null}
        </div>
      ) : null}
      {errors.status ? <p role="alert" className="mt-2 font-semibold text-ps-live">{errors.status}</p> : null}

      {mode === 'approve' ? <Confirm title="Approve this video?" body="This only records that you are happy with it. You still upload it to YouTube yourself, then come back and mark it uploaded." confirmLabel="Approve" busy={busy} onConfirm={() => void go({ action: 'approve' }, 'Approved.')} onCancel={() => setMode(null)} /> : null}
      {mode === 'reject' ? (
        <Confirm title="Reject this video?" body="The sender is not told from here. Reply to them yourself from the enquiry." confirmLabel="Reject" danger busy={busy} onConfirm={() => { if (reason.trim().length < 3) return setErrors({ reason: 'Say why you are rejecting it (a few words).' }); void go({ action: 'reject', reason }, 'Rejected.'); }} onCancel={() => setMode(null)}>
          <div className="mt-3"><Field label="Why? (kept with the record)" htmlFor={`rj-${s.id}`}><TextInput id={`rj-${s.id}`} value={reason} onChange={setReason} /></Field></div>
          {errors.reason ? <p role="alert" className="font-semibold text-ps-live">{errors.reason}</p> : null}
        </Confirm>
      ) : null}
      {mode === 'upload' ? (
        <Confirm title="Mark as uploaded?" body="Type the 11-character id of the video you uploaded to YouTube (the part after v= in its address)." confirmLabel="Mark uploaded" busy={busy} onConfirm={() => { if (!YOUTUBE_ID.test(ytId.trim())) return setErrors({ youtubeId: 'A YouTube video id is exactly 11 letters, digits, - or _.' }); void go({ action: 'mark_uploaded', youtubeId: ytId.trim() }, 'Marked as uploaded.'); }} onCancel={() => setMode(null)}>
          <div className="mt-3"><Field label="YouTube video id" htmlFor={`yt-${s.id}`}><TextInput id={`yt-${s.id}`} value={ytId} onChange={setYtId} maxLength={11} /></Field></div>
          {errors.youtubeId ? <p role="alert" className="font-semibold text-ps-live">{errors.youtubeId}</p> : null}
        </Confirm>
      ) : null}
    </article>
  );
}
