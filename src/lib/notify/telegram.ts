// Telegram owner alerts (D-029): PLAIN text (no parse mode, so there is nothing to escape or inject), to a private 1:1 chat.
//
// R-TELEGRAM-PHONE (S-5, C-4): by DEFAULT the alert holds NO phone number, NO email address and NO free text: only the kind
// of enquiry, the reference, the first name (letters only), the page the form was on and a pointer to read the lead in
// Supabase Studio until the M3 admin exists. The customer's WhatsApp reply link (which contains their phone number) and the
// district are added ONLY when the Worker variable TELEGRAM_ALERT_PHONE_LINK is exactly "true" (the owner and the lawyer
// decide, and the privacy page must say so). The number is not verified (no OTP), so it is also not sent by default for that reason.
//
// The bot token is part of the API URL: the URL and the response body are never logged or put in an error
// (D-027: "redact URLs in logs"). Failures are returned as small codes.
import { M3_ROUTES, ROUTES } from '../urls';
import { waLink } from '../whatsapp';
import { sanitisedFirstName, stripToOneLine } from '../security/text';
import type { LeadKind } from '../contracts/lead-constants';

export const TELEGRAM_TEXT_LIMIT = 4096; // sendMessage text max, https://core.telegram.org/bots/api#sendmessage (checked 2026-10-21)

export const KIND_LABELS: Record<LeadKind, string> = {
  coverage: 'Coverage enquiry',
  sponsorship: 'Sponsorship enquiry',
  general: 'General message',
  player_product: 'Player product request',
  tournament_submission: 'Tournament listing',
  video_submission: 'Video submission',
  alerts_signup: 'Alerts sign-up',
  profile_request: 'Profile request',
  content_removal: 'Content removal request',
};

export interface AlertLead {
  ref: string;
  kind: LeadKind;
  name: string;
  /** Digits with country code (normalised), or undefined when the visitor gave only an email. */
  phone?: string;
  district?: string;
  /** Reference of the coverage lead created from a tournament listing, or true when asked but not created. */
  alsoCoverage?: string | boolean;
  /** The page the form was on (the validated `source.path`, no query string). Shown only in a strict form, see displayPage. */
  sourcePath?: string;
}

export interface AlertTextOptions {
  /** The enquiry was NOT stored (database problem). */
  degraded?: boolean;
  /**
   * R-TELEGRAM-PHONE: add the customer's WhatsApp reply link (it contains the phone number) and the district. Default false.
   * The caller passes `config.telegramPhoneLink` (the Worker variable TELEGRAM_ALERT_PHONE_LINK being exactly "true").
   */
  includePhoneLink?: boolean;
}

/** WhatsApp link TO the customer with a short greeting (Appendix D style). Null when there is no phone. */
export function customerReplyLink(lead: Pick<AlertLead, 'ref' | 'name' | 'phone' | 'kind'>): string | null {
  const first = sanitisedFirstName(lead.name);
  const topic = lead.kind === 'general' ? 'your message' : 'your enquiry';
  return waLink(lead.phone ?? null, `Hi ${first}, this is Power Smash. Thanks for ${topic}. Ref ${lead.ref}.`);
}

/** Canonical (slash) forms of every real page, plus the same without the trailing slash. */
const KNOWN_PAGES: ReadonlySet<string> = new Set([...Object.values(ROUTES), ...Object.values(M3_ROUTES)].flatMap((r) => (r === '/' ? [r] : [r, r.replace(/\/$/, '')])));
/** A tournament page: /tournaments/<slug>, with or without the trailing slash (slug: lowercase letters, digits, hyphens, at most 80). */
const TOURNAMENT_PAGE = /^\/tournaments\/[a-z0-9][a-z0-9-]{0,79}\/?$/;

