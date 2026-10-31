// Registrations (D-111): the owner's switch and payment texts, which events take registrations and their fee, and per event the list
// of registrations: check a payment made outside the website, add a registration to the entries (an existing player record or a new
// one of UNKNOWN age, D-012), or reject it. The owner sees the contact details here; they are never on the website.
// The screen takes its store as a prop (the integrator passes the admin client once AdminStore includes RegistrationAdminStore).
import { useState } from 'react';
import type { RegistrationAdminStore, RegistrationDto, RegistrationEventSummary } from '../../../lib/admin/registration/types';
import { rejectReasonProblem } from '../../../lib/admin/registration/rules';
import { Badge, Button, Confirm, Empty, Field, LoadState, cardCls, inputCls, useAdmin, useAsync } from '../../ui';
import { ErrorText, H2, Input, Note, ReasonField, reasonProblem, useAction } from '../competition/shared';
import {
  AGE_WORDS,
  CONTACT_REMOVED_TEXT,
  isWaiting,
  STATUS_LABEL,
  choicesNamePublicly,
  convertChoices,
  eventTitle,
  existingRecordWarning,
  initialChoices,
  feeLabel,
  nextSteps,
  parseAmountReceived,
  parseFee,
  rupeesText,
  settingsSummary,
  underpaidQuestion,
  type NameChoice,
} from './logic';

export function RegistrationsScreen({ store }: { store: RegistrationAdminStore }) {
  const [eventId, setEventId] = useState<string | null>(null);
  return eventId ? (
    <EventRegistrations store={store} eventId={eventId} onBack={() => setEventId(null)} />
  ) : (
    <div className="flex flex-col gap-6">
      <Note>Registration on the website stays off until you switch it on here AND the website switch is turned on after the lawyer has read the wording. Junior events never take registrations on the website.</Note>
      <SettingsCard store={store} />
      <EventsList store={store} onOpen={setEventId} />
    </div>
  );
}

function SettingsCard({ store }: { store: RegistrationAdminStore }) {
  const { actor, notify, bump } = useAdmin();
  const { data, error, loading } = useAsync(() => store.registrationSettings(), []);
  const act = useAction();
  const [form, setForm] = useState<{ enabled: boolean; text: string; upi: string; payee: string; reason: string } | null>(null);
  const f = form ?? (data ? { enabled: data.enabled, text: data.paymentInstructions ?? '', upi: data.upiId ?? '', payee: data.payeeName ?? '', reason: '' } : null);
  const [reasonError, setReasonError] = useState<string | null>(null);
  const save = async () => {
    if (!f) return;
    const p = reasonProblem(f.reason);
    setReasonError(p);
    if (p) return;
    const r = await act.run(() =>
      store.registrationSaveSettings(actor, { enabled: f.enabled, paymentInstructions: f.text.trim() || null, upiId: f.upi.trim() || null, payeeName: f.payee.trim() || null, reason: f.reason.trim() }),
    );
    if (!r) return;
    setForm(null);
    notify(r.fields.length === 0 ? 'Nothing changed.' : 'Registration settings saved.');
    bump();
  };
  return (
    <section aria-labelledby="reg-settings-h" className={cardCls}>
      <H2 id="reg-settings-h">Registration settings</H2>
      <LoadState loading={loading} error={error}>
        {f ? (
          <div className="mt-3 flex flex-col gap-4">
            <p>{settingsSummary(data?.enabled === true)}</p>
            <label className="flex min-h-tap items-center gap-3 font-semibold">
              <input type="checkbox" className="h-5 w-5" checked={f.enabled} onChange={(e) => setForm({ ...f, enabled: e.target.checked })} />
              Take registrations on the website
            </label>
            <Field label="How to pay (shown on events with a fee)" htmlFor="reg-pay-text" hint="Optional. Your own words, for example where to pay and what to write in the payment note. No phone numbers, email addresses or WhatsApp links: this text is public. Nothing is shown when empty.">
              <textarea id="reg-pay-text" className={`${inputCls} min-h-[5rem]`} maxLength={1000} value={f.text} onChange={(e) => setForm({ ...f, text: e.target.value })} />
              <ErrorText id="reg-pay-text-error" text={act.fields.paymentInstructions} />
            </Field>
            <Field label="UPI id to pay" htmlFor="reg-upi" hint="Optional, for example name@bank. Shown with the name below so payers can check it. Not a UPI id made from your phone number: that would publish the number.">
              <Input id="reg-upi" value={f.upi} maxLength={130} onChange={(v) => setForm({ ...f, upi: v })} error={act.fields.upiId} />
              <ErrorText id="reg-upi-error" text={act.fields.upiId} />
            </Field>
            <Field label="Name the UPI id pays" htmlFor="reg-payee">
              <Input id="reg-payee" value={f.payee} maxLength={80} onChange={(v) => setForm({ ...f, payee: v })} error={act.fields.payeeName} />
              <ErrorText id="reg-payee-error" text={act.fields.payeeName} />
            </Field>
            <ReasonField id="reg-settings-reason" value={f.reason} onChange={(v) => setForm({ ...f, reason: v })} error={reasonError} />
            <ErrorText text={act.error} />
            <div>
              <Button variant="primary" busy={act.busy} onClick={() => void save()}>
                Save settings
              </Button>
            </div>
          </div>
        ) : null}
      </LoadState>
    </section>
  );
}

