// Mark paid: record a payment on an enquiry. The owner types every figure; nothing is filled in or worked out except the plain
// subtraction shown in the review step (src/lib/pricing-admin/mark-paid.ts). Loaded on demand from the Inbox.
import { useState } from 'react';
import type { InboxLead } from '../../lib/inbox/lead';
import { parsePaiseField } from '../../lib/admin/money-input';
import type { MarkPaidRequest } from '../../lib/admin/types';
import { formatInr } from '../../lib/money';
import { allowedDocumentTypes, validateMarkPaid, type DocumentType } from '../../lib/pricing-admin/mark-paid';
import { Badge, Button, Confirm, Field, LoadState, TextInput, cx, inputCls, useAdmin, useAsync, useBusy } from '../ui';

const METHODS = [
  ['upi_manual', 'UPI (paid to your UPI id)'],
  ['bank_transfer', 'Bank transfer'],
  ['razorpay', 'Razorpay payment link'],
  ['cash', 'Cash'],
] as const;

const DOC_LABEL: Record<DocumentType, string> = {
  payment_receipt: 'Payment receipt (no GST line)',
  invoice: 'Invoice',
  receipt_voucher: 'Receipt voucher',
  credit_note: 'Credit note',
};

const todayIst = (): string => new Date(Date.now() + 5.5 * 3600 * 1000).toISOString().slice(0, 10);
const inr = (p: number | null): string => (p === null ? 'not worked out' : formatInr(p));

