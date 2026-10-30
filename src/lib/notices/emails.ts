// The texts of the email list (D-114). Plain TEXT only (nothing typed by anyone is read as markup), plain English, no promise of how
// often we write. The confirmation email holds only the link; the announcement holds the owner's words and, at send time, the
// one-click unsubscribe footer (src/lib/notify/outbox/adapters.ts listFooter).
import { stripToOneLine } from '../security/text';
import { BODY_MAX, SUBJECT_MAX, outboxTextProblem } from '../notify/outbox/payload';
import { CONFIRM_TTL_HOURS } from './constants';

export function buildConfirmationEmail(input: { confirmUrl: string; senderName?: string }): { subject: string; text: string } {
  const sender = stripToOneLine(input.senderName ?? 'Power Smash', 60) || 'Power Smash';
  return {
    subject: `Confirm your email for ${sender} updates`,
    text: [
      'Hi there,',
      `Someone (we hope you) asked to get ${sender} updates by email at this address. To confirm, open this link within ${CONFIRM_TTL_HOURS} hours:`,
      input.confirmUrl,
      'If you did not ask for this, do nothing: we will not email you again and your address will not be used.',
      `- ${sender}`,
    ].join('\n\n'),
  };
}

export interface AnnouncementInput {
  title: string;
  body: string;
}

/** Single-line title and a multi-line body, control characters removed (line breaks kept in the body), blank runs folded. */
function cleanBody(s: string): string {
  return s
    .replace(/\r\n?/g, '\n')
    .split('\n')
    .map((line) => stripToOneLine(line, 2000))
    .join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

/**
 * The announcement every active subscriber gets (the same text for all: subscribers have no name on file). Returns the problems in
 * plain English when the text would be refused by the database (app.notify_text_ok): no email address, no phone number.
 */
export function renderSubscriberAnnouncement(input: AnnouncementInput, senderName = 'Power Smash'): { ok: true; subject: string; body: string } | { ok: false; errors: Record<string, string> } {
  const title = stripToOneLine(input.title, SUBJECT_MAX);
  const text = cleanBody(input.body);
  const errors: Record<string, string> = {};
  if (title.length < 2) errors.title = 'Write a subject of at least 2 characters.';
  else if (outboxTextProblem(title, SUBJECT_MAX, false)) errors.title = 'The subject must not hold an email address or a phone number.';
  if (text.length < 2) errors.body = 'Write the text of the email.';
  const sender = stripToOneLine(senderName, 60) || 'Power Smash';
  const body = `Hi there,\n\n${text}\n\n- ${sender}`;
  if (!errors.body && body.length > BODY_MAX) errors.body = `The text is too long: keep it under ${BODY_MAX - 100} characters.`;
  else if (!errors.body && outboxTextProblem(body, BODY_MAX, true)) errors.body = 'The text must not hold an email address, a phone number or a WhatsApp chat link.';
  if (Object.keys(errors).length > 0) return { ok: false, errors };
  return { ok: true, subject: title, body };
}
