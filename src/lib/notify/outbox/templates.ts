// Plain-English message templates for the outbox (pure, no clock). Plain TEXT only: nothing an organiser or a visitor typed is
// ever interpreted as markup, every one-line value goes through stripToOneLine, and the subject can never hold a line break
// (src/lib/notify/email.ts refuses one).
//
// R-ACK-PROMISE (CLAUDE.md): a reply time is promised ONLY when the owner set one (site.replyTimePromise, passed in as
// `replyWindow`). Otherwise the text says "as soon as we can". There is NO default time (never "24 hours").
// D-012: another player is named only when that player is `adult_confirmed`; otherwise the text says "your opponent".
// Match labels are organiser text and MUST NOT contain player names (for example "Match 12, Men's Doubles quarter-final").
// Payments are manual-verification only in this wave: no text ever asks for a card number, a UPI PIN or an OTP.
import { formatDate, formatInstantIst, isIsoDate } from '../../dates';
import { sanitisedFirstName, stripToOneLine } from '../../security/text';
import { absoluteUrl, isInternalPath } from '../../urls';
import type { DomainEvent, MentionedPlayer, NotificationKind, Recipient } from './types';

export interface TemplateOptions {
  /** Brand name used to sign messages. Default "Power Smash" (the brand in CLAUDE.md); the caller may pass the owner's choice. */
  senderName?: string;
  /** Site origin for "see the details" links (for example the live domain). No origin = no link (nothing is guessed). */
  siteOrigin?: string | null;
  /** The owner's site.replyTimePromise. Absent or blank = no promise. */
  replyWindow?: string | null;
}

export interface RenderedMessage {
  subject: string;
  body: string;
}

export const SUBJECT_LIMIT = 200;
export const BODY_LIMIT = 3000;

/** "Saturday, 7 November 2026 at 9:30 am (India time)"; the formatter lives in the one date module (D-030). */
export { formatInstantIst };

const one = (s: string | null | undefined, max = 120): string => (s ? stripToOneLine(s, max) : '');

/** Multi-line organiser text: control characters removed except line breaks, at most 3 blank-free paragraphs per break run. */
function paragraph(s: string, max = 2000): string {
  const cleaned = s
    .replace(/\r\n?/g, '\n')
    .split('\n')
    .map((line) => stripToOneLine(line, max))
    .join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
  return Array.from(cleaned).slice(0, max).join('');
}

/** D-012: the name only for an adult_confirmed player, otherwise a neutral phrase. */
export function opponentPhrase(p: MentionedPlayer | null | undefined): string | null {
  if (!p) return null;
  if (p.ageStatus !== 'adult_confirmed') return 'your opponent';
  const name = one(p.name, 60);
  return name === '' ? 'your opponent' : name;
}

function where(e: Pick<DomainEvent, 'tournamentName' | 'eventName'>): string {
  const t = one(e.tournamentName) || 'the tournament';
  const ev = one(e.eventName);
  return ev ? `${ev} at ${t}` : t;
}

function scopeText(e: { scope: 'match' | 'event' | 'tournament'; matchLabel?: string | null } & Pick<DomainEvent, 'tournamentName' | 'eventName'>): string {
  if (e.scope === 'match') return `${one(e.matchLabel) || 'Your match'} (${where(e)})`;
  if (e.scope === 'event') return where(e);
  return one(e.tournamentName) || 'The tournament';
}

function cap(s: string, max: number): string {
  return Array.from(s).slice(0, max).join('');
}

const KIND_SUBJECTS: Record<NotificationKind, string> = {
  registration_confirmation: 'Registration received',
  registration_approved: 'Registration approved',
  registration_rejected: 'Registration not accepted',
  payment_verification: 'Payment check',
  announcement: 'Announcement',
  schedule_change: 'Match time changed',
  court_change: 'Court changed',
  match_reminder: 'Match reminder',
  draw_published: 'Draw published',
  results_published: 'Results published',
  postponement: 'Postponed',
  cancellation: 'Cancelled',
};

