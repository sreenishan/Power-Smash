// An organizer's tournament submission (an enquiry of kind tournament_submission) added to the tournament list as a pending, hidden
// "Submitted by organizers" candidate (D-103). The preview shows only the tournament's own details; no contact detail is copied.
import { useState } from 'react';
import { FIELD_WORDS, type SubmissionPreview } from '../../lib/admin/submission-candidate';
import { formatDate } from '../../lib/dates';
import { hashFor } from '../messages';
import { Badge, Button, Confirm, LoadState, useAdmin, useAsync, useBusy } from '../ui';

export function SubmissionToTournament({ leadId }: { leadId: string }) {
  const { client } = useAdmin();
  const q = useAsync(() => client.previewSubmission({ leadId }), [leadId]);
  return (
    <div className="mt-3 border-t border-line pt-3">
      <LoadState loading={q.loading && !q.data} error={q.error}>
        {q.data ? <Preview p={q.data} /> : null}
      </LoadState>
    </div>
  );
}

const when = (start: string | null, end: string | null): string =>
  start === null ? 'Not given' : end === null || end === start ? formatDate(start) : `${formatDate(start)} to ${formatDate(end)}`;

function Preview({ p }: { p: SubmissionPreview }) {
  const { client, actor, notify, check, bump } = useAdmin();
  const [asking, setAsking] = useState(false);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [busy, run] = useBusy();
  const r = p.record;

  const add = async () => {
    const res = await run(() => client.addSubmission(actor, { leadId: p.leadId, reason: `Organizer submission ${p.refCode} added by owner` }));
    setAsking(false);
    if (!res) return;
    if (check(res)) {
      notify('Added to Tournaments, under "Submitted by organizers". It stays hidden until you approve it there.');
      bump();
    } else setErrors(res.errors ?? {});
  };

  if (p.addedAs) {
    return (
      <p className="flex flex-wrap items-center gap-2">
        <Badge tone="good">In the tournament list</Badge>
        <a href={hashFor('tournaments')} className="font-semibold">Open Tournaments</a>
      </p>
    );
  }
  return (
    <div className="flex flex-col gap-2">
      <p className="text-small text-fg-muted">This adds the tournament to your Tournaments list as "Submitted by organizers". It stays hidden from the site until you approve it there. The organizer's name, phone and email are not copied: they stay on this enquiry.</p>
      {r ? (
        <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 text-small">
          <dt className="font-bold">Name</dt><dd className="break-words">{r.name}</dd>
          <dt className="font-bold">Dates</dt><dd>{when(r.startDate, r.endDate)}</dd>
          <dt className="font-bold">Place</dt><dd className="break-words">{[r.venue, r.city, r.district].filter(Boolean).join(', ') || 'Not given'}</dd>
          <dt className="font-bold">Tamil Nadu?</dt>
          <dd>{r.region === 'tamil_nadu' ? 'Yes (the place is in Tamil Nadu)' : 'Not sure from the place given. If you approve it, it stays off the site: places outside Tamil Nadu are not shown unless you switch that on, and they never get a tournament page.'}</dd>
        </dl>
      ) : null}
      {p.dropped.length > 0 ? <p className="text-small">Left out because it was not usable: {p.dropped.map((f) => FIELD_WORDS[f]).join(', ')}. You can add it later with "Details".</p> : null}
      {p.problem ? <p role="alert" className="font-semibold text-ps-live">{p.problem}</p> : null}
      {errors.form ? <p role="alert" className="font-semibold text-ps-live">{errors.form}</p> : null}
      <div><Button small variant="primary" disabled={!r || p.problem !== null} onClick={() => setAsking(true)}>Add to the tournament list</Button></div>
      {asking && r ? (
        <Confirm
          title={`Add "${r.name}" to the tournament list?`}
          body="It is added as hidden and waiting for your approval. The change is recorded with your name."
          confirmLabel="Add"
          busy={busy}
          onConfirm={() => void add()}
          onCancel={() => setAsking(false)}
        />
      ) : null}
    </div>
  );
}
