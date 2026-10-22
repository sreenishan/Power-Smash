// Pure helpers that turn the owner-supplied facts into the contact blocks on the legal pages (D-037, D-014, D-025).
// Nothing here invents a value: a missing value is null and the component shows a Todo or hides the option.
import { isInternalPath, path } from '../../lib/urls';
import { waLink } from '../../lib/whatsapp';
import { resolveSiteField, type LegalSiteFacts, type SiteField } from './model';

/** Prefilled WhatsApp text for a removal request. Free of personal data on purpose (D-029). */
export const REMOVAL_WHATSAPP_PREFILL = 'Hello Power Smash, I would like to ask about a removal or correction request.';

const EMAIL = /^[^\s@<>"'()[\],;:\\]+@[^\s@<>"'()[\],;:\\]+\.[A-Za-z]{2,}$/;

/** mailto link for a plausible email address, else null. */
export function mailHref(email: string | null): string | null {
  if (!email) return null;
  const e = email.trim();
  return EMAIL.test(e) ? `mailto:${e}` : null;
}

/** tel link for a phone number with at least 6 digits, else null. */
export function telHref(phone: string | null): string | null {
  if (!phone) return null;
  const digits = phone.replace(/[^\d+]/g, '');
  return digits.replace(/\D/g, '').length >= 6 ? `tel:${digits}` : null;
}

export interface ContactRoutes {
  /** wa.me link from waLink(), or null when no WhatsApp number is set. */
  readonly whatsapp: string | null;
  readonly email: { readonly address: string; readonly href: string } | null;
  /** Shown for urgent court or government orders. */
  readonly phone: { readonly display: string; readonly href: string } | null;
  /** Path of the online form (with its trailing slash), or null until it exists. */
  readonly formPath: string | null;
  /** True when at least one way to reach us exists (WhatsApp, email or form). */
  readonly hasRoute: boolean;
}

export function resolveContactRoutes(
  facts: LegalSiteFacts,
  removalFormPath: string | null,
  prefill: string = REMOVAL_WHATSAPP_PREFILL,
): ContactRoutes {
  const whatsapp = waLink(facts.whatsappNumber, prefill);
  const emailRaw = resolveSiteField(facts, 'publicEmail');
  const emailHrefValue = mailHref(emailRaw);
  const phoneRaw = resolveSiteField(facts, 'phone');
  const phoneHrefValue = telHref(phoneRaw);
  // The online form is a page on this site, written through the one URL helper (R-LINKS: trailing slash).
  const formPath = removalFormPath && isInternalPath(removalFormPath) ? path(removalFormPath) : null;
  const email = emailRaw && emailHrefValue ? { address: emailRaw, href: emailHrefValue } : null;
  const phone = phoneRaw && phoneHrefValue ? { display: phoneRaw, href: phoneHrefValue } : null;
  return { whatsapp, email, phone, formPath, hasRoute: Boolean(whatsapp || email || formPath) };
}

export type GrievanceKind = 'text' | 'email' | 'phone' | 'address';

export interface GrievanceRow {
  readonly label: string;
  readonly value: string | null;
  readonly kind: GrievanceKind;
  /** Shown as a Todo when `value` is null. */
  readonly todo: string;
}

const row = (label: string, facts: LegalSiteFacts, name: SiteField, kind: GrievanceKind, todo: string): GrievanceRow => ({
  label,
  value: resolveSiteField(facts, name),
  kind,
  todo,
});

/**
 * Seller, customer-care and grievance-officer details that the E-Commerce Rules 2020 expect a seller to show (VF-E10, D-037).
 * The grievance officer's phone falls back to the business phone when the owner has not supplied a separate one.
 */
export function grievanceRows(facts: LegalSiteFacts): GrievanceRow[] {
  const phoneName: SiteField = resolveSiteField(facts, 'grievanceOfficerPhone') ? 'grievanceOfficerPhone' : 'phone';
  return [
    row('Business name', facts, 'legalName', 'text', 'legal name of the business (OT-19)'),
    row('Postal address', facts, 'postalAddress', 'address', 'postal address to publish (OT-19)'),
    row('Grievance officer', facts, 'grievanceOfficerName', 'text', "grievance officer's name (OT-19)"),
    row('Grievance email', facts, 'grievanceEmail', 'email', "grievance officer's email address (OT-19)"),
    row('Phone', facts, phoneName, 'phone', 'phone number for customer care and grievances (OT-19)'),
    row('General email', facts, 'publicEmail', 'email', 'public email address (OT-19; needs the domain verified, OT-07)'),
  ];
}