function EventsList({ store, onOpen }: { store: RegistrationAdminStore; onOpen: (id: string) => void }) {
  const { data, error, loading } = useAsync(() => store.registrationEvents(), []);
  return (
    <section aria-labelledby="reg-events-h" className="flex flex-col gap-3">
      <H2 id="reg-events-h">Events</H2>
      <LoadState loading={loading} error={error}>
        {data && data.length === 0 ? <Empty>No events yet. Add events in Competitions first.</Empty> : null}
        {data?.map((e) => <EventCard key={e.id} store={store} e={e} onOpen={() => onOpen(e.id)} />)}
      </LoadState>
    </section>
  );
}

function EventCard({ store, e, onOpen }: { store: RegistrationAdminStore; e: RegistrationEventSummary; onOpen: () => void }) {
  const { actor, notify, bump } = useAdmin();
  const act = useAction();
  const [open, setOpen] = useState(e.registrationOpen);
  const [fee, setFee] = useState(rupeesText(e.entryFeePaise));
  const [reason, setReason] = useState('');
  const [reasonError, setReasonError] = useState<string | null>(null);
  const id = (n: string) => `reg-${e.id}-${n}`;
  const waiting = e.counts.submitted + e.counts.payment_verified;
  const save = async () => {
    const parsed = parseFee(fee);
    if (!parsed.ok) return act.fail('Check the fee.', { fee: parsed.error });
    const p = reasonProblem(reason);
    setReasonError(p);
    if (p) return;
    const r = await act.run(() => store.registrationSetEvent(actor, { eventId: e.id, open, entryFeePaise: parsed.paise, reason: reason.trim() }));
    if (!r) return;
    setReason('');
    notify(r.fields.length === 0 ? 'Nothing changed.' : 'Saved.');
    bump();
  };
  return (
    <article aria-label={eventTitle(e)} className={cardCls}>
      <div className="flex flex-wrap items-center gap-2">
        <strong>{eventTitle(e)}</strong>
        {e.junior ? <Badge tone="warn">Junior: no registration on the website</Badge> : null}
        {e.registrationOpen ? <Badge tone="good">Taking registrations</Badge> : <Badge>Not taking registrations</Badge>}
        <span className="text-fg-muted">Fee: {feeLabel(e.entryFeePaise)}</span>
      </div>
      <p className="mt-2 text-fg-muted">
        {waiting} waiting, {e.counts.converted} added to entries, {e.counts.rejected} rejected.
        {e.capacity !== null ? ` Places: ${e.capacity}.` : ''}
      </p>
      {!e.junior ? (
        <details className="mt-3">
          <summary className="min-h-tap cursor-pointer py-2 font-semibold">Change registration and fee</summary>
          <div className="mt-2 flex flex-col gap-3">
            <label className="flex min-h-tap items-center gap-3">
              <input type="checkbox" className="h-5 w-5" checked={open} disabled={e.status !== 'open' && !e.registrationOpen} onChange={(ev) => setOpen(ev.target.checked)} />
              Take registrations for this event
            </label>
            {e.status !== 'open' ? <Note tone="warn">The event itself is {e.status}. Open it in Competitions first.</Note> : null}
            <Field label="Entry fee in rupees" htmlFor={id('fee')} hint={'Leave empty for no fee. Paid outside the website; you check each payment here. After a change, press "Publish now" on the dashboard so the registration page shows the new fee: until then visitors still see the old one.'}>
              <Input id={id('fee')} value={fee} inputMode="decimal" maxLength={16} onChange={setFee} error={act.fields.fee} />
              <ErrorText id={`${id('fee')}-error`} text={act.fields.fee} />
            </Field>
            <ReasonField id={id('reason')} value={reason} onChange={setReason} error={reasonError} />
            <ErrorText text={act.error} />
            <div>
              <Button variant="primary" busy={act.busy} onClick={() => void save()}>
                Save
              </Button>
            </div>
          </div>
        </details>
      ) : null}
      <div className="mt-3">
        <Button onClick={onOpen}>See registrations ({e.counts.submitted + e.counts.payment_verified + e.counts.converted + e.counts.rejected})</Button>
      </div>
    </article>
  );
}

