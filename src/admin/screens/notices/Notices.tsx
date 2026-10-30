// Notices and email updates (D-114). The owner writes short notices for the website or for organizers and scorers, publishes or
// unpublishes them, opens or closes the email sign-up, writes an announcement email to the confirmed subscribers, and sends the queued
// emails. Only COUNTS of subscribers are shown, never an address. Nothing here is on the website until the website switches are on
// (features.siteNotices, features.emailNotifications) after the lawyer has read the wording.
// The screen takes its store as a prop (the integrator passes the admin client once AdminStore includes NoticesAdminStore).
// StaffNoticesPanel is for the organizer and scorer home (wave 4 accounts): published staff notices only.
import { useState } from 'react';
import type { NoticeRow, NoticesAdminStore } from '../../../lib/admin/notices/types';
import { noticeHref } from '../../../lib/notices/site-notices';
import { Badge, Button, Confirm, Empty, Field, LoadState, cardCls, inputCls, useAdmin, useAsync } from '../../ui';
import { ErrorText, H2, Input, Note, ReasonField, reasonProblem, useAction } from '../competition/shared';
import { AUDIENCE_LABEL, EMPTY_NOTICE_FORM, NOTICE_TEXT_HINT, NOTICE_TIMING_HINTS, formOf, newAnnouncementId, noticeInputOf, noticeStatus, summaryLines, type NoticeForm } from './logic';

export function NoticesScreen({ store }: { store: NoticesAdminStore }) {
  const [editing, setEditing] = useState<NoticeRow | 'new' | null>(null);
  return (
    <div className="flex flex-col gap-6">
      <Note>Notices and email updates stay off on the website until the website switches are turned on after the lawyer has read the wording.</Note>
      {editing ? (
        <NoticeEditor store={store} row={editing === 'new' ? null : editing} onDone={() => setEditing(null)} />
      ) : (
        <>
          <NoticesList store={store} onEdit={setEditing} />
          <EmailCard store={store} />
        </>
      )}
    </div>
  );
}

function NoticesList({ store, onEdit }: { store: NoticesAdminStore; onEdit: (n: NoticeRow | 'new') => void }) {
  const { data, error, loading } = useAsync(() => store.noticesList(), []);
  return (
    <section aria-labelledby="notices-h" className="flex flex-col gap-3">
      <H2 id="notices-h">Notices</H2>
      <div>
        <Button variant="primary" onClick={() => onEdit('new')}>
          Write a notice
        </Button>
      </div>
      <LoadState loading={loading} error={error}>
        {data && data.length === 0 ? <Empty>No notices yet.</Empty> : null}
        {data?.map((n) => <NoticeCard key={n.id} store={store} n={n} onEdit={() => onEdit(n)} />)}
      </LoadState>
    </section>
  );
}

function NoticeCard({ store, n, onEdit }: { store: NoticesAdminStore; n: NoticeRow; onEdit: () => void }) {
  const { actor, notify, bump } = useAdmin();
  const act = useAction();
  const [asking, setAsking] = useState(false);
  const [reason, setReason] = useState('');
  const [reasonError, setReasonError] = useState<string | null>(null);
  const link = noticeHref({ link_path: n.linkPath, link_url: n.linkUrl });
  const toggle = async () => {
    const p = reasonProblem(reason);
    setReasonError(p);
    if (p) return;
    const r = await act.run(() => store.noticesPublish(actor, { id: n.id, published: !n.published, expectedRevision: n.revision, reason: reason.trim() }));
    if (!r) return;
    setAsking(false);
    setReason('');
    notify(r.published ? 'Notice published.' : 'Notice taken down.');
    bump();
  };
  return (
    <article className={cardCls} aria-labelledby={`notice-${n.id}-h`}>
      <div className="flex flex-wrap items-center gap-2">
        <h3 id={`notice-${n.id}-h`} className="text-h4 font-bold">
          {n.title}
        </h3>
        <Badge tone={n.published ? 'good' : 'neutral'}>{n.published ? 'Published' : 'Draft'}</Badge>
        <Badge>{AUDIENCE_LABEL[n.audience]}</Badge>
      </div>
      {n.body ? <p className="mt-2 whitespace-pre-line">{n.body}</p> : null}
      {link ? <p className="mt-1 text-small">Link: {n.linkLabel} ({link.href})</p> : null}
      <p className="mt-2 text-small text-fg-muted">{noticeStatus(n, new Date())}</p>
      <ErrorText text={act.error} />
      <div className="mt-3 flex flex-wrap gap-2">
        <Button onClick={onEdit}>Change</Button>
        <Button variant={n.published ? 'danger' : 'primary'} onClick={() => setAsking(true)}>
          {n.published ? 'Take down' : 'Publish'}
        </Button>
      </div>
      {asking ? (
        <Confirm
          title={n.published ? 'Take this notice down?' : 'Publish this notice?'}
          body={n.audience === 'public' ? 'Website notices change at the next site update.' : 'Organizers and scorers see the change at once.'}
          confirmLabel={n.published ? 'Take down' : 'Publish'}
          danger={n.published}
          busy={act.busy}
          onConfirm={() => void toggle()}
          onCancel={() => setAsking(false)}
        >
          <ReasonField id={`notice-${n.id}-reason`} value={reason} onChange={setReason} error={reasonError} />
        </Confirm>
      ) : null}
    </article>
  );
}

