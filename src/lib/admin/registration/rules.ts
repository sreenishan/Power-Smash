// Contact-data rules of the registration owner texts, shared by the admin form, the service and (mirrored) migration 0020
// (app.registration_contact_free and the UPI phone rule). The patterns are the ones of app.notify_text_ok (0023, payload.ts), so one
// definition of "contact details" holds across the platform:
//  - the payment instructions are PUBLIC (shown on the registration pages), so they may not hold an email address, a phone number
//    or a wa.me / tel: link: the only public number is PUBLIC_WHATSAPP_NUMBER (D-029);
//  - a UPI id whose name part is a phone number (a mobile number before the @) would publish that number, so it is refused;
//  - the reason for rejecting a registration lands in the audit log, which holds ids, counts and codes only: no contact details.
import { OUTBOX_TEXT_SQL_PATTERNS } from '../../notify/outbox/payload';

const EMAIL_RE = new RegExp(OUTBOX_TEXT_SQL_PATTERNS.email);
const PHONE_RE = new RegExp(OUTBOX_TEXT_SQL_PATTERNS.phone);
const LINK_RE = new RegExp(OUTBOX_TEXT_SQL_PATTERNS.link, 'i');

/** Mirrors app.registration_contact_free (0020): true when the text holds no email address, phone number or WhatsApp/phone link. */
export function contactFree(text: string): boolean {
  return !EMAIL_RE.test(text) && !PHONE_RE.test(text) && !LINK_RE.test(text);
}

/** At least this many digits in the name part of a UPI id (before the @) look like a phone number: refused (mirrors 0020). */
export const UPI_PHONE_DIGITS = 9;

/** Mirrors the 0020 UPI phone rule: the name part (before @) holds 9 or more digits in all. */
export function upiLooksLikePhone(upi: string): boolean {
  const local = upi.split('@')[0] ?? '';
  return local.replace(/[^0-9]/g, '').length >= UPI_PHONE_DIGITS;
}

/** The owner's plain-English refusals (null when fine). */
export const CONTACT_TEXT_PROBLEM = 'Leave out phone numbers, email addresses and WhatsApp links: this text is shown on the website.';
export const UPI_PHONE_PROBLEM =
  'This UPI id is made from a phone number, so showing it would publish that number on the website. Use a UPI id with a name instead (in your UPI app).';
export const REASON_CONTACT_PROBLEM = 'Leave out phone numbers, email addresses and links: the reason is kept in the record of changes.';

/** The reject reason: free text for the owner, but never contact details (it is stored in the audit log). */
export function rejectReasonProblem(reason: string): string | null {
  return contactFree(reason) ? null : REASON_CONTACT_PROBLEM;
}
