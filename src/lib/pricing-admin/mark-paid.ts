// "Mark paid" record (BUILD_PLAN M3, D-020, D-021, spec 8.2). PURE: validation and the derived amounts.
//
// D-021: the build STORES FACTS; it computes no tax and knows no rate. Every amount is typed by the owner as integer paise; the only
// arithmetic is subtraction of amounts the owner entered. Nothing here knows a gateway fee, a GST rate or a TDS rate, and there are no
// defaults for any of them. All tax treatments are for the CA to confirm (OWNER_TODO: CA question list).
//
// Meaning of the fields (PROPOSED wording, docs/m2/business-notes.md; the CA confirms):
//   gross               what this payment settles against the invoice, INCLUDING any TDS the payer withheld.
//   gatewayFee          the payment gateway's fee (Razorpay payments).
//   gstOnFee            the GST the gateway charged on its fee.
//   netSettled          gross - gatewayFee - gstOnFee: what the gateway settles to the bank (only when both fee amounts are entered).
//   tds                 tax the payer deducted at source (a sponsor may remit less than the invoice).
//   netReceived         netSettled - tds: what actually reaches the bank.
//   TDS certificate     received yes/no and the date; a pending certificate is a reminder, never a reason to leave the invoice open.
//   documentType        invoice, receipt_voucher, credit_note or payment_receipt. While the business is not GST-registered (or that is
//                       not yet known) only a plain `payment_receipt` with no GST line may be issued (D-021).
// "Net-of-TDS" payments: the invoice is cleared by gross (TDS included), so a sponsor who pays invoice minus TDS does not leave the invoice
// wrongly open; the certificate reminder stays until it arrives.
import { isIsoDate } from '../dates';
import { isAmountPaise, isNonNegativePaise } from './price-input';

export const PAYMENT_PROVIDERS = ['razorpay', 'upi_manual', 'bank_transfer', 'cash'] as const;
export type PaymentProvider = (typeof PAYMENT_PROVIDERS)[number];

export const DOCUMENT_TYPES = ['invoice', 'receipt_voucher', 'credit_note', 'payment_receipt'] as const;
export type DocumentType = (typeof DOCUMENT_TYPES)[number];

export interface MarkPaidInput {
  /** The lead or order reference code (PS-YYYY-XXXXXX). */
  reference: string;
  provider: string;
  /** Payment id, UTR or cheque number. Required unless the payment was cash. */
  providerRef?: string | null;
  /** IST calendar date the money arrived. */
  paidOn: string;
  grossPaise: number;
  gatewayFeePaise?: number | null;
  gstOnFeePaise?: number | null;
  tdsPaise?: number | null;
  tdsCertificateReceived?: boolean | null;
  /** IST date the certificate arrived (needed when it was received). */
  tdsCertificateOn?: string | null;
  documentType: string;
  /** GST registration as recorded in settings: true, false, or null when the owner has not said yet. */
  gstRegistered: boolean | null;
  reverseCharge?: boolean | null;
  /** The invoice total this payment is against, in paise (optional: lets the screen say settled or part paid). */
  invoiceTotalPaise?: number | null;
  /** Gross of earlier payments already recorded against the same invoice. */
  alreadySettledPaise?: number | null;
}

export type MarkPaidField = 'reference' | 'provider' | 'providerRef' | 'paidOn' | 'gross' | 'gatewayFee' | 'gstOnFee' | 'tds' | 'tdsCertificate' | 'documentType' | 'invoiceTotal' | 'alreadySettled';

export interface PaymentRecord {
  reference: string;
  provider: PaymentProvider;
  providerRef: string | null;
  paidOn: string;
  grossPaise: number;
  gatewayFeePaise: number | null;
  gstOnFeePaise: number | null;
  /** gross - fee - gst on fee, or null while the fee amounts are not both known. */
  netSettledPaise: number | null;
  tdsPaise: number;
  /** netSettled - tds, or null while netSettled is unknown. */
  netReceivedPaise: number | null;
  tdsCertificateReceived: boolean;
  tdsCertificateOn: string | null;
  documentType: DocumentType;
  gstRegistered: boolean | null;
  reverseCharge: boolean;
}

export interface Settlement {
  status: 'settled' | 'part_paid' | 'unknown';
  /** Invoice total minus everything cleared so far (negative = overpaid). Null when the invoice total was not given. */
  balancePaise: number | null;
  /** TDS was deducted and its certificate has not arrived yet. */
  tdsCertificatePending: boolean;
}

export type MarkPaidValidation = { ok: true; record: PaymentRecord; settlement: Settlement; warnings: string[] } | { ok: false; errors: Partial<Record<MarkPaidField, string>> };

const REF = /^PS-\d{4}-[0-9A-HJKMNP-TV-Z]{6}$/;
const PROVIDER_REF = /^[A-Za-z0-9][A-Za-z0-9 _./:-]{2,79}$/;

/** The document types the owner may pick, given the GST settings. Unregistered or unknown: a plain payment receipt only. */
export function allowedDocumentTypes(gstRegistered: boolean | null): readonly DocumentType[] {
  return gstRegistered === true ? DOCUMENT_TYPES : ['payment_receipt'];
}

