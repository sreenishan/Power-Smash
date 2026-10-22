// WhatsApp message builders for the forms (D-025, D-029). All links go through waLink(); this file only decides the TEXT.
// Rule: no personal data in a prefilled text. A reference code and a topic are fine. For the failure fallback the
// visitor's own free-text message may be included (they typed it to us), after removing anything that looks like a
// phone number, an email address or a link, so contact details never travel inside a URL.
import { waLink } from '../whatsapp';
import type { LeadKind } from '../contracts/lead-constants';

export const KIND_LABEL: Record<LeadKind, string> = {
  coverage: 'coverage booking',
  sponsorship: 'sponsorship enquiry',
  general: 'enquiry',
  player_product: 'player product enquiry',
  tournament_submission: 'tournament listing',
  video_submission: 'video submission',
  alerts_signup: 'alerts sign-up',
  profile_request: 'profile request',
  content_removal: 'content removal request',
};

const MAX_LINE = 80;
const MAX_MESSAGE = 400;
const MAX_TOTAL = 900;

// Control characters, invisible formatting characters (zero-width, bidi marks, soft hyphen, BOM) and line separators.
const INVISIBLE = /[\p{Cc}\p{Cf}\p{Zl}\p{Zp}]/gu;

/** Collapse whitespace, drop control characters, remove emails, links and long digit runs, cut to a length. */
export function scrubForWhatsApp(raw: string, max: number): string {
  const text = raw
    .replace(INVISIBLE, ' ')
    .replace(/[^\s@]+@[^\s@]+\.[^\s@]+/g, '')
    .replace(/(?:https?:\/\/|www\.)\S+/gi, '')
    .replace(/\+?\d[\d\s().-]{4,}\d/g, '')
    .replace(/\s+/g, ' ')
    .trim();
  return Array.from(text).slice(0, max).join('');
}

/** After a successful send: only the reference code and the kind of request. */
export function confirmationText(kind: LeadKind, ref: string): string {
  return `Hi Power Smash, I just sent a ${KIND_LABEL[kind]} on your website. My reference is ${ref}.`;
}

export interface FallbackSummary {
  /** Short, non-personal choices the visitor made, e.g. ["Package: Essential", "District: Madurai"]. */
  choices: readonly string[];
  /** The visitor's own free-text message, if they wrote one. */
  message?: string;
}

/** When sending failed: a WhatsApp text that lets the owner pick the enquiry up without the form. */
export function fallbackText(kind: LeadKind, summary: FallbackSummary): string {
  const lines = [`Hi Power Smash, I tried to send a ${KIND_LABEL[kind]} on your website but it did not go through.`];
  for (const choice of summary.choices) {
    const clean = scrubForWhatsApp(choice, MAX_LINE);
    if (clean !== '') lines.push(clean);
  }
  const message = scrubForWhatsApp(summary.message ?? '', MAX_MESSAGE);
  if (message !== '') lines.push(`My message: ${message}`);
  return Array.from(lines.join('\n')).slice(0, MAX_TOTAL).join('');
}

/** Button link after success. Null (button hidden) when no WhatsApp number is configured. */
export function confirmationLink(number: string | null | undefined, kind: LeadKind, ref: string): string | null {
  return waLink(number, confirmationText(kind, ref));
}

/** Button link when sending failed. Null when no WhatsApp number is configured. */
export function fallbackLink(number: string | null | undefined, kind: LeadKind, summary: FallbackSummary): string | null {
  return waLink(number, fallbackText(kind, summary));
}

/** A neutral "ask us a question" text for the button next to a form (rendered on the server by the page). */
export function askText(kind: LeadKind): string {
  switch (kind) {
    case 'coverage':
      return 'Hi Power Smash, I would like to ask about coverage for a tournament.';
    case 'sponsorship':
      return 'Hi Power Smash, I would like to ask about partnering with you.';
    case 'tournament_submission':
      return 'Hi Power Smash, I would like to list a tournament.';
    case 'video_submission':
      return 'Hi Power Smash, I would like to send you a match video.';
    case 'alerts_signup':
      return 'Hi Power Smash, I have a question about your alerts.';
    case 'profile_request':
    case 'content_removal':
      return 'Hi Power Smash, I would like to make a request about a profile or a video.';
    case 'player_product':
      return 'Hi Power Smash, I would like to ask about a player product.';
    default:
      return 'Hi Power Smash, I have a question.';
  }
}