/**
 * The page for the owner alert (N-1). The path is the visitor's own claim (it is only validated for shape), so it is shown ONLY when
 * it equals a real page of this site (ROUTES in src/lib/urls.ts, with or without the trailing slash) or a /tournaments/<slug> page.
 * Anything else, however harmless it looks, is printed as "(other)": an attacker cannot put a message into the alert through it.
 * No path at all gives null (the Page line is left out).
 */
export function displayPage(path: string | undefined): string | null {
  if (path === undefined) return null;
  return KNOWN_PAGES.has(path) || TOURNAMENT_PAGE.test(path) ? path : '(other)';
}

export function buildAlertText(lead: AlertLead, options: AlertTextOptions = {}): string {
  const lines: string[] = [];
  lines.push(options.degraded ? `LEAD NOT SAVED (database problem): ${lead.ref}` : `New lead ${lead.ref}`);
  lines.push(`Type: ${KIND_LABELS[lead.kind]}`);
  lines.push(`From: ${sanitisedFirstName(lead.name)}`);
  const page = displayPage(lead.sourcePath);
  if (page) lines.push(`Page: ${page}`);
  if (lead.alsoCoverage) {
    lines.push(typeof lead.alsoCoverage === 'string' ? `Also wants coverage: ${lead.alsoCoverage}` : 'Also wants coverage');
  }
  if (options.includePhoneLink) {
    // Opt-in only (TELEGRAM_ALERT_PHONE_LINK=true): the district and the one-tap WhatsApp reply link, which holds the phone.
    const district = lead.district ? stripToOneLine(lead.district, 60) : '';
    if (district) lines.push(`District: ${district}`);
    const link = customerReplyLink(lead);
    lines.push(link ? `Reply on WhatsApp: ${link}` : 'Contact: email only, see the lead list');
  }
  if (options.degraded) {
    lines.push(
      options.includePhoneLink
        ? 'Follow up now: this enquiry is not in the lead list.'
        : `This enquiry is NOT saved and this alert holds no contact details. The visitor was shown a WhatsApp link quoting ${lead.ref}: watch your WhatsApp for it.`,
    );
  } else {
    lines.push(`Open the lead in Supabase Studio (leads table, reference ${lead.ref})`);
  }
  const text = lines.join('\n');
  return Array.from(text).slice(0, TELEGRAM_TEXT_LIMIT).join('');
}

export type TelegramResult = { ok: true } | { ok: false; reason: 'unconfigured' | 'rate_limited' | 'rejected' | 'unavailable' };

export interface TelegramOptions {
  fetch: typeof fetch;
  token: string | null;
  chatId: string | null;
  text: string;
  timeoutMs?: number;
}

async function once(o: TelegramOptions & { token: string; chatId: string }): Promise<TelegramResult> {
  try {
    const signal = typeof AbortSignal !== 'undefined' && 'timeout' in AbortSignal ? AbortSignal.timeout(o.timeoutMs ?? 5000) : undefined;
    const res = await o.fetch(`https://api.telegram.org/bot${o.token}/sendMessage`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        chat_id: o.chatId,
        text: o.text.slice(0, TELEGRAM_TEXT_LIMIT),
        link_preview_options: { is_disabled: true },
      }),
      signal,
    });
    if (res.ok) return { ok: true };
    if (res.status === 429) return { ok: false, reason: 'rate_limited' };
    if (res.status >= 500) return { ok: false, reason: 'unavailable' };
    return { ok: false, reason: 'rejected' }; // 400 bad chat id, 401 bad token, 403 bot blocked
  } catch {
    return { ok: false, reason: 'unavailable' };
  }
}

/** Send one plain-text message; retries once on a network or 5xx failure. Never throws, never exposes the token. */
export async function sendTelegram(o: TelegramOptions): Promise<TelegramResult> {
  if (!o.token || !o.chatId) return { ok: false, reason: 'unconfigured' };
  const first = await once({ ...o, token: o.token, chatId: o.chatId });
  if (first.ok || first.reason !== 'unavailable') return first;
  return once({ ...o, token: o.token, chatId: o.chatId });
}