/** Render one event for one recipient. Pure: the same input always gives the same text. */
export function renderMessage(event: DomainEvent, recipient: Pick<Recipient, 'greetingName'>, options: TemplateOptions = {}): RenderedMessage {
  const sender = one(options.senderName, 60) || 'Power Smash';
  const hi = `Hi ${recipient.greetingName ? sanitisedFirstName(recipient.greetingName) : 'there'},`;
  const lines: string[] = [];
  let subject = `${KIND_SUBJECTS[event.kind]}: ${one(event.tournamentName, 80) || 'tournament'}`;
  const replyWindow = one(options.replyWindow, 60);
  const promise = replyWindow ? `We will reply within ${replyWindow}.` : 'We will get back to you as soon as we can.';

  switch (event.kind) {
    case 'registration_confirmation': {
      const ref = one(event.registrationRef, 40);
      subject = `Registration received - ${ref}`;
      lines.push(`We have received your registration for ${where(event)}.`);
      lines.push('Your place is not confirmed yet: the organiser checks every registration by hand and will tell you the result.');
      lines.push(promise);
      lines.push(`Reference: ${ref}`);
      break;
    }
    case 'registration_approved': {
      const ref = one(event.registrationRef, 40);
      subject = `Registration approved - ${ref}`;
      lines.push(`Good news: your registration for ${where(event)} has been approved.`);
      lines.push(`Reference: ${ref}`);
      break;
    }
    case 'registration_rejected': {
      const ref = one(event.registrationRef, 40);
      subject = `Registration not accepted - ${ref}`;
      lines.push(`Sorry, your registration for ${where(event)} was not accepted.`);
      const reason = one(event.reason, 300);
      if (reason) lines.push(`Reason given by the organiser: ${reason}`);
      lines.push(`If you think this is a mistake, contact the organiser and quote your reference. ${promise}`);
      lines.push(`Reference: ${ref}`);
      break;
    }
    case 'payment_verification': {
      const ref = one(event.registrationRef, 40);
      subject = `Payment check - ${ref}`;
      if (event.outcome === 'verified') {
        lines.push(`Power Smash has checked your payment for ${where(event)} by hand and marked it as verified.`);
      } else {
        lines.push(`The organiser could not verify your payment for ${where(event)} yet. Please contact the organiser and quote your reference.`);
      }
      lines.push('We never ask for your card number, UPI PIN or OTP. Do not share them with anyone.');
      lines.push(`Reference: ${ref}`);
      break;
    }
    case 'announcement': {
      subject = `${one(event.title, 120) || 'Announcement'} - ${one(event.tournamentName, 60) || 'tournament'}`;
      lines.push(`Announcement for ${where(event)}:`);
      const body = paragraph(event.body);
      if (body) lines.push(body);
      break;
    }
    case 'schedule_change': {
      lines.push(`The time of ${one(event.matchLabel) || 'your match'} (${where(event)}) has changed.`);
      lines.push(`New time: ${formatInstantIst(event.newStart)}`);
      if (event.previousStart) lines.push(`Previous time: ${formatInstantIst(event.previousStart)}`);
      break;
    }
    case 'court_change': {
      lines.push(`${one(event.matchLabel) || 'Your match'} (${where(event)}) has moved to a different court.`);
      lines.push(`New court: ${one(event.newCourt, 40)}`);
      const prev = one(event.previousCourt, 40);
      if (prev) lines.push(`Previous court: ${prev}`);
      break;
    }
    case 'match_reminder': {
      const opp = opponentPhrase(event.opponent);
      lines.push(`Reminder: ${one(event.matchLabel) || 'your match'} (${where(event)})${opp ? ` against ${opp}` : ''} starts ${formatInstantIst(event.start)}.`);
      const court = one(event.court, 40);
      if (court) lines.push(`Court: ${court}`);
      lines.push('Times can change on the day: please check with the tournament desk when you arrive.');
      break;
    }
    case 'draw_published': {
      lines.push(`The draw for ${where(event)} has been published.`);
      break;
    }
    case 'results_published': {
      lines.push(`Results for ${where(event)} have been published.`);
      break;
    }
    case 'postponement': {
      lines.push(`${scopeText(event)} has been postponed.`);
      lines.push(event.newDate && isIsoDate(event.newDate) ? `New date: ${formatDate(event.newDate)}` : 'The new date will be shared once it is fixed.');
      const reason = one(event.reason, 300);
      if (reason) lines.push(`Reason: ${reason}`);
      break;
    }
    case 'cancellation': {
      lines.push(`${scopeText(event)} has been cancelled.`);
      const reason = one(event.reason, 300);
      if (reason) lines.push(`Reason: ${reason}`);
      break;
    }
  }

  if (event.pagePath && options.siteOrigin && isInternalPath(event.pagePath) && !/[\s\u0000-\u001F]/.test(event.pagePath)) {
    try {
      lines.push(`Details: ${absoluteUrl(event.pagePath, options.siteOrigin)}`);
    } catch {
      // an unreadable origin: no link rather than a wrong one
    }
  }
  lines.push(`- ${sender}`);
  const body = cap([hi, ...lines].join('\n\n'), BODY_LIMIT);
  return { subject: cap(stripToOneLine(subject, SUBJECT_LIMIT), SUBJECT_LIMIT), body };
}