function NoticeEditor({ store, row, onDone }: { store: NoticesAdminStore; row: NoticeRow | null; onDone: () => void }) {
  const { actor, notify, bump } = useAdmin();
  const act = useAction();
  const [f, setF] = useState<NoticeForm>(row ? formOf(row) : EMPTY_NOTICE_FORM);
  const [reasonError, setReasonError] = useState<string | null>(null);
  const set = <K extends keyof NoticeForm>(k: K, v: NoticeForm[K]) => setF((x) => ({ ...x, [k]: v }));
  const save = async () => {
    const built = noticeInputOf(f);
    if (!built.ok) return act.fail('Check the dates.', built.errors);
    const p = reasonProblem(f.reason);
    setReasonError(p);
    if (p) return;
    const r = await act.run(() => store.noticesSave(actor, { ...built.input, id: row?.id ?? null, expectedRevision: row?.revision ?? null, reason: f.reason.trim() }));
    if (!r) return;
    notify(r.created ? 'Notice saved as a draft. Publish it when it is ready.' : 'Notice saved.');
    bump();
    onDone();
  };
  const fe = act.fields;
  return (
    <section aria-labelledby="notice-edit-h" className={cardCls}>
      <H2 id="notice-edit-h">{row ? 'Change the notice' : 'Write a notice'}</H2>
      <div className="mt-3 flex flex-col gap-4">
        <Field label="Title" htmlFor="ntc-title" hint="2 to 120 characters. No phone numbers or email addresses.">
          <Input id="ntc-title" value={f.title} maxLength={120} onChange={(v) => set('title', v)} error={fe.title} />
          <ErrorText id="ntc-title-error" text={fe.title} />
        </Field>
        <Field label="Text (optional)" htmlFor="ntc-body" hint={NOTICE_TEXT_HINT}>
          <textarea id="ntc-body" className={`${inputCls} min-h-[5rem]`} maxLength={600} value={f.body} onChange={(e) => set('body', e.target.value)} aria-describedby={fe.body ? 'ntc-body-error' : undefined} />
          <ErrorText id="ntc-body-error" text={fe.body} />
        </Field>
        <fieldset className="flex flex-col gap-2">
          <legend className="font-semibold">Who sees it</legend>
          {(['public', 'staff'] as const).map((a) => (
            <label key={a} className="flex min-h-tap items-center gap-3">
              <input type="radio" name="ntc-audience" className="h-5 w-5" checked={f.audience === a} onChange={() => set('audience', a)} />
              {AUDIENCE_LABEL[a]}
            </label>
          ))}
        </fieldset>
        <fieldset className="flex flex-col gap-2">
          <legend className="font-semibold">Link (optional)</legend>
          {(
            [
              ['none', 'No link'],
              ['page', 'A page of this website'],
              ['outside', 'Power Smash on YouTube, Instagram, Facebook or the WhatsApp Channel'],
            ] as const
          ).map(([k, label]) => (
            <label key={k} className="flex min-h-tap items-center gap-3">
              <input type="radio" name="ntc-link" className="h-5 w-5" checked={f.linkKind === k} onChange={() => set('linkKind', k)} />
              {label}
            </label>
          ))}
          <ErrorText text={fe.link} />
        </fieldset>
        {f.linkKind === 'page' ? (
          <Field label="Page" htmlFor="ntc-path" hint="Starts and ends with /, for example /competitions/.">
            <Input id="ntc-path" value={f.linkPath} maxLength={160} onChange={(v) => set('linkPath', v)} error={fe.linkPath} />
            <ErrorText id="ntc-path-error" text={fe.linkPath} />
          </Field>
        ) : null}
        {f.linkKind === 'outside' ? (
          <Field label="Outside link" htmlFor="ntc-url" hint="Starts with https://">
            <Input id="ntc-url" value={f.linkUrl} maxLength={300} onChange={(v) => set('linkUrl', v)} error={fe.linkUrl} />
            <ErrorText id="ntc-url-error" text={fe.linkUrl} />
          </Field>
        ) : null}
        {f.linkKind !== 'none' ? (
          <Field label="Words people tap" htmlFor="ntc-label" hint='For example "See the draw".'>
            <Input id="ntc-label" value={f.linkLabel} maxLength={60} onChange={(v) => set('linkLabel', v)} error={fe.linkLabel} />
            <ErrorText id="ntc-label-error" text={fe.linkLabel} />
          </Field>
        ) : null}
        <Note>{NOTICE_TIMING_HINTS.note}</Note>
        <Field label="Show from (optional, India time)" htmlFor="ntc-start-d" hint={NOTICE_TIMING_HINTS.start}>
          <div className="flex flex-wrap gap-2">
            <Input id="ntc-start-d" type="date" value={f.startDate} onChange={(v) => set('startDate', v)} error={fe.startsAt} />
            <Input id="ntc-start-t" type="time" value={f.startTime} onChange={(v) => set('startTime', v)} error={fe.startsAt} errorId="ntc-start-d-error" />
          </div>
          <ErrorText id="ntc-start-d-error" text={fe.startsAt} />
        </Field>
        <Field label="Show until (optional, India time)" htmlFor="ntc-end-d" hint={NOTICE_TIMING_HINTS.end}>
          <div className="flex flex-wrap gap-2">
            <Input id="ntc-end-d" type="date" value={f.endDate} onChange={(v) => set('endDate', v)} error={fe.endsAt} />
            <Input id="ntc-end-t" type="time" value={f.endTime} onChange={(v) => set('endTime', v)} error={fe.endsAt} errorId="ntc-end-d-error" />
          </div>
          <ErrorText id="ntc-end-d-error" text={fe.endsAt} />
        </Field>
        <ReasonField id="ntc-reason" value={f.reason} onChange={(v) => set('reason', v)} error={reasonError} />
        <ErrorText text={act.error} />
        <div className="flex flex-wrap gap-2">
          <Button variant="primary" busy={act.busy} onClick={() => void save()}>
            Save
          </Button>
          <Button onClick={onDone}>Cancel</Button>
        </div>
      </div>
    </section>
  );
}

