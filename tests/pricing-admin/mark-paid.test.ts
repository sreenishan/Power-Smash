import { describe, expect, it } from 'vitest';
import { allowedDocumentTypes, validateMarkPaid } from '../../src/lib/pricing-admin/mark-paid';
import type { MarkPaidInput } from '../../src/lib/pricing-admin/mark-paid';

const TODAY = '2026-10-22';
const REF = 'PS-2026-7K3QDM';

const base = (over: Partial<MarkPaidInput> = {}): MarkPaidInput => ({
  reference: REF,
  provider: 'bank_transfer',
  providerRef: 'UTR123456789',
  paidOn: '2026-10-21',
  grossPaise: 1000000,
  documentType: 'payment_receipt',
  gstRegistered: false,
  ...over,
});

function ok(input: MarkPaidInput) {
  const r = validateMarkPaid(input, TODAY);
  if (!r.ok) throw new Error(`expected ok: ${JSON.stringify(r.errors)}`);
  return r;
}

describe('Mark paid: the record (D-021)', () => {
  it('stores gross, fee, GST on fee, net settled, TDS, net received and the document type, all as integer paise', () => {
    const r = ok(base({ provider: 'razorpay', providerRef: 'pay_FAKE0001', grossPaise: 1000000, gatewayFeePaise: 20000, gstOnFeePaise: 3600, tdsPaise: 10000, tdsCertificateReceived: false, gstRegistered: true, documentType: 'invoice' }));
    expect(r.record).toMatchObject({ grossPaise: 1000000, gatewayFeePaise: 20000, gstOnFeePaise: 3600, netSettledPaise: 976400, tdsPaise: 10000, netReceivedPaise: 966400, documentType: 'invoice', provider: 'razorpay' });
    for (const v of [r.record.grossPaise, r.record.netSettledPaise, r.record.netReceivedPaise, r.record.tdsPaise]) expect(Number.isSafeInteger(v)).toBe(true);
  });

  it('a bank transfer with nothing deducted: net settled and received equal the gross', () => {
    const r = ok(base());
    expect(r.record).toMatchObject({ gatewayFeePaise: null, gstOnFeePaise: null, netSettledPaise: 1000000, tdsPaise: 0, netReceivedPaise: 1000000 });
  });

  it('a Razorpay payment with no fee entered does not guess the settled amount', () => {
    const r = ok(base({ provider: 'razorpay', providerRef: 'pay_FAKE0001' }));
    expect(r.record.netSettledPaise).toBeNull();
    expect(r.record.netReceivedPaise).toBeNull();
    expect(r.warnings.some((w) => w.includes('fee is not entered'))).toBe(true);
  });

  it('no rate is applied anywhere: zero fee and zero GST on it are taken as typed', () => {
    const r = ok(base({ provider: 'razorpay', providerRef: 'pay_FAKE0001', gatewayFeePaise: 0, gstOnFeePaise: 0 }));
    expect(r.record.netSettledPaise).toBe(1000000);
  });

  it('the fee and the GST on it come together', () => {
    expect(validateMarkPaid(base({ gatewayFeePaise: 100 }), TODAY)).toMatchObject({ ok: false, errors: { gstOnFee: expect.any(String) } });
    expect(validateMarkPaid(base({ gstOnFeePaise: 100 }), TODAY)).toMatchObject({ ok: false, errors: { gatewayFee: expect.any(String) } });
  });

  it('refuses deductions that exceed the amount received', () => {
    expect(validateMarkPaid(base({ gatewayFeePaise: 600000, gstOnFeePaise: 300000, tdsPaise: 200000 }), TODAY)).toMatchObject({ ok: false, errors: { gross: expect.any(String) } });
    expect(validateMarkPaid(base({ gatewayFeePaise: 500000, gstOnFeePaise: 300000, tdsPaise: 200000 }), TODAY).ok).toBe(true); // exactly the gross
  });

  it('rejects floats, negatives, zero and text for every amount', () => {
    for (const bad of [1.5, -1, 0, Number.NaN, '100' as unknown as number]) expect(validateMarkPaid(base({ grossPaise: bad }), TODAY)).toMatchObject({ ok: false, errors: { gross: expect.any(String) } });
    for (const bad of [1.5, -1, '5' as unknown as number]) {
      expect(validateMarkPaid(base({ gatewayFeePaise: bad, gstOnFeePaise: 0 }), TODAY).ok).toBe(false);
      expect(validateMarkPaid(base({ tdsPaise: bad }), TODAY).ok).toBe(false);
    }
  });
});

describe('Mark paid: TDS (net-of-TDS payments)', () => {
  it('a payment net of TDS clears the invoice because the gross includes the TDS', () => {
    // invoice 10,00,000.00; the sponsor pays 9,90,000.00 and deducts 10,000.00: gross counts as the full invoice
    const r = ok(base({ grossPaise: 100000000, tdsPaise: 1000000, invoiceTotalPaise: 100000000, alreadySettledPaise: 0 }));
    expect(r.settlement).toEqual({ status: 'settled', balancePaise: 0, tdsCertificatePending: true });
    expect(r.record.netReceivedPaise).toBe(99000000);
    expect(r.warnings.some((w) => w.includes('TDS certificate'))).toBe(true);
  });

  it('records the certificate when it arrives, and stops the reminder', () => {
    const r = ok(base({ tdsPaise: 5000, tdsCertificateReceived: true, tdsCertificateOn: '2026-10-22' }));
    expect(r.record).toMatchObject({ tdsCertificateReceived: true, tdsCertificateOn: '2026-10-22' });
    expect(r.settlement.tdsCertificatePending).toBe(false);
  });

  it('refuses a certificate without TDS, without a date, dated in the future, or a date without the tick', () => {
    expect(validateMarkPaid(base({ tdsCertificateReceived: true, tdsCertificateOn: '2026-10-22' }), TODAY)).toMatchObject({ ok: false, errors: { tdsCertificate: expect.any(String) } });
    expect(validateMarkPaid(base({ tdsPaise: 5, tdsCertificateReceived: true }), TODAY)).toMatchObject({ ok: false, errors: { tdsCertificate: expect.any(String) } });
    expect(validateMarkPaid(base({ tdsPaise: 5, tdsCertificateReceived: true, tdsCertificateOn: '2026-10-23' }), TODAY).ok).toBe(false);
    expect(validateMarkPaid(base({ tdsPaise: 5, tdsCertificateOn: '2026-10-22' }), TODAY).ok).toBe(false);
  });
});