export function MarkPaid({ lead, onDone }: { lead: InboxLead; onDone: () => void }) {
  const { client, actor, notify, check, bump } = useAdmin();
  const earlier = useAsync(() => client.listPayments({ leadId: lead.id }), [lead.id]);
  const today = todayIst();
  const [f, setF] = useState({ provider: '', providerRef: '', paidOn: today, gross: '', fee: '', gstFee: '', tds: '', certReceived: false, certOn: '', gst: 'unknown', docType: 'payment_receipt', invoiceTotal: '' });
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [review, setReview] = useState<MarkPaidRequest | null>(null);
  const [busy, run] = useBusy();
  const set = <K extends keyof typeof f>(k: K) => (v: (typeof f)[K]) => setF((x) => ({ ...x, [k]: v }));
  const gstRegistered = f.gst === 'yes' ? true : f.gst === 'no' ? false : null;
  const docs = allowedDocumentTypes(gstRegistered);

  const build = (): MarkPaidRequest | null => {
    const e: Record<string, string> = {};
    const gross = parsePaiseField(f.gross);
    const fee = parsePaiseField(f.fee, { allowZero: true });
    const gstFee = parsePaiseField(f.gstFee, { allowZero: true });
    const tds = parsePaiseField(f.tds, { allowZero: true });
    const total = parsePaiseField(f.invoiceTotal);
    if (!gross.ok) e.gross = gross.error;
    else if (gross.paise === null) e.gross = 'Type the amount you received.';
    if (!fee.ok) e.gatewayFee = fee.error;
    if (!gstFee.ok) e.gstOnFee = gstFee.error;
    if (!tds.ok) e.tds = tds.error;
    if (!total.ok) e.invoiceTotal = total.error;
    if (!f.provider) e.provider = 'Choose how it was paid.';
    if (Object.keys(e).length > 0 || !gross.ok || !fee.ok || !gstFee.ok || !tds.ok || !total.ok) {
      setErrors(e);
      return null;
    }
    const docType = docs.includes(f.docType as DocumentType) ? f.docType : 'payment_receipt';
    const req: MarkPaidRequest = {
      leadId: lead.id,
      provider: f.provider,
      providerRef: f.providerRef.trim() === '' ? null : f.providerRef.trim(),
      paidOn: f.paidOn,
      grossPaise: gross.paise as number,
      gatewayFeePaise: fee.paise,
      gstOnFeePaise: gstFee.paise,
      tdsPaise: tds.paise,
      tdsCertificateReceived: f.certReceived,
      tdsCertificateOn: f.certReceived && f.certOn !== '' ? f.certOn : null,
      documentType: docType,
      gstRegistered,
      invoiceTotalPaise: total.paise,
    };
    // the same rules the server applies, so the owner sees every problem here first
    const prior = earlier.data?.reduce((s, p) => s + p.grossPaise, 0) ?? 0;
    const v = validateMarkPaid({ reference: lead.refCode, ...req, alreadySettledPaise: req.invoiceTotalPaise != null && prior > 0 ? prior : null }, today);
    if (!v.ok) {
      setErrors(v.errors as Record<string, string>);
      return null;
    }
    setErrors({});
    return req;
  };

  const preview = review
    ? validateMarkPaid({ reference: lead.refCode, ...review, alreadySettledPaise: review.invoiceTotalPaise != null && (earlier.data?.length ?? 0) > 0 ? earlier.data!.reduce((s, p) => s + p.grossPaise, 0) : null }, today)
    : null;

  const save = async () => {
    if (!review) return;
    const r = await run(() => client.markPaid(actor, review));
    setReview(null);
    if (!r) return;
    if (check(r)) {
      notify(r.data.leadStatus === 'completed' ? 'Payment recorded. The enquiry is completed.' : 'Payment recorded. The enquiry is won.');
      bump();
      onDone();
    } else setErrors(r.errors ?? {});
  };

  const err = (k: string) => (errors[k] ? <p role="alert" className="font-semibold text-ps-live">{errors[k]}</p> : null);

  return (
    <form className="mt-3 flex flex-col gap-3 border-t border-line pt-3" onSubmit={(e) => { e.preventDefault(); const r = build(); if (r) setReview(r); }} aria-label={`Record a payment for ${lead.refCode}`}>
      <h3 className="text-h4 font-bold text-heading">Record a payment</h3>
      <p className="text-small text-fg-muted">Type every figure yourself. Nothing is filled in for you, and the site does not know any fee or tax rate. Ask your accountant if unsure.</p>
      <LoadState loading={earlier.loading} error={earlier.error}>
        {earlier.data && earlier.data.length > 0 ? (
          <ul className="text-small">
            {earlier.data.map((p, i) => (
              <li key={`${p.paidOn}-${i}`}><Badge>Earlier payment</Badge> {p.paidOn}: {formatInr(p.grossPaise)}</li>
            ))}
          </ul>
        ) : null}
      </LoadState>
      <Field label="How was it paid?" htmlFor="mp-method">
        <select id="mp-method" className={inputCls} value={f.provider} onChange={(e) => set('provider')(e.target.value)}>
          <option value="">Choose...</option>
          {METHODS.map(([k, l]) => <option key={k} value={k}>{l}</option>)}
        </select>
      </Field>
      {err('provider')}
      <Field label={f.provider === 'cash' ? 'Reference (optional for cash)' : 'Payment id or bank reference (UTR)'} htmlFor="mp-ref">
        <TextInput id="mp-ref" value={f.providerRef} onChange={set('providerRef')} />
      </Field>
      {err('providerRef')}
      <Field label="Date the money arrived" htmlFor="mp-date">
        <input id="mp-date" type="date" className={inputCls} max={today} value={f.paidOn} onChange={(e) => set('paidOn')(e.target.value)} />
      </Field>
      {err('paidOn')}
      <Field label="Amount received, in rupees" htmlFor="mp-gross" hint="The full amount this payment covers, including any TDS the payer kept back.">
        <TextInput id="mp-gross" value={f.gross} onChange={set('gross')} inputMode="numeric" />
      </Field>
      {err('gross')}
      <div className="grid grid-cols-2 gap-3">
        <Field label="Gateway fee (rupees)" htmlFor="mp-fee" hint="Razorpay only. 0 if none.">
          <TextInput id="mp-fee" value={f.fee} onChange={set('fee')} inputMode="numeric" />
        </Field>
        <Field label="GST on that fee" htmlFor="mp-gstfee" hint="Type 0 if none.">
          <TextInput id="mp-gstfee" value={f.gstFee} onChange={set('gstFee')} inputMode="numeric" />
        </Field>
      </div>
      {err('gatewayFee')}{err('gstOnFee')}
      <Field label="TDS deducted by the payer (rupees)" htmlFor="mp-tds" hint="Leave empty if none.">
        <TextInput id="mp-tds" value={f.tds} onChange={set('tds')} inputMode="numeric" />
      </Field>
      {err('tds')}
      <label className="flex min-h-tap items-center gap-2"><input type="checkbox" className="h-5 w-5" checked={f.certReceived} onChange={(e) => set('certReceived')(e.target.checked)} />The TDS certificate has arrived</label>
      {f.certReceived ? (
        <Field label="Date the certificate arrived" htmlFor="mp-cert"><input id="mp-cert" type="date" className={inputCls} max={today} value={f.certOn} onChange={(e) => set('certOn')(e.target.value)} /></Field>
      ) : null}
      {err('tdsCertificate')}
      <Field label="Is the business registered for GST?" htmlFor="mp-gst" hint="Until you say yes, only a payment receipt can be issued.">
        <select id="mp-gst" className={inputCls} value={f.gst} onChange={(e) => { set('gst')(e.target.value); set('docType')('payment_receipt'); }}>
          <option value="unknown">Not set yet</option>
          <option value="yes">Yes, registered</option>
          <option value="no">No, not registered</option>
        </select>
      </Field>
      <Field label="Document to issue" htmlFor="mp-doc">
        <select id="mp-doc" className={inputCls} value={docs.includes(f.docType as DocumentType) ? f.docType : 'payment_receipt'} onChange={(e) => set('docType')(e.target.value)}>
          {docs.map((d) => <option key={d} value={d}>{DOC_LABEL[d]}</option>)}
        </select>
      </Field>
      {err('documentType')}
      <Field label="Invoice total in rupees (optional)" htmlFor="mp-total" hint="Type it to see whether this payment settles the invoice.">
        <TextInput id="mp-total" value={f.invoiceTotal} onChange={set('invoiceTotal')} inputMode="numeric" />
      </Field>
      {err('invoiceTotal')}
      {errors.form ? <p role="alert" className="font-semibold text-ps-live">{errors.form}</p> : null}
      <div><Button type="submit" variant="primary">Review the payment</Button></div>
      {review && preview?.ok ? (
        <Confirm title="Record this payment?" body={`Once recorded it cannot be edited here. If it is wrong, tell your accountant and add a correcting entry.`} confirmLabel="Record payment" busy={busy} onConfirm={() => void save()} onCancel={() => setReview(null)}>
          <dl className={cx('mt-3 grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 text-small')}>
            <dt>Received</dt><dd className="ps-num font-semibold">{formatInr(preview.record.grossPaise)}</dd>
            <dt>Gateway fee and GST on it</dt><dd className="ps-num">{preview.record.gatewayFeePaise === null ? 'not entered' : `${formatInr(preview.record.gatewayFeePaise)} + ${formatInr(preview.record.gstOnFeePaise ?? 0)}`}</dd>
            <dt>TDS kept back</dt><dd className="ps-num">{formatInr(preview.record.tdsPaise)}</dd>
            <dt>Settled to the bank</dt><dd className="ps-num">{inr(preview.record.netSettledPaise)}</dd>
            <dt>Reaches your bank after TDS</dt><dd className="ps-num font-semibold">{inr(preview.record.netReceivedPaise)}</dd>
            <dt>Document</dt><dd>{DOC_LABEL[preview.record.documentType]}</dd>
            {preview.settlement.balancePaise !== null ? (<><dt>Invoice</dt><dd>{preview.settlement.status === 'settled' ? 'Settled with this payment' : `Still to pay: ${formatInr(preview.settlement.balancePaise)}`}</dd></>) : null}
          </dl>
          {preview.warnings.length > 0 ? <ul className="mt-2 list-disc pl-5 text-small">{preview.warnings.map((w) => <li key={w}>{w}</li>)}</ul> : null}
          <p className="mt-2 text-small">The enquiry moves to {preview.settlement.status === 'settled' ? 'Completed' : 'Won'} (unless it is already there).</p>
        </Confirm>
      ) : null}
    </form>
  );
}
