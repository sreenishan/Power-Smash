// Email through Resend's REST API (D-022). OFF until `EMAIL_ENABLED=true`, which the owner sets only after the sending
// domain is verified (OT-07, OT-40). Before that: Telegram only, and the confirmation screen shows a WhatsApp link.
//
// Resend: POST https://api.resend.com/emails, `Authorization: Bearer`, JSON body {from, to, subject, text|html, reply_to},
// optional `Idempotency-Key` (max 256 chars, 24 h), 429 on rate limit, 409 on an idempotency conflict
// (https://resend.com/docs/api-reference/emails/send-email, checked 2026-10-21; free plan 100 mails a day, VF-F1).
// We send TEXT only: nothing the visitor typed is ever interpreted as markup. The only visitor-derived values are the
// sanitised first name and the reference; addresses and subjects are checked for CR/LF and angle brackets.
import { sanitisedFirstName, normaliseEmail } from '../security/text';
import { waLink } from '../whatsapp';
import { KIND_LABELS, buildAlertText, type AlertLead, type AlertTextOptions } from './telegram';
import type { LeadKind } from '../contracts/lead-constants';

export const RESEND_URL = 'https://api.resend.com/emails';

export type EmailResult = { ok: true } | { ok: false; reason: 'unconfigured' | 'invalid' | 'rate_limited' | 'rejected' | 'unavailable' };

export interface EmailMessage {
  /** `hello@domain` or `Power Smash <hello@domain>`. */
  from: string;
  to: string;
  subject: string;
  text: string;
  replyTo?: string;
  /** Resend `Idempotency-Key`: the lead reference plus a suffix, so a retry never sends twice. */
  idempotencyKey?: string;
}

const NO_BREAKS = /[\u0000-\u001F\u007F-\u009F\u2028\u2029]/;

/** A bare address or `Name <address>`; display names are limited to safe characters. Returns the normalised value or null. */
export function safeMailbox(raw: string): string | null {
  if (NO_BREAKS.test(raw)) return null; // checked BEFORE trimming: a trailing CR/LF is an injection attempt, not whitespace
  const s = raw.trim();
  if (s.length === 0 || s.length > 254) return null;
  const m = /^(?:([\p{L}\p{N} .,'’&-]{1,60}) <([^<>\s]+)>|([^<>\s]+))$/u.exec(s);
  if (!m) return null;
  const address = normaliseEmail((m[2] ?? m[3]) as string);
  if (!address) return null;
  return m[1] ? `${m[1].trim()} <${address}>` : address;
}

export interface SendEmailOptions {
  fetch: typeof fetch;
  apiKey: string | null;
  message: EmailMessage;
  timeoutMs?: number;
}

export async function sendEmail(o: SendEmailOptions): Promise<EmailResult> {
  if (!o.apiKey) return { ok: false, reason: 'unconfigured' };
  const from = safeMailbox(o.message.from);
  const to = safeMailbox(o.message.to);
  const replyTo = o.message.replyTo === undefined ? undefined : safeMailbox(o.message.replyTo);
  const subject = o.message.subject;
  if (!from || !to || replyTo === null || NO_BREAKS.test(subject) || subject.length > 200 || NO_BREAKS.test(o.message.idempotencyKey ?? '')) {
    return { ok: false, reason: 'invalid' };
  }
  const headers: Record<string, string> = {
    authorization: `Bearer ${o.apiKey}`,
    'content-type': 'application/json',
    'user-agent': 'power-smash-worker',
  };
  if (o.message.idempotencyKey) headers['idempotency-key'] = o.message.idempotencyKey.slice(0, 256);
  try {
    const signal = typeof AbortSignal !== 'undefined' && 'timeout' in AbortSignal ? AbortSignal.timeout(o.timeoutMs ?? 6000) : undefined;
    const res = await o.fetch(RESEND_URL, {
      method: 'POST',
      headers,
      body: JSON.stringify({ from, to, subject, text: o.message.text, ...(replyTo ? { reply_to: replyTo } : {}) }),
      signal,
    });
    if (res.ok || res.status === 409) return { ok: true }; // 409: the same idempotency key was already accepted
    if (res.status === 429) return { ok: false, reason: 'rate_limited' };
    return { ok: false, reason: res.status >= 500 ? 'unavailable' : 'rejected' };
  } catch {
    return { ok: false, reason: 'unavailable' };
  }
}

/**
 * Owner alert: exactly the same minimal content as the Telegram alert (D-029), as plain text, so the same privacy rule holds:
 * by default NO phone, NO email address and no free text (R-TELEGRAM-PHONE; `includePhoneLink` adds the WhatsApp reply link
 * and the district, only when TELEGRAM_ALERT_PHONE_LINK=true). The subject names the kind and the reference only.
 */
export function buildOwnerAlertEmail(lead: AlertLead, options: AlertTextOptions = {}): { subject: string; text: string } {
  return { subject: `New lead ${lead.ref}: ${KIND_LABELS[lead.kind]}`, text: buildAlertText(lead, options) };
}

/**
 * Customer acknowledgement (Appendix D template, spec 8.1): carries only the reference and a sanitised first name.
 * R-ACK-PROMISE: it promises a reply time ONLY when `replyWindow` (the owner-supplied site.replyTimePromise, passed in by the
 * caller) is set. Otherwise it says "We will get back to you as soon as we can." There is NO default time (never "24 hours").
 */
export function buildAckEmail(input: { ref: string; name: string; kind: LeadKind; whatsappNumber: string | null; replyWindow?: string | null }): { subject: string; text: string } {
  const first = sanitisedFirstName(input.name);
  const what = input.kind === 'general' ? 'message' : input.kind === 'tournament_submission' ? 'tournament listing' : input.kind === 'video_submission' ? 'video submission' : input.kind === 'alerts_signup' ? 'alerts sign-up' : 'request';
  const link = waLink(input.whatsappNumber, `Hi Power Smash, my reference is ${input.ref}.`);
  const window = (input.replyWindow ?? '').replace(/[\u0000-\u001F\u007F-\u009F]/g, ' ').trim();
  const promise = window === '' ? 'We will get back to you as soon as we can.' : `We will reply within ${window}.`;
  const lines = [
    `Hi ${first}, thanks for contacting Power Smash. We've received your ${what}. ${promise}`,
    link ? `For anything urgent, WhatsApp us: ${link}` : null,
    `Reference: ${input.ref}`,
  ].filter((l): l is string => l !== null);
  return { subject: `We've got your request - ${input.ref}`, text: lines.join('\n\n') };
}
