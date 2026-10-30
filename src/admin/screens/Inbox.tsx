// Inbox: move an enquiry through its statuses with notes and a follow-up date (DoD 5). View models come from src/lib/inbox.
import { lazy, Suspense, useMemo, useState } from 'react';
import type { InboxLead } from '../../lib/inbox/lead';
import { TYPE_LABELS } from '../../lib/inbox/lead';
import { quickActions } from '../../lib/inbox/actions';
import { followUpState, validateFollowUpDate } from '../../lib/inbox/followup';
import { countByStatus, istDateOfInstant, moveButtons } from '../../lib/inbox/filters';
import { LEAD_STATUSES, LOST_REASON_PRESETS, STATUS_LABELS, type LeadStatus } from '../../lib/inbox/status';
import { parseRupeesToPaise, rupeesInputFromPaise } from '../../lib/pricing-admin/price-input';
import type { LeadUpdateInput } from '../../lib/admin/types';
import { Badge, Button, Confirm, Empty, Field, LoadState, TextInput, cardCls, cx, inputCls, useAdmin, useAsync, useBusy } from '../ui';

// The payment form is its own chunk: it is loaded only when the owner opens it.
const MarkPaid = lazy(() => import('./MarkPaid').then((m) => ({ default: m.MarkPaid })));
// The tournament-list step for an organizer's submission (D-103): its own chunk too.
const SubmissionToTournament = lazy(() => import('./SubmissionToTournament').then((m) => ({ default: m.SubmissionToTournament })));

const istNow = (): string => istDateOfInstant(new Date().toISOString());

export function Inbox() {
  const { client } = useAdmin();
  const q = useAsync(() => client.listLeads({ limit: 200 }), []);
  const [filter, setFilter] = useState<LeadStatus | 'open'>('open');
  const today = useMemo(istNow, []);
  const leads = q.data ?? [];
  const counts = countByStatus(leads);
  const shown = leads.filter((l) => (filter === 'open' ? l.status !== 'completed' && l.status !== 'lost' : l.status === filter));
  return (
    <div className="flex flex-col gap-4">
      <p className="text-fg-muted">Enquiries from the website. Contact details are visible only here, to you.</p>
      <div role="group" aria-label="Filter by stage" className="flex flex-wrap gap-2">
        {(['open', ...LEAD_STATUSES] as const).map((s) => (
          <button key={s} aria-pressed={filter === s} onClick={() => setFilter(s)} className={cx('min-h-tap rounded-md border-2 px-3 text-small font-bold', filter === s ? 'border-ps-court bg-ps-court text-ps-white' : 'border-line-strong bg-surface text-fg')}>
            {s === 'open' ? 'Open' : STATUS_LABELS[s]} {s === 'open' ? '' : `(${counts[s]})`}
          </button>
        ))}
      </div>
      {/* while the list reloads after a change, keep showing it, so an open panel (or a half-typed note) is not thrown away */}
      <LoadState loading={q.loading && !q.data} error={q.error}>
        {shown.length > 0 ? shown.map((l) => <LeadCard key={l.id} lead={l} today={today} />) : <Empty>No enquiries here.</Empty>}
      </LoadState>
    </div>
  );
}