describe('Mark paid: settlement against an invoice', () => {
  it('part paid, settled and overpaid', () => {
    expect(ok(base({ grossPaise: 400000, invoiceTotalPaise: 1000000 })).settlement).toMatchObject({ status: 'part_paid', balancePaise: 600000 });
    expect(ok(base({ grossPaise: 600000, invoiceTotalPaise: 1000000, alreadySettledPaise: 400000 })).settlement).toMatchObject({ status: 'settled', balancePaise: 0 });
    const over = ok(base({ grossPaise: 700000, invoiceTotalPaise: 1000000, alreadySettledPaise: 400000 }));
    expect(over.settlement).toMatchObject({ status: 'settled', balancePaise: -100000 });
    expect(over.warnings.some((w) => w.includes('more than the invoice'))).toBe(true);
  });
  it('without an invoice total the status is unknown, never guessed', () => {
    expect(ok(base()).settlement).toEqual({ status: 'unknown', balancePaise: null, tdsCertificatePending: false });
  });
});

describe('Mark paid: document type follows the GST settings (D-021)', () => {
  it('unregistered or unknown: a plain payment receipt only; registered: all four', () => {
    expect(allowedDocumentTypes(false)).toEqual(['payment_receipt']);
    expect(allowedDocumentTypes(null)).toEqual(['payment_receipt']);
    expect([...allowedDocumentTypes(true)].sort()).toEqual(['credit_note', 'invoice', 'payment_receipt', 'receipt_voucher']);
  });
  it('refuses an invoice while the business is not registered or the setting is unknown', () => {
    expect(validateMarkPaid(base({ documentType: 'invoice', gstRegistered: false }), TODAY)).toMatchObject({ ok: false, errors: { documentType: expect.stringContaining('not GST registered') } });
    expect(validateMarkPaid(base({ documentType: 'invoice', gstRegistered: null }), TODAY)).toMatchObject({ ok: false, errors: { documentType: expect.stringContaining('not set') } });
    expect(ok(base({ documentType: 'receipt_voucher', gstRegistered: true })).record.documentType).toBe('receipt_voucher');
    expect(validateMarkPaid(base({ documentType: 'bill' }), TODAY).ok).toBe(false);
  });
  it('keeps the reverse charge flag and the registration status on the record', () => {
    expect(ok(base({ gstRegistered: true, documentType: 'invoice', reverseCharge: true })).record).toMatchObject({ reverseCharge: true, gstRegistered: true });
    expect(ok(base()).record.reverseCharge).toBe(false);
  });
});

describe('Mark paid: reference, provider and dates', () => {
  it('needs a well-formed lead reference (normalised to upper case)', () => {
    expect(ok(base({ reference: ' ps-2026-7k3qdm ' })).record.reference).toBe(REF);
    for (const bad of ['PS-2026-7K3QDI', 'PS-26-7K3QDM', 'ORDER-1', '', 'PS-2026-7K3QDM; drop']) expect(validateMarkPaid(base({ reference: bad }), TODAY)).toMatchObject({ ok: false, errors: { reference: expect.any(String) } });
  });
  it('needs a payment reference unless it was cash, and keeps it tidy', () => {
    expect(validateMarkPaid(base({ providerRef: '' }), TODAY)).toMatchObject({ ok: false, errors: { providerRef: expect.any(String) } });
    expect(ok(base({ provider: 'cash', providerRef: '' })).record.providerRef).toBeNull();
    expect(validateMarkPaid(base({ providerRef: '<script>' }), TODAY).ok).toBe(false);
    expect(validateMarkPaid(base({ providerRef: 'ab' }), TODAY).ok).toBe(false);
    expect(validateMarkPaid(base({ provider: 'cheque' }), TODAY)).toMatchObject({ ok: false, errors: { provider: expect.any(String) } });
  });
  it('the payment date is a real India date, not in the future', () => {
    expect(ok(base({ paidOn: TODAY })).record.paidOn).toBe(TODAY);
    expect(validateMarkPaid(base({ paidOn: '2026-10-23' }), TODAY)).toMatchObject({ ok: false, errors: { paidOn: expect.any(String) } });
    expect(validateMarkPaid(base({ paidOn: '2026-02-30' }), TODAY).ok).toBe(false);
  });
  it('checks the invoice amounts it is given', () => {
    expect(validateMarkPaid(base({ invoiceTotalPaise: 0 }), TODAY)).toMatchObject({ ok: false, errors: { invoiceTotal: expect.any(String) } });
    expect(validateMarkPaid(base({ alreadySettledPaise: -1 }), TODAY)).toMatchObject({ ok: false, errors: { alreadySettled: expect.any(String) } });
  });
});
