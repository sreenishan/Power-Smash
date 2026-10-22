// Pure business rules shared by the in-memory and the Supabase admin stores for the owner's phone tasks (leads, placements, prices).
// Each function wraps the existing validators (src/lib/inbox, src/lib/placements, src/lib/pricing-admin) and returns either the new
// value plus what changed (for the audit row) or plain-English field errors. No I/O, no clock (the caller passes today in IST).
import type { InboxLead } from '../inbox/lead';
import { validateFollowUpDate } from '../inbox/followup';
import { validateTransition } from '../inbox/status';
import type { Placement } from '../placements/schedule';
import { validatePlacement } from '../placements/validate';
import { isNonNegativePaise } from '../pricing-admin/price-input';
import { changedFields, priceChange, validateProductEdit, type PriceChange, type ProductRecord } from '../pricing-admin/product-edit';
import { validateMarkPaid, type PaymentRecord, type Settlement } from '../pricing-admin/mark-paid';
import { canTransition, type LeadStatus } from '../inbox/status';
import type { LeadUpdateInput, MarkPaidRequest, PlacementCreateInput, ProductSaveInput, SponsorDto } from './types';

export type Errors = Record<string, string>;

export const NOTES_MAX = 2000;
// eslint-disable-next-line no-control-regex
const CONTROL = /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g;

// ----------------------------------------------------------------------------- leads

export type LeadUpdateOutcome = { ok: true; next: InboxLead; changed: string[]; from: InboxLead['status']; to: InboxLead['status'] } | { ok: false; errors: Errors };

export function applyLeadUpdate(lead: InboxLead, input: LeadUpdateInput, today: string): LeadUpdateOutcome {
  const errors: Errors = {};
  const next: InboxLead = { ...lead };
  const changed: string[] = [];

  if (input.to !== undefined) {
    const t = validateTransition(lead.status, input.to, input.lostReason ?? null);
    if (!t.ok) errors.status = t.error;
    else {
      next.status = t.status;
      next.lostReason = t.lostReason;
      changed.push('status');
      if (t.lostReason !== lead.lostReason) changed.push('lost_reason');
    }
  }
  if (input.notes !== undefined) {
    const notes = input.notes === null ? null : input.notes.replace(CONTROL, '').trim();
    if (notes !== null && notes.length > NOTES_MAX) errors.notes = `Keep the notes under ${NOTES_MAX} characters.`;
    else if ((notes === '' ? null : notes) !== lead.notes) {
      next.notes = notes === '' ? null : notes;
      changed.push('notes');
    }
  }
  if (input.followUpOn !== undefined) {
    const f = validateFollowUpDate(input.followUpOn, today);
    if (!f.ok) errors.followUpOn = f.error;
    else if (f.date !== lead.followUpOn) {
      next.followUpOn = f.date;
      changed.push('follow_up_on');
    }
  }
  if (input.valuePaise !== undefined) {
    if (input.valuePaise !== null && !isNonNegativePaise(input.valuePaise)) errors.valuePaise = 'The value is not a valid amount.';
    else if (input.valuePaise !== lead.valuePaise) {
      next.valuePaise = input.valuePaise;
      changed.push('value_paise');
    }
  }
  if (Object.keys(errors).length > 0) return { ok: false, errors };
  if (changed.length === 0) return { ok: false, errors: { form: 'Nothing to change.' } };
  return { ok: true, next, changed, from: lead.status, to: next.status };
}

// ----------------------------------------------------------------------------- placements

type PlacementValue = Extract<ReturnType<typeof validatePlacement>, { ok: true }>['value'];
export type PlacementOutcome = { ok: true; value: PlacementValue; targetUrl: string; warnings: string[] } | { ok: false; errors: Errors };

/** Validates a new placement (always created as a draft). The link must sit on the sponsor's registered website. */
export function prepareNewPlacement(input: PlacementCreateInput, sponsor: SponsorDto | undefined, existing: readonly Placement[]): PlacementOutcome {
  if (!sponsor) return { ok: false, errors: { sponsorId: 'Choose the sponsor.' } };
  if (!sponsor.active) return { ok: false, errors: { sponsorId: 'This sponsor is switched off.' } };
  const v = validatePlacement({ ...input, sponsorWebsite: sponsor.website, status: 'draft' }, existing);
  if (!v.ok) return { ok: false, errors: v.errors as Errors };
  return { ok: true, value: v.value, targetUrl: v.targetUrl, warnings: v.warnings };
}