function LeadCard({ lead, today }: { lead: InboxLead; today: string }) {
  const { client, actor, notify, check, bump } = useAdmin();
  const [open, setOpen] = useState(false);
  const [paying, setPaying] = useState(false);
  const [listing, setListing] = useState(false);
  const [notes, setNotes] = useState(lead.notes ?? '');
  const [follow, setFollow] = useState(lead.followUpOn ?? '');
  const [value, setValue] = useState(rupeesInputFromPaise(lead.valuePaise));
  const [move, setMove] = useState<LeadStatus | null>(null);
  const [lostReason, setLostReason] = useState('');
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [busy, run] = useBusy();
  const actions = quickActions(lead);
  const fu = followUpState(lead, today);

  const send = async (input: Omit<LeadUpdateInput, 'id'>, done: string) => {
    setErrors({});
    const r = await run(() => client.updateLead(actor, { id: lead.id, ...input }));
    setMove(null);
    if (!r) return;
    if (check(r)) {
      notify(done);
      bump();
    } else if (r.errors) setErrors(r.errors);
  };

  const saveDetails = () => {
    const input: Omit<LeadUpdateInput, 'id'> = {};
    if (notes.trim() !== (lead.notes ?? '')) input.notes = notes.trim() === '' ? null : notes;
    if (follow !== (lead.followUpOn ?? '')) {
      const f = validateFollowUpDate(follow, today);
      if (!f.ok) return setErrors({ followUpOn: f.error });
      input.followUpOn = f.date;
    }
    if (value !== rupeesInputFromPaise(lead.valuePaise)) {
      const p = parseRupeesToPaise(value);
      if (!p.ok) return setErrors({ valuePaise: p.error });
      input.valuePaise = p.paise;
    }
    if (Object.keys(input).length === 0) return setErrors({ form: 'Nothing to change.' });
    void send(input, 'Saved.');
  };

  return (
    <article className={cardCls} aria-label={`Enquiry ${lead.refCode}`}>
      <div className="flex flex-wrap items-center gap-2">
        <Badge tone={lead.status === 'lost' ? 'warn' : lead.status === 'won' || lead.status === 'completed' ? 'good' : 'neutral'}>{STATUS_LABELS[lead.status]}</Badge>
        <Badge>{TYPE_LABELS[lead.type]}</Badge>
        {fu === 'overdue' ? <Badge tone="danger">Follow-up overdue</Badge> : fu === 'due_today' ? <Badge tone="warn">Follow up today</Badge> : null}
        <span className="text-small text-fg-muted">{lead.refCode}</span>
      </div>
      <p className="mt-2 break-words text-body font-bold">{lead.name}{lead.organization ? `, ${lead.organization}` : ''}</p>
      <p className="text-small text-fg-muted">{new Date(lead.createdAt).toLocaleString('en-IN', { timeZone: 'Asia/Kolkata' })}{lead.followUpOn ? ` · Follow up ${lead.followUpOn}` : ''}</p>
      {lead.notes ? <p className="mt-1 whitespace-pre-wrap break-words text-small">{lead.notes}</p> : null}
      {lead.lostReason ? <p className="mt-1 text-small text-fg-muted">Lost: {lead.lostReason}</p> : null}
      <div className="mt-3 flex flex-wrap gap-2">
        {actions.whatsapp.href ? <a className="inline-flex min-h-tap items-center rounded-md border-2 border-line-strong px-4 font-bold no-underline" href={actions.whatsapp.href} rel="noopener noreferrer" target="_blank">WhatsApp reply{actions.whatsapp.customerAgreed ? '' : ' (asked for other contact)'}</a> : null}
        {actions.email ? <a className="inline-flex min-h-tap items-center rounded-md border-2 border-line-strong px-4 font-bold no-underline" href={actions.email}>Email reply</a> : null}
        <Button small onClick={() => setOpen(!open)}>{open ? 'Close' : 'Update'}</Button>
        <Button small onClick={() => setPaying(!paying)}>{paying ? 'Close payment' : 'Record payment'}</Button>
        {lead.type === 'tournament_submission' ? <Button small onClick={() => setListing(!listing)}>{listing ? 'Close tournament list' : 'Tournament list'}</Button> : null}
      </div>
      {listing ? (
        <Suspense fallback={<p className="mt-3 text-fg-muted">Loading...</p>}>
          <SubmissionToTournament leadId={lead.id} />
        </Suspense>
      ) : null}
      {paying ? (
        <Suspense fallback={<p className="mt-3 text-fg-muted">Loading...</p>}>
          <MarkPaid lead={lead} onDone={() => setPaying(false)} />
        </Suspense>
      ) : null}
      {open ? (
        <div className="mt-3 flex flex-col gap-3 border-t border-line pt-3">
          <div className="flex flex-wrap gap-2">
            {moveButtons(lead.status).map((m) => (
              <Button key={m.to} small variant={m.to === 'lost' ? 'quiet' : 'primary'} onClick={() => { setErrors({}); setMove(m.to); }}>{m.label}</Button>
            ))}
          </div>
          {errors.status ? <p role="alert" className="font-semibold text-ps-live">{errors.status}</p> : null}
          {move ? (
            <Confirm title={`Move to ${STATUS_LABELS[move]}?`} body="The change is recorded with the time." confirmLabel="Move" busy={busy} onConfirm={() => void send({ to: move, ...(move === 'lost' ? { lostReason } : {}) }, `Moved to ${STATUS_LABELS[move]}.`)} onCancel={() => setMove(null)}>
              {move === 'lost' ? (
                <div className="mt-3 flex flex-col gap-2">
                  <Field label="Why was it lost?" htmlFor={`lost-${lead.id}`}>
                    <TextInput id={`lost-${lead.id}`} value={lostReason} onChange={setLostReason} />
                  </Field>
                  <div className="flex flex-wrap gap-2">
                    {LOST_REASON_PRESETS.map((p) => <Button key={p} small onClick={() => setLostReason(p)}>{p}</Button>)}
                  </div>
                </div>
              ) : null}
            </Confirm>
          ) : null}
          <Field label="Notes (only you see these)" htmlFor={`notes-${lead.id}`}>
            <textarea id={`notes-${lead.id}`} className={inputCls} rows={3} value={notes} onChange={(e) => setNotes(e.target.value)} />
          </Field>
          {errors.notes ? <p role="alert" className="font-semibold text-ps-live">{errors.notes}</p> : null}
          <Field label="Follow up on" htmlFor={`fu-${lead.id}`} hint="Leave empty for no reminder.">
            <input id={`fu-${lead.id}`} type="date" className={inputCls} min={today} value={follow} onChange={(e) => setFollow(e.target.value)} />
          </Field>
          {errors.followUpOn ? <p role="alert" className="font-semibold text-ps-live">{errors.followUpOn}</p> : null}
          <Field label="Deal value in rupees" htmlFor={`val-${lead.id}`} hint="Only what you type. Nothing is filled in for you.">
            <TextInput id={`val-${lead.id}`} value={value} onChange={setValue} inputMode="numeric" />
          </Field>
          {errors.valuePaise ? <p role="alert" className="font-semibold text-ps-live">{errors.valuePaise}</p> : null}
          {errors.form ? <p role="alert" className="font-semibold text-ps-live">{errors.form}</p> : null}
          <div><Button variant="primary" busy={busy} onClick={saveDetails}>Save notes, date and value</Button></div>
        </div>
      ) : null}
    </article>
  );
}