function EventRegistrations({ store, eventId, onBack }: { store: RegistrationAdminStore; eventId: string; onBack: () => void }) {
  const { data, error, loading } = useAsync(() => store.registrationList({ eventId }), [eventId]);
  const open = data?.registrations.filter((r) => isWaiting(r)) ?? [];
  const done = data?.registrations.filter((r) => !isWaiting(r)) ?? [];
  return (
    <div className="flex flex-col gap-4">
      <div>
        <Button onClick={onBack}>Back to events</Button>
      </div>
      <LoadState loading={loading} error={error}>
        {data ? (
          <>
            <H2>{eventTitle(data.event)}</H2>
            <p className="text-fg-muted">Fee: {feeLabel(data.event.entryFeePaise)}. Names stay private until you confirm a player is an adult in Players.</p>
            {open.length === 0 ? <Empty>No registrations waiting.</Empty> : open.map((r) => <RegistrationCard key={r.id} store={store} r={r} />)}
            {done.length > 0 ? (
              <details className="rounded-lg border border-line p-3">
                <summary className="min-h-tap cursor-pointer py-2 font-semibold">Added, rejected and cleared ({done.length})</summary>
                <ul className="mt-2 flex flex-col gap-1">
                  {done.map((r) => (
                    <li key={r.id}>
                      {r.ref} · {r.names.map((n) => n.typed).join(' & ')} · {STATUS_LABEL[r.status]}
                      {r.rejectedReason ? ` (${r.rejectedReason})` : ''}
                      {r.anonymisedAt ? ` · ${CONTACT_REMOVED_TEXT}` : ''}
                    </li>
                  ))}
                </ul>
              </details>
            ) : null}
          </>
        ) : null}
      </LoadState>
    </div>
  );
}