/** Switching a placement on needs an image (database rule) and must not tie another live one; ended is final. */
export function checkStatusChange(p: Placement, to: 'active' | 'paused' | 'ended', existing: readonly Placement[]): string | null {
  if (p.status === 'ended') return 'An ended placement cannot be changed. Create a new one.';
  if (p.status === to) return 'It is already in that state.';
  if (to === 'active' && !p.creativeDesktopPath && !p.creativeMobilePath) return 'Add an image before switching it on.';
  if (to === 'active') {
    const v = validatePlacement({ ...p, sponsorId: p.sponsorId, targetUrl: 'https://placeholder.example/', creativeDesktopPath: p.creativeDesktopPath, creativeMobilePath: p.creativeMobilePath, status: 'active' }, existing.filter((x) => x.status === 'active' || x.id === p.id));
    if (!v.ok && v.errors.priority) return v.errors.priority;
  }
  return null;
}

// ----------------------------------------------------------------------------- prices

export type ProductOutcome =
  | { ok: true; value: ProductRecord; warnings: string[]; changed: string[]; price: PriceChange | null }
  | { ok: false; errors: Errors };

export function prepareProductSave(before: ProductRecord, input: ProductSaveInput): ProductOutcome {
  const { slug: _slug, ...edit } = input;
  const v = validateProductEdit(edit);
  if (!v.ok) return { ok: false, errors: v.errors as Errors };
  const changed = changedFields(before, v.value);
  if (changed.length === 0) return { ok: false, errors: { form: 'Nothing to change.' } };
  return { ok: true, value: v.value, warnings: v.warnings, changed, price: priceChange(before, v.value) };
}

// ----------------------------------------------------------------------------- mark paid

export type MarkPaidOutcome =
  | { ok: true; record: PaymentRecord; settlement: Settlement; warnings: string[]; from: LeadStatus; to: LeadStatus }
  | { ok: false; errors: Errors };

/**
 * Validates a payment typed by the owner (src/lib/pricing-admin: integer paise, no default amount or rate) against an enquiry, and
 * decides the enquiry status afterwards: a payment that settles a known invoice total completes the enquiry, any other payment makes it
 * won (already won or completed stays). A lost enquiry must be reopened first. `alreadySettledPaise` = gross of earlier payments.
 */
export function prepareMarkPaid(lead: InboxLead, input: MarkPaidRequest, today: string, alreadySettledPaise: number): MarkPaidOutcome {
  if (lead.status === 'lost') return { ok: false, errors: { form: 'This enquiry is marked lost. Reopen it first, then record the payment.' } };
  const v = validateMarkPaid(
    {
      reference: lead.refCode,
      provider: input.provider,
      providerRef: input.providerRef ?? null,
      paidOn: input.paidOn,
      grossPaise: input.grossPaise,
      gatewayFeePaise: input.gatewayFeePaise ?? null,
      gstOnFeePaise: input.gstOnFeePaise ?? null,
      tdsPaise: input.tdsPaise ?? null,
      tdsCertificateReceived: input.tdsCertificateReceived ?? null,
      tdsCertificateOn: input.tdsCertificateOn ?? null,
      documentType: input.documentType,
      gstRegistered: input.gstRegistered,
      reverseCharge: input.reverseCharge ?? null,
      invoiceTotalPaise: input.invoiceTotalPaise ?? null,
      alreadySettledPaise: input.invoiceTotalPaise != null && alreadySettledPaise > 0 ? alreadySettledPaise : null,
    },
    today,
  );
  if (!v.ok) return { ok: false, errors: v.errors as Errors };
  const target: LeadStatus = v.settlement.status === 'settled' ? 'completed' : 'won';
  let to: LeadStatus = lead.status;
  if (lead.status !== target && lead.status !== 'completed' && canTransition(lead.status, target)) to = target;
  return { ok: true, record: v.record, settlement: v.settlement, warnings: v.warnings, from: lead.status, to };
}
