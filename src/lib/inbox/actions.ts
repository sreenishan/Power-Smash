// Quick actions on a lead (spec 14 "Inbox: quick actions: WhatsApp (prefilled), email"). PURE link builders.
//
//  * WhatsApp: through `waLink()` only (D-025, D-029; never a hand-written wa.me URL). The prefilled text holds the reference and
//    nothing else about the person: no name, no organisation, no topic detail.
//  * Email: a `mailto:` link with the reference in the subject and an empty body. The address must be a plain single address; anything
//    that could add a recipient, a header or a query part (comma, semicolon, space, line break, `?`, `&`, `#`) gives no link.
import { waLink } from '../whatsapp';
import type { InboxLead } from './lead';

/** The first words of the owner's WhatsApp reply. Reference only. Plain English; the owner edits it before sending. */
export const replyGreeting = (refCode: string): string => `Hello, this is Power Smash replying to your enquiry ${refCode}.`;

export interface WhatsAppReply {
  /** The wa.me link to the CUSTOMER's number, or null when the lead has no usable phone number. */
  href: string | null;
  /** True when the customer said WhatsApp is fine for the reply. The owner may still choose to use it; the screen shows the answer. */
  customerAgreed: boolean;
}

export function whatsappReply(lead: Pick<InboxLead, 'phone' | 'refCode' | 'whatsappOk'>): WhatsAppReply {
  return { href: waLink(lead.phone, replyGreeting(lead.refCode)), customerAgreed: lead.whatsappOk === true };
}

const SAFE_EMAIL = /^[a-z0-9._%+-]{1,64}@[a-z0-9-]+(?:\.[a-z0-9-]+)*\.[a-z]{2,24}$/;

export function emailReplyLink(lead: Pick<InboxLead, 'email' | 'refCode'>): string | null {
  const email = (lead.email ?? '').trim().toLowerCase();
  if (!SAFE_EMAIL.test(email) || email.length > 254) return null;
  return `mailto:${email}?subject=${encodeURIComponent(`Your Power Smash enquiry ${lead.refCode}`)}`;
}

export interface QuickActions {
  whatsapp: WhatsAppReply;
  email: string | null;
}

export const quickActions = (lead: Pick<InboxLead, 'phone' | 'email' | 'refCode' | 'whatsappOk'>): QuickActions => ({
  whatsapp: whatsappReply(lead),
  email: emailReplyLink(lead),
});