function EmailCard({ store }: { store: NoticesAdminStore }) {
  const { actor, notify, bump } = useAdmin();
  const { data, error, loading } = useAsync(() => store.notifySummary(actor), []);
  const act = useAction();
  const [reason, setReason] = useState('');
  const [reasonError, setReasonError] = useState<string | null>(null);
  const [title, setTitle] = useState('');
  const [body, setBody] = useState('');
  const [annId, setAnnId] = useState(newAnnouncementId);
  const [askSend, setAskSend] = useState(false);

  const needReason = (): boolean => {
    const p = reasonProblem(reason);
    setReasonError(p);
    return p === null;
  };
  const toggleSignup = async () => {
    if (!data || !needReason()) return;
    const r = await act.run(() => store.notifySaveSettings(actor, { emailSubscribeOpen: !data.emailSubscribeOpen, reason: reason.trim() }));
    if (!r) return;
    setReason('');
    notify(r.emailSubscribeOpen ? 'The email sign-up is open.' : 'The email sign-up is closed.');
    bump();
  };
  const queue = async () => {
    if (!needReason()) return;
    const r = await act.run(() => store.notifyQueueAnnouncement(actor, { announcementId: annId, title, body, reason: reason.trim() }));
    setAskSend(false);
    if (!r) return;
    setReason('');
    setTitle('');
    setBody('');
    setAnnId(newAnnouncementId());
    notify(r.queued === 0 ? 'Nothing new was queued (this message was already queued, or nobody has confirmed yet).' : `Queued for ${r.queued} confirmed subscribers.`);
    bump();
  };
  const sendNow = async () => {
    const r = await act.run(() => store.notifyDispatch(actor));
    if (!r) return;
    notify(`Sent ${r.sent}. Will try again later: ${r.retrying}. Not sent: ${r.skipped + r.failed}.`);
    bump();
  };

  return (
    <section aria-labelledby="email-h" className={cardCls}>
      <H2 id="email-h">Email updates</H2>
      <LoadState loading={loading} error={error}>
        {data ? (
          <div className="mt-3 flex flex-col gap-4">
            <ul className="flex list-disc flex-col gap-1 pl-5">
              {summaryLines(data).map((l) => (
                <li key={l}>{l}</li>
              ))}
            </ul>
            <ReasonField id="email-reason" value={reason} onChange={setReason} error={reasonError} />
            <div>
              <Button busy={act.busy} onClick={() => void toggleSignup()}>
                {data.emailSubscribeOpen ? 'Close the email sign-up' : 'Open the email sign-up'}
              </Button>
            </div>
            <h3 className="text-h4 font-bold">Write an announcement email</h3>
            <p className="text-small">It goes to confirmed subscribers only. Every email ends with a link to stop the emails.</p>
            <Field label="Subject" htmlFor="ann-title">
              <Input id="ann-title" value={title} maxLength={200} onChange={setTitle} error={act.fields.title} />
              <ErrorText id="ann-title-error" text={act.fields.title} />
            </Field>
            <Field label="Text" htmlFor="ann-body" hint="Plain text. No phone numbers or email addresses.">
              <textarea id="ann-body" className={`${inputCls} min-h-[7rem]`} maxLength={2800} value={body} onChange={(e) => setBody(e.target.value)} aria-describedby={act.fields.body ? 'ann-body-error' : undefined} />
              <ErrorText id="ann-body-error" text={act.fields.body} />
            </Field>
            <ErrorText text={act.error} />
            <div className="flex flex-wrap gap-2">
              <Button variant="primary" busy={act.busy} onClick={() => setAskSend(true)}>
                Queue the email
              </Button>
              <Button busy={act.busy} disabled={!data.emailReady} onClick={() => void sendNow()}>
                Send queued emails now
              </Button>
            </div>
            {askSend ? (
              <Confirm
                title="Queue this email?"
                body={`It will go to ${data.subscribers.active} confirmed subscribers when the emails are sent. It cannot be taken back once sent.`}
                confirmLabel="Queue it"
                busy={act.busy}
                onConfirm={() => void queue()}
                onCancel={() => setAskSend(false)}
              />
            ) : null}
          </div>
        ) : null}
      </LoadState>
    </section>
  );
}

/** For the organizer and scorer home: the published staff notices (nothing private). */
export function StaffNoticesPanel({ store }: { store: Pick<NoticesAdminStore, 'noticesStaff'> }) {
  const { data, error, loading } = useAsync(() => store.noticesStaff(), []);
  if (!loading && !error && data && data.length === 0) return null;
  return (
    <section aria-labelledby="staff-notices-h" className={cardCls}>
      <H2 id="staff-notices-h">Notices</H2>
      <LoadState loading={loading} error={error}>
        <ul className="mt-2 flex flex-col gap-3">
          {data?.map((n) => {
            const link = noticeHref({ link_path: n.linkPath, link_url: n.linkUrl });
            return (
              <li key={n.id}>
                <strong>{n.title}</strong>
                {n.body ? <p className="whitespace-pre-line">{n.body}</p> : null}
                {link ? (
                  <a className="font-semibold underline" href={link.href} target={link.external ? '_blank' : undefined} rel={link.external ? 'noopener' : undefined}>
                    {n.linkLabel}
                  </a>
                ) : null}
              </li>
            );
          })}
        </ul>
      </LoadState>
    </section>
  );
}