function RegistrationCard({ store, r }: { store: RegistrationAdminStore; r: RegistrationDto }) {
  const { actor, notify, bump } = useAdmin();
  const act = useAction();
  const steps = nextSteps(r);
  const [amount, setAmount] = useState(r.verifiedAmountPaise !== null ? rupeesText(r.verifiedAmountPaise) : '');
  // D-012: every name starts as a NEW record (age unknown); a matching record is only ever picked by the owner on purpose
  const [choices, setChoices] = useState<NameChoice[]>(initialChoices(r));
  const [entryStatus, setEntryStatus] = useState<'pending' | 'confirmed' | 'waitlisted'>('confirmed');
  const [asking, setAsking] = useState<'reject' | 'underpaid' | 'name' | null>(null);
  const [reason, setReason] = useState('');
  const [reasonError, setReasonError] = useState<string | null>(null);
  const id = (n: string) => `reg-${r.id}-${n}`;
  const typedAmount = parseAmountReceived(amount);
  const underpaid = typedAmount.ok ? underpaidQuestion(typedAmount.paise, r.feePaiseAtSubmit) : null;

  const verify = async (sure = false) => {
    const a = parseAmountReceived(amount);
    if (!a.ok) return act.fail('Check the amount.', { amount: a.error });
    if (!sure && underpaidQuestion(a.paise, r.feePaiseAtSubmit)) return setAsking('underpaid');
    setAsking(null);
    const res = await act.run(() => store.registrationVerifyPayment(actor, { registrationId: r.id, amountPaise: a.paise, expectedRevision: r.revision, reason: `Payment of ${feeLabel(a.paise)} checked by owner` }));
    if (!res) return;
    notify('Payment marked as checked.');
    bump();
  };
  const convert = async (sure = false) => {
    if (!sure && choicesNamePublicly(r, choices)) return setAsking('name');
    setAsking(null);
    const res = await act.run(() =>
      store.registrationConvert(actor, { registrationId: r.id, players: convertChoices(r, choices), status: entryStatus, expectedRevision: r.revision, reason: 'Registration added to entries by owner' }),
    );
    if (!res) return;
    notify(res.newPlayerIds.length > 0 ? 'Added to the entries. New player records start as "age unknown" and stay "Protected player" on the website.' : 'Added to the entries.');
    bump();
  };
  const reject = async () => {
    const p = reasonProblem(reason) ?? rejectReasonProblem(reason);
    setReasonError(p);
    if (p) return;
    const res = await act.run(() => store.registrationReject(actor, { registrationId: r.id, expectedRevision: r.revision, reason: reason.trim() }));
    setAsking(null);
    if (!res) return;
    notify('Registration rejected.');
    bump();
  };

  return (
    <article aria-label={`Registration ${r.ref}`} className={cardCls}>
      <div className="flex flex-wrap items-center gap-2">
        <strong className="ps-num">{r.ref}</strong>
        <Badge tone={r.status === 'payment_verified' ? 'good' : 'neutral'}>{STATUS_LABEL[r.status]}</Badge>
      </div>
      <dl className="mt-2 grid grid-cols-[auto_1fr] gap-x-3 gap-y-1">
        <dt className="font-semibold">Player{r.names.length > 1 ? 's' : ''}</dt>
        <dd>{r.names.map((n) => n.typed).join(' & ')}</dd>
        <dt className="font-semibold">Phone</dt>
        {r.phone === null || r.anonymisedAt ? (
          <dd>{CONTACT_REMOVED_TEXT}</dd>
        ) : (
          <dd className="ps-num">
            {r.phone}
            {r.whatsappOk ? ' (WhatsApp)' : ''}
          </dd>
        )}
        {r.email ? (
          <>
            <dt className="font-semibold">Email</dt>
            <dd className="break-all">{r.email}</dd>
          </>
        ) : null}
        <dt className="font-semibold">Fee</dt>
        <dd>{feeLabel(r.feePaiseAtSubmit)}</dd>
        {r.paymentReference ? (
          <>
            <dt className="font-semibold">Payment reference</dt>
            <dd className="ps-num break-all">{r.paymentReference}</dd>
          </>
        ) : null}
        {r.verifiedAmountPaise !== null ? (
          <>
            <dt className="font-semibold">Received</dt>
            <dd>{r.verifiedAmountPaise === 0 ? 'Fee waived' : feeLabel(r.verifiedAmountPaise)}</dd>
          </>
        ) : null}
      </dl>

      {steps.verify && r.feePaiseAtSubmit !== null ? (
        <div className="mt-3 flex flex-col gap-2">
          <Field label="Amount received, in rupees" htmlFor={id('amount')} hint="Check your bank or UPI app first. 0 means you waive the fee.">
            <Input id={id('amount')} value={amount} inputMode="decimal" maxLength={16} onChange={setAmount} error={act.fields.amount} />
            <ErrorText id={`${id('amount')}-error`} text={act.fields.amount} />
          </Field>
          <div className="flex flex-wrap gap-2">
            <Button onClick={() => setAmount(rupeesText(r.feePaiseAtSubmit))}>Same as the fee</Button>
            <Button variant="primary" busy={act.busy} onClick={() => void verify()}>
              Payment checked
            </Button>
          </div>
          {asking === 'underpaid' ? (
            <Confirm
              title="Less than the fee?"
              body={underpaid ?? ''}
              confirmLabel="Record it anyway"
              busy={act.busy}
              onConfirm={() => void verify(true)}
              onCancel={() => setAsking(null)}
            />
          ) : null}
        </div>
      ) : null}

      {steps.convert ? (
        <fieldset className="mt-4 flex flex-col gap-3">
          <legend className="font-semibold">Add to the entries</legend>
          {r.names.map((n, i) => (
            <div key={i} className="flex flex-col gap-1">
              <span>{n.typed}</span>
              {n.candidates.map((c) => (
                <div key={c.id} className="flex flex-col">
                  <label className="flex min-h-tap items-center gap-2">
                    <input type="radio" name={id(`name-${i}`)} checked={choices[i] === c.id} onChange={() => setChoices(choices.map((x, j) => (j === i ? c.id : x)))} />
                    Same name, existing record: {c.displayName} ({AGE_WORDS[c.ageStatus] ?? c.ageStatus})
                  </label>
                  {choices[i] === c.id && existingRecordWarning(c.ageStatus) ? <Note tone="warn">{existingRecordWarning(c.ageStatus)}</Note> : null}
                </div>
              ))}
              <label className="flex min-h-tap items-center gap-2">
                <input type="radio" name={id(`name-${i}`)} checked={choices[i] === 'new'} onChange={() => setChoices(choices.map((x, j) => (j === i ? 'new' : x)))} />
                New player record (age unknown until you confirm it)
              </label>
            </div>
          ))}
          <Field label="Entry status" htmlFor={id('entry-status')}>
            <select id={id('entry-status')} className={inputCls} value={entryStatus} onChange={(e) => setEntryStatus(e.target.value as typeof entryStatus)}>
              <option value="confirmed">Confirmed</option>
              <option value="pending">Pending</option>
              <option value="waitlisted">Waiting list</option>
            </select>
          </Field>
          <div>
            <Button variant="primary" busy={act.busy} onClick={() => void convert()}>
              Add to entries
            </Button>
          </div>
          {asking === 'name' ? (
            <Confirm
              title="Show this name on the website?"
              body="You picked an existing record of a confirmed adult. That person is then named on the competition pages. Go on only if you know it is the same person, not just the same name."
              confirmLabel="Yes, same person"
              busy={act.busy}
              onConfirm={() => void convert(true)}
              onCancel={() => setAsking(null)}
            />
          ) : null}
        </fieldset>
      ) : r.status === 'submitted' && r.needsVerification ? (
        <p className="mt-3 text-fg-muted">Check the payment first; then you can add this registration to the entries.</p>
      ) : null}

      <ErrorText text={act.error} />
      {steps.reject ? (
        <div className="mt-3">
          <Button variant="danger" onClick={() => setAsking('reject')}>
            Reject
          </Button>
        </div>
      ) : null}
      {asking === 'reject' ? (
        <Confirm title="Reject this registration?" body="The person is not added to the entries. The reason stays private in the admin." confirmLabel="Reject" danger busy={act.busy} onConfirm={() => void reject()} onCancel={() => setAsking(null)}>
          <ReasonField id={id('reject-reason')} value={reason} onChange={setReason} error={reasonError} label="Reason (private, kept in the record of changes; no phone numbers or emails)" />
        </Confirm>
      ) : null}
    </article>
  );
}