export function validateMarkPaid(input: MarkPaidInput, today: string): MarkPaidValidation {
  const errors: Partial<Record<MarkPaidField, string>> = {};
  const warnings: string[] = [];

  const reference = typeof input.reference === 'string' ? input.reference.trim().toUpperCase() : '';
  if (!REF.test(reference)) errors.reference = 'Enter the reference, for example PS-2026-7K3QDM.';

  const provider = (PAYMENT_PROVIDERS as readonly string[]).includes(input.provider) ? (input.provider as PaymentProvider) : null;
  if (!provider) errors.provider = 'Choose how it was paid.';

  const providerRef = (input.providerRef ?? '').trim();
  if (providerRef !== '' && !PROVIDER_REF.test(providerRef)) errors.providerRef = 'The payment reference can use letters, digits and - _ . / : only (3 to 80 characters).';
  else if (providerRef === '' && provider && provider !== 'cash') errors.providerRef = 'Enter the payment id or bank reference (UTR).';

  if (!isIsoDate(input.paidOn)) errors.paidOn = 'Choose the date the money arrived.';
  else if (input.paidOn > today) errors.paidOn = 'The payment date cannot be in the future.';

  if (!isAmountPaise(input.grossPaise)) errors.gross = 'Enter the amount received, more than zero.';

  const fee = input.gatewayFeePaise ?? null;
  const gstFee = input.gstOnFeePaise ?? null;
  if (fee !== null && !isNonNegativePaise(fee)) errors.gatewayFee = 'The gateway fee must be an amount of zero or more.';
  if (gstFee !== null && !isNonNegativePaise(gstFee)) errors.gstOnFee = 'The GST on the fee must be an amount of zero or more.';
  if ((fee === null) !== (gstFee === null) && !errors.gatewayFee && !errors.gstOnFee) {
    if (fee === null) errors.gatewayFee = 'Enter the gateway fee (0 if there was none) together with the GST on it.';
    else errors.gstOnFee = 'Enter the GST on the fee (0 if there was none) together with the fee.';
  }

  const tdsRaw = input.tdsPaise ?? null;
  if (tdsRaw !== null && !isNonNegativePaise(tdsRaw)) errors.tds = 'TDS must be an amount of zero or more.';
  const tds = tdsRaw ?? 0;

  if (isAmountPaise(input.grossPaise) && !errors.gatewayFee && !errors.gstOnFee && !errors.tds) {
    if ((fee ?? 0) + (gstFee ?? 0) + tds > input.grossPaise) errors.gross = 'The fee, the GST on it and the TDS add up to more than the amount received.';
  }

  const certReceived = input.tdsCertificateReceived === true;
  const certOn = input.tdsCertificateOn ?? null;
  if (tds === 0 && (certReceived || certOn)) errors.tdsCertificate = 'No TDS was entered, so there is no certificate to record.';
  else if (certReceived) {
    if (!certOn || !isIsoDate(certOn)) errors.tdsCertificate = 'Enter the date the TDS certificate arrived.';
    else if (certOn > today) errors.tdsCertificate = 'The certificate date cannot be in the future.';
  } else if (certOn) errors.tdsCertificate = 'Tick "certificate received" or clear the date.';

  const gstRegistered = input.gstRegistered === true ? true : input.gstRegistered === false ? false : null;
  const docType = (DOCUMENT_TYPES as readonly string[]).includes(input.documentType) ? (input.documentType as DocumentType) : null;
  if (!docType) errors.documentType = 'Choose the document to issue.';
  else if (!allowedDocumentTypes(gstRegistered).includes(docType)) {
    errors.documentType = gstRegistered === false ? 'The business is not GST registered: issue a payment receipt (no GST line).' : 'GST registration is not set in Settings yet: only a payment receipt can be issued.';
  }

  const total = input.invoiceTotalPaise ?? null;
  const before = input.alreadySettledPaise ?? null;
  if (total !== null && !isAmountPaise(total)) errors.invoiceTotal = 'The invoice total must be an amount more than zero.';
  if (before !== null && !isNonNegativePaise(before)) errors.alreadySettled = 'Earlier payments must be an amount of zero or more.';

  if (Object.keys(errors).length > 0 || !provider || !docType) return { ok: false, errors };

  const feesKnown = fee !== null && gstFee !== null;
  const netSettled = feesKnown ? input.grossPaise - fee - gstFee : provider === 'razorpay' ? null : input.grossPaise;
  if (provider === 'razorpay' && !feesKnown) warnings.push('The gateway fee is not entered yet, so the amount settled to the bank is not worked out.');
  const netReceived = netSettled === null ? null : netSettled - tds;

  const record: PaymentRecord = {
    reference,
    provider,
    providerRef: providerRef === '' ? null : providerRef,
    paidOn: input.paidOn,
    grossPaise: input.grossPaise,
    gatewayFeePaise: fee,
    gstOnFeePaise: gstFee,
    netSettledPaise: netSettled,
    tdsPaise: tds,
    netReceivedPaise: netReceived,
    tdsCertificateReceived: tds > 0 && certReceived,
    tdsCertificateOn: tds > 0 && certReceived ? certOn : null,
    documentType: docType,
    gstRegistered,
    reverseCharge: input.reverseCharge === true,
  };

  let settlement: Settlement;
  if (total === null) settlement = { status: 'unknown', balancePaise: null, tdsCertificatePending: tds > 0 && !certReceived };
  else {
    const balance = total - ((before ?? 0) + input.grossPaise);
    settlement = { status: balance <= 0 ? 'settled' : 'part_paid', balancePaise: balance, tdsCertificatePending: tds > 0 && !certReceived };
    if (balance < 0) warnings.push('This is more than the invoice total. Check the amounts.');
  }
  if (settlement.tdsCertificatePending) warnings.push('TDS was deducted: ask the payer for the TDS certificate and record it when it arrives.');
  return { ok: true, record, settlement, warnings };
}
